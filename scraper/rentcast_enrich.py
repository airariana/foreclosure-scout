"""
RentCast property enrichment for Foreclosure Scout.

For each scraped property, looks up:
  - beds, baths, sqft, year_built, lot_size (via /v1/properties)
  - monthly rent estimate (via /v1/avm/rent/long-term)

Strategy:
  - Cache successful lookups by normalized address key → avoid repeat API calls
    for the same property each week.
  - Properties RentCast can't match (rural, new construction, typos) land in a
    retry queue for next run rather than getting cached as permanent misses.

Files (committed to repo so GitHub Actions persists them across runs):
  data/enrichment_cache.json  — { normalized_key: { beds, baths, sqft, ... } }
  data/enrichment_retry.json  — { normalized_key: { address, last_attempt, attempts } }
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

RENTCAST_BASE      = "https://api.rentcast.io/v1"
CACHE_PATH         = Path("data/enrichment_cache.json")
RETRY_PATH         = Path("data/enrichment_retry.json")
RATE_LIMIT_SECONDS = 0.2   # gentle pacing between calls
MAX_RETRY_ATTEMPTS = 6     # after 6 weeks of whiffs, stop trying


# ── Cache helpers ────────────────────────────────────────────────────────────

def _load_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception as e:
            log.warning(f"Could not parse {path}, starting fresh: {e}")
    return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str, sort_keys=True))


def _normalize_key(address: str, city: str, state: str, zip_code: str) -> str:
    """
    Build a stable cache key from a (possibly messy) address.
    Collapses whitespace, strips punctuation, lowercases. Same key for
    "123 Main St" / "123 Main Street" would be nice but we don't abbreviate-
    expand here (RentCast itself handles most variations).
    """
    parts = [address or "", city or "", (state or "").upper(), zip_code or ""]
    joined = "::".join(p.strip() for p in parts)
    joined = re.sub(r"\s+", " ", joined).lower()
    return joined


# ── API calls ────────────────────────────────────────────────────────────────

def _fetch_property(full_addr: str, api_key: str) -> dict | None:
    """Look up property details (beds/baths/sqft/yearBuilt/lotSize/propertyType)."""
    try:
        r = requests.get(
            f"{RENTCAST_BASE}/properties",
            params={"address": full_addr},
            headers={"X-Api-Key": api_key, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code == 404:
            return None
        if r.status_code == 401:
            log.error("RentCast returned 401 — check RENTCAST_API_KEY")
            return None
        if r.status_code == 429:
            log.warning("RentCast rate-limited; backing off")
            time.sleep(2)
            return None
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict) and data:
            return data
        return None
    except Exception as e:
        log.debug(f"RentCast property lookup failed for {full_addr}: {e}")
        return None


def _fetch_rent(full_addr: str, api_key: str) -> float | None:
    """Look up long-term rent estimate."""
    try:
        r = requests.get(
            f"{RENTCAST_BASE}/avm/rent/long-term",
            params={"address": full_addr},
            headers={"X-Api-Key": api_key, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code in (404, 401, 429):
            return None
        r.raise_for_status()
        data = r.json()
        return data.get("rent") or data.get("rentEstimate")
    except Exception as e:
        log.debug(f"RentCast rent lookup failed for {full_addr}: {e}")
        return None


# ── Public entry point ───────────────────────────────────────────────────────

def enrich_properties(properties: list[dict], api_key: str) -> dict:
    """
    Enrich a list of property dicts in-place with beds/baths/sqft/year_built
    and monthly rent estimate from RentCast.

    Returns stats dict: {total, cache_hits, api_calls, succeeded, retried, skipped}.
    """
    if not api_key:
        log.warning("RENTCAST_API_KEY not set — skipping enrichment")
        return {"total": len(properties), "skipped": len(properties)}

    cache = _load_json(CACHE_PATH)
    retry = _load_json(RETRY_PATH)
    now   = datetime.utcnow().isoformat() + "Z"

    stats = {
        "total":       len(properties),
        "cache_hits":  0,
        "api_calls":   0,
        "succeeded":   0,
        "retried":     0,
        "skipped":     0,
    }

    for p in properties:
        key = _normalize_key(
            p.get("address") or "",
            p.get("city") or "",
            p.get("state") or "VA",
            p.get("zip_code") or "",
        )

        # 1. Cache hit — use stored data, no API call.
        if key in cache and cache[key]:
            _apply(p, cache[key])
            stats["cache_hits"] += 1
            continue

        # 2. In retry queue and already attempted too many times → skip.
        if key in retry and retry[key].get("attempts", 0) >= MAX_RETRY_ATTEMPTS:
            stats["skipped"] += 1
            continue

        # 3. Fetch fresh from RentCast.
        full_addr = _build_full_address(p)
        if not full_addr:
            stats["skipped"] += 1
            continue

        prop_data = _fetch_property(full_addr, api_key)
        stats["api_calls"] += 1
        time.sleep(RATE_LIMIT_SECONDS)

        rent_data = _fetch_rent(full_addr, api_key)
        stats["api_calls"] += 1
        time.sleep(RATE_LIMIT_SECONDS)

        if prop_data or rent_data:
            enrichment = {
                "beds":           _to_int(_first(prop_data, "bedrooms", "beds")),
                "baths":          _to_float(_first(prop_data, "bathrooms", "baths")),
                "sqft":           _to_int(_first(prop_data, "squareFootage", "livingArea")),
                "year_built":     _to_int(_first(prop_data, "yearBuilt", "year_built")),
                "lot_size":       _to_int(_first(prop_data, "lotSize", "lot_size")),
                "property_type":  (prop_data or {}).get("propertyType"),
                "rent_estimate":  _to_int(rent_data),
                "enriched_at":    now,
            }
            cache[key] = enrichment
            retry.pop(key, None)
            _apply(p, enrichment)
            stats["succeeded"] += 1
        else:
            # Couldn't match — add/bump retry counter.
            existing = retry.get(key, {})
            retry[key] = {
                "address":      full_addr,
                "last_attempt": now,
                "attempts":     int(existing.get("attempts", 0)) + 1,
            }
            stats["retried"] += 1

    # Persist cache + retry state.
    _save_json(CACHE_PATH, cache)
    _save_json(RETRY_PATH, retry)
    return stats


# ── Helpers ──────────────────────────────────────────────────────────────────

def _build_full_address(p: dict) -> str:
    parts = [p.get("address"), p.get("city"), p.get("state") or "VA", p.get("zip_code")]
    return ", ".join(str(x).strip() for x in parts if x)


def _first(d: dict | None, *keys):
    if not d:
        return None
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return None


def _to_int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _to_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _apply(p: dict, enr: dict) -> None:
    """
    Apply enrichment data to a property dict. Only overrides fields that we
    currently have at 0/null defaults — never overwrite values the source
    already provided (e.g., BWW-listed original loan amount).
    """
    if enr.get("beds"):       p["beds"]       = int(enr["beds"])
    if enr.get("baths"):      p["baths"]      = float(enr["baths"])
    if enr.get("sqft"):       p["sqft"]       = int(enr["sqft"])
    if enr.get("year_built"): p["yearBuilt"]  = int(enr["year_built"])
    if enr.get("lot_size"):   p["lot_size"]   = int(enr["lot_size"])
    # Expose enrichment metadata for UI/debugging.
    p["_enriched"] = True
    if enr.get("rent_estimate"):
        p["_rent_override"] = int(enr["rent_estimate"])
