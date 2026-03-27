---
name: va-trustee-sale-intelligence
description: >
  Weekly Virginia trustee sale scraper and pre-foreclosure intelligence agent.
  Covers the four major trustee/substitute trustee law firms publishing foreclosure
  sale notices in Northern Virginia and the broader DC/MD/VA metro:
  Samuel I. White P.C., Orlans Law Group, BWW Law Group, and
  McCabe Weisberg & Conway. Replaces dummy $150K placeholder pricing with
  an auction pricing matrix derived from property attributes. Triggers on:
  "run Virginia foreclosure report", "check VA trustee sales", "update VA
  listings", "scrape trustee notices", or any request to refresh VA data.
---

# Virginia Trustee Sale Intelligence Agent

A weekly workflow that scrapes the four dominant trustee law firm PDF notice
publications for Northern Virginia, extracts structured property data, scores
each listing using an auction pricing matrix, and exports to Foreclosure Scout.

---

## Industry Knowledge Base — Virginia Trustee Sale System

### How Virginia Foreclosures Reach the Public

Virginia is a non-judicial foreclosure state. There is no court filing before
the sale — the lender appoints a Substitute Trustee (almost always a law firm)
who has authority under the Deed of Trust's "power of sale" clause to sell the
property without court approval. The first PUBLIC signal is the legal notice
published in a local newspaper and simultaneously posted on the trustee firm's
website, typically 60 days before the sale date for owner-occupied residential.

The process from this public signal to auction:
1. Trustee publishes Notice of Trustee's Sale (60 days before auction)
2. Notice runs in newspaper 1x/week for 2–4 weeks (or 5 consecutive days)
3. Auction held at the county courthouse steps (or virtual, post-COVID)
4. Deed of Foreclosure recorded in Circuit Court Clerk's office after sale

**Key investor insight:** The 60-day notice window is your primary action window.
Properties in this window are pre-sale, meaning the homeowner may still be
reachable for a pre-foreclosure deal, a short sale negotiation, or to gather
intel before the courthouse steps auction.

---

## The Four Major Trustee Firms to Scrape

### 1. Samuel I. White, P.C. (SIWPC)
- **Coverage:** ~40% of Virginia foreclosure market, concentrated in Hampton Roads,
  Northern Virginia, and Richmond metro
- **Website:** https://www.siwpc.net/
- **Notice format:** Weekly PDF published Monday mornings
- **PDF URL pattern:** https://www.siwpc.net/foreclosures/ (listings page with
  downloadable PDF)
- **Status in Foreclosure Scout:** ✅ Already integrated — weekly GitHub Actions
  scraper running
- **Data fields available:** Address, county, sale date, sale time, sale location,
  firm file number
- **Gap:** No pricing data in notices — using $150K placeholder currently

### 2. Orlans Law Group
- **Coverage:** Large share of NOVA (Fairfax, Arlington, Loudoun, Prince William),
  also statewide. One of the most active trustees for major bank servicers.
- **Website:** https://www.orlans.com/
- **Notice format:** Searchable web listings + individual property pages
- **Listings URL:** https://www.orlans.com/property-listings/
- **Key fields:** Property address, sale date/time, sale location, opening bid
  (sometimes published), loan amount, trustee file number
- **Special:** Orlans sometimes publishes the **opening bid amount** — this is
  the most valuable pricing signal available without going to auction
- **Scrape target:** The property listings grid/table on their site

### 3. BWW Law Group
- **Coverage:** Heavy Northern Virginia and DC metro concentration.
  Handles servicers including Bank of America, Wells Fargo, and SPS.
- **Website:** https://www.bww-law.com/
- **Notice format:** Individual listing pages + searchable database
- **Listings URL:** https://www.bww-law.com/foreclosure-listings/
- **Key fields:** Address, county, sale date, trustee number
- **Note:** BWW publishes notices in local legal newspapers (Washington Examiner,
  Fairfax County Times). Cross-reference newspaper legal notices for additional
  coverage.

### 4. McCabe, Weisberg & Conway (MWC)
- **Coverage:** Maryland-heavy but significant Virginia presence, especially
  Prince William and Stafford Counties
- **Website:** https://www.mwc-law.com/
- **Notice format:** PDF lists + searchable web interface
- **Listings URL:** https://www.mwc-law.com/foreclosure-listings/
- **Key fields:** Address, county, sale date, original loan amount (sometimes)

---

## Auction Pricing Matrix

### Why the $150K Placeholder Is a Problem

The current Samuel I. White scraper assigns every property a static $150,000
price estimate. This creates three problems:
1. The scoring system (score: 65) is meaningless — all properties score identically
2. Cash flow, cap rate, and BRRRR calculations are wrong for the user's market
3. Properties in Fairfax County (median $600K+) and properties in rural VA
   (median $200K) look identical in the app

### The Pricing Matrix Approach

Since trustee sale notices don't include the property's market value, we build
an **Estimated Auction Value (EAV)** using a hierarchy of signals:

#### Signal Tier 1 — Use if Available (Direct Price Data)
| Signal | Source | Reliability |
|--------|--------|-------------|
| Opening bid amount | Orlans, MWC notices | Very high — this IS the starting price |
| Original loan amount | Some trustee notices | High — correlates ~85% with original purchase price |
| Delinquent loan balance | Sometimes in notice | High — floor for lender's credit bid |

#### Signal Tier 2 — Derived Estimate (Property Attributes)
When no direct price signal exists, build the EAV from property attributes:

**Step 1: County Base Price (Median Assessed Value per County)**
Use Virginia CAMA (Computer Assisted Mass Appraisal) data as the base:

```
COUNTY_BASE_VALUES = {
  # Northern Virginia (high value)
  "Fairfax County":      625000,
  "Arlington County":    700000,
  "Loudoun County":      575000,
  "Prince William County": 415000,
  "Alexandria City":     575000,
  "Falls Church City":   700000,
  "Manassas City":       325000,
  "Manassas Park City":  300000,

  # Richmond Metro (mid value)
  "Henrico County":      325000,
  "Chesterfield County": 330000,
  "Richmond City":       285000,
  "Hanover County":      365000,

  # Hampton Roads (mid value)
  "Virginia Beach City": 365000,
  "Norfolk City":        265000,
  "Chesapeake City":     345000,
  "Newport News City":   255000,
  "Suffolk City":        305000,

  # Other DC Metro
  "Stafford County":     385000,
  "Spotsylvania County": 325000,
  "Fredericksburg City": 310000,

  # Default fallback
  "DEFAULT":             275000
}
```

**Step 2: Property Type Multiplier**
```
PROPERTY_TYPE_MULTIPLIERS = {
  "Single Family":  1.00,   # baseline
  "Townhouse":      0.82,
  "Condo":          0.68,
  "Multi-Family":   1.25,   # 2-4 units
  "Land/Lot":       0.35,
  "Mobile Home":    0.28,
  "Commercial":     1.40,
  "Unknown":        1.00    # default
}
```
Detect property type from the address description in the notice
(e.g., "Unit 4B" → Condo, "Lot 7" → Land, etc.)

**Step 3: Size Adjustment**
If square footage is available (from public records lookup or address matching):
```
SIZE_ADJUSTMENT = {
  "< 800 sqft":     0.75,
  "800–1200 sqft":  0.90,
  "1200–1800 sqft": 1.00,  # baseline
  "1800–2500 sqft": 1.15,
  "2500–3500 sqft": 1.30,
  "> 3500 sqft":    1.55
}
```

**Step 4: Distress Discount**
Auction properties sell at a discount to market value due to:
- No inspection contingency
- "As-is" condition
- Title risk (though deed of trust sales convey clear title in VA)
- Competitive bidding uncertainty

```
AUCTION_DISCOUNT = 0.72  # properties typically sell at 72% of market value
                          # range: 65-85% depending on market conditions
                          # Northern Virginia: 75-82% (competitive)
                          # Rural VA: 65-72% (less bidder competition)
```

**Step 5: Final EAV Formula**
```
EAV = COUNTY_BASE * TYPE_MULTIPLIER * SIZE_ADJUSTMENT * AUCTION_DISCOUNT
```

**Step 6: ARV Estimate**
```
ARV = COUNTY_BASE * TYPE_MULTIPLIER * SIZE_ADJUSTMENT
# ARV = EAV / AUCTION_DISCOUNT (the inverse — full market value if rehabbed)
```

#### Signal Tier 3 — Public Records Enrichment (Future Enhancement)
For properties where the address can be confirmed, query the Virginia iCARE
assessment database or county GIS to retrieve:
- Last assessed value
- Year built
- Bedrooms/bathrooms
- Square footage
- Land value vs. improvement value

If iCARE data is available, replace the county base with the actual
assessed value × 1.05 (assessments typically lag market by ~5%).

---

### Confidence Scoring

Each EAV should carry a confidence label so the user knows how to interpret it:

| Confidence | Condition | Label |
|------------|-----------|-------|
| High | Opening bid or loan balance from notice | `HIGH — Direct signal` |
| Medium | County + property type + size from public records | `MEDIUM — Derived estimate` |
| Low | County base only, type and size unknown | `LOW — County average` |

Display the confidence label next to every price estimate in Foreclosure Scout.

---

### Derived Financial Metrics

Once EAV and ARV are established, calculate these for each property:

**Estimated Cash Flow (Monthly)**
```python
monthly_rent = ARV * 0.007          # 0.7% rent-to-value rule (conservative)
mortgage_payment = EAV * 0.006      # ~6% rate, 30yr, 80% LTV
property_tax = ARV * 0.009 / 12    # VA avg ~0.9% annually
insurance = ARV * 0.005 / 12       # avg homeowner insurance
vacancy_reserve = monthly_rent * 0.08

cash_flow = monthly_rent - mortgage_payment - property_tax - insurance - vacancy_reserve
```

**Cap Rate**
```python
noi_annual = (monthly_rent - property_tax - insurance - vacancy_reserve) * 12
cap_rate = noi_annual / EAV * 100
```

**Discount to ARV**
```python
discount_pct = (1 - EAV / ARV) * 100
```

**Investment Score (0–100)**
```python
score = 0
score += min(30, discount_pct * 1.2)    # up to 30 pts for discount depth
score += min(25, max(0, cap_rate * 3))  # up to 25 pts for cap rate
score += min(20, max(0, cash_flow / 50)) # up to 20 pts for cash flow
score += 15 if tier_1_county else (10 if tier_2_county else 5)  # location
score += 10 if confidence == "HIGH" else (5 if confidence == "MEDIUM" else 0)
```

---

## Scraper Architecture

### Data Flow

```
Samuel I. White PDF  ──┐
Orlans Web Listings  ──┼──> Parser ──> Structured JSON ──> Pricing Matrix ──> Foreclosure Scout
BWW Web Listings     ──┤
MWC Web/PDF         ──┘
```

### Property Object Schema

```json
{
  "id": "va-siw-2026-abc123",
  "source": "Samuel I. White",
  "source_url": "https://siwpc.net/...",
  "firm_file_number": "25-012345",
  "address": "123 Main St",
  "city": "Fairfax",
  "state": "VA",
  "zip_code": "22030",
  "county": "Fairfax County",
  "lat": 38.8462,
  "lng": -77.3064,
  "sale_date": "2026-04-15",
  "sale_time": "10:00 AM",
  "sale_location": "Fairfax County Courthouse, 4110 Chain Bridge Rd, Fairfax, VA",
  "property_type": "Single Family",
  "sqft": null,
  "beds": null,
  "baths": null,
  "year_built": null,
  "opening_bid": null,
  "original_loan_amount": null,
  "pricing": {
    "eav": 468750,
    "arv": 625000,
    "confidence": "LOW — County average",
    "county_base": 625000,
    "type_multiplier": 1.00,
    "size_adjustment": 1.00,
    "auction_discount": 0.75,
    "monthly_rent_estimate": 4375,
    "cash_flow_estimate": 412,
    "cap_rate": 6.2,
    "discount_to_arv": 25.0,
    "score": 68
  },
  "tags": ["VA Foreclosure", "Trustee Sale", "Fairfax County"],
  "scraped_at": "2026-03-27T06:00:00Z",
  "days_to_sale": 19
}
```

---

## Alert Thresholds

| Condition | Alert | Action |
|-----------|-------|--------|
| Sale date ≤ 7 days away | 🔴 URGENT | Flag in auction calendar, notify user |
| Sale date ≤ 21 days away | 🟡 WATCH | Urgency badge in calendar |
| Opening bid available from notice | ✅ DATA QUALITY | Upgrade confidence to HIGH |
| Property in Tier 1 county + score > 70 | ⭐ TOP PICK | Surface in top of list |
| New listing not in prior week's scan | 🆕 NEW | Flag as new in property card |

---

## Workflow Steps (in order)

1. **Fetch Samuel I. White PDF** — Download from siwpc.net, parse with PyPDF2
   (already running in GitHub Actions weekly)
2. **Fetch Orlans listings** — Scrape property-listings page, extract table rows
3. **Fetch BWW listings** — Scrape foreclosure-listings page
4. **Fetch MWC listings** — Scrape or download PDF
5. **Deduplicate** — Match by address + sale date to avoid double-counting
   properties handled by multiple references
6. **Enrich with pricing matrix** — Apply EAV formula to all properties missing
   real pricing data
7. **Geocode** — Any address without lat/lng goes through Google Maps Geocoding API
8. **Score** — Apply investment score formula to all properties
9. **Detect alerts** — Flag urgent sale dates and top picks
10. **Export** — Write to `data/foreclosures_va.json` with updated metadata
11. **Trigger Foreclosure Scout refresh** — Updated JSON auto-deploys via GitHub Pages

---

## GitHub Actions Schedule

```yaml
# .github/workflows/update-va-foreclosures.yml
# Run every Monday at 6 AM EST (existing) + Wednesday for mid-week updates
schedule:
  - cron: '0 11 * * 1'  # Monday 6 AM EST
  - cron: '0 11 * * 3'  # Wednesday 6 AM EST (new — for Orlans/BWW/MWC)
```

---

## Data Quality Notes

- **Duplicate handling:** The same property may appear from multiple sources
  (e.g., Orlans publishes + newspaper republishes). Deduplicate on
  `address + sale_date` before writing to JSON.
- **Address normalization:** Standardize abbreviations (St/Street, Ave/Avenue,
  Ct/Court) before geocoding to improve match rates.
- **Postponed sales:** Trustee sales are frequently postponed at the last minute.
  Check for postponement notices in the same PDFs/listings pages and update the
  sale date field accordingly.
- **Cancelled sales:** If a property appears in a prior week's data but not in the
  current scrape, mark it as `"status": "cancelled_or_resolved"` rather than
  deleting it — the homeowner may have cured the default.

---

## Integration Notes for Foreclosure Scout

Replace the existing `displayVAForeclosures()` function logic:

1. Remove hardcoded `price: 150000` — replace with `property.pricing.eav`
2. Remove hardcoded `arv: 200000` — replace with `property.pricing.arv`
3. Replace hardcoded `score: 65` — replace with `property.pricing.score`
4. Replace hardcoded `cashFlow: 250` — replace with `property.pricing.cash_flow_estimate`
5. Replace hardcoded `capRate: '6.5'` — replace with `property.pricing.cap_rate`
6. Add `confidence` badge to property card UI (HIGH/MEDIUM/LOW)
7. Add source badge to distinguish which trustee firm the listing came from
8. Add `days_to_sale` countdown to property card

New data source chips to add in the filter sidebar:
- ✅ Samuel I. White (existing)
- 🆕 Orlans Law Group
- 🆕 BWW Law Group
- 🆕 McCabe Weisberg & Conway
