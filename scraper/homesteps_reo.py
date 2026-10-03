"""
HomeSteps REO scraper — Freddie Mac's bank-owned property portal.

homesteps.com publishes search results as a Drupal Views page with both
HTML markup and JSON-LD structured data per listing. We parse the
JSON-LD because it's stable across Drupal theme changes, and falls back
to nothing — so a layout refactor on Freddie Mac's side won't silently
return zero properties (we'd see the count drop and investigate).

URL: /listing/search?search={STATE}&items_per_page=200
  - One large page returns all listings for the state (typical inventory
    < 50 per state in DC/MD/VA, so 200 is more than enough).
  - JSON-LD blocks: <script type="application/ld+json"> with
    {"@type": ["RealEstateListing"], name, url, address: {streetAddress,
    addressLocality, addressRegion, postalCode}, offers: {price, ...,
    itemOffered: {numberOfBedrooms, numberOfBathroomsTotal}}}.

Robots.txt allows /listing/* (only /core/ /admin/ /comment/ /node/add/
/search/ are disallowed). The site is Cloudflare-fronted but doesn't
challenge plain server-side curl with a desktop UA.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

HS_BASE = "https://www.homesteps.com"
LIST_URL = HS_BASE + "/listing/search"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
TARGET_STATES = ["DC", "MD", "VA"]


def scrape_homesteps_reo() -> list[dict]:
    """Pull HomeSteps (Freddie Mac REO) listings for DC/MD/VA."""
    log.info("Scraping HomeSteps (Freddie Mac REO) ...")
    properties: list[dict] = []

    for state in TARGET_STATES:
        before = len(properties)
        try:
            properties.extend(_scrape_state(state))
            log.info(f"HomeSteps {state}: {len(properties) - before} properties")
        except Exception as e:
            log.warning(f"HomeSteps {state}: scrape failed: {e}")
        time.sleep(0.5)

    log.info(f"HomeSteps: {len(properties)} total properties")
    return properties


def _scrape_state(state: str) -> list[dict]:
    r = requests.get(
        LIST_URL,
        params={"search": state, "items_per_page": "200"},
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        timeout=20,
    )
    if r.status_code != 200:
        log.warning(f"HomeSteps {state}: HTTP {r.status_code}")
        return []
    return _parse_listings(r.text, state)


def _parse_listings(html: str, state_filter: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    seen_urls: set[str] = set()

    # Build a {detail_url -> photo_url} map by scanning the visible card
    # markup. Each <a id="node-XXXX" href="/listingdetails/..."> wraps an
    # <img src="https://rbimages.blob.core.windows.net/...">. The JSON-LD
    # blocks have the same /listingdetails URL but no photo, so we join
    # them by URL when building the property dict.
    photo_by_url: dict[str, str] = {}
    for a in soup.select("a[href^='/listingdetails/']"):
        img = a.find("img")
        if img and img.get("src"):
            href = a.get("href", "")
            full = f"https://www.homesteps.com{href}" if href.startswith("/") else href
            photo_by_url[full] = img["src"]

    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or "")
        except Exception:
            continue
        # The page also has a SearchAction LD block; only keep RealEstateListing.
        if not _is_real_estate_listing(data):
            continue
        prop = _build_property(data, state_filter)
        if prop and prop["source_url"] not in seen_urls:
            seen_urls.add(prop["source_url"])
            # Attach the photo URL we extracted from the card HTML.
            photo = photo_by_url.get(prop["source_url"])
            if photo:
                prop["primary_photo_url"] = photo
            out.append(prop)

    return out


def _is_real_estate_listing(d: Any) -> bool:
    t = d.get("@type")
    if isinstance(t, list):
        return "RealEstateListing" in t
    return t == "RealEstateListing"


def _build_property(d: dict, state_filter: str) -> dict | None:
    name = d.get("name") or ""
    detail_url = d.get("url") or ""
    if not detail_url:
        return None

    # Address
    loc = d.get("@location") or d.get("location") or {}
    addr = (loc or {}).get("address") or {}
    street = (addr.get("streetAddress") or "").strip()
    city = (addr.get("addressLocality") or "").strip()
    state = (addr.get("addressRegion") or "").strip().upper()
    zip_code = (addr.get("postalCode") or "").strip()
    if not street or state != state_filter:
        return None

    # Price + accommodation specs
    offers = d.get("offers") or {}
    price = _parse_money(offers.get("price"))
    item = offers.get("itemOffered") or {}
    beds = _to_int(item.get("numberOfBedrooms"))
    baths = _to_int(item.get("numberOfBathroomsTotal"))
    accommodation = (item.get("accommodationCategory") or "").strip()

    # Active/Pending status from additionalProperty array
    status = "active"
    for ap in d.get("additionalProperty") or []:
        if (ap or {}).get("name") == "Status":
            status = ((ap or {}).get("value") or "active").strip().lower()
            break

    # Investment metrics — same shape as hud_reo / va_vendee
    if not price:
        return None
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
    score = max(0, min(100, score))
    grade = "A+" if score >= 90 else "A" if score >= 80 else "B" if score >= 70 else "C" if score >= 60 else "D"

    pricing = {
        "eav":                     price,
        "arv":                     arv_estimate,
        "confidence":              "HIGH — HomeSteps list price",
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

    tags = [f"{state} REO", "HomeSteps", "Freddie Mac"]

    detail_id = _extract_detail_id(detail_url)

    return {
        "id":               _make_id(detail_id, street, state),
        "source":           "HomeSteps",
        "source_url":       detail_url,
        "primary_photo_url": None,  # filled in by _parse_listings via card HTML
        "firm_file_number": detail_id,
        "address":          street,
        "city":             city,
        "state":            state,
        "zip_code":         zip_code,
        "county":           "Unknown County",  # Resolved by main scraper geocoder
        "lat":              None,
        "lng":              None,
        "sale_date":        None,
        "sale_date_raw":    None,
        "sale_time":        None,
        "sale_location":    None,
        "listingType":      "REO/Bank-Owned",
        "property_type":    _accommodation_to_type(accommodation),
        "sqft":             None,  # JSON-LD doesn't expose floorSize on HomeSteps
        "beds":             beds,
        "baths":            baths,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             tags,
        "status":           status,
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     None,
    }


# ── helpers ────────────────────────────────────────────────────────────────

def _parse_money(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    digits = re.sub(r"[^\d]", "", str(v))
    return int(digits) if digits else None


def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(float(str(v)))
    except (ValueError, TypeError):
        return None


def _extract_detail_id(url: str) -> str | None:
    # /listingdetails/804-carter-st-martinsville-va-24112
    m = re.search(r"/listingdetails/([^/?#]+)", url or "")
    return m.group(1) if m else None


def _accommodation_to_type(s: str) -> str:
    if not s:
        return "Single Family"
    s = s.lower()
    if "single" in s: return "Single Family"
    if "town" in s or "row" in s: return "Townhouse"
    if "condo" in s: return "Condo"
    if "multi" in s or "duplex" in s: return "Multi-Family"
    if "mobile" in s or "manufactured" in s: return "Mobile Home"
    if "land" in s or "lot" in s: return "Land"
    return "Single Family"


def _make_id(detail_id: str | None, address: str, state: str) -> str:
    raw = f"homesteps:{detail_id or ''}:{address.lower()}:{state.lower()}"
    return f"{state.lower()}-homesteps-{hashlib.md5(raw.encode()).hexdigest()[:8]}"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    rows = scrape_homesteps_reo()
    print(f"Got {len(rows)} HomeSteps properties")
    for r in rows[:5]:
        print(f"  {r['state']} {r['city']} | {r['address']} | ${r['pricing']['eav']:,} · {r['beds']}bd/{r['baths']}ba · {r['property_type']}")
