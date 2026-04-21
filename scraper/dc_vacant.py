"""
DC Vacant & Blighted Building Registry source for Foreclosure Scout.

DC's Office of Tax and Revenue maintains a daily-updated registry of
vacant and blighted buildings. Blighted properties pay the Class 3 tax
rate (5x the standard rate), creating sustained financial pressure that
often cascades into tax-sale auctions and foreclosures. These aren't
active listings — they're high-probability distress LEADS.

Data source: DC ArcGIS Hub, FeatureServer layer 82
  https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/
    Property_and_Land_WebMercator/FeatureServer/82

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
    return properties


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
