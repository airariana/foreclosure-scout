#!/usr/bin/env python3
"""
Samuel I. White Foreclosure Scraper
Downloads and parses Virginia foreclosure sales report PDF
"""

import requests
import json
import pdfplumber
from datetime import datetime
import re
import sys

class SamuelWhiteScraper:
    """Scraper for Samuel I. White foreclosure sales reports"""
    
    def __init__(self):
        self.base_url = "https://www.siwpc.com"
        # The PDF URL - you'll need to find the actual direct link
        # It might be something like: https://www.siwpc.com/sales.pdf
        self.pdf_url = f"https://www.siwpc.net/AutoUpload/Sales.pdf"  # UPDATE THIS
        
    def download_pdf(self):
        """Download the foreclosure sales PDF"""
        print(f"Downloading PDF from {self.pdf_url}...")
        
        headers = {
            'User-Agent': 'ForeclosureScout/1.0 (Educational/Research Purpose)'
        }
        
        try:
            response = requests.get(self.pdf_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            # Save PDF temporarily
            with open('sales_temp.pdf', 'wb') as f:
                f.write(response.content)
            
            print(f"✓ Downloaded PDF ({len(response.content)} bytes)")
            return 'sales_temp.pdf'
            
        except Exception as e:
            print(f"✗ Error downloading PDF: {e}")
            return None
    
    def parse_pdf(self, pdf_path):
        """Parse the foreclosure data from PDF"""
        print(f"Parsing PDF: {pdf_path}...")
        
        foreclosures = []
        current_county = None
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    print(f"  Processing page {page_num}...")
                    
                    # Extract text from page
                    text = page.extract_text()
                    
                    if not text:
                        continue
                    
                    # Split into lines
                    lines = text.split('\n')
                    
                    for line in lines:
                        # Check if line is a county header (green headers in PDF)
                        # These are usually in Title Case without numbers
                        if self._is_county_header(line):
                            current_county = line.strip()
                            print(f"    Found county: {current_county}")
                            continue
                        
                        # Try to parse as foreclosure entry
                        foreclosure = self._parse_foreclosure_line(line, current_county)
                        if foreclosure:
                            foreclosures.append(foreclosure)
            
            print(f"✓ Parsed {len(foreclosures)} foreclosure properties")
            return foreclosures
            
        except Exception as e:
            print(f"✗ Error parsing PDF: {e}")
            return []
    
    def _is_county_header(self, line):
        """Check if line is a county header"""
        # County headers are typically:
        # - Title case or all caps
        # - Don't start with numbers
        # - Are relatively short
        # - Match known Virginia county/city names
        
        line = line.strip()
        
        if not line or len(line) > 50:
            return False
        
        # Check if line starts with a number (property addresses do)
        if re.match(r'^\d', line):
            return False
        
        # Common county/city keywords
        county_keywords = [
            'County', 'City of', 'Fairfax', 'Loudoun', 'Prince William',
            'Chesterfield', 'Henrico', 'Virginia Beach', 'Norfolk',
            'Richmond', 'Hampton', 'Newport News', 'Alexandria'
        ]
        
        return any(keyword in line for keyword in county_keywords)
    
    def _parse_foreclosure_line(self, line, county):
        """Parse a single foreclosure entry line"""
        # Format: Address City Zip SaleDate SaleTime Location FirmFile#
        # Example: 5724 Croatan Court Centreville 20120 3/17/2026 11:30:00 Fairfax 81374
        
        # Skip empty lines or lines that don't look like data
        if not line.strip() or 'Property Address' in line or 'Information Reported' in line:
            return None
        
        # Try to extract data using regex
        # This is a simplified parser - may need adjustment based on actual PDF format
        parts = line.split()
        
        if len(parts) < 7:
            return None
        
        try:
            # Find the ZIP code (5 digits)
            zip_index = None
            for i, part in enumerate(parts):
                if re.match(r'^\d{5}$', part):
                    zip_index = i
                    break
            
            if zip_index is None:
                return None
            
            # Everything before ZIP is address + city
            address_parts = parts[:zip_index-1]  # -1 because city is just before ZIP
            address = ' '.join(address_parts)
            
            city = parts[zip_index-1]
            zip_code = parts[zip_index]
            
            # After ZIP: date, time, location, file#
            if len(parts) >= zip_index + 4:
                sale_date = parts[zip_index + 1]
                sale_time = parts[zip_index + 2]
                sale_location = parts[zip_index + 3]
                firm_file = parts[zip_index + 4] if len(parts) > zip_index + 4 else None
                
                return {
                    'id': f"VA-{firm_file}" if firm_file else None,
                    'address': address,
                    'city': city,
                    'state': 'VA',
                    'zip_code': zip_code,
                    'county': county,
                    'sale_date': sale_date,
                    'sale_time': sale_time,
                    'sale_location': sale_location,
                    'firm_file_number': firm_file,
                    'source': 'Samuel I. White, P.C.',
                    'source_url': 'https://www.siwpc.com/',
                    'scraped_at': datetime.utcnow().isoformat()
                }
        
        except Exception as e:
            # Skip lines that don't parse correctly
            return None
        
        return None
    
    def enrich_with_coordinates(self, foreclosures, google_maps_api_key=None):
        """Add lat/lng coordinates using Google Maps API"""
        if not google_maps_api_key:
            print("⚠ No Google Maps API key - skipping geocoding")
            return foreclosures
        
        print(f"Geocoding {len(foreclosures)} addresses...")
        
        import time
        
        for i, foreclosure in enumerate(foreclosures):
            # Construct full address
            full_address = f"{foreclosure['address']}, {foreclosure['city']}, {foreclosure['state']} {foreclosure['zip_code']}"
            
            try:
                # Call Google Maps Geocoding API
                url = "https://maps.googleapis.com/maps/api/geocode/json"
                params = {
                    'address': full_address,
                    'key': google_maps_api_key
                }
                
                response = requests.get(url, params=params)
                data = response.json()
                
                if data['status'] == 'OK' and data['results']:
                    location = data['results'][0]['geometry']['location']
                    foreclosure['latitude'] = location['lat']
                    foreclosure['longitude'] = location['lng']
                    print(f"  ✓ Geocoded {i+1}/{len(foreclosures)}: {foreclosure['city']}")
                else:
                    print(f"  ✗ Could not geocode: {foreclosure['city']}")
                
                # Rate limiting - don't hammer the API
                time.sleep(0.1)
                
            except Exception as e:
                print(f"  ✗ Geocoding error: {e}")
                continue
        
        return foreclosures
    
    def save_to_json(self, foreclosures, output_path='foreclosures_va.json'):
        """Save foreclosures to JSON file"""
        print(f"Saving {len(foreclosures)} foreclosures to {output_path}...")
        
        # Add metadata
        output = {
            'metadata': {
                'source': 'Samuel I. White, P.C.',
                'source_url': 'https://www.siwpc.com/',
                'scraped_at': datetime.utcnow().isoformat(),
                'total_properties': len(foreclosures),
                'coverage': 'Virginia statewide'
            },
            'foreclosures': foreclosures
        }
        
        try:
            with open(output_path, 'w') as f:
                json.dump(output, f, indent=2)
            
            print(f"✓ Saved to {output_path}")
            return True
            
        except Exception as e:
            print(f"✗ Error saving JSON: {e}")
            return False
    
    def run(self, google_maps_api_key=None):
        """Main scraper workflow"""
        print("=" * 60)
        print("Samuel I. White Foreclosure Scraper")
        print("=" * 60)
        
        # Step 1: Download PDF
        pdf_path = self.download_pdf()
        if not pdf_path:
            print("✗ Failed to download PDF")
            return False
        
        # Step 2: Parse PDF
        foreclosures = self.parse_pdf(pdf_path)
        if not foreclosures:
            print("✗ No foreclosures found in PDF")
            return False
        
        # Step 3: Enrich with coordinates (optional)
        if google_maps_api_key:
            foreclosures = self.enrich_with_coordinates(foreclosures, google_maps_api_key)
        
        # Step 4: Save to JSON
        success = self.save_to_json(foreclosures)
        
        print("=" * 60)
        print(f"{'✓ COMPLETE' if success else '✗ FAILED'}")
        print("=" * 60)
        
        return success


if __name__ == "__main__":
    import os
    
    # Get Google Maps API key from environment variable (optional)
    google_maps_key = os.environ.get('GOOGLE_MAPS_API_KEY')
    
    # Run scraper
    scraper = SamuelWhiteScraper()
    success = scraper.run(google_maps_api_key=google_maps_key)
    
    sys.exit(0 if success else 1)
