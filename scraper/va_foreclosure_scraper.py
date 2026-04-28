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
    import pdfplumber
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

ALLOWED_STATES = {"VA", "MD", "DC"}

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
    # DC-adjacent / I-95 corridor (VA)
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
    # Maryland — DC suburbs
    "Montgomery County":      625_000,
    "Prince George's County": 360_000,
    "Howard County":          525_000,
    # Baltimore metro
    "Anne Arundel County":    420_000,
    "Baltimore County":       290_000,
    "Baltimore City":         180_000,
    "Carroll County":         400_000,
    "Harford County":         330_000,
    # Southern Maryland
    "Charles County":         350_000,
    "Calvert County":         430_000,
    "St. Mary's County":      365_000,
    # Western Maryland
    "Frederick County":       400_000,
    "Washington County":      260_000,
    "Allegany County":        130_000,
    "Garrett County":         280_000,
    # Eastern Shore
    "Cecil County":           310_000,
    "Kent County":            300_000,
    "Queen Anne's County":    465_000,
    "Talbot County":          420_000,
    "Caroline County":        265_000,
    "Dorchester County":      200_000,
    "Wicomico County":        210_000,
    "Somerset County":        170_000,
    "Worcester County":       320_000,
    # District of Columbia (one jurisdiction — quadrants treated as same base)
    "District Of Columbia":   725_000,
    "District of Columbia":   725_000,
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
    # Heuristic: 0.7%-of-ARV monthly rent. County-level averages are the most
    # specific signal available without paid property-data enrichment.
    monthly_rent = arv * 0.007
    mortgage_payment = eav * 0.006
    prop_tax = arv * 0.009 / 12
    insurance = arv * 0.005 / 12
    vacancy = monthly_rent * 0.08
    cash_flow = monthly_rent - mortgage_payment - prop_tax - insurance - vacancy

    noi_annual = (monthly_rent - prop_tax - insurance - vacancy) * 12
    cap_rate = (noi_annual / eav * 100) if eav > 0 else 0

    discount_to_arv = ((1 - eav / arv) * 100) if arv > 0 else 0

    # ── 70% Rule ────────────────────────────────────────────────────────────
    # Industry-standard investor benchmark (BiggerPockets, Rocket Mortgage,
    # DealCheck all use it). MAO = ARV × 0.70 − rehab estimate. A property
    # "passes" if its list price is at or below MAO.
    rehab_assumed = round(arv * 0.08)  # 8% of ARV is the scraper's default rehab guess
    mao_70        = round(arv * 0.70 - rehab_assumed)
    gap_to_mao    = round(eav - mao_70)  # negative = deal, positive = overpay
    passes_70     = eav > 0 and eav <= mao_70

    # ── DSCR (Debt Service Coverage Ratio) ──────────────────────────────────
    # DSCR ≥ 1.0 means rent covers mortgage; ≥ 1.25 is institutional-grade
    # BRRRR-ready. 2026 DSCR lenders use this for refi qualification.
    dscr = round(monthly_rent / mortgage_payment, 2) if mortgage_payment > 0 else 0

    # ── Investment score (0–100) with red-flag subtractors ──────────────────
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
    # Bonuses / penalties from the research-based signals
    if passes_70:
        score += 5   # bonus: clears the gold-standard flip benchmark
    if dscr >= 1.25:
        score += 5   # bonus: institutional-grade BRRRR refi candidate
    elif dscr < 1.0 and dscr > 0:
        score -= 5   # penalty: can't refi cleanly, negative leverage
    if not sqft:
        score -= 5   # penalty: can't comp without sqft

    score = max(0, min(100, round(score)))

    # ── Letter grade for investor glance-ability ────────────────────────────
    # Matches FlipperForce / Rehab Valuator convention.
    if score >= 90:   grade = "A+"
    elif score >= 80: grade = "A"
    elif score >= 70: grade = "B"
    elif score >= 60: grade = "C"
    else:             grade = "D"

    return {
        "eav":                  round(eav),
        "arv":                  round(arv),
        "confidence":           confidence,
        "county_base":          county_base,
        "type_multiplier":      type_mult,
        "opening_bid":          opening_bid,
        "original_loan":        original_loan,
        "monthly_rent_estimate": round(monthly_rent),
        "rent_source":          "heuristic",
        "cash_flow_estimate":   round(cash_flow),
        "cap_rate":             round(cap_rate, 1),
        "discount_to_arv":      round(discount_to_arv, 1),
        "mao_70":               mao_70,
        "gap_to_mao":           gap_to_mao,
        "passes_70_rule":       passes_70,
        "dscr":                 dscr,
        "score":                score,
        "grade":                grade,
    }


# ── Geocoding ─────────────────────────────────────────────────────────────────

def geocode(address: str, api_key: str) -> tuple[float | None, float | None]:
    """Return (lat, lng) for a given address string. Caller passes the
    full address including state/zip — do NOT hardcode a state here, the
    project covers DC + MD + VA."""
    if not api_key:
        return None, None
    try:
        r = requests.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": address, "key": api_key},
            timeout=5,
        )
        data = r.json()
        status = data.get("status")
        if status == "OK":
            loc = data["results"][0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
        # Surface non-OK responses so we can tell the difference between
        # "API key rejected" (REQUEST_DENIED), "rate-limited" (OVER_QUERY_LIMIT),
        # "address didn't resolve" (ZERO_RESULTS), and other failure modes.
        err_msg = data.get("error_message") or ''
        log.warning(f"Geocode {status} for '{address}': {err_msg[:200]}")
    except Exception as e:
        log.warning(f"Geocode exception for '{address}': {e}")
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

SIW_PDF_URL = "https://www.siwpc.net/AutoUpload/Sales.pdf"


def _is_siw_county_header(line: str) -> bool:
    """County headers in SIW PDF are short lines like 'Fairfax' or 'City of Alexandria'."""
    line = line.strip()
    if not line or len(line) > 50 or re.match(r"^\d", line):
        return False
    if any(
        skip in line for skip in (
            "Foreclosure Sales Report", "Property Address", "Information Reported",
            "Samuel I. White", "contact our offices", "makes no representations",
        )
    ):
        return False
    # Must be Title Case-ish letters only (optionally with "City of" / "County")
    return bool(re.match(r"^(VA|[A-Z][A-Za-z\s]+)$", line))


def _parse_siw_line(line: str, current_county: str | None) -> dict | None:
    """
    Parse one property line from the SIW PDF.
    Format: Address City Zip MM/DD/YYYY HH:MM:SS Location FileNumber
    Example: 5724 Croatan Court Centreville 20120 3/17/2026 11:30:00 Fairfax 81374
    """
    parts = line.split()
    if len(parts) < 7:
        return None

    # Find ZIP (5 digits)
    zip_index = None
    for i, part in enumerate(parts):
        if re.match(r"^\d{5}$", part):
            zip_index = i
            break
    if zip_index is None or zip_index < 2:
        return None

    # Validate that the two tokens after ZIP look like date + time
    if zip_index + 2 >= len(parts):
        return None
    if not re.match(r"^\d{1,2}/\d{1,2}/\d{4}$", parts[zip_index + 1]):
        return None
    if not re.match(r"^\d{1,2}:\d{2}", parts[zip_index + 2]):
        return None

    city = parts[zip_index - 1]
    address = " ".join(parts[: zip_index - 1])
    zip_code = parts[zip_index]
    sale_date_raw = parts[zip_index + 1]
    sale_time = parts[zip_index + 2]
    # Sale location + firm file number make up the tail; file# is the last token
    tail = parts[zip_index + 3:]
    if not tail:
        return None
    firm_file = tail[-1]
    sale_location = " ".join(tail[:-1]) or city

    # Normalize sale date to ISO for downstream consumers (days_to_sale)
    sale_date_iso = None
    try:
        sale_date_iso = datetime.strptime(sale_date_raw, "%m/%d/%Y").strftime("%Y-%m-%d")
    except Exception:
        sale_date_iso = sale_date_raw

    # SIW headers distinguish counties vs independent cities via a "City of"
    # prefix, so handle this here rather than rely on normalize_county (which
    # conflates names like "Fairfax" that are both a county and a city).
    if current_county:
        cc = current_county.strip()
        if cc.lower().startswith("city of "):
            county = cc[len("city of "):].strip() + " City"
        elif cc.lower().endswith(" county") or cc.lower().endswith(" city"):
            county = cc
        else:
            county = cc + " County"
    else:
        county = "Unknown County"

    property_type = detect_property_type(address)
    pricing = build_pricing(county, property_type, None, None, None)

    return {
        "id":               make_id("siw", address, sale_date_iso or ""),
        "source":           "Samuel I. White, P.C.",
        "source_url":       SIW_PDF_URL,
        "firm_file_number": firm_file,
        "address":          address,
        "city":             city,
        "state":            "VA",
        "zip_code":         zip_code,
        "county":           county,
        "lat":              None,
        "lng":              None,
        "sale_date":        sale_date_iso,
        "sale_date_raw":    sale_date_raw,
        "sale_time":        sale_time,
        "sale_location":    sale_location,
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             ["VA Foreclosure", "Trustee Sale", county],
        "status":           "active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     days_to_sale(sale_date_iso) if sale_date_iso else None,
    }


def scrape_siw() -> list[dict]:
    """
    Download the Samuel I. White PDF and parse property listings using
    pdfplumber (preserves line layout). Each property fits on one line.
    """
    log.info("Scraping Samuel I. White, P.C. ...")
    properties: list[dict] = []

    if not PDF_AVAILABLE:
        log.warning("pdfplumber not installed — skipping SIW")
        return properties

    try:
        r = requests.get(SIW_PDF_URL, headers=HEADERS, timeout=30)
        r.raise_for_status()
        pdf_path = Path("/tmp/siw_listings.pdf")
        pdf_path.write_bytes(r.content)

        current_county: str | None = None
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                for raw_line in text.split("\n"):
                    line = raw_line.strip()
                    if not line:
                        continue
                    prop = _parse_siw_line(line, current_county)
                    if prop:
                        properties.append(prop)
                    elif _is_siw_county_header(line):
                        # VA is the state marker; ignore it as a county
                        if line != "VA":
                            current_county = line

    except Exception as e:
        log.error(f"SIW scrape failed: {e}")

    log.info(f"SIW: {len(properties)} properties")
    return properties


def parse_siw_block(text: str, source_url: str) -> dict | None:
    """Deprecated — kept for backwards-compat with v2 signature. Not used."""
    return None


# ── Source 2: Orlans Law Group (Mid Atlantic portal) ─────────────────────────
# Portal: https://matlsales.orlans.com/
# Flow: visit root → click "ACCEPT" policy link → navigate to
#       /Home/ForeclosureSales → ~100 .sales-item divs, each with structured
#       label/value pairs (File Number, Property Address, Property State, etc.)
# Filter: keep only State=VA and Status=Active.

ORLANS_ROOT   = "https://matlsales.orlans.com/"
ORLANS_SALES  = "https://matlsales.orlans.com/Home/ForeclosureSales"


def scrape_orlans() -> list[dict]:
    """Scrape Orlans MATL sales portal via Playwright (JS-rendered listings)."""
    log.info("Scraping Orlans (matlsales.orlans.com) ...")
    properties: list[dict] = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning("Orlans: playwright not installed — skipping")
        return properties

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=HEADERS["User-Agent"])
                page.goto(ORLANS_ROOT, timeout=30_000)
                # ACCEPT policy link lives on root
                try:
                    page.locator('a:has-text("ACCEPT")').first.click(timeout=10_000)
                    page.wait_for_load_state("networkidle", timeout=30_000)
                except Exception:
                    log.warning("Orlans: ACCEPT button not found (may already be accepted)")
                page.goto(ORLANS_SALES, timeout=30_000)
                page.wait_for_load_state("networkidle", timeout=30_000)

                # Parse .sales-item blocks
                items = page.locator(".sales-item")
                n = items.count()
                log.info(f"Orlans: {n} total listings (pre-filter)")
                for i in range(n):
                    try:
                        text = items.nth(i).inner_text()
                        prop = _parse_orlans_item(text)
                        if prop:
                            properties.append(prop)
                    except Exception as e:
                        log.debug(f"Orlans item {i} parse failed: {e}")
            finally:
                browser.close()

    except Exception as e:
        log.error(f"Orlans scrape failed: {e}")

    log.info(f"Orlans: {len(properties)} VA properties after filter")
    return properties


def _parse_orlans_item(text: str) -> dict | None:
    """
    Parse a single Orlans .sales-item block's visible text into a property dict.
    Returns None if state not in ALLOWED_STATES or status != Active.

    Expected text format (one field-label per line, value on next line):
        File Number\n24-000825\nStatus\nActive\nProperty Address\n...\nProperty State\nVA\n...
    """
    fields: dict[str, str] = {}
    labels = {
        "File Number", "Status", "Property Address", "Property City",
        "Property State", "Property Zip", "Property County",
        "Sale Date", "Sale Time", "Deposit Amount", "Sale Location",
    }
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    i = 0
    while i < len(lines) - 1:
        if lines[i] in labels:
            fields[lines[i]] = lines[i + 1]
            i += 2
        else:
            i += 1

    # Filter
    state = fields.get("Property State", "").strip().upper()
    status = fields.get("Status", "").strip().lower()
    if state not in ALLOWED_STATES or status != "active":
        return None
    address = fields.get("Property Address", "").strip()
    if not address:
        return None

    # Sale date → ISO
    sale_date_raw = fields.get("Sale Date", "").strip()
    sale_date_iso = None
    try:
        sale_date_iso = datetime.strptime(sale_date_raw, "%m/%d/%Y").strftime("%Y-%m-%d")
    except Exception:
        sale_date_iso = sale_date_raw or None

    # County is "Fairfax, VA" or "Prince George's, MD" — strip any state suffix.
    county_raw = fields.get("Property County", "").strip()
    county_raw = re.sub(r",\s*[A-Z]{2}\s*$", "", county_raw, flags=re.IGNORECASE).strip()
    county = normalize_county(county_raw, state)

    property_type = detect_property_type(address)
    pricing = build_pricing(county, property_type, None, None, None)

    return {
        "id":               make_id("orlans", address, sale_date_iso or ""),
        "source":           "Orlans Law Group",
        "source_url":       ORLANS_SALES,
        "firm_file_number": fields.get("File Number", "").strip() or None,
        "address":          address,
        "city":             fields.get("Property City", "").strip(),
        "state":            state,
        "zip_code":         fields.get("Property Zip", "").strip(),
        "county":           county,
        "lat":              None,
        "lng":              None,
        "sale_date":        sale_date_iso,
        "sale_date_raw":    sale_date_raw,
        "sale_time":        fields.get("Sale Time", "").strip() or None,
        "sale_location":    fields.get("Sale Location", "").strip() or f"{county} Courthouse",
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             [f"{state} Foreclosure", "Trustee Sale", county, "Orlans"],
        "status":           "active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     days_to_sale(sale_date_iso) if sale_date_iso else None,
    }


def _unused_scrape_orlans_legacy() -> list[dict]:
    """Original v2 Orlans scraper — kept for reference, not called."""
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


# ── Source 3: BWW Law Group (Aldridge Pite) ──────────────────────────────────
# Flow: visit /disclaimer-virginia/ → click "I agree" → land on
#   /sale-day-listings-selection/foreclosure-listings-virginia/
#   → 1 main table with columns [FILE NUMBER, ADDRESS, CITY, STATE, ZIP,
#     COUNTY, DATE LISTED (sale date+time), ORIGINAL LOAN AMOUNT]
# The ORIGINAL LOAN AMOUNT column unlocks HIGH-confidence pricing.

BWW_DISCLAIMER = "https://aldridgepite.com/disclaimer-virginia/"
BWW_LISTINGS   = "https://aldridgepite.com/sale-day-listings-selection/foreclosure-listings-virginia/"


def scrape_bww() -> list[dict]:
    """Scrape Aldridge Pite VA listings via Playwright (disclaimer gate)."""
    log.info("Scraping BWW / Aldridge Pite ...")
    properties: list[dict] = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning("BWW: playwright not installed — skipping")
        return properties

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=HEADERS["User-Agent"])
                page.goto(BWW_DISCLAIMER, timeout=30_000)
                page.locator('a:has-text("I agree")').first.click(timeout=10_000)
                page.wait_for_load_state("networkidle", timeout=30_000)

                tables = page.locator("table")
                n_tables = tables.count()
                # The second table is the listings table (first is a "affected
                # counties → new sale locations" lookup). Find by header text.
                target_idx = None
                for i in range(n_tables):
                    try:
                        first_row = tables.nth(i).locator("tr").first.inner_text()
                        if "FILE NUMBER" in first_row.upper() and "ADDRESS" in first_row.upper():
                            target_idx = i
                            break
                    except Exception:
                        continue
                if target_idx is None:
                    log.warning("BWW: could not find listings table")
                    return properties

                rows = tables.nth(target_idx).locator("tr")
                row_count = rows.count()
                log.info(f"BWW: {row_count - 1} total listings")
                for r in range(1, row_count):  # skip header
                    try:
                        cells = rows.nth(r).locator("td").all_inner_texts()
                        prop = _parse_bww_row(cells)
                        if prop:
                            properties.append(prop)
                    except Exception as e:
                        log.debug(f"BWW row {r} parse failed: {e}")
            finally:
                browser.close()

    except Exception as e:
        log.error(f"BWW scrape failed: {e}")

    log.info(f"BWW: {len(properties)} properties")
    return properties


def _parse_bww_row(cells: list[str]) -> dict | None:
    """
    Parse a BWW listings-table row.
    Columns: [FILE NUMBER, ADDRESS, CITY, STATE, ZIP, COUNTY, DATE LISTED, ORIGINAL LOAN AMOUNT]
    Example: ['VA-361587-1', '4622 Flatlick Branch Drive', 'Chantilly', 'VA',
              '20151', 'Fairfax County', 'July 15, 2026 11:45 AM', '$412,093.30']
    """
    if len(cells) < 8:
        return None
    file_number, address, city, state, zip_code, county_raw, date_listed, loan_amount_raw = \
        [c.strip() for c in cells[:8]]

    state_upper = state.upper()
    if state_upper not in ALLOWED_STATES or not address:
        return None

    # Parse "July 15, 2026 11:45 AM" into sale_date + sale_time
    sale_date_iso, sale_time = None, None
    m = re.match(
        r"([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)",
        date_listed, re.IGNORECASE,
    )
    if m:
        date_part, sale_time = m.group(1), m.group(2).upper().replace(" ", "")
        try:
            sale_date_iso = datetime.strptime(date_part, "%B %d, %Y").strftime("%Y-%m-%d")
        except Exception:
            pass

    # Parse loan amount "$412,093.30"
    original_loan = None
    m2 = re.search(r"\$\s*([\d,]+(?:\.\d{2})?)", loan_amount_raw)
    if m2:
        try:
            val = float(m2.group(1).replace(",", ""))
            if val > 10_000:
                original_loan = val
        except Exception:
            pass

    county = normalize_county(county_raw, state_upper)
    property_type = detect_property_type(address)
    pricing = build_pricing(county, property_type, None, None, original_loan)

    return {
        "id":               make_id("bww", address, sale_date_iso or ""),
        "source":           "BWW / Aldridge Pite",
        "source_url":       BWW_LISTINGS,
        "firm_file_number": file_number or None,
        "address":          address,
        "city":             city,
        "state":            state_upper,
        "zip_code":         zip_code,
        "county":           county,
        "lat":              None,
        "lng":              None,
        "sale_date":        sale_date_iso,
        "sale_date_raw":    date_listed,
        "sale_time":        sale_time,
        "sale_location":    f"{county} Courthouse",
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             [f"{state_upper} Foreclosure", "Trustee Sale", county, "Aldridge Pite"],
        "status":           "active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     days_to_sale(sale_date_iso) if sale_date_iso else None,
    }


# ── Source 4: McCabe, Weisberg & Conway ──────────────────────────────────────
# The main site (mccabeesq.com) gates with a disclaimer click-through, but the
# actual VA sales list is served from their apps subdomain at a stable URL
# with NO disclaimer — plain HTTP, clean HTML table. No Playwright needed.
# Columns: [Sale Date, Sale Time, County, Address, City, State, Mat No]

MWC_VA_URL = "https://apps.mwc-law.com/SalesLists/VA.html"
MWC_MD_URL = "https://apps.mwc-law.com/SalesLists/MD.html"


def scrape_mwc() -> list[dict]:
    """
    Scrape McCabe sales lists (VA + MD) via direct HTTP (HTML tables).

    Each state has its own URL on apps.mwc-law.com. MD URL may 404 if McCabe
    doesn't publish MD sales separately — we swallow that quietly.
    """
    log.info("Scraping McCabe, Weisberg & Conway ...")
    properties: list[dict] = []

    for url, state_hint in ((MWC_VA_URL, "VA"), (MWC_MD_URL, "MD")):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 404:
                log.info(f"MWC {state_hint}: 404 (not published at {url})")
                continue
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            table = soup.find("table")
            if table is None:
                log.warning(f"MWC {state_hint}: no table found")
                continue

            rows = table.find_all("tr")
            # Header row is at index 1 (index 0 is title row "VA Sales List").
            # Data starts at index 2.
            added = 0
            for row in rows[2:]:
                cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
                prop = _parse_mwc_row(cells, source_url=url)
                if prop:
                    properties.append(prop)
                    added += 1
            log.info(f"MWC {state_hint}: {added} properties (of {max(0, len(rows) - 2)} rows)")

        except Exception as e:
            log.error(f"MWC {state_hint} scrape failed: {e}")

    log.info(f"MWC: {len(properties)} total properties")
    return properties


def _parse_mwc_row(cells: list[str], source_url: str = MWC_VA_URL) -> dict | None:
    """
    Parse an MWC sales-list row.
    Columns: [Sale Date, Sale Time, County, Address, City, State, Mat No, (blank)]
    Example: ['4/22/2026', '12:30pm', 'Henrico', '7512 Edgewood Avenue',
              'Richmond', 'VA', '25-701031', '']
    """
    if len(cells) < 7:
        return None
    sale_date_raw, sale_time, county_raw, address, city, state, mat_no = \
        [c.strip() for c in cells[:7]]

    state_upper = state.upper()
    if state_upper not in ALLOWED_STATES or not address or sale_date_raw.lower() == "sale date":
        return None

    # Normalize sale date to ISO
    sale_date_iso = None
    try:
        sale_date_iso = datetime.strptime(sale_date_raw, "%m/%d/%Y").strftime("%Y-%m-%d")
    except Exception:
        sale_date_iso = sale_date_raw or None

    county = normalize_county(county_raw, state_upper)
    property_type = detect_property_type(address)
    pricing = build_pricing(county, property_type, None, None, None)

    return {
        "id":               make_id("mwc", address, sale_date_iso or ""),
        "source":           "McCabe, Weisberg & Conway",
        "source_url":       source_url,
        "firm_file_number": mat_no or None,
        "address":          address,
        "city":             city,
        "state":            state_upper,
        "zip_code":         "",
        "county":           county,
        "lat":              None,
        "lng":              None,
        "sale_date":        sale_date_iso,
        "sale_date_raw":    sale_date_raw,
        "sale_time":        sale_time or None,
        "sale_location":    f"{county} Courthouse",
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             [f"{state_upper} Foreclosure", "Trustee Sale", county, "McCabe"],
        "status":           "active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     days_to_sale(sale_date_iso) if sale_date_iso else None,
    }


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

def normalize_county(raw: str, state: str = "VA") -> str:
    """
    Normalize county string to 'X County' or 'X City' format.

    State-aware: VA has many independent cities (Alexandria, Fairfax, etc.)
    that must render as 'X City'. MD has only one (Baltimore City). Apostrophes
    like "Prince George's" survive .title() incorrectly ("Prince George'S"),
    so we patch those common cases.
    """
    raw = raw.strip()
    if not raw:
        return "Unknown County"

    # Fix common apostrophe capitalization (MD has "Prince George's",
    # "Queen Anne's", "St. Mary's"; VA has no apostrophe counties).
    titled = raw.title()
    titled = re.sub(r"([A-Za-z])'S\b", lambda m: m.group(1) + "'s", titled)
    # St. Mary's preservation (title() mangles the dot but not much)

    state = (state or "VA").upper()
    if state == "VA":
        va_cities = {
            "Alexandria", "Fairfax", "Falls Church", "Manassas", "Manassas Park",
            "Richmond", "Norfolk", "Virginia Beach", "Chesapeake", "Newport News",
            "Hampton", "Portsmouth", "Suffolk", "Poquoson", "Fredericksburg",
            "Colonial Heights", "Petersburg", "Lynchburg", "Roanoke",
        }
        for city in va_cities:
            if city in titled and "County" not in titled:
                return f"{city} City"
    elif state == "MD":
        # Baltimore City is the only MD independent city.
        if "Baltimore" in titled and "County" not in titled:
            return "Baltimore City"
    elif state == "DC":
        # DC has no counties — the District itself is the jurisdiction.
        # Normalize any permutation ("District Of Columbia", "Washington", etc.)
        # to a single canonical form used in COUNTY_BASE_VALUES.
        return "District of Columbia"

    if "County" not in titled and "City" not in titled:
        return f"{titled} County"
    return titled


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
    """Geocode any property missing lat/lng. Builds the full
    address-with-state from each property's own state/city/zip — DO NOT
    hardcode VA, this project covers DC + MD + VA."""
    missing = [p for p in properties if not p.get("lat")]
    log.info(f"Geocoding {len(missing)} properties ...")
    success = 0
    failed_status_counts: dict[str, int] = {}
    for prop in missing:
        state = (prop.get("state") or "VA").upper()
        zip_code = prop.get("zip_code") or ""
        city = prop.get("city") or ""
        # Compose the cleanest possible string. Fall back through what we have.
        parts = [prop.get("address") or "", city, state, zip_code]
        address_str = ", ".join(p for p in parts if p)
        lat, lng = geocode(address_str, api_key)
        prop["lat"] = lat
        prop["lng"] = lng
        if lat:
            success += 1
            log.debug(f"  ✓ {prop['address']} → {lat:.4f}, {lng:.4f}")
        time.sleep(0.1)  # rate limit
    log.info(f"Geocoded {success}/{len(missing)} successfully")
    return properties


# ── Main ──────────────────────────────────────────────────────────────────────

def run(gmaps_key: str = "") -> dict:
    import os
    api_key = gmaps_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")

    # Load previous output once — used for both the new/updated diff and the
    # safety guard that aborts on suspicious property-count collapses.
    previous: dict = {}
    prev_by_id: dict[str, dict] = {}
    if OUTPUT_PATH.exists():
        try:
            previous = json.loads(OUTPUT_PATH.read_text())
            prev_by_id = {p.get("id"): p for p in previous.get("foreclosures", []) if p.get("id")}
        except Exception as e:
            log.warning(f"Could not parse previous output for diff: {e}")
            previous = {}
            prev_by_id = {}

    # Scrape all sources
    all_props = []
    all_props.extend(scrape_siw())
    time.sleep(2)
    all_props.extend(scrape_orlans())
    time.sleep(2)
    all_props.extend(scrape_bww())
    time.sleep(2)
    all_props.extend(scrape_mwc())
    time.sleep(1)

    # HUD REO from user-committed xlsx (data/hud_{va,md,dc}.xlsx).
    # User manually exports from hudhomestore.gov weekly; committing the
    # files triggers inclusion in the next scrape run.
    try:
        from hud_reo import scrape_hud_reo
        all_props.extend(scrape_hud_reo())
    except Exception as e:
        log.warning(f"HUD REO: loader failed: {e}")

    # DC Vacant & Blighted registry — distress signal, not active listings.
    # Blighted properties pay Class 3 tax rate (5x standard), making them
    # strong pre-foreclosure / tax-sale candidates for off-market outreach.
    try:
        from dc_vacant import scrape_dc_vacant
        all_props.extend(scrape_dc_vacant())
    except Exception as e:
        log.warning(f"DC Vacant: loader failed: {e}")

    # VA Vendee REO via VRM Properties — public listings, no auth.
    # Bank-owned VA-foreclosed homes already in disposition.
    try:
        from va_vendee import scrape_va_vendee
        all_props.extend(scrape_va_vendee())
    except Exception as e:
        log.warning(f"VA Vendee: loader failed: {e}")

    # HomeSteps REO (Freddie Mac) — public Drupal Views site with JSON-LD
    # structured data per listing. Single page covers DC/MD/VA inventory.
    try:
        from homesteps_reo import scrape_homesteps_reo
        all_props.extend(scrape_homesteps_reo())
    except Exception as e:
        log.warning(f"HomeSteps: loader failed: {e}")

    # Deduplicate
    all_props = deduplicate(all_props)

    # Pricing is derived purely from county + property type + size using the
    # heuristic matrix in build_pricing(). No third-party enrichment layer.

    # Geocode
    if api_key:
        all_props = geocode_missing(all_props, api_key)

    # Sort by days to sale (soonest first), nulls last
    all_props.sort(
        key=lambda p: p.get("days_to_sale") if p.get("days_to_sale") is not None else 9999
    )

    # Frontend compat: emit latitude/longitude alongside lat/lng.
    # The existing HTML reads `property.latitude` / `property.longitude`.
    for p in all_props:
        if p.get("lat") is not None:
            p["latitude"] = p["lat"]
        if p.get("lng") is not None:
            p["longitude"] = p["lng"]

    # Frontend compat: flatten pricing object into top-level fields.
    # The HTML reads `p.price`, `p.arv`, `p.monthlyRent`, `p.cashFlow`, `p.capRate`,
    # `p.score`, `p.zip`, `p.listingType`, `p.rehabEstimate`, `p.beds`, `p.baths`,
    # `p.sqft`. Provide sensible defaults so cards/filters/calculators don't break;
    # the frontend's in-browser enrichment step (Estated, HUD FMR) fills in real
    # beds/baths/sqft for properties it can resolve.
    for p in all_props:
        pr = p.get("pricing", {}) or {}
        p["price"]          = pr.get("eav") or 0
        p["arv"]            = pr.get("arv") or 0
        p["monthlyRent"]    = pr.get("monthly_rent_estimate") or 0
        p["cashFlow"]       = pr.get("cash_flow_estimate") or 0
        p["capRate"]        = pr.get("cap_rate") or 0
        p["score"]          = pr.get("score") or 0
        p["grade"]          = pr.get("grade") or "D"
        p["passes70"]       = pr.get("passes_70_rule") or False
        p["mao70"]          = pr.get("mao_70") or 0
        p["dscr"]           = pr.get("dscr") or 0
        p["zip"]            = p.get("zip_code") or ""
        # Trustee-firm listings have a set auction date + courthouse location,
        # so they map to "Auction" on the map legend. HUD REO and any other
        # source that sets listingType explicitly (e.g., "REO/Bank-Owned") is
        # preserved here.
        p["listingType"]    = p.get("listingType") or "Auction"
        # Rehab default: assume 8% of ARV for a typical foreclosure ($20K on a
        # $250K home). User can override in the calculator drawer per-property.
        p["rehabEstimate"]  = p.get("rehabEstimate") or round((pr.get("arv") or 0) * 0.08)
        # Property specs — 0/null until enrichment API (Estated) populates them.
        # Frontend uses `(p.sqft||0)` and numeric comparisons like `p.beds<minB`
        # which would misbehave on null (null<3 is true), so default to 0.
        if p.get("beds") is None:  p["beds"] = 0
        if p.get("baths") is None: p["baths"] = 0
        if p.get("sqft") is None:  p["sqft"] = 0
        if p.get("yearBuilt") is None: p["yearBuilt"] = p.get("year_built")

    # ── New / updated tracking ─────────────────────────────────────────────
    # Persist first_seen_at and last_changed_at so the frontend can highlight
    # listings that newly entered the inventory or whose key fields shifted
    # since the prior run. Server-authoritative (same answer on every device).
    now_iso = datetime.utcnow().isoformat() + "Z"
    # Fields whose change implies "this listing changed materially". Sale-date
    # shifts, status flips, and price signals are the meaningful diffs;
    # scraped_at obviously updates every run and is excluded.
    DIFF_FIELDS = (
        "sale_date", "sale_date_raw", "sale_time", "sale_location",
        "status", "listingType", "address", "city", "zip_code",
    )
    PRICING_DIFF_FIELDS = ("opening_bid", "original_loan", "eav", "arv")

    new_count = 0
    updated_count = 0
    for p in all_props:
        prev = prev_by_id.get(p.get("id"))
        if prev is None:
            p["first_seen_at"] = now_iso
            p["last_changed_at"] = now_iso
            new_count += 1
            continue
        # Existing property — preserve first_seen, decide if anything changed
        p["first_seen_at"] = prev.get("first_seen_at") or now_iso
        changed = any(p.get(f) != prev.get(f) for f in DIFF_FIELDS)
        if not changed:
            cur_pr = p.get("pricing") or {}
            old_pr = prev.get("pricing") or {}
            changed = any(cur_pr.get(f) != old_pr.get(f) for f in PRICING_DIFF_FIELDS)
        if changed:
            p["last_changed_at"] = now_iso
            updated_count += 1
        else:
            p["last_changed_at"] = prev.get("last_changed_at") or p["first_seen_at"]
    log.info(f"Diff vs prior run: {new_count} new, {updated_count} updated, "
             f"{len(all_props) - new_count - updated_count} unchanged")

    # Build output
    high_conf = sum(1 for p in all_props if "HIGH" in p["pricing"]["confidence"])
    med_conf  = sum(1 for p in all_props if "MEDIUM" in p["pricing"]["confidence"])
    low_conf  = sum(1 for p in all_props if "LOW" in p["pricing"]["confidence"])

    sources = {}
    for p in all_props:
        s = p["source"]
        sources[s] = sources.get(s, 0) + 1

    counties = sorted({p["county"] for p in all_props if p["county"] != "Unknown County"})

    # State breakdown so the frontend can show state filter chip counts.
    states = {}
    for p in all_props:
        st = (p.get("state") or "VA").upper()
        states[st] = states.get(st, 0) + 1

    output = {
        "metadata": {
            "total_properties":     len(all_props),
            "scraped_at":           datetime.utcnow().isoformat() + "Z",
            "new_this_run":         new_count,
            "updated_this_run":     updated_count,
            "sources":              sources,
            "states":               states,
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

    # Safety guard: refuse to clobber existing data on a suspicious collapse.
    # A real scrape should produce a similar order-of-magnitude count week to
    # week; a sudden drop to 0 (or below half) almost always means a source
    # broke, not that foreclosures stopped happening.
    prev_total = previous.get("metadata", {}).get("total_properties", 0)
    if len(all_props) == 0 and prev_total > 0:
        log.error(
            f"ABORT: scrape returned 0 properties but previous run had {prev_total}. "
            "Refusing to overwrite data. Investigate the source scrapers."
        )
        return previous
    if prev_total >= 10 and len(all_props) < prev_total * 0.5:
        log.error(
            f"ABORT: scrape returned {len(all_props)} properties, "
            f"a >50% drop from previous {prev_total}. Refusing to overwrite. "
            "Investigate the source scrapers."
        )
        return previous

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, default=str))
    log.info(f"✅ Wrote {len(all_props)} properties to {OUTPUT_PATH}")

    return output


if __name__ == "__main__":
    run()
