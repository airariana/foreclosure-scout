"""
VA Vendee REO scraper.

VRM Properties (vrmproperties.com) is the public listing portal for VA
Vendee Resource Management Corporation — the federal contractor that
manages the disposition of REO properties acquired by the U.S. Department
of Veterans Affairs after foreclosure on VA-guaranteed mortgages.

Listings are public, no auth required. Robots.txt disallows /Auth /Error
/User /Lead — /Properties-For-Sale is fair game.

URL pattern:
  https://www.vrmproperties.com/Properties-For-Sale?state={ST}&currentpage={N}

Listing card markup (per page, ~16 cards):
  <a href="/Property-For-Sale/{id}/{slug-with-address}">
    <img class="img-fit" alt="Photo of {slug}">
  ...
  <h6 class="card-subtitle">$XXX,XXX</h6>
  <span>{N}&nbsp;<i title="Beds">    <span>{N}&nbsp;<i title="Baths">
  <span>{NNN}&nbsp;<i title="Sqr. Feet">
  <p class="card-text properCase">{street}<br />{city}, {ST}  {zip}</p>
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

VRM_BASE = "https://www.vrmproperties.com"
LIST_URL = VRM_BASE + "/Properties-For-Sale"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
TARGET_STATES = ["DC", "MD", "VA"]
MAX_PAGES_PER_STATE = 10  # Safety guard against accidental infinite pagination


def scrape_va_vendee() -> list[dict]:
    """Pull VA REO listings for DC/MD/VA from VRM Properties."""
    log.info("Scraping VA Vendee (VRM Properties) ...")
    properties: list[dict] = []

    for state in TARGET_STATES:
        before = len(properties)
        try:
            properties.extend(_scrape_state(state))
            log.info(f"VA Vendee {state}: {len(properties) - before} properties")
        except Exception as e:
            log.warning(f"VA Vendee {state}: scrape failed: {e}")

    log.info(f"VA Vendee: {len(properties)} total properties")
    return properties


def _scrape_state(state: str) -> list[dict]:
    """Paginate through one state's listings."""
    out: list[dict] = []
    seen_urls: set[str] = set()

    for page in range(1, MAX_PAGES_PER_STATE + 1):
        try:
            r = requests.get(
                LIST_URL,
                params={
                    "state": state,
                    "currentpage": page,
                    "orderby": "default desc",
                    "orderbytext": "Default",
                    "propertystatus": "for-sale_coming-soon",
                },
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
                timeout=15,
            )
            if r.status_code != 200:
                log.warning(f"VA Vendee {state} page {page}: HTTP {r.status_code}")
                break

            cards = _parse_listing_page(r.text, state)
            new_cards = [c for c in cards if c["source_url"] not in seen_urls]
            for c in new_cards:
                seen_urls.add(c["source_url"])
            out.extend(new_cards)

            # Heuristic stop: if this page returned fewer than 5 new cards,
            # we've likely hit the last page (or pagination is wrapping).
            if len(new_cards) < 5:
                break
            time.sleep(0.5)
        except requests.RequestException as e:
            log.warning(f"VA Vendee {state} page {page}: request failed: {e}")
            break

    return out


def _parse_listing_page(html: str, state: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    for card in soup.select(".prop-card-container"):
        prop = _parse_card(card, state)
        if prop:
            out.append(prop)
    return out


def _parse_card(card, state_filter: str) -> dict | None:
    # Detail link → property ID + slug
    link = card.select_one("a[href^='/Property-For-Sale/']")
    if not link:
        return None
    href = link.get("href", "")
    detail_url = urljoin(VRM_BASE, href)
    m = re.match(r"/Property-For-Sale/(\d+)/", href)
    detail_id = m.group(1) if m else None

    # Address block: "<street><br/><city>, <ST>  <zip>"
    addr_p = card.select_one(".card-text.properCase")
    if not addr_p:
        return None
    raw = addr_p.get_text("\n", strip=True)
    address, city, state_code, zip_code = _split_address_block(raw)
    if not address or not state_code:
        return None
    if state_code != state_filter:
        # Sometimes search results bleed across states; trust the per-state scope.
        return None

    # Price
    price_el = card.select_one("h6.card-subtitle")
    price = _parse_money(price_el.get_text(strip=True)) if price_el else None
    if not price:
        return None  # No-price cards aren't useful for underwriting

    # Beds / baths / sqft from <span><N>&nbsp;<i title="Beds|Baths|Sqr. Feet"></i></span>
    beds = _parse_int_with_title(card, "Beds")
    baths = _parse_int_with_title(card, "Baths")
    sqft = _parse_int_with_title(card, "Sqr. Feet")

    # Status (For Sale / Coming Soon / Pending / Withdrawn)
    status_el = card.select_one(".property-status")
    status = status_el.get_text(strip=True) if status_el else "For Sale"

    arv_estimate = int(round(price * 1.05))  # REO list price ≈ market
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

    score = 60  # Baseline for REO with full data
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
        "confidence":              "HIGH — VA Vendee list price",
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

    tags = [f"{state_code} REO", "VA Vendee", "Vendee Eligible"]

    return {
        "id":               _make_id(detail_id, address, state_code),
        "source":           "VA Vendee",
        "source_url":       detail_url,
        "firm_file_number": detail_id,
        "address":          address,
        "city":             city,
        "state":            state_code,
        "zip_code":         zip_code,
        "county":           "Unknown County",  # Not in card; main scraper geocoder enriches
        "lat":              None,
        "lng":              None,
        "sale_date":        None,            # REO is for-sale, not auctioned
        "sale_date_raw":    None,
        "sale_time":        None,
        "sale_location":    None,
        "listingType":      "REO/Bank-Owned",
        "property_type":    "Single Family",
        "sqft":             sqft,
        "beds":             beds,
        "baths":            baths,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             tags,
        "status":           status,
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     None,
    }


# ── parsing helpers ────────────────────────────────────────────────────────

ADDR_LINE_RX = re.compile(r"^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$")


def _split_address_block(raw: str) -> tuple[str | None, str | None, str | None, str | None]:
    """
    Split "1700 wilson road\\nnorfolk, VA  23523" into
    ("1700 Wilson Road", "Norfolk", "VA", "23523").
    """
    parts = [p.strip() for p in raw.split("\n") if p.strip()]
    if len(parts) < 2:
        return None, None, None, None
    street = parts[0]
    m = ADDR_LINE_RX.match(parts[1])
    if not m:
        return None, None, None, None
    city, state, zipc = m.group(1).strip(), m.group(2), m.group(3)
    return _titlecase(street), _titlecase(city), state, zipc


def _titlecase(s: str) -> str:
    """Title-case but keep small joiners lowercase and ALL-CAPS state-like bits intact."""
    if not s:
        return s
    return " ".join(w.capitalize() for w in re.split(r"\s+", s.strip()))


def _parse_money(text: str) -> int | None:
    if not text:
        return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def _parse_int_with_title(card, title: str) -> int | None:
    """
    Find <span>{N}&nbsp;<i title="Beds"></i></span> and pull the integer.
    """
    icon = card.find("i", attrs={"title": title})
    if not icon:
        return None
    span = icon.parent
    if not span:
        return None
    txt = span.get_text(" ", strip=True)
    m = re.search(r"([\d,]+)", txt)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _make_id(detail_id: str | None, address: str, state: str) -> str:
    raw = f"vendee:{detail_id or ''}:{address.lower()}:{state.lower()}"
    return f"{state.lower()}-vendee-{hashlib.md5(raw.encode()).hexdigest()[:8]}"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    rows = scrape_va_vendee()
    print(f"Got {len(rows)} VA Vendee properties")
    for r in rows[:3]:
        print(f"  {r['state']} {r['city']} | {r['address']} | ${r['pricing']['eav']:,} · {r['beds']}bd/{r['baths']}ba {r['sqft']}sf")
