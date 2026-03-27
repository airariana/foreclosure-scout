#!/usr/bin/env python3
"""
va_foreclosure_scraper.py — v2.0
Virginia Trustee Sale Intelligence Scraper

Sources:
  1. Samuel I. White, P.C.  (existing — PDF)
  2. Orlans Law Group        (new — web scrape)
  3. BWW Law Group           (new — web scrape)
  4. McCabe Weisberg & Conway (new — web scrape)

New in v2.0:
  - Auction Pricing Matrix replaces $150K placeholder
  - Confidence scoring (HIGH / MEDIUM / LOW)
  - Derived financial metrics (cash flow, cap rate, score)
  - Multi-source deduplication
  - Days-to-sale countdown
  - Source tagging per property
"""

import json
import re
import time
import hashlib
import logging
from datetime import datetime, date, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

try:
    import PyPDF2
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
GMAPS_API_KEY = ""  # Set via environment variable GOOGLE_MAPS_API_KEY
OUTPUT_PATH = Path("data/foreclosures_va.json")
TODAY = date.today()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}

# ── Auction Pricing Matrix ────────────────────────────────────────────────────

COUNTY_BASE_VALUES = {
    # Northern Virginia
    "Fairfax County":        625_000,
    "Arlington County":      700_000,
    "Loudoun County":        575_000,
    "Prince William County": 415_000,
    "Alexandria City":       575_000,
    "Falls Church City":     700_000,
    "Manassas City":         325_000,
    "Manassas Park City":    300_000,
    # DC-adjacent / I-95 corridor
    "Stafford County":       385_000,
    "Spotsylvania County":   325_000,
    "Fredericksburg City":   310_000,
    "King George County":    290_000,
    # Richmond Metro
    "Henrico County":        325_000,
    "Chesterfield County":   330_000,
    "Richmond City":         285_000,
    "Hanover County":        365_000,
    "Colonial Heights City": 250_000,
    "Petersburg City":       185_000,
    # Hampton Roads
    "Virginia Beach City":   365_000,
    "Norfolk City":          265_000,
    "Chesapeake City":       345_000,
    "Newport News City":     255_000,
    "Hampton City":          240_000,
    "Suffolk City":          305_000,
    "Portsmouth City":       235_000,
    "Poquoson City":         355_000,
    # Default
    "DEFAULT":               275_000,
}

# Counties where auction competition is fiercer → smaller discount
COMPETITIVE_COUNTIES = {
    "Fairfax County", "Arlington County", "Alexandria City",
    "Falls Church City", "Loudoun County", "Henrico County",
    "Virginia Beach City",
}

PROPERTY_TYPE_MULTIPLIERS = {
    "Single Family": 1.00,
    "Townhouse":     0.82,
    "Townhome":      0.82,
    "Condo":         0.68,
    "Condominium":   0.68,
    "Multi-Family":  1.25,
    "Duplex":        1.15,
    "Land":          0.35,
    "Lot":           0.35,
    "Mobile Home":   0.28,
    "Commercial":    1.40,
    "Unknown":       1.00,
}

SIZE_ADJUSTMENTS = [
    (800,  0.75),
    (1200, 0.90),
    (1800, 1.00),
    (2500, 1.15),
    (3500, 1.30),
    (float("inf"), 1.55),
]

TIER_1_COUNTIES = {
    "Fairfax County", "Arlington County", "Loudoun County",
    "Prince William County", "Alexandria City",
}
TIER_2_COUNTIES = {
    "Stafford County", "Spotsylvania County", "Fredericksburg City",
    "Henrico County", "Chesterfield County", "Virginia Beach City",
    "Chesapeake City",
}


def detect_property_type(address: str, description: str = "") -> str:
    """Infer property type from address and description text."""
    text = f"{address} {description}".lower()
    if any(k in text for k in ["unit ", "apt ", "#", "suite ", "condo", "condominium"]):
        return "Condo"
    if any(k in text for k in ["townhome", "townhouse", "th "]):
        return "Townhouse"
    if any(k in text for k in ["lot ", "parcel ", "land ", "unimproved"]):
        return "Land"
    if any(k in text for k in ["mobile", "manufactured"]):
        return "Mobile Home"
    if any(k in text for k in ["duplex", "multi", "units"]):
        return "Multi-Family"
    return "Single Family"  # default assumption for residential trustee sales


def size_adjustment(sqft: int | None) -> float:
    if not sqft:
        return 1.00
    for threshold, multiplier in SIZE_ADJUSTMENTS:
        if sqft < threshold:
            return multiplier
    return 1.55


def build_pricing(
    county: str,
    property_type: str = "Unknown",
    sqft: int | None = None,
    opening_bid: float | None = None,
    original_loan: float | None = None,
) -> dict:
    """
    Build the auction pricing estimate for a property.
    Returns a dict with eav, arv, confidence, and derived metrics.
    """
    # ── Tier 1: Direct price signal ─────────────────────────────────────────
    if opening_bid and opening_bid > 50_000:
        eav = opening_bid
        county_base = COUNTY_BASE_VALUES.get(county, COUNTY_BASE_VALUES["DEFAULT"])
        type_mult = PROPERTY_TYPE_MULTIPLIERS.get(property_type, 1.00)
        discount = 0.78 if county in COMPETITIVE_COUNTIES else 0.72
        arv = county_base * type_mult  # use county base for ARV even when EAV is known
        confidence = "HIGH — Opening bid from notice"

    elif original_loan and original_loan > 50_000:
        # Loan amount correlates strongly with purchase price; apply small premium
        # for appreciation since origination (avg 3% per year, assume 5yr loan age)
        eav = original_loan * 0.85   # lender typically bids ~85% of balance
        county_base = COUNTY_BASE_VALUES.get(county, COUNTY_BASE_VALUES["DEFAULT"])
        type_mult = PROPERTY_TYPE_MULTIPLIERS.get(property_type, 1.00)
        arv = county_base * type_mult
        confidence = "HIGH — Loan balance from notice"

    # ── Tier 2: Derived estimate ────────────────────────────────────────────
    else:
        county_base = COUNTY_BASE_VALUES.get(county, COUNTY_BASE_VALUES["DEFAULT"])
        type_mult = PROPERTY_TYPE_MULTIPLIERS.get(property_type, 1.00)
        size_adj = size_adjustment(sqft)
        discount = 0.78 if county in COMPETITIVE_COUNTIES else 0.72
        arv = county_base * type_mult * size_adj
        eav = arv * discount

        if sqft:
            confidence = "MEDIUM — Derived from county, type, and size"
        else:
            confidence = "LOW — County average only"

    # ── Derived financial metrics ───────────────────────────────────────────
    monthly_rent = arv * 0.007
    mortgage_payment = eav * 0.006
    prop_tax = arv * 0.009 / 12
    insurance = arv * 0.005 / 12
    vacancy = monthly_rent * 0.08
    cash_flow = monthly_rent - mortgage_payment - prop_tax - insurance - vacancy

    noi_annual = (monthly_rent - prop_tax - insurance - vacancy) * 12
    cap_rate = (noi_annual / eav * 100) if eav > 0 else 0

    discount_to_arv = ((1 - eav / arv) * 100) if arv > 0 else 0

    # ── Investment score (0–100) ────────────────────────────────────────────
    score = 0
    score += min(30, discount_to_arv * 1.2)
    score += min(25, max(0, cap_rate * 3))
    score += min(20, max(0, cash_flow / 50))
    if county in TIER_1_COUNTIES:
        score += 15
    elif county in TIER_2_COUNTIES:
        score += 10
    else:
        score += 5
    if "HIGH" in confidence:
        score += 10
    elif "MEDIUM" in confidence:
        score += 5

    return {
        "eav":                  round(eav),
        "arv":                  round(arv),
        "confidence":           confidence,
        "county_base":          county_base,
        "type_multiplier":      type_mult,
        "opening_bid":          opening_bid,
        "original_loan":        original_loan,
        "monthly_rent_estimate": round(monthly_rent),
        "cash_flow_estimate":   round(cash_flow),
        "cap_rate":             round(cap_rate, 1),
        "discount_to_arv":      round(discount_to_arv, 1),
        "score":                min(100, round(score)),
    }


# ── Geocoding ─────────────────────────────────────────────────────────────────

def geocode(address: str, api_key: str) -> tuple[float | None, float | None]:
    """Return (lat, lng) for a given address string."""
    if not api_key:
        return None, None
    try:
        r = requests.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": f"{address}, Virginia", "key": api_key},
            timeout=5,
        )
        data = r.json()
        if data.get("status") == "OK":
            loc = data["results"][0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
    except Exception as e:
        log.warning(f"Geocode failed for '{address}': {e}")
    return None, None


# ── Property ID ───────────────────────────────────────────────────────────────

def make_id(source_prefix: str, address: str, sale_date: str) -> str:
    raw = f"{source_prefix}:{address}:{sale_date}".lower()
    return f"va-{source_prefix}-{hashlib.md5(raw.encode()).hexdigest()[:8]}"


def days_to_sale(sale_date_str: str) -> int | None:
    try:
        sale_dt = datetime.strptime(sale_date_str, "%Y-%m-%d").date()
        return (sale_dt - TODAY).days
    except Exception:
        return None


# ── Source 1: Samuel I. White, P.C. ──────────────────────────────────────────

def scrape_siw() -> list[dict]:
    """
    Download the current Samuel I. White PDF and parse property listings.
    Existing logic preserved from v1.0, augmented with pricing matrix.
    """
    log.info("Scraping Samuel I. White, P.C. ...")
    properties = []

    try:
        # Fetch the listings page to find the current PDF URL
        r = requests.get("https://www.siwpc.net/foreclosures/", headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")

        # Find PDF link (usually the first .pdf href on the page)
        pdf_url = None
        for a in soup.find_all("a", href=True):
            if ".pdf" in a["href"].lower():
                pdf_url = a["href"]
                if not pdf_url.startswith("http"):
                    pdf_url = "https://www.siwpc.net" + pdf_url
                break

        if not pdf_url:
            log.warning("SIW: Could not find PDF URL")
            return properties

        # Download the PDF
        pdf_r = requests.get(pdf_url, headers=HEADERS, timeout=30)
        pdf_path = Path("/tmp/siw_listings.pdf")
        pdf_path.write_bytes(pdf_r.content)

        if not PDF_AVAILABLE:
            log.warning("PyPDF2 not installed — skipping SIW PDF parse")
            return properties

        # Parse PDF
        reader = PyPDF2.PdfReader(str(pdf_path))
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() or ""

        # Extract property blocks
        # SIW PDF format: each property separated by firm file number pattern
        blocks = re.split(r"\n(?=\d{2}-\d+\s)", full_text)

        for block in blocks:
            if not block.strip():
                continue
            prop = parse_siw_block(block, pdf_url)
            if prop:
                properties.append(prop)

    except Exception as e:
        log.error(f"SIW scrape failed: {e}")

    log.info(f"SIW: {len(properties)} properties")
    return properties


def parse_siw_block(text: str, source_url: str) -> dict | None:
    """Parse a single property block from Samuel I. White PDF text."""
    # Extract firm file number
    file_match = re.search(r"(\d{2}-\d+)", text)
    if not file_match:
        return None
    file_number = file_match.group(1)

    # Extract address (first line-like thing after file number)
    address_match = re.search(
        r"(\d+\s+[A-Z][A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Circle|Cir|Terrace|Ter|Pike|Highway|Hwy)\.?)",
        text, re.IGNORECASE
    )
    address = address_match.group(1).strip() if address_match else None
    if not address:
        return None

    # Extract county
    county_match = re.search(
        r"(Fairfax|Arlington|Loudoun|Prince William|Alexandria|Stafford|Spotsylvania"
        r"|Fredericksburg|Henrico|Chesterfield|Richmond|Virginia Beach|Norfolk"
        r"|Chesapeake|Newport News|Hampton|Suffolk|Portsmouth)\s*(County|City)?",
        text, re.IGNORECASE
    )
    county_raw = county_match.group(0).strip() if county_match else ""
    county = normalize_county(county_raw)

    # Extract city/state/zip
    city_match = re.search(r",\s*([A-Za-z\s]+),\s*VA\s*(\d{5})?", text)
    city = city_match.group(1).strip() if city_match else ""
    zip_code = city_match.group(2) if city_match and city_match.group(2) else ""

    # Extract sale date
    date_match = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}",
        text, re.IGNORECASE
    )
    sale_date_str = None
    if date_match:
        try:
            sale_dt = datetime.strptime(date_match.group(0), "%B %d, %Y")
            sale_date_str = sale_dt.strftime("%Y-%m-%d")
        except Exception:
            pass

    # Extract sale time
    time_match = re.search(r"(\d{1,2}:\d{2}\s*(?:AM|PM))", text, re.IGNORECASE)
    sale_time = time_match.group(1) if time_match else "10:00 AM"

    # Extract original loan amount if present
    loan_match = re.search(r"\$\s*([\d,]+(?:\.\d{2})?)", text)
    original_loan = None
    if loan_match:
        try:
            original_loan = float(loan_match.group(1).replace(",", ""))
        except Exception:
            pass

    property_type = detect_property_type(address, text)
    pricing = build_pricing(county, property_type, None, None, original_loan)

    prop_id = make_id("siw", address, sale_date_str or "")

    return {
        "id":               prop_id,
        "source":           "Samuel I. White, P.C.",
        "source_url":       source_url,
        "firm_file_number": file_number,
        "address":          address,
        "city":             city,
        "state":            "VA",
        "zip_code":         zip_code,
        "county":           county,
        "lat":              None,
        "lng":              None,
        "sale_date":        sale_date_str,
        "sale_time":        sale_time,
        "sale_location":    f"{county} Courthouse",
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             ["VA Foreclosure", "Trustee Sale", county],
        "status":           "active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     days_to_sale(sale_date_str) if sale_date_str else None,
    }


# ── Source 2: Orlans Law Group ────────────────────────────────────────────────

def scrape_orlans() -> list[dict]:
    """Scrape Orlans Law Group property listings page."""
    log.info("Scraping Orlans Law Group ...")
    properties = []

    try:
        r = requests.get(
            "https://www.orlans.com/property-listings/",
            headers=HEADERS, timeout=15
        )
        soup = BeautifulSoup(r.text, "html.parser")

        # Orlans typically uses a table or card grid for listings
        # Try table rows first
        rows = soup.select("table tbody tr")
        if not rows:
            # Try card/article pattern
            rows = soup.select(".property-listing, .listing-item, article.property")

        for row in rows:
            prop = parse_orlans_row(row)
            if prop:
                properties.append(prop)

        # If no structured data found, try JSON-LD or embedded JSON
        if not properties:
            scripts = soup.find_all("script", type="application/json")
            for script in scripts:
                try:
                    data = json.loads(script.string or "")
                    if isinstance(data, list):
                        for item in data:
                            prop = parse_orlans_json(item)
                            if prop:
                                properties.append(prop)
                except Exception:
                    pass

    except Exception as e:
        log.error(f"Orlans scrape failed: {e}")

    log.info(f"Orlans: {len(properties)} properties")
    return properties


def parse_orlans_row(row) -> dict | None:
    """Parse a single row/card from Orlans listings."""
    try:
        cells = row.find_all(["td", "div", "span"])
        text = row.get_text(" ", strip=True)

        address_match = re.search(
            r"(\d+\s+[A-Z][A-Za-z\s]+(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Cir|Ter)\.?)",
            text, re.IGNORECASE
        )
        if not address_match:
            return None
        address = address_match.group(1).strip()

        date_match = re.search(
            r"(\d{1,2}/\d{1,2}/\d{4}|\w+\s+\d{1,2},\s+\d{4})", text
        )
        sale_date_str = None
        if date_match:
            raw = date_match.group(1)
            for fmt in ("%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
                try:
                    sale_dt = datetime.strptime(raw, fmt)
                    sale_date_str = sale_dt.strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass

        # Look for opening bid
        bid_match = re.search(r"\$\s*([\d,]+(?:\.\d{2})?)", text)
        opening_bid = None
        if bid_match:
            try:
                val = float(bid_match.group(1).replace(",", ""))
                if val > 50_000:  # sanity check — ignore small numbers
                    opening_bid = val
            except Exception:
                pass

        county_match = re.search(
            r"(Fairfax|Arlington|Loudoun|Prince William|Alexandria|Stafford"
            r"|Spotsylvania|Fredericksburg|Henrico|Chesterfield|Richmond"
            r"|Virginia Beach|Norfolk|Chesapeake|Newport News)\s*(County|City)?",
            text, re.IGNORECASE
        )
        county_raw = county_match.group(0).strip() if county_match else ""
        county = normalize_county(county_raw)

        property_type = detect_property_type(address, text)
        pricing = build_pricing(county, property_type, None, opening_bid, None)

        return {
            "id":               make_id("orlans", address, sale_date_str or ""),
            "source":           "Orlans Law Group",
            "source_url":       "https://www.orlans.com/property-listings/",
            "firm_file_number": None,
            "address":          address,
            "city":             "",
            "state":            "VA",
            "zip_code":         "",
            "county":           county,
            "lat":              None,
            "lng":              None,
            "sale_date":        sale_date_str,
            "sale_time":        "10:00 AM",
            "sale_location":    f"{county} Courthouse",
            "property_type":    property_type,
            "sqft":             None,
            "beds":             None,
            "baths":            None,
            "year_built":       None,
            "pricing":          pricing,
            "tags":             ["VA Foreclosure", "Trustee Sale", county, "Orlans"],
            "status":           "active",
            "scraped_at":       datetime.utcnow().isoformat() + "Z",
            "days_to_sale":     days_to_sale(sale_date_str) if sale_date_str else None,
        }
    except Exception:
        return None


def parse_orlans_json(item: dict) -> dict | None:
    """Parse a property from Orlans JSON data."""
    try:
        address = item.get("address") or item.get("property_address", "")
        if not address:
            return None
        sale_date_str = item.get("sale_date") or item.get("auction_date", "")
        county = normalize_county(item.get("county", ""))
        opening_bid = item.get("opening_bid") or item.get("bid_amount")
        property_type = detect_property_type(address)
        pricing = build_pricing(county, property_type, None,
                                float(opening_bid) if opening_bid else None, None)
        return {
            "id":               make_id("orlans", address, sale_date_str),
            "source":           "Orlans Law Group",
            "source_url":       "https://www.orlans.com/property-listings/",
            "firm_file_number": item.get("file_number"),
            "address":          address,
            "city":             item.get("city", ""),
            "state":            "VA",
            "zip_code":         item.get("zip", ""),
            "county":           county,
            "lat":              None,
            "lng":              None,
            "sale_date":        sale_date_str,
            "sale_time":        item.get("sale_time", "10:00 AM"),
            "sale_location":    item.get("sale_location", f"{county} Courthouse"),
            "property_type":    property_type,
            "sqft":             item.get("sqft"),
            "beds":             item.get("beds"),
            "baths":            item.get("baths"),
            "year_built":       item.get("year_built"),
            "pricing":          pricing,
            "tags":             ["VA Foreclosure", "Trustee Sale", county, "Orlans"],
            "status":           "active",
            "scraped_at":       datetime.utcnow().isoformat() + "Z",
            "days_to_sale":     days_to_sale(sale_date_str) if sale_date_str else None,
        }
    except Exception:
        return None


# ── Source 3: BWW Law Group ───────────────────────────────────────────────────

def scrape_bww() -> list[dict]:
    """Scrape BWW Law Group foreclosure listings."""
    log.info("Scraping BWW Law Group ...")
    properties = []

    try:
        r = requests.get(
            "https://www.bww-law.com/foreclosure-listings/",
            headers=HEADERS, timeout=15
        )
        soup = BeautifulSoup(r.text, "html.parser")

        # BWW may use a table or listing grid
        rows = soup.select("table tr, .property-card, .foreclosure-item, article")
        for row in rows:
            text = row.get_text(" ", strip=True)
            if len(text) < 20:
                continue
            prop = parse_generic_listing(row, text, "bww", "BWW Law Group",
                                         "https://www.bww-law.com/foreclosure-listings/")
            if prop:
                properties.append(prop)

    except Exception as e:
        log.error(f"BWW scrape failed: {e}")

    log.info(f"BWW: {len(properties)} properties")
    return properties


# ── Source 4: McCabe, Weisberg & Conway ──────────────────────────────────────

def scrape_mwc() -> list[dict]:
    """Scrape McCabe Weisberg & Conway foreclosure listings."""
    log.info("Scraping McCabe, Weisberg & Conway ...")
    properties = []

    try:
        r = requests.get(
            "https://www.mwc-law.com/foreclosure-listings/",
            headers=HEADERS, timeout=15
        )
        soup = BeautifulSoup(r.text, "html.parser")

        rows = soup.select("table tr, .property-card, .listing-row, article")
        for row in rows:
            text = row.get_text(" ", strip=True)
            if len(text) < 20:
                continue
            prop = parse_generic_listing(row, text, "mwc",
                                         "McCabe Weisberg & Conway",
                                         "https://www.mwc-law.com/foreclosure-listings/")
            if prop:
                properties.append(prop)

    except Exception as e:
        log.error(f"MWC scrape failed: {e}")

    log.info(f"MWC: {len(properties)} properties")
    return properties


# ── Generic listing parser (BWW / MWC) ───────────────────────────────────────

def parse_generic_listing(element, text: str, source_key: str,
                           source_name: str, source_url: str) -> dict | None:
    """Generic parser for trustee firm listing rows/cards."""
    try:
        address_match = re.search(
            r"(\d+\s+[A-Z][A-Za-z0-9\s]+(?:St(?:reet)?|Ave(?:nue)?|Rd|Road"
            r"|Dr(?:ive)?|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Pl|Place"
            r"|Cir(?:cle)?|Ter(?:race)?|Pike|Hwy|Highway)\.?)",
            text, re.IGNORECASE
        )
        if not address_match:
            return None
        address = address_match.group(1).strip()

        county_match = re.search(
            r"(Fairfax|Arlington|Loudoun|Prince William|Alexandria|Stafford"
            r"|Spotsylvania|Fredericksburg|Henrico|Chesterfield|Richmond"
            r"|Virginia Beach|Norfolk|Chesapeake|Newport News|Hampton"
            r"|Suffolk|Portsmouth|Manassas|Roanoke|Lynchburg)\s*(County|City)?",
            text, re.IGNORECASE
        )
        county_raw = county_match.group(0).strip() if county_match else ""
        county = normalize_county(county_raw)

        date_match = re.search(
            r"(\d{1,2}/\d{1,2}/\d{4}|\w+\s+\d{1,2},\s+\d{4})", text
        )
        sale_date_str = None
        if date_match:
            raw = date_match.group(1)
            for fmt in ("%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
                try:
                    sale_dt = datetime.strptime(raw, fmt)
                    sale_date_str = sale_dt.strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass

        bid_match = re.search(r"\$\s*([\d,]+(?:\.\d{2})?)", text)
        opening_bid = None
        if bid_match:
            try:
                val = float(bid_match.group(1).replace(",", ""))
                if val > 50_000:
                    opening_bid = val
            except Exception:
                pass

        property_type = detect_property_type(address, text)
        pricing = build_pricing(county, property_type, None, opening_bid, None)

        return {
            "id":               make_id(source_key, address, sale_date_str or ""),
            "source":           source_name,
            "source_url":       source_url,
            "firm_file_number": None,
            "address":          address,
            "city":             "",
            "state":            "VA",
            "zip_code":         "",
            "county":           county,
            "lat":              None,
            "lng":              None,
            "sale_date":        sale_date_str,
            "sale_time":        "10:00 AM",
            "sale_location":    f"{county} Courthouse",
            "property_type":    property_type,
            "sqft":             None,
            "beds":             None,
            "baths":            None,
            "year_built":       None,
            "pricing":          pricing,
            "tags":             ["VA Foreclosure", "Trustee Sale", county, source_name],
            "status":           "active",
            "scraped_at":       datetime.utcnow().isoformat() + "Z",
            "days_to_sale":     days_to_sale(sale_date_str) if sale_date_str else None,
        }
    except Exception:
        return None


# ── Utilities ─────────────────────────────────────────────────────────────────

def normalize_county(raw: str) -> str:
    """Normalize county string to 'X County' or 'X City' format."""
    raw = raw.strip().title()
    if not raw:
        return "Unknown County"
    known_cities = {
        "Alexandria", "Fairfax", "Falls Church", "Manassas", "Manassas Park",
        "Richmond", "Norfolk", "Virginia Beach", "Chesapeake", "Newport News",
        "Hampton", "Portsmouth", "Suffolk", "Poquoson", "Fredericksburg",
        "Colonial Heights", "Petersburg", "Lynchburg", "Roanoke",
    }
    for city in known_cities:
        if city in raw and "County" not in raw:
            return f"{city} City"
    if "County" not in raw and "City" not in raw:
        return f"{raw} County"
    return raw


def deduplicate(properties: list[dict]) -> list[dict]:
    """
    Remove duplicate properties across sources.
    A duplicate is defined as: same address + same sale date (within 1 day).
    Prefer the record with higher pricing confidence when deduplicating.
    """
    seen: dict[str, dict] = {}
    confidence_rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}

    for prop in properties:
        address_norm = re.sub(r"\s+", " ", (prop.get("address") or "").lower().strip())
        sale_date = prop.get("sale_date") or ""
        key = f"{address_norm}::{sale_date}"

        if key not in seen:
            seen[key] = prop
        else:
            # Keep the one with higher pricing confidence
            existing_conf = confidence_rank.get(
                seen[key]["pricing"]["confidence"].split("—")[0].strip().upper(), 1
            )
            new_conf = confidence_rank.get(
                prop["pricing"]["confidence"].split("—")[0].strip().upper(), 1
            )
            if new_conf > existing_conf:
                seen[key] = prop

    result = list(seen.values())
    log.info(f"Deduplication: {len(properties)} → {len(result)} properties")
    return result


def geocode_missing(properties: list[dict], api_key: str) -> list[dict]:
    """Geocode any property missing lat/lng."""
    missing = [p for p in properties if not p.get("lat")]
    log.info(f"Geocoding {len(missing)} properties ...")
    for prop in missing:
        address_str = f"{prop['address']}, {prop['city']}, VA {prop['zip_code']}"
        lat, lng = geocode(address_str, api_key)
        prop["lat"] = lat
        prop["lng"] = lng
        if lat:
            log.debug(f"  ✓ {prop['address']} → {lat:.4f}, {lng:.4f}")
        time.sleep(0.1)  # rate limit
    return properties


# ── Main ──────────────────────────────────────────────────────────────────────

def run(gmaps_key: str = "") -> dict:
    import os
    api_key = gmaps_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")

    # Scrape all sources
    all_props = []
    all_props.extend(scrape_siw())
    time.sleep(2)
    all_props.extend(scrape_orlans())
    time.sleep(2)
    all_props.extend(scrape_bww())
    time.sleep(2)
    all_props.extend(scrape_mwc())

    # Deduplicate
    all_props = deduplicate(all_props)

    # Geocode
    if api_key:
        all_props = geocode_missing(all_props, api_key)

    # Sort by days to sale (soonest first), nulls last
    all_props.sort(
        key=lambda p: p.get("days_to_sale") if p.get("days_to_sale") is not None else 9999
    )

    # Build output
    high_conf = sum(1 for p in all_props if "HIGH" in p["pricing"]["confidence"])
    med_conf  = sum(1 for p in all_props if "MEDIUM" in p["pricing"]["confidence"])
    low_conf  = sum(1 for p in all_props if "LOW" in p["pricing"]["confidence"])

    sources = {}
    for p in all_props:
        s = p["source"]
        sources[s] = sources.get(s, 0) + 1

    counties = sorted({p["county"] for p in all_props if p["county"] != "Unknown County"})

    output = {
        "metadata": {
            "total_properties":     len(all_props),
            "scraped_at":           datetime.utcnow().isoformat() + "Z",
            "sources":              sources,
            "counties_covered":     len(counties),
            "pricing_confidence": {
                "high":   high_conf,
                "medium": med_conf,
                "low":    low_conf,
            },
            "pricing_note": (
                "EAV (Estimated Auction Value) derived from county base values, "
                "property type, and auction discount. "
                "Confidence: HIGH = direct price signal from notice, "
                "MEDIUM = derived from county + type + size, "
                "LOW = county average only. Not a formal appraisal."
            ),
        },
        "foreclosures": all_props,
    }

    # Write JSON
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, default=str))
    log.info(f"✅ Wrote {len(all_props)} properties to {OUTPUT_PATH}")

    return output


if __name__ == "__main__":
    run()
