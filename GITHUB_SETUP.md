# Setting Up Foreclosure Scout on GitHub

Follow these steps to create a new GitHub repository for Foreclosure Scout, completely separate from your beyondpayroll repository.

## Step 1: Create New GitHub Repository

### Using GitHub Website:

1. Go to https://github.com/new
2. **Repository name**: `foreclosure-scout`
3. **Description**: "DC/MD/VA Foreclosure Intelligence Platform - PWA for tracking foreclosure listings"
4. **Visibility**: Choose Public or Private
5. **Important**: DO NOT check any of these boxes:
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license
   
   (We already have these files)

6. Click **"Create repository"**

### Using GitHub CLI (Alternative):

```bash
gh repo create foreclosure-scout \
  --public \
  --description "DC/MD/VA Foreclosure Intelligence Platform - PWA for tracking foreclosure listings"
```

## Step 2: Initialize Git Repository Locally

Navigate to your foreclosure-scout directory and run:

```bash
cd /path/to/foreclosure-scout

# Initialize git
git init

# Add all files
git add .

# Check what will be committed
git status

# Create initial commit
git commit -m "Initial commit: Foreclosure Scout PWA

- Progressive Web App for DC/MD/VA foreclosure tracking
- Multi-source data aggregation (CourtListener, Census, FEMA)
- AI-powered insights with Google Gemini
- Offline-capable with service worker
- Mobile-optimized interface"
```

## Step 3: Connect to GitHub

Replace `YOUR_USERNAME` with your actual GitHub username:

```bash
# Add remote repository
git remote add origin https://github.com/YOUR_USERNAME/foreclosure-scout.git

# Verify the remote was added
git remote -v
```

Expected output:
```
origin  https://github.com/YOUR_USERNAME/foreclosure-scout.git (fetch)
origin  https://github.com/YOUR_USERNAME/foreclosure-scout.git (push)
```

## Step 4: Push to GitHub

```bash
# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

You should see output confirming the upload:
```
Enumerating objects: X, done.
Counting objects: 100% (X/X), done.
...
To https://github.com/YOUR_USERNAME/foreclosure-scout.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

## Step 5: Verify on GitHub

Visit: `https://github.com/YOUR_USERNAME/foreclosure-scout`

You should see:
- ✅ README.md displayed as homepage
- ✅ foreclosure-scout.html
- ✅ manifest.json
- ✅ fc-sw.js
- ✅ LICENSE file
- ✅ .gitignore

## Step 6: Set Up GitHub Pages (Optional - For Free Hosting)

To host your app for free on GitHub Pages:

1. Go to your repository on GitHub
2. Click **Settings** → **Pages** (in the left sidebar)
3. Under "Source", select **main** branch
4. Click **Save**
5. Wait a few minutes for deployment

Your app will be available at:
```
https://YOUR_USERNAME.github.io/foreclosure-scout/foreclosure-scout.html
```

### Custom Domain (Optional)

If you have a domain:
1. Add your domain in GitHub Pages settings
2. Create a `CNAME` file with your domain
3. Configure DNS records with your domain provider

## Step 7: Configure Repository

### Add Topics

Click "Add topics" and add:
- `foreclosure`
- `real-estate`
- `pwa`
- `progressive-web-app`
- `javascript`
- `dc`
- `maryland`
- `virginia`
- `property-investment`
- `ai`
- `gemini`

### Update Description

Edit the description at the top of your repo to include:
- Website URL (once deployed)
- Key features

### Enable Features

In Settings, enable:
- ✅ Issues
- ✅ Discussions (optional)
- ⬜ Wiki (probably not needed)

## Step 8: Create App Icons

Your manifest.json references icons that don't exist yet. Create them:

```bash
# Create icons directory
mkdir icons

# Add your icon files (you'll need to create these)
# - icons/fc-icon-192.png (192x192 pixels)
# - icons/fc-icon-512.png (512x512 pixels)
```

Design tips:
- Use your Foreclosure Scout branding
- Simple, recognizable icon
- High contrast for visibility
- Export as PNG with transparency

Once created, commit and push:

```bash
git add icons/
git commit -m "Add PWA icons"
git push
```

## Step 9: Protect Sensitive Data

**IMPORTANT**: Never commit API keys!

If you need to add API configuration:

```bash
# Create a config template (safe to commit)
cat > config.example.js << 'EOF'
// Copy this file to config.js and add your API keys
const CONFIG = {
  GEMINI_API_KEY: 'your-gemini-api-key-here',
  GOOGLE_MAPS_API_KEY: 'your-google-maps-api-key-here'
};
EOF

# Commit the example
git add config.example.js
git commit -m "Add configuration template"
git push

# Make sure config.js is in .gitignore (already done)
```

## Common Git Commands for Future Updates

```bash
# Check status
git status

# Add specific file
git add filename.html

# Add all changes
git add .

# Commit changes
git commit -m "Description of changes"

# Push to GitHub
git push

# Pull latest changes
git pull

# Create a new branch for features
git checkout -b feature-name

# Switch back to main
git checkout main

# Merge a branch
git merge feature-name
```

## Troubleshooting

### "Permission denied" when pushing

Use HTTPS with personal access token instead of password:
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token with `repo` scope
3. Use token as password when pushing

Or set up SSH keys:
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your.email@example.com"

# Add to GitHub: Settings → SSH and GPG keys → New SSH key
# Then use SSH URL instead:
git remote set-url origin git@github.com:YOUR_USERNAME/foreclosure-scout.git
```

### Files not uploading

Make sure they're not in .gitignore:
```bash
git check-ignore filename.html
```

### Large file warning

GitHub has a 100MB file limit. If you have large files:
- Add to .gitignore
- Use Git LFS for large assets
- Host large files elsewhere

## Next Steps

1. ✅ Repository created and pushed
2. ⬜ Deploy to GitHub Pages (or Netlify/Vercel)
3. ⬜ Create app icons
4. ⬜ Add demo screenshots to README
5. ⬜ Set up project board for features
6. ⬜ Create contribution guidelines
7. ⬜ Share with community!

## Verification Checklist

- [ ] Repository created on GitHub
- [ ] All files pushed successfully
- [ ] README displays correctly on GitHub
- [ ] License file present
- [ ] .gitignore working
- [ ] GitHub Pages deployed (if using)
- [ ] App accessible via URL
- [ ] PWA installs correctly
- [ ] No API keys or secrets committed

---

**Your Foreclosure Scout repository is now live on GitHub!** 🎉

Repository URL: `https://github.com/YOUR_USERNAME/foreclosure-scout`
