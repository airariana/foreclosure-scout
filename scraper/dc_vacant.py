"""
DC Vacant & Blighted Building Registry source for Foreclosure Scout.

DC's Office of Tax and Revenue maintains a daily-updated registry of
vacant and blighted buildings. Blighted properties pay the Class 3 tax
rate (5x the standard rate), creating sustained financial pressure that
often cascades into tax-sale auctions and foreclosures. These aren't
active listings — they're high-probability distress LEADS.

Data sources (two sibling DC ArcGIS layers, joined by SSL):
  - Layer 82: Vacant/Blighted addresses (address + geometry + ward)
    https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/
      Property_and_Land_WebMercator/FeatureServer/82
  - Layer 80: ITSPE Property Records (owner name + owner mailing address
    + tax class + assessed value)
    https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/
      Property_and_Land_WebMercator/MapServer/80

Joining layer 82 (addresses) with layer 80 (ownership) via SSL gives us
distress leads annotated with owner contact info. Absentee owners —
where mailing address != property address — are the highest-value
outreach candidates.

~2,400 active rows. Daily refresh. Geocoded. No auth required.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime

import requests

log = logging.getLogger(__name__)

ARCGIS_URL = (
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/"
    "Property_and_Land_WebMercator/FeatureServer/82/query"
)
ARCGIS_ITSPE_URL = (
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/"
    "Property_and_Land_WebMercator/MapServer/80/query"
)

# DC ArcGIS caps queries to 2000 features per call. Registry is ~2,400 rows,
# so we paginate with resultOffset.
PAGE_SIZE = 2000

# Cap the number of DC Vacant entries we include. 2,400 pins concentrated
# in DC makes the map unreadable at country-level zoom; 300 is still dense
# enough to show the distress pattern in the hot wards. Override via
# DC_VACANT_LIMIT env var. Set to 0 for no cap.
DC_VACANT_LIMIT = int(os.environ.get("DC_VACANT_LIMIT", "300"))


def scrape_dc_vacant() -> list[dict]:
    """
    Fetch active vacant/blighted DC properties from the ArcGIS registry,
    capped at DC_VACANT_LIMIT. Returns property dicts matching the shared
    v2.1 schema.
    """
    log.info("Scraping DC Vacant & Blighted registry ...")
    properties: list[dict] = []

    offset = 0
    while True:
        try:
            r = requests.get(
                ARCGIS_URL,
                params={
                    "where":                "STATUS='ACTIVE'",
                    "outFields":            "*",
                    "outSR":                "4326",  # WGS84 lat/lng
                    "f":                    "json",
                    "resultOffset":         offset,
                    "resultRecordCount":    PAGE_SIZE,
                },
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.error(f"DC Vacant: fetch failed at offset {offset}: {e}")
            break

        features = data.get("features") or []
        if not features:
            break

        for f in features:
            prop = _build_property(f)
            if prop:
                properties.append(prop)

        # Short-circuit if we've hit the cap.
        if DC_VACANT_LIMIT > 0 and len(properties) >= DC_VACANT_LIMIT:
            properties = properties[:DC_VACANT_LIMIT]
            log.info(f"DC Vacant: reached cap of {DC_VACANT_LIMIT}, stopping pagination")
            break

        # Stop when we've consumed the last page. ArcGIS sets
        # exceededTransferLimit=True if there's more to fetch.
        if not data.get("exceededTransferLimit") and len(features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    log.info(f"DC Vacant: {len(properties)} active properties (cap={DC_VACANT_LIMIT or 'none'})")

    # Enrich with owner info from layer 80 (ITSPE property records).
    _enrich_with_owner_data(properties)

    return properties


def _enrich_with_owner_data(properties: list[dict]) -> None:
    """
    Look up OWNERNAME + owner mailing address from DC's ITSPE property-record
    layer (MapServer layer 80) and merge into each property by SSL.

    We fetch layer 80 in bulk filtered to the SSLs of our properties — one
    query instead of 300. Falls through silently if the layer is unreachable;
    DC Vacant entries remain useful even without owner data.
    """
    ssl_by_id = {p["id"]: (p.get("firm_file_number") or "") for p in properties}
    ssls = [s for s in ssl_by_id.values() if s]
    if not ssls:
        log.info("DC Vacant owner enrichment: no SSLs, skipping")
        return

    # ArcGIS WHERE clause size-limited; batch in chunks of ~100 SSLs.
    BATCH = 100
    owner_by_ssl: dict[str, dict] = {}

    for i in range(0, len(ssls), BATCH):
        chunk = ssls[i:i + BATCH]
        where = "SSL IN (" + ",".join(f"'{s}'" for s in chunk) + ")"
        try:
            r = requests.get(
                ARCGIS_ITSPE_URL,
                params={
                    "where":              where,
                    "outFields":          "SSL,OWNERNAME,ADDRESS1,ADDRESS2,CITYSTZIP,CLASSTYPE,USECODE,NEWTOTAL",
                    "f":                  "json",
                    "returnGeometry":     "false",
                    "resultRecordCount":  BATCH,
                },
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.warning(f"DC Vacant owner enrichment: batch fetch failed at i={i}: {e}")
            continue

        for f in data.get("features") or []:
            attrs = f.get("attributes") or {}
            ssl = str(attrs.get("SSL") or "").strip()
            if not ssl:
                continue
            owner_by_ssl[ssl] = {
                "owner_name":      (attrs.get("OWNERNAME") or "").strip() or None,
                "owner_addr1":     (attrs.get("ADDRESS1") or "").strip() or None,
                "owner_addr2":     (attrs.get("ADDRESS2") or "").strip() or None,
                "owner_citystzip": (attrs.get("CITYSTZIP") or "").strip() or None,
                "tax_class":       (attrs.get("CLASSTYPE") or "").strip() or None,
                "use_code":        (attrs.get("USECODE") or "").strip() or None,
                "assessed_value":  _to_int(attrs.get("NEWTOTAL")),
            }

    enriched_count = 0
    absentee_count = 0
    for p in properties:
        ssl = p.get("firm_file_number") or ""
        o = owner_by_ssl.get(ssl)
        if not o:
            continue
        enriched_count += 1
        if o.get("owner_name"):      p["owner_name"]      = o["owner_name"]
        if o.get("owner_addr1"):     p["owner_address"]   = _join_owner_address(o)
        if o.get("tax_class"):       p["tax_class"]       = o["tax_class"]
        if o.get("use_code"):        p["use_code"]        = o["use_code"]
        if o.get("assessed_value"):  p["assessed_value"]  = o["assessed_value"]

        # Flag absentee owners — mailing address is different from property.
        # Heuristic: if owner city+state+zip doesn't contain "Washington, DC"
        # (or "DC 200xx"), owner is out-of-district.
        citystzip = (o.get("owner_citystzip") or "").lower()
        if citystzip and "dc" not in citystzip and "district of columbia" not in citystzip:
            p["absentee_owner"] = True
            absentee_count += 1

    log.info(
        f"DC Vacant owner enrichment: {enriched_count}/{len(properties)} matched, "
        f"{absentee_count} flagged absentee (out-of-DC mailing address)"
    )


def _join_owner_address(o: dict) -> str:
    parts = [o.get("owner_addr1"), o.get("owner_addr2"), o.get("owner_citystzip")]
    return ", ".join(p for p in parts if p)


def _to_int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _build_property(feature: dict) -> dict | None:
    attrs = feature.get("attributes") or {}
    geom = feature.get("geometry") or {}

    # Required: address + coords
    address = (attrs.get("ADDRESS") or "").strip()
    lng = geom.get("x")
    lat = geom.get("y")
    if not address or lat is None or lng is None:
        return None

    # Pricing matrix — late-bound import avoids a circular dep at module load.
    try:
        from va_foreclosure_scraper import build_pricing, detect_property_type
    except ImportError:
        # Scraper package layout gotcha — reach up one level.
        from scraper.va_foreclosure_scraper import build_pricing, detect_property_type

    zip_code = str(attrs.get("ZIPCODE") or "").strip()
    ward = str(attrs.get("WARD") or "").strip()
    ssl = str(attrs.get("SSL") or "").strip()
    status = str(attrs.get("STATUS") or "").strip().title()

    county = "District of Columbia"
    property_type = detect_property_type(address)
    pricing = build_pricing(county, property_type, None, None, None)

    prop_id = _make_id("dc-vacant", address, ssl)

    return {
        "id":               prop_id,
        "source":           "DC Vacant & Blighted Registry",
        "source_url":       "https://otr.cfo.dc.gov/page/vacant-and-blighted-buildings",
        "firm_file_number": ssl or None,
        "address":          address,
        "city":             "Washington",
        "state":            "DC",
        "zip_code":         zip_code,
        "county":           county,
        "lat":              lat,
        "lng":              lng,
        "sale_date":        None,
        "sale_date_raw":    None,
        "sale_time":        None,
        "sale_location":    None,
        "listingType":      "Distressed",
        "property_type":    property_type,
        "sqft":             None,
        "beds":             None,
        "baths":            None,
        "year_built":       None,
        "pricing":          pricing,
        "tags":             [
            "DC Foreclosure", "Distressed", "Vacant/Blighted",
            f"Ward {ward}" if ward else "DC",
        ],
        "status":           status or "Active",
        "scraped_at":       datetime.utcnow().isoformat() + "Z",
        "days_to_sale":     None,
    }


def _make_id(prefix: str, address: str, extra: str = "") -> str:
    key = f"{prefix}::{address}::{extra}".lower()
    return f"{prefix}-{hashlib.md5(key.encode()).hexdigest()[:10]}"
