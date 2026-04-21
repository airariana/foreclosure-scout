"""
RentCast property enrichment for Foreclosure Scout.

For each scraped property, looks up:
  - beds, baths, sqft, year_built, lot_size (via /v1/properties)
  - monthly rent estimate (via /v1/avm/rent/long-term)
  - sale AVM + nearby comparable sales (via /v1/avm/value)

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

# Diagnostic counter — log verbose details for the first N calls per run so
# failures are debuggable in CI without drowning the log on cache-hit runs.
_DIAG_CALLS_LEFT = 3


def _log_response(label: str, r: requests.Response, full_addr: str) -> None:
    """Emit diagnostic info for the first few API calls of a run."""
    global _DIAG_CALLS_LEFT
    if _DIAG_CALLS_LEFT <= 0:
        return
    _DIAG_CALLS_LEFT -= 1
    body_snippet = (r.text or "")[:300].replace("\n", " ")
    log.info(
        f"[RentCast diag] {label} status={r.status_code} "
        f"addr={full_addr!r} body={body_snippet!r}"
    )


def _fetch_property(full_addr: str, api_key: str) -> dict | None:
    """Look up property details (beds/baths/sqft/yearBuilt/lotSize/propertyType)."""
    try:
        r = requests.get(
            f"{RENTCAST_BASE}/properties",
            params={"address": full_addr},
            headers={"X-Api-Key": api_key, "Accept": "application/json"},
            timeout=15,
        )
        _log_response("property", r, full_addr)
        if r.status_code == 404:
            return None
        if r.status_code == 401:
            log.error("RentCast returned 401 — check RENTCAST_API_KEY")
            return None
        if r.status_code == 429:
            log.warning("RentCast rate-limited; backing off")
            time.sleep(2)
            return None
        if r.status_code >= 400:
            # Surface HTTP errors so we stop silently-swallowing them.
            log.warning(
                f"RentCast property {r.status_code}: {r.text[:200]!r} (addr={full_addr!r})"
            )
            return None
        data = r.json()
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict) and data:
            return data
        return None
    except Exception as e:
        log.warning(f"RentCast property lookup exception for {full_addr}: {e}")
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
        _log_response("rent", r, full_addr)
        if r.status_code in (404, 401, 429):
            return None
        if r.status_code >= 400:
            log.warning(
                f"RentCast rent {r.status_code}: {r.text[:200]!r} (addr={full_addr!r})"
            )
            return None
        data = r.json()
        return data.get("rent") or data.get("rentEstimate")
    except Exception as e:
        log.warning(f"RentCast rent lookup exception for {full_addr}: {e}")
        return None


# Max comparables to store per property. RentCast typically returns 5-10
# sorted by correlation; trimming keeps the JSON payload small.
MAX_SALE_COMPS = 8


def _fetch_sale_comps(full_addr: str, api_key: str) -> dict | None:
    """
    Look up sale AVM + nearby comparable sales.

    Returns a dict shaped:
      {
        "avm_value":       412000,
        "avm_range_low":   385000,
        "avm_range_high":  440000,
        "sale_comps": [
          { address, beds, baths, sqft, price, distance, days_on_market,
            year_built, price_per_sqft, correlation },
          ...
        ]
      }

    Returns None if RentCast can't value the address.
    """
    try:
        r = requests.get(
            f"{RENTCAST_BASE}/avm/value",
            params={"address": full_addr},
            headers={"X-Api-Key": api_key, "Accept": "application/json"},
            timeout=15,
        )
        _log_response("avm_value", r, full_addr)
        if r.status_code in (404, 401, 429):
            return None
        if r.status_code >= 400:
            log.warning(
                f"RentCast avm_value {r.status_code}: {r.text[:200]!r} (addr={full_addr!r})"
            )
            return None
        data = r.json() or {}
    except Exception as e:
        log.warning(f"RentCast avm_value exception for {full_addr}: {e}")
        return None

    avm_value = _to_int(data.get("price") or data.get("value"))
    avm_low   = _to_int(data.get("priceRangeLow"))
    avm_high  = _to_int(data.get("priceRangeHigh"))

    raw_comps = data.get("comparables") or []
    comps: list[dict] = []
    for c in raw_comps[:MAX_SALE_COMPS]:
        price = _to_int(c.get("price"))
        sqft  = _to_int(c.get("squareFootage"))
        pps   = (price // sqft) if (price and sqft) else None
        comps.append({
            "address":        c.get("formattedAddress") or c.get("address"),
            "beds":           _to_int(c.get("bedrooms")),
            "baths":          _to_float(c.get("bathrooms")),
            "sqft":           sqft,
            "price":          price,
            "distance":       _to_float(c.get("distance")),
            "days_on_market": _to_int(c.get("daysOnMarket")),
            "year_built":     _to_int(c.get("yearBuilt")),
            "price_per_sqft": pps,
            "correlation":    _to_float(c.get("correlation")),
            "latitude":       _to_float(c.get("latitude")),
            "longitude":      _to_float(c.get("longitude")),
        })

    if not (avm_value or comps):
        return None

    return {
        "avm_value":      avm_value,
        "avm_range_low":  avm_low,
        "avm_range_high": avm_high,
        "sale_comps":     comps,
    }


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
        full_addr = _build_full_address(p)

        # 1. Cache hit. Backfill sale_comps on old cache entries that pre-date
        #    the AVM fetch, so we don't burn the full 2-call property+rent
        #    budget again on already-enriched properties.
        if key in cache and cache[key]:
            entry = cache[key]
            if "sale_comps" not in entry and full_addr:
                comps = _fetch_sale_comps(full_addr, api_key)
                stats["api_calls"] += 1
                time.sleep(RATE_LIMIT_SECONDS)
                entry["avm_value"]      = (comps or {}).get("avm_value")
                entry["avm_range_low"]  = (comps or {}).get("avm_range_low")
                entry["avm_range_high"] = (comps or {}).get("avm_range_high")
                entry["sale_comps"]     = (comps or {}).get("sale_comps") or []
                cache[key] = entry
            _apply(p, entry)
            stats["cache_hits"] += 1
            continue

        # 2. In retry queue and already attempted too many times → skip.
        if key in retry and retry[key].get("attempts", 0) >= MAX_RETRY_ATTEMPTS:
            stats["skipped"] += 1
            continue

        # 3. Fetch fresh from RentCast.
        if not full_addr:
            stats["skipped"] += 1
            continue

        prop_data = _fetch_property(full_addr, api_key)
        stats["api_calls"] += 1
        time.sleep(RATE_LIMIT_SECONDS)

        rent_data = _fetch_rent(full_addr, api_key)
        stats["api_calls"] += 1
        time.sleep(RATE_LIMIT_SECONDS)

        comps_data = _fetch_sale_comps(full_addr, api_key)
        stats["api_calls"] += 1
        time.sleep(RATE_LIMIT_SECONDS)

        if prop_data or rent_data or comps_data:
            enrichment = {
                "beds":           _to_int(_first(prop_data, "bedrooms", "beds")),
                "baths":          _to_float(_first(prop_data, "bathrooms", "baths")),
                "sqft":           _to_int(_first(prop_data, "squareFootage", "livingArea")),
                "year_built":     _to_int(_first(prop_data, "yearBuilt", "year_built")),
                "lot_size":       _to_int(_first(prop_data, "lotSize", "lot_size")),
                "property_type":  (prop_data or {}).get("propertyType"),
                "rent_estimate":  _to_int(rent_data),
                "avm_value":      (comps_data or {}).get("avm_value"),
                "avm_range_low":  (comps_data or {}).get("avm_range_low"),
                "avm_range_high": (comps_data or {}).get("avm_range_high"),
                "sale_comps":     (comps_data or {}).get("sale_comps") or [],
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
    # Sale AVM + comps feed the frontend's market-comparison widget.
    if enr.get("avm_value"):      p["avm_value"]      = int(enr["avm_value"])
    if enr.get("avm_range_low"):  p["avm_range_low"]  = int(enr["avm_range_low"])
    if enr.get("avm_range_high"): p["avm_range_high"] = int(enr["avm_range_high"])
    if enr.get("sale_comps"):     p["sale_comps"]     = enr["sale_comps"]
