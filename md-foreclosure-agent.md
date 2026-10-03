---
name: md-foreclosure-intelligence
description: >
  Daily Maryland pre-foreclosure intelligence agent. Pulls live NOI, NOF, and FPR
  data from the Maryland Open Data Portal (Socrata) across all 24 counties.
  Identifies early-stage distressed properties 30–90 days before auction.
  Triggers on: "run Maryland foreclosure report", "check MD pre-foreclosures",
  "MD NOI report", "Maryland distressed property scan", or any request to
  check Maryland foreclosure signal data.
---

# Maryland Foreclosure Intelligence Agent

A daily workflow that queries the Maryland Office of Financial Regulation (OFR)
foreclosure datasets via the Socrata API, surfaces pre-foreclosure signals across
all 24 Maryland jurisdictions, scores counties by distress activity, and produces
an actionable intelligence brief for the Foreclosure Scout dashboard.

---

## Industry Knowledge Base — What to Look For

### The Maryland Foreclosure Signal Pipeline

Maryland is one of the best-documented pre-foreclosure states in the US because
state law mandates electronic filing of three sequential notices with the OFR.
Each notice represents a distinct stage in the distress timeline:

#### Stage 1 — Notice of Intent to Foreclose (NOI)
- **What it means:** The mortgage servicer has mailed a formal default warning to
  the homeowner. This is the earliest public signal of distress — typically 30–60
  days before any court action.
- **Legal basis:** Maryland Code, Real Property § 7-105.1(c). Servicer must file
  with OFR within 5 business days of mailing.
- **Investor opportunity window:** 45–120 days to auction. Best time for direct
  mail outreach, pre-listing negotiations, or short sale positioning.
- **Noise level:** High — most NOI recipients resolve their default. Historically
  only 15–25% of NOIs proceed to formal foreclosure filing.
- **Key signal:** Rising NOI counts in a zip/county = leading indicator of future
  auction inventory 60–90 days out.

#### Stage 2 — Notice of Foreclosure (NOF)
- **What it means:** The lender's law firm has filed the Order to Docket or
  Complaint to Foreclose with the Circuit Court. The case is now officially active
  in the court system. Filed within 7 days of court filing.
- **Legal basis:** Maryland Code, Real Property § 7-105.2.
- **Investor opportunity window:** 15–90 days to auction. Direct negotiation with
  servicer/attorney is still possible. Mediation window may be open.
- **Noise level:** Medium — NOF cases do get dismissed, but conversion rate to
  actual sale is much higher than NOI stage (~50–65%).
- **Key signal:** NOF spike in a county = active foreclosure inventory building.
  Cross-reference against NOI data from 60–90 days prior to confirm pipeline.

#### Stage 3 — Foreclosed Property Registration (FPR)
- **What it means:** The property has SOLD at foreclosure auction. The winning
  bidder must register within a defined period. This is a lagging indicator —
  useful for understanding market absorption and pricing comps.
- **Legal basis:** Maryland Code, Real Property § 7-105.14.
- **Investor opportunity window:** Post-sale. Useful for identifying REO
  properties (if lender was winning bidder) or tracking new ownership for
  follow-up.
- **Key signal:** FPR volume in a county = actual auction throughput. Compare
  to NOF from 30–60 days prior to estimate conversion rate.

---

### Maryland County Priority Tiers (for Foreclosure Scout)

Based on population density, distressed property concentration, and investor
activity relevant to the DC/MD/VA market:

**Tier 1 — Primary Targets (highest volume + investor activity)**
- Baltimore City — consistently highest NOI/NOF volume statewide
- Prince George's County — large suburban inventory, close to DC, high distress
- Montgomery County — lower distress rate but high ARV; strong flip margin
- Baltimore County — second highest volume after Baltimore City

**Tier 2 — Secondary Targets (moderate volume, strong opportunity)**
- Anne Arundel County (Annapolis area)
- Howard County (Columbia corridor)
- Charles County (Southern MD, growing market)
- Frederick County (I-70 corridor)
- Harford County (Northeast MD)

**Tier 3 — Monitor Only (lower volume)**
All remaining 15 Maryland jurisdictions — pull data but don't prioritize unless
a spike is detected (>20% week-over-week increase in any Tier 3 county).

---

### Key Ratios and Signals to Calculate

**NOF-to-NOI Conversion Rate (per county, trailing 90 days)**
```
conversion_rate = NOF_count / NOI_count (same county, 90-day lag)
```
A county with >30% conversion rate signals aggressive servicer behavior —
properties there are more likely to actually reach auction.

**NOI Velocity (week-over-week change)**
```
velocity = (current_month_NOI - prior_month_NOI) / prior_month_NOI * 100
```
A +15% or greater increase = ALERT. Flags a county heating up.

**FPR Absorption Rate**
```
absorption = FPR_count / NOF_count (same county, 30-day lag)
```
High absorption (>70%) = auctions are selling quickly; investor competition is
high. Low absorption (<40%) = properties sitting post-auction; REO buildup.

---

### What This Data Does NOT Tell You

Be explicit with the user about these limitations:

1. **No property-level addresses** — Socrata data is aggregate (county or zip
   level). It tells you WHERE to look, not WHICH specific property.
2. **No real-time filings** — Data updates monthly. The most recent month is
   typically the prior calendar month.
3. **Duplicates exist** — OFR acknowledges the data may contain duplicate NOI
   submissions. Treat county-level totals as directional, not exact.
4. **Tax sale foreclosures excluded** — OFR does not track county tax sales.
   Those are separate pipelines (each county administers independently).
5. **NOI ≠ imminent foreclosure** — Most homeowners receiving an NOI resolve
   the default. Use NOF as the stronger action signal.

---

## Socrata API Endpoints

### Primary Datasets

**NOI + NOF + FPR by County (monthly totals)**
```
Dataset ID: w3bc-8mnv
Endpoint: https://opendata.maryland.gov/resource/w3bc-8mnv.json
Fields: date, notice_type, allegany_county, anne_arundel_county,
        baltimore_city, baltimore_county, calvert_county, caroline_county,
        carroll_county, cecil_county, charles_county, dorchester_county,
        frederick_county, garrett_county, harford_county, howard_county,
        kent_county, montgomery_county, prince_georges_county,
        queen_annes_county, somerset_county, st_marys_county,
        talbot_county, washington_county, wicomico_county, worcester_county
```

**NOI by Zip Code (monthly totals)**
```
Dataset ID: ftsr-vapt
Endpoint: https://opendata.maryland.gov/resource/ftsr-vapt.json
Fields: date, zip_code, notice_count
```

**NOI by Census Tract (annual)**
```
Dataset ID: [census tract dataset]
Endpoint: https://opendata.maryland.gov/resource/[id].json
Use for: deeper geographic heat mapping (quarterly, not daily)
```

### API Query Patterns

**Get last 6 months of all notice types by county:**
```
GET https://opendata.maryland.gov/resource/w3bc-8mnv.json
  ?$order=date DESC
  &$limit=18
  &$$app_token=[OPTIONAL_APP_TOKEN]
```

**Get NOF data only for the last 3 months:**
```
GET https://opendata.maryland.gov/resource/w3bc-8mnv.json
  ?notice_type=Notice of Foreclosure
  &$order=date DESC
  &$limit=3
```

**Get zip-level NOI for a specific county (requires zip filtering):**
```
GET https://opendata.maryland.gov/resource/ftsr-vapt.json
  ?$where=zip_code LIKE '207%'  (Prince George's County zips start with 207)
  &$order=date DESC
  &$limit=12
```

**No API key required** — Socrata allows unauthenticated requests up to 1,000/day.
For production use, register a free app token at opendata.maryland.gov to get
unlimited requests.

---

## Workflow Steps (in order)

1. **Pull current data** — Query `w3bc-8mnv` for the last 6 months (all notice types)
2. **Pull zip-level NOI** — Query `ftsr-vapt` for the last 3 months
3. **Calculate metrics** for each county:
   - Current month NOI, NOF, FPR totals
   - NOI velocity (month-over-month % change)
   - NOF-to-NOI conversion rate (90-day lag)
   - FPR absorption rate
4. **Score and rank counties** using the tier system above
5. **Detect alerts** — flag any county with >15% NOI velocity spike
6. **Generate output** in the format below
7. **Export JSON** for ingestion into Foreclosure Scout dashboard

---

## Alert Thresholds

| Condition | Alert Level | Action |
|---|---|---|
| County NOI up >15% MoM | 🟡 WATCH | Flag in report, add to dashboard |
| County NOI up >30% MoM | 🔴 ALERT | Push notification to user |
| NOF-to-NOI conversion >35% in any Tier 1 county | 🔴 ALERT | High auction likelihood |
| FPR absorption <30% (lender buying back) | 🟡 WATCH | REO buildup signal |
| Any Tier 3 county jumps to Tier 2 NOF volume | 🟡 WATCH | Emerging market flag |

---

## Report Structure

Build the report in this exact order:

---

### 🚨 URGENT ALERTS

List any counties triggering alert thresholds above. Include:
- County name
- Metric that triggered the alert
- Current value vs. prior month
- Recommended action (e.g., "Expand search radius in Prince George's County")

If no alerts: *No threshold breaches this week. All counties within normal range.*

---

### Maryland Statewide Summary

3–5 sentences on the overall state of the MD pre-foreclosure market:
- Total NOI volume statewide vs. prior month
- Total NOF volume statewide vs. prior month
- Any notable geographic concentration of activity

---

### Tier 1 County Deep-Dives

For each of the 4 Tier 1 counties, provide:

**[County Name]**
- NOI (current month): [count] | Trend: [↑/↓/→] [%]
- NOF (current month): [count] | Trend: [↑/↓/→] [%]
- FPR (current month): [count]
- Conversion Rate (90-day): [%]
- Absorption Rate: [%]
- Signal: [ALERT / WATCH / NORMAL]
- Investor Note: 1–2 sentences on what this means for deal flow

---

### Tier 2 County Summary Table

Condensed table format:

| County | NOI | NOI Trend | NOF | NOF Trend | Signal |
|--------|-----|-----------|-----|-----------|--------|
| Anne Arundel | — | — | — | — | — |
| Howard | — | — | — | — | — |
| Charles | — | — | — | — | — |
| Frederick | — | — | — | — | — |
| Harford | — | — | — | — | — |

---

### Zip Code Hot Spots

Top 10 zip codes by NOI count (current month), from the `ftsr-vapt` dataset.
Flag any zip that increased >20% vs. prior month.

| Zip | County | NOI Count | MoM Change |
|-----|--------|-----------|------------|
| — | — | — | — |

---

### Data Freshness & Caveats

Always include at the bottom:
- Date the data was pulled
- Most recent data period available (Socrata updates monthly)
- Reminder that data is aggregate, not property-level
- Link to the OFR Foreclosure Data Tracker for reference

---

## Output Format

### 1. Dashboard JSON (for Foreclosure Scout ingestion)

```json
{
  "report_date": "YYYY-MM-DD",
  "data_period": "YYYY-MM",
  "alerts": [
    {
      "county": "Prince George's County",
      "type": "NOI_SPIKE",
      "current_value": 1191,
      "prior_value": 1052,
      "change_pct": 13.2,
      "level": "WATCH"
    }
  ],
  "counties": {
    "baltimore_city": {
      "noi": 2025,
      "nof": 181,
      "fpr": 25,
      "noi_trend_pct": -6.9,
      "conversion_rate": null,
      "tier": 1
    }
  },
  "top_zip_codes": [
    { "zip": "20783", "county": "Prince George's", "noi": 89, "mom_change": 12.5 }
  ]
}
```

### 2. Intelligence Brief (Markdown)

Structured markdown report following the format above, suitable for:
- Pasting into Foreclosure Scout's data panel
- Saving as a weekly record
- Sharing with team members

---

## Tone & Style

- Write like a market analyst, not a journalist — direct, data-first, brief
- Always cite the specific metric and time period ("Baltimore City NOI rose 13%
  in October vs. September 2025")
- Flag data quality issues explicitly (duplicates, missing periods, lag)
- Never speculate about individual homeowners or imply personal financial distress
  — this is aggregate market intelligence only
- Keep each county section to 3–5 lines max in the brief format

---

## Integration Notes for Foreclosure Scout

This agent's JSON output plugs directly into the `loadMDNOI()` function in
`foreclosure-scout.html`. The existing Socrata call in the app pulls the zip-level
NOI dataset (`ftsr-vapt`). To integrate the NOF county dataset (`w3bc-8mnv`):

1. Add a new `loadMDNOF()` function mirroring `loadMDNOI()`
2. The county dataset returns rows with a `notice_type` field — filter for
   `"Notice of Foreclosure"` to isolate NOF data
3. Map county column names from the API to display names in the UI
4. Add a new "MD Foreclosure Pipeline" tab in the data panel showing NOI → NOF
   → FPR funnel per county

County column name mapping (API field → display name):
```
baltimore_city          → Baltimore City
baltimore_county        → Baltimore County
prince_georges_county   → Prince George's County
montgomery_county       → Montgomery County
anne_arundel_county     → Anne Arundel County
howard_county           → Howard County
charles_county          → Charles County
frederick_county        → Frederick County
harford_county          → Harford County
carroll_county          → Carroll County
```
