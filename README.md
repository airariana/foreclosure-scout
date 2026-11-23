# Nestscoop

Off-market land search and pre-screening for western Loudoun and Fauquier
counties, Virginia, and Frederick, Washington and Montgomery counties,
Maryland. Live at [nestscoop.com](https://nestscoop.com/).

Nestscoop started as a DC/MD/VA foreclosure tracker. That feed and its
scraper were retired on 2026-11-22; the app is now the land pipeline.

## What it does

- **Find land:** screens county parcel data for size, road access, water and
  buildability, and for signs an owner may sell (taxes past due, an estate
  or heirs, an owner out of state, decades of ownership).
- **Parcel card:** owner, assessment, last sale, zoning, flood, soils and
  water for any parcel you tap on the map.
- **Stage 1 report:** a per-parcel pre-screen of deeds, owners, estates,
  entities, taxes, tax-sale timing and liens, marking each step as found in
  public data, yours to check (with the link and exact search), or not
  applicable.
- **Due-diligence checklist, outreach letters and follow-ups** for saved
  parcels.

Parcels are looked up in the browser from county and state GIS services each
time you open one. Saved parcels, checklists, letters and the Maryland
tax-sale results live in a Cloudflare Worker with a D1 database
(`backend/`, not in this repository).

## Run locally

```bash
python3 -m http.server 8787
```

Then open http://localhost:8787/foreclosure-scout.html.

## Files

- `foreclosure-scout.html`: the page (its name predates the land app).
- `fc-dashboard.js`: the app. Bump `fc-dashboard.js?v=` in the page after
  every change so browsers load the new version.
- `data/`: static map layers (county growth, easement and zoning-case
  layers, streams and ponds).
- `manifest.json`, `fc-sw.js`: install-to-home-screen support.
