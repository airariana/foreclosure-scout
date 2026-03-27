#!/usr/bin/env python3
"""
md_foreclosure_agent.py — v1.0
Maryland Foreclosure Intelligence Agent

Pulls NOI + NOF + FPR data from the Maryland Open Data Portal (Socrata)
across all 24 counties. Calculates velocity, conversion rates, absorption,
detects alert thresholds, and exports JSON for Foreclosure Scout ingestion.

Datasets:
  - w3bc-8mnv : NOI + NOF + FPR by County (monthly)
  - ftsr-vapt : NOI by Zip Code (monthly)

No API key required for basic access. For production, set MD_SOCRATA_APP_TOKEN.
"""

import json
import os
import logging
from datetime import datetime, date
from pathlib import Path

import requests

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Config ────────────────────────────────────────────────────────────────────
SOCRATA_BASE = "https://opendata.maryland.gov/resource"
COUNTY_DATASET = "w3bc-8mnv"  # NOI + NOF + FPR by County
ZIP_DATASET    = "ftsr-vapt"  # NOI by Zip Code
APP_TOKEN      = os.environ.get("MD_SOCRATA_APP_TOKEN", "")
OUTPUT_PATH    = Path("data/foreclosures_md.json")

# ── County Tier Classification ────────────────────────────────────────────────
TIER_1 = {
    "baltimore_city",
    "prince_georges_county",
    "montgomery_county",
    "baltimore_county",
}
TIER_2 = {
    "anne_arundel_county",
    "howard_county",
    "charles_county",
    "frederick_county",
    "harford_county",
    "carroll_county",
}

# API field name → display name
COUNTY_DISPLAY = {
    "allegany_county":        "Allegany County",
    "anne_arundel_county":    "Anne Arundel County",
    "baltimore_city":         "Baltimore City",
    "baltimore_county":       "Baltimore County",
    "calvert_county":         "Calvert County",
    "caroline_county":        "Caroline County",
    "carroll_county":         "Carroll County",
    "cecil_county":           "Cecil County",
    "charles_county":         "Charles County",
    "dorchester_county":      "Dorchester County",
    "frederick_county":       "Frederick County",
    "garrett_county":         "Garrett County",
    "harford_county":         "Harford County",
    "howard_county":          "Howard County",
    "kent_county":            "Kent County",
    "montgomery_county":      "Montgomery County",
    "prince_georges_county":  "Prince George's County",
    "queen_annes_county":     "Queen Anne's County",
    "somerset_county":        "Somerset County",
    "st_marys_county":        "St. Mary's County",
    "talbot_county":          "Talbot County",
    "washington_county":      "Washington County",
    "wicomico_county":        "Wicomico County",
    "worcester_county":       "Worcester County",
}

ALL_COUNTY_FIELDS = list(COUNTY_DISPLAY.keys())

# ── Alert Thresholds ──────────────────────────────────────────────────────────
NOI_VELOCITY_WATCH  = 15.0   # % month-over-month increase → WATCH
NOI_VELOCITY_ALERT  = 30.0   # % month-over-month increase → ALERT
NOF_CONVERSION_ALERT = 35.0  # NOF/NOI % for Tier 1 counties → ALERT
FPR_ABSORPTION_WATCH = 30.0  # FPR/NOF % below this → WATCH (REO buildup)


# ── Socrata API Helpers ───────────────────────────────────────────────────────

def socrata_get(dataset_id: str, params: dict) -> list[dict]:
    """Fetch records from a Maryland Socrata dataset."""
    url = f"{SOCRATA_BASE}/{dataset_id}.json"
    headers = {}
    if APP_TOKEN:
        headers["X-App-Token"] = APP_TOKEN

    try:
        r = requests.get(url, params=params, headers=headers, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error(f"Socrata fetch failed for {dataset_id}: {e}")
        return []


def fetch_county_data(months: int = 6) -> list[dict]:
    """Fetch the last N months of NOI/NOF/FPR by county."""
    params = {
        "$order":  "date DESC",
        "$limit":  str(months * 3),  # 3 notice types per month
    }
    rows = socrata_get(COUNTY_DATASET, params)
    log.info(f"County dataset: {len(rows)} rows fetched")
    return rows


def fetch_zip_data(months: int = 3) -> list[dict]:
    """Fetch the last N months of NOI by zip code."""
    params = {
        "$order": "date DESC",
        "$limit": "2000",
    }
    rows = socrata_get(ZIP_DATASET, params)
    log.info(f"Zip dataset: {len(rows)} rows fetched")
    return rows


# ── Data Parsing ──────────────────────────────────────────────────────────────

def parse_county_rows(rows: list[dict]) -> dict:
    """
    Restructure raw Socrata rows into a nested dict:
      data[period][notice_type][county_field] = count
    """
    data = {}
    for row in rows:
        raw_date = row.get("date") or ""
        # Normalize date to YYYY-MM
        try:
            dt = datetime.fromisoformat(raw_date.replace("Z", ""))
            period = dt.strftime("%Y-%m")
        except Exception:
            continue

        notice_type = (row.get("notice_type") or "").strip()
        if not notice_type:
            continue

        if period not in data:
            data[period] = {}
        if notice_type not in data[period]:
            data[period][notice_type] = {}

        for field in ALL_COUNTY_FIELDS:
            raw_val = row.get(field) or row.get(field.replace("_", " ")) or "0"
            try:
                data[period][notice_type][field] = int(str(raw_val).replace(",", ""))
            except (ValueError, TypeError):
                data[period][notice_type][field] = 0

    return data


def get_sorted_periods(data: dict) -> list[str]:
    """Return periods sorted newest-first."""
    return sorted(data.keys(), reverse=True)


# ── Metric Calculations ───────────────────────────────────────────────────────

def calc_velocity(current: int, prior: int) -> float | None:
    """Month-over-month % change."""
    if prior == 0:
        return None
    return round((current - prior) / prior * 100, 1)


def calc_conversion_rate(nof: int, noi: int) -> float | None:
    """NOF as % of NOI — measures how many NOIs become formal filings."""
    if noi == 0:
        return None
    return round(nof / noi * 100, 1)


def calc_absorption_rate(fpr: int, nof: int) -> float | None:
    """FPR as % of NOF — measures auction throughput."""
    if nof == 0:
        return None
    return round(fpr / nof * 100, 1)


def classify_signal(
    velocity: float | None,
    conversion: float | None,
    absorption: float | None,
    tier: str,
) -> str:
    if velocity is not None and velocity >= NOI_VELOCITY_ALERT:
        return "ALERT"
    if (velocity is not None and velocity >= NOI_VELOCITY_WATCH) or \
       (conversion is not None and conversion >= NOF_CONVERSION_ALERT and tier == "tier1") or \
       (absorption is not None and absorption <= FPR_ABSORPTION_WATCH):
        return "WATCH"
    return "NORMAL"


def tier_for(county_field: str) -> str:
    if county_field in TIER_1:
        return "tier1"
    if county_field in TIER_2:
        return "tier2"
    return "tier3"


# ── Zip Code Analysis ─────────────────────────────────────────────────────────

def analyze_zip_data(rows: list[dict]) -> list[dict]:
    """
    Aggregate zip code NOI data. Return top zips for current period,
    with month-over-month change where available.
    """
    zip_by_period: dict[str, dict[str, int]] = {}
    for row in rows:
        raw_date = row.get("date") or ""
        try:
            dt = datetime.fromisoformat(raw_date.replace("Z", ""))
            period = dt.strftime("%Y-%m")
        except Exception:
            continue
        zip_code = str(row.get("zip_code") or row.get("zipcode") or "").strip()
        count_raw = row.get("notice_count") or row.get("count") or "0"
        try:
            count = int(str(count_raw).replace(",", ""))
        except Exception:
            count = 0
        if period not in zip_by_period:
            zip_by_period[period] = {}
        zip_by_period[period][zip_code] = count

    periods = sorted(zip_by_period.keys(), reverse=True)
    if not periods:
        return []

    current_period = periods[0]
    prior_period   = periods[1] if len(periods) > 1 else None

    current_zips = zip_by_period[current_period]
    prior_zips   = zip_by_period.get(prior_period, {}) if prior_period else {}

    # Build top-zip list
    results = []
    for zip_code, count in sorted(current_zips.items(), key=lambda x: -x[1])[:20]:
        prior_count = prior_zips.get(zip_code, 0)
        mom = calc_velocity(count, prior_count) if prior_count > 0 else None
        results.append({
            "zip":        zip_code,
            "noi_count":  count,
            "prior_noi":  prior_count,
            "mom_change": mom,
            "flag":       "SPIKE" if mom and mom >= 20 else None,
        })

    return results[:10]  # top 10


# ── Statewide Totals ──────────────────────────────────────────────────────────

def statewide_totals(period_data: dict, notice_type: str) -> int:
    row = period_data.get(notice_type, {})
    return sum(row.get(f, 0) for f in ALL_COUNTY_FIELDS)


# ── Main Analysis ─────────────────────────────────────────────────────────────

def analyze(county_data: dict, zip_rows: list[dict]) -> dict:
    periods = get_sorted_periods(county_data)
    if not periods:
        log.error("No county data periods found")
        return {}

    current = periods[0]
    prior   = periods[1] if len(periods) > 1 else None

    NOI_TYPE = "Notice of Intent to Foreclose"
    NOF_TYPE = "Notice of Foreclosure"
    FPR_TYPE = "Foreclosure Property Registration"

    current_noi = county_data[current].get(NOI_TYPE, {})
    current_nof = county_data[current].get(NOF_TYPE, {})
    current_fpr = county_data[current].get(FPR_TYPE, {})

    prior_noi = county_data[prior].get(NOI_TYPE, {}) if prior else {}
    prior_nof = county_data[prior].get(NOF_TYPE, {}) if prior else {}

    # ── Per-county analysis ──────────────────────────────────────────────────
    counties_out = {}
    alerts = []

    for field, display in COUNTY_DISPLAY.items():
        noi = current_noi.get(field, 0)
        nof = current_nof.get(field, 0)
        fpr = current_fpr.get(field, 0)
        p_noi = prior_noi.get(field, 0)
        p_nof = prior_nof.get(field, 0)

        velocity   = calc_velocity(noi, p_noi)
        conversion = calc_conversion_rate(nof, noi)
        absorption = calc_absorption_rate(fpr, nof)
        tier       = tier_for(field)
        signal     = classify_signal(velocity, conversion, absorption, tier)

        county_record = {
            "display_name":     display,
            "tier":             tier,
            "noi":              noi,
            "nof":              nof,
            "fpr":              fpr,
            "prior_noi":        p_noi,
            "prior_nof":        p_nof,
            "noi_velocity_pct": velocity,
            "conversion_rate":  conversion,
            "absorption_rate":  absorption,
            "signal":           signal,
        }
        counties_out[field] = county_record

        if signal in ("ALERT", "WATCH"):
            alert_reasons = []
            if velocity and velocity >= NOI_VELOCITY_WATCH:
                alert_reasons.append(
                    f"NOI up {velocity}% MoM ({p_noi} → {noi})"
                )
            if conversion and conversion >= NOF_CONVERSION_ALERT and tier == "tier1":
                alert_reasons.append(
                    f"NOF conversion rate {conversion}% (high)"
                )
            if absorption and absorption <= FPR_ABSORPTION_WATCH:
                alert_reasons.append(
                    f"FPR absorption {absorption}% (REO buildup risk)"
                )
            alerts.append({
                "county":      display,
                "field":       field,
                "tier":        tier,
                "level":       signal,
                "reasons":     alert_reasons,
                "current_noi": noi,
                "current_nof": nof,
                "current_fpr": fpr,
            })

    # ── Statewide summary ────────────────────────────────────────────────────
    state_noi_curr = statewide_totals(county_data[current], NOI_TYPE)
    state_nof_curr = statewide_totals(county_data[current], NOF_TYPE)
    state_fpr_curr = statewide_totals(county_data[current], FPR_TYPE)
    state_noi_prior = statewide_totals(county_data[prior], NOI_TYPE) if prior else 0
    state_nof_prior = statewide_totals(county_data[prior], NOF_TYPE) if prior else 0

    # ── Zip analysis ─────────────────────────────────────────────────────────
    top_zips = analyze_zip_data(zip_rows)

    return {
        "report_date":      date.today().isoformat(),
        "data_period":      current,
        "prior_period":     prior,
        "alerts":           sorted(alerts, key=lambda a: a["level"] == "ALERT", reverse=True),
        "statewide": {
            "noi_current":     state_noi_curr,
            "noi_prior":       state_noi_prior,
            "noi_velocity":    calc_velocity(state_noi_curr, state_noi_prior),
            "nof_current":     state_nof_curr,
            "nof_prior":       state_nof_prior,
            "nof_velocity":    calc_velocity(state_nof_curr, state_nof_prior),
            "fpr_current":     state_fpr_curr,
        },
        "counties":          counties_out,
        "top_zip_codes":     top_zips,
        "data_caveats": [
            "Data is aggregate (county/zip level) — no individual property addresses.",
            "Updated monthly by OFR. Most recent period may lag by 30–45 days.",
            "May contain duplicate NOI submissions per OFR disclosure.",
            "Tax sale foreclosures NOT included — tracked separately by each county.",
            "NOI does not guarantee foreclosure — most resolve prior to court filing.",
        ],
        "source_urls": {
            "county_dataset": f"https://opendata.maryland.gov/resource/{COUNTY_DATASET}.json",
            "zip_dataset":    f"https://opendata.maryland.gov/resource/{ZIP_DATASET}.json",
            "ofr_tracker":    "https://labor.maryland.gov/finance/consumers/frforeclosuredatatracker.shtml",
        },
    }


# ── Report Generator ──────────────────────────────────────────────────────────

def generate_brief(analysis: dict) -> str:
    """Generate a markdown intelligence brief from analysis output."""
    lines = []
    sw = analysis["statewide"]
    period = analysis["data_period"]

    lines.append(f"# Maryland Foreclosure Intelligence Brief")
    lines.append(f"**Data period:** {period} | **Generated:** {analysis['report_date']}\n")

    # Alerts
    alerts = analysis["alerts"]
    if alerts:
        lines.append("## 🚨 Alerts\n")
        for a in alerts:
            icon = "🔴" if a["level"] == "ALERT" else "🟡"
            lines.append(f"{icon} **{a['display_name'] if 'display_name' in a else a['county']}** ({a['tier'].upper()}) — {' | '.join(a['reasons'])}")
        lines.append("")
    else:
        lines.append("## ✅ No Alerts\nAll counties within normal range.\n")

    # Statewide
    noi_vel = sw["noi_velocity"]
    nof_vel = sw["nof_velocity"]
    vel_str = lambda v: f"({'+' if v > 0 else ''}{v}% MoM)" if v is not None else ""
    lines.append("## Statewide Summary\n")
    lines.append(f"- **NOI:** {sw['noi_current']:,} {vel_str(noi_vel)}")
    lines.append(f"- **NOF:** {sw['nof_current']:,} {vel_str(nof_vel)}")
    lines.append(f"- **FPR (sales registered):** {sw['fpr_current']:,}\n")

    # Tier 1 counties
    lines.append("## Tier 1 Counties\n")
    lines.append("| County | NOI | NOI Trend | NOF | Conversion | Signal |")
    lines.append("|--------|-----|-----------|-----|------------|--------|")
    for field, rec in analysis["counties"].items():
        if rec["tier"] != "tier1":
            continue
        vel = rec["noi_velocity_pct"]
        vel_s = f"{'+' if vel and vel > 0 else ''}{vel}%" if vel is not None else "—"
        conv = f"{rec['conversion_rate']}%" if rec["conversion_rate"] else "—"
        sig = {"ALERT": "🔴 ALERT", "WATCH": "🟡 WATCH", "NORMAL": "✅"}.get(rec["signal"], "—")
        lines.append(f"| {rec['display_name']} | {rec['noi']:,} | {vel_s} | {rec['nof']:,} | {conv} | {sig} |")
    lines.append("")

    # Tier 2 table
    lines.append("## Tier 2 Counties\n")
    lines.append("| County | NOI | NOI Trend | NOF | Signal |")
    lines.append("|--------|-----|-----------|-----|--------|")
    for field, rec in analysis["counties"].items():
        if rec["tier"] != "tier2":
            continue
        vel = rec["noi_velocity_pct"]
        vel_s = f"{'+' if vel and vel > 0 else ''}{vel}%" if vel is not None else "—"
        sig = {"ALERT": "🔴", "WATCH": "🟡", "NORMAL": "✅"}.get(rec["signal"], "—")
        lines.append(f"| {rec['display_name']} | {rec['noi']:,} | {vel_s} | {rec['nof']:,} | {sig} |")
    lines.append("")

    # Top zips
    if analysis["top_zip_codes"]:
        lines.append("## Top Zip Codes by NOI\n")
        lines.append("| Zip | NOI | MoM | Flag |")
        lines.append("|-----|-----|-----|------|")
        for z in analysis["top_zip_codes"]:
            mom = f"{'+' if z['mom_change'] and z['mom_change'] > 0 else ''}{z['mom_change']}%" \
                  if z["mom_change"] is not None else "—"
            flag = z.get("flag") or ""
            lines.append(f"| {z['zip']} | {z['noi_count']} | {mom} | {flag} |")
        lines.append("")

    # Caveats
    lines.append("---")
    lines.append("**Data Notes:** " + " | ".join(analysis["data_caveats"][:2]))

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def run() -> dict:
    log.info("Maryland Foreclosure Intelligence Agent starting ...")

    county_rows = fetch_county_data(months=6)
    zip_rows    = fetch_zip_data(months=3)

    if not county_rows:
        log.error("No county data returned — check Socrata API availability")
        return {}

    county_data = parse_county_rows(county_rows)
    analysis    = analyze(county_data, zip_rows)
    brief       = generate_brief(analysis)

    # Write JSON output
    output = {**analysis, "markdown_brief": brief}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, default=str))
    log.info(f"✅ Maryland analysis written to {OUTPUT_PATH}")

    # Print brief to stdout (for GitHub Actions logs)
    print("\n" + brief)

    return output


if __name__ == "__main__":
    run()
