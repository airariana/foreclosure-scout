# Virginia Foreclosure Scraper - Setup Instructions

## 🎯 What This Does

Automatically scrapes Virginia foreclosure data from Samuel I. White, P.C. every week and makes it available to your Foreclosure Scout app.

## 📁 Project Structure

```
foreclosure-scout/
├── scraper/
│   ├── va_foreclosure_scraper.py    # Main scraper script
│   └── requirements.txt              # Python dependencies
├── data/
│   └── foreclosures_va.json         # Output data (auto-generated)
├── .github/
│   └── workflows/
│       └── scrape-foreclosures.yml  # GitHub Actions config
└── foreclosure-scout.html           # Your main app
```

## 🚀 Setup Steps

### Step 1: Add Files to Your Foreclosure Scout Repo

```bash
cd "/Users/amjadjaghori/Desktop/Business/Foreclosure Scout"

# Create directory structure
mkdir -p scraper
mkdir -p data
mkdir -p .github/workflows

# Add the scraper files (download from Claude)
# Move va_foreclosure_scraper.py to scraper/
# Move requirements.txt to scraper/
# Move scrape-foreclosures.yml to .github/workflows/
```

### Step 2: Find the Actual PDF URL

The scraper needs the direct link to the Samuel I. White PDF.

**To find it:**
1. Go to https://www.siwpc.com/
2. Look for "Foreclosure Sales" or similar link
3. Right-click the PDF link → Copy Link Address
4. Update line 18 in `va_foreclosure_scraper.py`:

```python
self.pdf_url = "PASTE_THE_ACTUAL_PDF_URL_HERE"
```

### Step 3: Add Google Maps API Key (Optional but Recommended)

To geocode addresses (add lat/lng coordinates):

1. Go to your GitHub repo: https://github.com/airariana/foreclosure-scout
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `GOOGLE_MAPS_API_KEY`
5. Value: Your Foreclosure Scout Google Maps API key
6. Click **Add secret**

### Step 4: Commit and Push

```bash
cd "/Users/amjadjaghori/Desktop/Business/Foreclosure Scout"

# Add new files
git add scraper/ data/ .github/

# Commit
git commit -m "Add automated Virginia foreclosure scraper"

# Push
git push
```

### Step 5: Test the Workflow

1. Go to your GitHub repo: https://github.com/airariana/foreclosure-scout
2. Click **Actions** tab
3. Click **Scrape Virginia Foreclosures** workflow
4. Click **Run workflow** → **Run workflow**
5. Watch it run!

---

## 📅 Schedule

The scraper runs automatically:
- **Every Monday at 6 AM UTC** (1 AM EST)
- Or manually via Actions tab

## 📊 Output Data

The scraper creates `data/foreclosures_va.json`:

```json
{
  "metadata": {
    "source": "Samuel I. White, P.C.",
    "source_url": "https://www.siwpc.com/",
    "scraped_at": "2024-03-23T10:30:00Z",
    "total_properties": 87,
    "coverage": "Virginia statewide"
  },
  "foreclosures": [
    {
      "id": "VA-95019",
      "address": "519 Bird Farm Rd",
      "city": "Covington",
      "state": "VA",
      "zip_code": "24426",
      "county": "Alleghany",
      "sale_date": "3/25/2026",
      "sale_time": "13:00:00",
      "sale_location": "Covington",
      "firm_file_number": "95019",
      "latitude": 37.7834,
      "longitude": -79.9939,
      "source": "Samuel I. White, P.C.",
      "source_url": "https://www.siwpc.com/",
      "scraped_at": "2024-03-23T10:30:00Z"
    }
    // ... more properties
  ]
}
```

## 🔗 Using Data in Foreclosure Scout

Update your `foreclosure-scout.html` to fetch the data:

```javascript
// Fetch Virginia foreclosures
async function loadVirginiaForeclosures() {
  try {
    const response = await fetch('data/foreclosures_va.json');
    const data = await response.json();
    
    console.log(`Loaded ${data.metadata.total_properties} VA foreclosures`);
    console.log(`Last updated: ${data.metadata.scraped_at}`);
    
    // Display in your app
    displayForeclosures(data.foreclosures);
    
  } catch (error) {
    console.error('Error loading VA foreclosures:', error);
  }
}

// Call on page load
loadVirginiaForeclosures();
```

---

## 🐛 Troubleshooting

### Scraper Fails - PDF URL Not Found

**Problem**: The PDF URL in the scraper is wrong or outdated  
**Solution**: 
1. Visit https://www.siwpc.com/
2. Find the current PDF link
3. Update `self.pdf_url` in the scraper
4. Commit and push

### No Data in JSON File

**Problem**: PDF parsing failed  
**Solution**:
1. Check the Actions log for errors
2. The PDF format may have changed
3. May need to adjust the `_parse_foreclosure_line()` method

### Geocoding Not Working

**Problem**: Missing or invalid Google Maps API key  
**Solution**:
1. Verify the secret is set in GitHub: Settings → Secrets → Actions
2. Key should be for Foreclosure Scout project (not SalesHQ)
3. Geocoding API must be enabled in Google Cloud Console

---

## 📈 Next Steps

Once the Virginia scraper is working:

1. **Add Maryland** - Similar approach but court records instead of PDF
2. **Add DC** - DC Superior Court scraper
3. **Add More Trustees** - Other VA trustees beyond Samuel I. White
4. **Add Enrichment** - Census data, FEMA flood zones, Zillow values
5. **Add Alerts** - Email/SMS when new properties match criteria

---

## 🔒 Security Notes

- ✅ Google Maps API key stored as GitHub Secret (encrypted)
- ✅ No sensitive data committed to repo
- ✅ Scraper respects rate limits
- ✅ User-Agent identifies the scraper
- ⚠️ PDF data is public but verify Samuel I. White's TOS

---

## 📞 Support

If you encounter issues:
1. Check the **Actions** tab logs in GitHub
2. Review the error messages
3. Update the PDF URL if it changed
4. Adjust parsing logic if PDF format changed

---

**Ready to deploy!** Follow the setup steps above and you'll have automated Virginia foreclosure data! 🚀
