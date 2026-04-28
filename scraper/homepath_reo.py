"""
HomePath REO scraper (Fannie Mae).

Approach: bounding-box queries against the public JSON API at
  GET https://homepath.fanniemae.com/cfl/property-inventory/search
       ?bounds={swLat},{swLng},{neLat},{neLng}

The API returns up to 400 properties per call (out of ~613k nationwide).
Filter param `bounds` is the only one that actually narrows results — all
other GET params (state, city, searchText, pageSize, etc.) are silently
ignored. This was reverse-engineered by capturing the XHR call the Angular
SPA fires when the user filters by location on the map view.

To capture all DC/MD/VA properties in 400-per-call pages, we issue several
overlapping bounding-box queries — each covering a quadrant of the DMV
region — and dedupe by propertyUuid. WV/KY/OH/NC/DE/TN bleed is filtered
out client-side.

No auth, no reCAPTCHA, no Playwright needed for the actual scrape — just
a plain HTTPS GET with a desktop UA. Robots.txt does not disallow /cfl/.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from typing import Any

import requests

log = logging.getLogger(__name__)

API = "https://homepath.fanniemae.com/cfl/property-inventory/search"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
TARGET_STATES = {"DC", "MD", "VA"}

# Sub-bounding boxes that together cover the DMV. Overlapping is fine —
# we dedupe by propertyUuid. Each bbox is (sw_lat, sw_lng, ne_lat, ne_lng).
# Tighter boxes mean fewer non-target states bleed in and we use the
# 400-property page budget more efficiently.
DMV_BBOXES = [
    # Northern Virginia + DC + Montgomery/PG MD
    (38.50, -78.20, 39.50, -76.50),
    # Central Virginia (Fredericksburg / Charlottesville / Richmond)
    (37.20, -78.80, 38.50, -76.80),
    # Eastern Maryland (Eastern Shore + Baltimore)
    (38.00, -77.20, 39.75, -75.05),
    # SE Virginia (Tidewater / Hampton Roads)
    (36.50, -77.50, 37.50, -75.50),
    # SW Virginia (Roanoke / Lynchburg / Bristol)
    (36.50, -83.70, 37.80, -78.80),
    # Western Maryland panhandle
    (39.20, -79.50, 39.75, -77.20),
]


def scrape_homepath_reo() -> list[dict]:
    """Pull HomePath (Fannie Mae REO) listings for DC/MD/VA via bbox queries."""
    log.info("Scraping HomePath (Fannie Mae REO) ...")
    seen: dict[str, dict] = {}  # propertyUuid -> attrs (last write wins; same shape across calls)

    for i, (sw_lat, sw_lng, ne_lat, ne_lng) in enumerate(DMV_BBOXES, 1):
        bounds = f"{sw_lat},{sw_lng},{ne_lat},{ne_lng}"
        try:
            r = requests.get(
                API,
                params={"bounds": bounds},
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=20,
            )
            if r.status_code != 200:
                log.warning(f"HomePath bbox {i}: HTTP {r.status_code}")
                continue
            data = r.json()
            ps = data.get("properties") or []
            in_dmv = [p for p in ps if (p.get("state") or "").upper() in TARGET_STATES]
            for p in in_dmv:
                uuid = p.get("propertyUuid")
                if uuid and uuid not in seen:
                    seen[uuid] = p
            log.info(
                f"HomePath bbox {i}/{len(DMV_BBOXES)}: {len(ps)} props in box, "
                f"{len(in_dmv)} DMV, {len(seen)} unique total"
            )
        except Exception as e:
            log.warning(f"HomePath bbox {i}: {e}")
        time.sleep(0.7)

    properties = [_to_property(attrs) for attrs in seen.values()]
    properties = [p for p in properties if p is not None]
    log.info(f"HomePath: {len(properties)} unique DMV properties")
    return properties


def _to_property(a: dict) -> dict | None:
    """Map the HomePath API attrs to the v2.1 schema."""
    address = (a.get("addressLine1") or "").strip()
    city = (a.get("city") or "").strip().title()  # API returns ALL CAPS
    state = (a.get("state") or "").upper()
    zip_code = (a.get("zipCode") or "").strip()
    if not address or not state:
        return None

    price = _to_int(a.get("price"))
    if not price:
        return None

    beds = _to_int(a.get("bedrooms"))
    baths = _to_float(a.get("bathrooms"))
    sqft = _to_int(a.get("sqft"))
    year_built = _to_int(a.get("yearBuilt"))
    property_type = _normalize_property_type(a.get("propertyType"))

    # Geo
    geo = a.get("geoPoint") or {}
    lat = _to_float(geo.get("lat") or geo.get("latitude"))
    lng = _to_float(geo.get("lon") or geo.get("lng") or geo.get("longitude"))

    # Listing dates / status
    listing_start_ms = a.get("listingStartDate")
    list_date = None
    if listing_start_ms:
        try:
            list_date = datetime.utcfromtimestamp(int(listing_start_ms) / 1000).date().isoformat()
        except Exception:
            pass

    # County normalization (API returns "FAIRFAX COUNTY" / "PRINCE GEORGES COUNTY" / etc.)
    county_raw = (a.get("county") or "").strip()
    county = _normalize_county(county_raw, state)

    # Investment metrics (mirror hud_reo + va_vendee + homesteps)
    arv_estimate = int(round(price * 1.05))
    monthly_rent_estimate = int(round(arv_estimate * 0.007)) if arv_estimate else 0
    mortgage_monthly = int(round(price * 0.006))
    prop_tax = int(round(arv_estimate * 0.009 / 12))
    insurance = int(round(arv_estimate * 0.005 / 12))
    vacancy = int(round(monthly_rent_estimate * 0.08))
    cash_flow = monthly_rent_estimate - mortgage_monthly - prop_tax - insurance - vacancy
    noi_annual = (monthly_rent_estimate - prop_tax - insurance - vacancy) * 12
    cap_rate = round((noi_annual / price * 100), 1) if price else 0
    rehab_assumed = int(round(arv_estimate * 0.08))
    mao_70 = int(round(arv_estimate * 0.70 - rehab_assumed))
    gap_to_mao = price - mao_70
    passes_70 = price <= mao_70
    dscr = round(monthly_rent_estimate / mortgage_monthly, 2) if mortgage_monthly > 0 else 0

    score = 60
    if passes_70: score += 8
    if dscr >= 1.25: score += 5
    elif 0 < dscr < 1.0: score -= 5
    if cap_rate >= 8: score += 5
    elif cap_rate < 4: score -= 3
    if not sqft: score -= 3
    score = max(0, min(100, score))
    grade = "A+" if score >= 90 else "A" if score >= 80 else "B" if score >= 70 else "C" if score >= 60 else "D"

    pricing = {
        "eav":                     price,
        "arv":                     arv_estimate,
        "confidence":              "HIGH — HomePath list price",
        "county_base":             None,
        "type_multiplier":         1.0,
        "opening_bid":             price,
        "original_loan":           None,
        "monthly_rent_estimate":   monthly_rent_estimate,
        "rent_source":             "heuristic",
        "cash_flow_estimate":      cash_flow,
        "cap_rate":                cap_rate,
        "discount_to_arv":         round((1 - price / arv_estimate) * 100, 1),
        "mao_70":                  mao_70,
        "gap_to_mao":              gap_to_mao,
        "passes_70_rule":          passes_70,
        "dscr":                    dscr,
        "score":                   score,
        "grade":                   grade,
    }

    tags = [f"{state} REO", "HomePath", "Fannie Mae"]
    if a.get("firstLookProgramIndicator"):
        tags.append("First Look")
    if a.get("auction"):
        tags.append("Auction")
    if a.get("hecmInd"):
        tags.append("HECM")  # Reverse-mortgage REO
    if a.get("tenantOccupied"):
        tags.append("Tenant Occupied")

    reo_id = a.get("reoId") or ""
    # HomePath's SPA does not expose stable per-property permalinks —
    # /property-details/{uuid} silently redirects to /404. Save the search
    # page as the source URL so the frontend deep-link doesn't break.
    detail_url = "https://homepath.fanniemae.com/property-finder"

    return {
        "id":               _make_id(reo_id, address, state),
        "source":           "HomePath",
        "source_url":       detail_url,
        "primary_photo_url": a.get("primHiResImageUrl") or None,
        "firm_file_number": reo_id or a.get("mlsId") or None,
        "address":          address.title(),
        "city":             city,
        "state":            state,
        "zip_code":         zip_code,
        "county":           county,
        "lat":              lat,
        "lng":              lng,
        "sale_date":        None,
        "sale_date_raw":    None,
        "sale_time":        None,
        "sale_location":    None,
        "listingType":      "REO/Bank-Owned",
        "property_type":    property_type,
        "sqft":             sqft,
        "beds":             beds,
        "baths":            baths,
        "year_built":       year_built,
        "pricing":          pricing,
        "tags":             tags,
        "status":           (a.get("propertyListingStatus") or "active").lower(),
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     None,
        "list_date":        list_date,
    }


def _to_int(v: Any) -> int | None:
    if v is None: return None
    try: return int(float(str(v)))
    except (ValueError, TypeError): return None


def _to_float(v: Any) -> float | None:
    if v is None: return None
    try: return float(v)
    except (ValueError, TypeError): return None


def _normalize_property_type(s: str | None) -> str:
    if not s: return "Single Family"
    s = s.lower()
    if "single" in s: return "Single Family"
    if "town" in s: return "Townhouse"
    if "condo" in s: return "Condo"
    if "multi" in s or "duplex" in s: return "Multi-Family"
    if "mobile" in s or "manuf" in s: return "Mobile Home"
    if "land" in s or "lot" in s: return "Land"
    return s.title()


def _normalize_county(raw: str, state: str) -> str:
    """HomePath returns county in ALL CAPS, sometimes without 'County' suffix."""
    if not raw or raw.lower() in ("", "unknown"):
        return "Unknown County"
    name = raw.strip().title()
    # API uses uppercase abbreviations like "PRINCE GEORGES" — convert apostrophes
    name = name.replace("'S", "'s")
    if state == "VA":
        # Independent cities in VA. Keep "X City" format if present.
        if name.endswith(" City") or name.endswith(" Co"):
            return name.replace(" Co", " County")
        if "City" in name:
            return name
        if not name.endswith(" County"):
            name += " County"
        return name
    if state == "MD":
        if not name.endswith(" County"):
            name += " County"
        return name
    if state == "DC":
        return "District of Columbia"
    return name


def _make_id(reo_id: str, address: str, state: str) -> str:
    raw = f"homepath:{reo_id}:{address.lower()}:{state.lower()}"
    return f"{state.lower()}-homepath-{hashlib.md5(raw.encode()).hexdigest()[:8]}"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    rows = scrape_homepath_reo()
    print(f"\nGot {len(rows)} HomePath properties")
    by_state = {}
    for r in rows:
        by_state[r["state"]] = by_state.get(r["state"], 0) + 1
    print("By state:", by_state)
    for r in rows[:5]:
        print(f"  {r['state']} {r['city']} | {r['address']} | ${r['pricing']['eav']:,} · {r['beds']}bd/{r['baths']}ba {r['sqft']}sf · {r['property_type']}")
