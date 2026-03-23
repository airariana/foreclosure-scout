# Foreclosure Scout

**DC/MD/VA Foreclosure Intelligence Platform**

A Progressive Web App (PWA) for tracking and analyzing foreclosure listings in the DC, Maryland, and Virginia area. Foreclosure Scout aggregates data from multiple public sources to help real estate investors identify opportunities in the foreclosure market.

## Features

- 🏠 **Multi-Source Data Aggregation**
  - CourtListener bankruptcy filings
  - Public foreclosure listings
  - Tax assessor data
  - Property valuations

- 📍 **Geographic Intelligence**
  - DC/MD/VA focused coverage
  - Location-based search
  - Neighborhood analysis
  - FEMA flood zone data

- 🔍 **Smart Filtering**
  - Property type filters
  - Price range search
  - Status tracking (pre-foreclosure, auction, REO)
  - Custom search criteria

- 📱 **Progressive Web App**
  - Install as native app
  - Offline functionality
  - Fast, responsive interface
  - Mobile-optimized

- 🤖 **AI-Powered Insights**
  - Property analysis with Gemini AI
  - Investment opportunity scoring
  - Market trend analysis
  - Risk assessment

## Quick Start

### Option 1: Use the Hosted Version

Simply visit the deployed application (add your deployment URL here).

### Option 2: Run Locally

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/foreclosure-scout.git
   cd foreclosure-scout
   ```

2. **Serve the files**
   
   Using Python:
   ```bash
   python -m http.server 8080
   ```
   
   Or using Node.js:
   ```bash
   npx http-server -p 8080
   ```

3. **Open in browser**
   ```
   http://localhost:8080/foreclosure-scout.html
   ```

4. **Install as PWA** (optional)
   - Click the install button in your browser
   - Or use "Add to Home Screen" on mobile

## Configuration

### API Keys

The application uses several APIs. You'll need to configure:

1. **Google Gemini API** (for AI insights)
   - Get your key at: https://ai.google.dev/
   - Add to the app configuration

2. **Google Maps API** (for geocoding)
   - Get your key at: https://console.cloud.google.com/
   - Enable Geocoding API

### Data Sources

Foreclosure Scout pulls from public sources including:
- **CourtListener**: Federal bankruptcy filings
- **Census API**: Demographic data
- **FEMA**: Flood risk data
- **USDA**: Rural housing data
- **BLS**: Economic indicators

All data sources are publicly accessible and require no authentication.

## Technology Stack

- **Frontend**: Pure HTML/CSS/JavaScript (no framework dependencies)
- **PWA**: Service Worker for offline functionality
- **AI**: Google Gemini API for property analysis
- **Data**: Public APIs (CourtListener, Census, FEMA)
- **Maps**: Google Maps API for geocoding

## File Structure

```
foreclosure-scout/
├── foreclosure-scout.html    # Main application
├── manifest.json              # PWA manifest
├── fc-sw.js                   # Service worker
├── icons/                     # App icons (create this)
│   ├── fc-icon-192.png
│   └── fc-icon-512.png
└── README.md
```

## Creating App Icons

You'll need to create app icons for the PWA:

1. Create an `icons/` directory
2. Add two PNG files:
   - `fc-icon-192.png` (192x192 pixels)
   - `fc-icon-512.png` (512x512 pixels)
3. Use your Foreclosure Scout branding/logo

## Deployment

### GitHub Pages

1. Push to GitHub
2. Go to Settings → Pages
3. Select main branch as source
4. Access at: `https://YOUR_USERNAME.github.io/foreclosure-scout/foreclosure-scout.html`

### Netlify

1. Connect your GitHub repo
2. Build command: (none needed)
3. Publish directory: `/`
4. Deploy!

### Vercel

1. Import GitHub repo
2. Framework preset: Other
3. Deploy!

## Usage Tips

### Search Strategies

1. **Find Pre-Foreclosures**
   - Search by county
   - Filter by filing date
   - Look for recent bankruptcies

2. **Auction Opportunities**
   - Track auction dates
   - Compare opening bids to market values
   - Research property history

3. **Investment Analysis**
   - Use AI insights for property evaluation
   - Check flood zones and risk factors
   - Review neighborhood demographics
   - Calculate potential ROI

### Offline Mode

Foreclosure Scout works offline thanks to the service worker:
- App shell cached for instant loading
- Search history preserved
- Saved searches available offline
- Sync when connection restored

## Browser Support

- ✅ Chrome/Edge (Recommended)
- ✅ Safari
- ✅ Firefox
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

PWA installation supported on:
- Android (Chrome, Edge)
- iOS/iPadOS 16.4+ (Safari)
- Windows (Edge, Chrome)
- macOS (Chrome, Edge)

## Privacy & Data

- All searches are client-side
- No personal data stored on servers
- API calls go directly to public sources
- Saved searches stored in browser only
- No tracking or analytics by default

## Legal Notice

⚠️ **Important Disclaimers:**

- This tool is for informational purposes only
- Data is sourced from public records and may not be complete or current
- Always verify foreclosure information with official sources
- Consult with legal and financial professionals before making investment decisions
- Comply with all Fair Housing Act requirements
- Respect terms of service of all data sources

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Roadmap

- [ ] Additional data sources (state/local courts)
- [ ] Enhanced AI analysis features
- [ ] Property watchlists and alerts
- [ ] Export to CSV/Excel
- [ ] Mobile app version (React Native)
- [ ] Email/SMS notifications
- [ ] Comparable sales analysis
- [ ] Investment calculator
- [ ] Team collaboration features

## Support

- 🐛 **Bug Reports**: Open an issue on GitHub
- 💡 **Feature Requests**: Start a discussion
- 📧 **Contact**: (Add your contact info)

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- Data provided by CourtListener, US Census Bureau, FEMA, and other public sources
- Built with Google Gemini AI
- PWA best practices from Google

---

**Foreclosure Scout** - Smart foreclosure intelligence for DC, Maryland, and Virginia

Made with ❤️ for real estate investors
