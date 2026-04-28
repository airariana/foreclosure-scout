/**
 * Nestscoop — Desktop Dashboard
 *
 * Stage 1: Topbar + sidebar + empty main shell (Mercantile precision).
 *
 * On desktop (≥769px) this REPLACES the existing mobile-first layout with a
 * BP-style dashboard. On mobile it's a no-op — the existing PWA layout
 * continues to work unchanged.
 *
 * Subsequent stages will fill the main area with KPI grid / priority queue /
 * signals feed / AI coach / nav views.
 */
(function () {
  'use strict';

  const DESKTOP_BREAKPOINT = 769;

  function isDesktop() {
    return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
  }

  // ─── Load web fonts once ────────────────────────────────────────────────
  function loadFonts() {
    if (document.getElementById('fc-dash-fonts')) return;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre1);
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous';
    document.head.appendChild(pre2);
    const fonts = document.createElement('link');
    fonts.id = 'fc-dash-fonts';
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,500&display=swap';
    document.head.appendChild(fonts);
  }

  // ─── Inject dashboard CSS (desktop-only, gated via @media) ──────────────
  function injectCSS() {
    if (document.getElementById('fc-dash-css')) return;
    const s = document.createElement('style');
    s.id = 'fc-dash-css';
    s.textContent = CSS_CONTENT;
    document.head.appendChild(s);
  }

  // ─── Auth (client-side passphrase gate) ─────────────────────────────────
  // SECURITY NOTE: This is "keep casual visitors out" not real security.
  // Anyone who opens DevTools can bypass it. Use Cloudflare Access or a
  // proper backend-enforced auth when the data actually needs protecting.
  //
  // Two roles:
  //   admin  → full access (watchlist, Zillow Queue, Data Keys, edit flows)
  //   viewer → read-only (dashboard, listings, map, 203(k) browse)
  //
  // Passwords are stored as SHA-256 hashes below, not plaintext. To change,
  // run this one-liner in the browser console with your new password:
  //   (async p => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p)))].map(b=>b.toString(16).padStart(2,'0')).join(''))('YOUR_PASSWORD')
  // then paste the output into the corresponding hash below and commit.
  const AUTH_LS_KEY = 'fc_auth_role';
  const PASS_HASHES = {
    admin:  '7b666d3d9835ac7fbdffb7fd30be401b4d79cdb34a8c36939f693f1f291122c1',
    viewer: '', // disabled — single-passphrase setup
  };

  async function hashPassphrase(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Role persists in localStorage so users stay signed in across reloads
  // and tab close/reopen. Sign-out (role chip click) clears it to force
  // re-auth. Can flip back to per-load re-auth by moving this to an
  // in-memory variable.
  function getRole()   { return localStorage.getItem(AUTH_LS_KEY); }
  function setRole(r)  { try { localStorage.setItem(AUTH_LS_KEY, r); } catch (e) {} }
  function clearRole() { try { localStorage.removeItem(AUTH_LS_KEY); } catch (e) {} }
  function isAdmin()   { return getRole() === 'admin'; }
  function isViewer()  { return getRole() === 'viewer'; }
  function isAuthed()  { return getRole() === 'admin' || getRole() === 'viewer'; }
  window.fcSignOut = () => { clearRole(); location.reload(); };

  // Apply role to <body> so CSS can hide/show elements. Also hide the
  // mobile-frame entirely until authed so nothing leaks through the gate.
  function applyRoleToDom() {
    document.body.classList.toggle('fc-role-admin',  isAdmin());
    document.body.classList.toggle('fc-role-viewer', isViewer());
  }

  // Show a full-screen login overlay. Blocks the rest of init() until the
  // user's passphrase matches one of the two known hashes.
  function showAuthGate() {
    return new Promise((resolve) => {
      // Hide any legacy mobile-frame content peeking through.
      const mobileFrame = document.querySelector('.mobile-frame');
      if (mobileFrame) mobileFrame.style.visibility = 'hidden';

      const overlay = document.createElement('div');
      overlay.id = 'fc-auth-overlay';
      overlay.innerHTML = `
        <div class="fc-auth-card">
          <div class="fc-auth-brand">
            <img src="fc-icon.svg?v=3" width="40" height="40" alt="Nestscoop"/>
            <div class="fc-auth-title">Nestscoop</div>
          </div>
          <div class="fc-auth-sub">DC · MD · VA Foreclosure Intelligence</div>
          <form class="fc-auth-form" id="fc-auth-form" autocomplete="off">
            <label class="fc-auth-label" for="fc-auth-input">Access passphrase</label>
            <input id="fc-auth-input" type="password" autocomplete="off"
                   spellcheck="false" autocapitalize="off" autocorrect="off"
                   placeholder="Enter your passphrase"
                   class="fc-auth-input" required>
            <div id="fc-auth-error" class="fc-auth-error"></div>
            <button type="submit" class="fc-auth-submit">Unlock</button>
            <div class="fc-auth-foot">
              Two access levels: admin (full) and viewer (read-only).
              Ask the owner for your passphrase.
            </div>
          </form>
        </div>`;
      document.body.appendChild(overlay);

      const form   = overlay.querySelector('#fc-auth-form');
      const input  = overlay.querySelector('#fc-auth-input');
      const errEl  = overlay.querySelector('#fc-auth-error');
      input.focus();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.textContent = '';
        const candidate = (input.value || '').trim();
        if (!candidate) return;
        const hash = await hashPassphrase(candidate);
        let matchedRole = null;
        for (const [role, h] of Object.entries(PASS_HASHES)) {
          if (h && hash === h) { matchedRole = role; break; }
        }
        if (!matchedRole) {
          errEl.textContent = 'Passphrase not recognized.';
          input.value = '';
          input.focus();
          return;
        }
        setRole(matchedRole);
        overlay.remove();
        if (mobileFrame) mobileFrame.style.visibility = '';
        resolve(matchedRole);
      });
    });
  }

  // ─── Build the desktop layout (called only when isDesktop()) ────────────
  function buildShell() {
    if (document.getElementById('fc-dash-root')) return;

    const mobileFrame = document.querySelector('.mobile-frame');
    if (mobileFrame) {
      mobileFrame.style.display = 'none';
      // The mobile-frame ships with a bunch of chrome (FC wordmark, ALL/HUD/REO
      // tabs, API status bar, Search/Filters/Clear buttons, metric strip) that
      // duplicates what our new dashboard has. Hide all of that so the Map
      // view is JUST the Google Map, maximally visible.
      const chromeHide = document.createElement('style');
      chromeHide.id = 'fc-mobile-chrome-hide';
      chromeHide.textContent = `
        @media (min-width: 769px) {
          /* Everything inside the mobile-frame's .app except #map should be
             hidden — they duplicate the dashboard's own chrome. Listed
             individually (not catch-all) to avoid hiding map overlays. */
          .mobile-frame .ptr-progress,
          .mobile-frame .ptr-indicator,
          .mobile-frame header,
          .mobile-frame .api-bar,
          .mobile-frame .filter-bar,
          .mobile-frame .stats-banner,
          .mobile-frame .filter-sidebar,
          .mobile-frame .mobile-bottom-bar,
          .mobile-frame [class*="mobile-bottom"],
          .mobile-frame .floating-calendar-btn {
            display: none !important;
          }
          .mobile-frame #map {
            height: calc(100vh - 48px) !important;
            min-height: calc(100vh - 48px) !important;
            max-height: none !important;
          }
          .mobile-frame .app,
          .mobile-frame .app::before {
            padding: 0 !important;
            background-image: none !important;
          }
        }
      `;
      document.head.appendChild(chromeHide);
    }

    const root = document.createElement('div');
    root.id = 'fc-dash-root';
    root.className = 'fc-dash';
    root.innerHTML = SHELL_HTML;
    document.body.appendChild(root);

    // Move the existing mobile-frame INSIDE fc-main → #fc-view-map. This
    // sidesteps all stacking-context issues since the frame is now a child
    // of the main pane; the sidebar and topbar stay visible naturally. The
    // Google Maps component inside the frame keeps its initialization intact.
    if (mobileFrame) {
      const mapView = root.querySelector('#fc-view-map');
      if (mapView) {
        mapView.appendChild(mobileFrame);
        // Strip the mobile-frame's phone-bezel chrome since it's now an
        // embedded pane, not a standalone device mockup.
        mobileFrame.style.cssText = [
          'display: none',           // shown only when map view is active
          'position: relative',
          'width: 100%',
          'max-width: none',
          'min-width: 0',
          'height: calc(100vh - 48px)',
          'margin: 0',
          'padding: 0',
          'border-radius: 0',
          'box-shadow: none',
          'background: #FAF8F3',
          'overflow: hidden',
        ].join('; ') + ';';
      }
    }

    wireNav(root);
    wireDataKeysButton(root);
    wireTopbarSearch(root);
    wireTopbarWatchlist(root);
    wireSidebarDrawer(root);
    wireRoleChip(root);

    // Publish the actual topbar height to a CSS var so fc-body + sidebar
    // reserve exactly the right amount of space (no dead gap). Run
    // multiple times since fonts + layout can settle asynchronously.
    measureTopbar();
    requestAnimationFrame(measureTopbar);
    setTimeout(measureTopbar, 120);
    setTimeout(measureTopbar, 400);
  }

  // Role chip: shows current role, click to sign out (clears role +
  // reloads so the gate reappears). Hidden entirely when auth is disabled.
  function wireRoleChip(root) {
    const btn = root.querySelector('#fc-tb-role');
    if (!btn) return;
    if (!AUTH_ENABLED) { btn.style.display = 'none'; return; }
    const role = getRole() || 'guest';
    const label = role === 'admin' ? '● Admin' : role === 'viewer' ? '○ Viewer' : '? Guest';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (confirm('Sign out of Nestscoop?')) window.fcSignOut();
    });
  }

  // ─── Topbar search ──────────────────────────────────────────────────────
  // Filter by address, city, county, zip, or case number across all loaded
  // properties. Click a result → opens that property's drawer.
  let __searchSelectedIndex = 0;

  function wireTopbarSearch(root) {
    const wrap    = root.querySelector('#fc-tb-search-wrap');
    const input   = root.querySelector('#fc-tb-search-input');
    const results = root.querySelector('#fc-tb-search-results');
    if (!input || !results) return;

    // Apply a "search" filter to the Listings view and navigate there.
    // Uses the same __listingsFilter plumbing as the Live Signal drill-downs
    // so the chip + ✕ clear come along for free.
    const applySearchFilter = (query, matchIds) => {
      const ids = new Set(matchIds);
      __listingsFilter = {
        label: `Search: "${query}" (${matchIds.length})`,
        predicate: (p) => ids.has(p.id),
        sortBy: 'score',
      };
      input.value = '';
      render([], '');
      location.hash = 'listings';
      if (window.__fcData) renderListings(window.__fcData);
    };

    const render = (matches, query) => {
      if (!query) {
        results.style.display = 'none';
        results.innerHTML = '';
        return;
      }
      if (!matches.length) {
        results.innerHTML = `<div class="fc-tb-search-result-empty">No matches for "${escapeHtml(query)}"</div>`;
        results.style.display = 'block';
        return;
      }
      const q = query.toLowerCase();
      const hl = (s) => {
        if (!s) return '';
        const safe = escapeHtml(String(s));
        // Case-insensitive highlight
        const idx = safe.toLowerCase().indexOf(q);
        if (idx < 0) return safe;
        return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + q.length) + '</mark>' + safe.slice(idx + q.length);
      };
      // Sticky "View all N in Listings" row at the top — filters the
      // Listings view to all matches instead of opening one drawer.
      // When search matches all 527 entries (e.g. query is too generic),
      // still useful as a way to view + sort/filter further.
      const filterAllRow = `
        <div class="fc-tb-search-filter-all" id="fc-tb-search-filter-all"
             title="Filter Listings to all ${matches.length} matches">
          <span class="fc-tb-search-filter-ico">⌕</span>
          <span>View all ${matches.length} matches in Listings</span>
          <kbd>↵</kbd>
        </div>`;
      results.innerHTML = filterAllRow + matches.slice(0, 10).map((p, i) => `
        <div class="fc-tb-search-result ${i === __searchSelectedIndex ? 'selected' : ''}" data-prop-id="${escapeAttr(p.id || '')}">
          <div class="fc-tb-search-result-addr">${hl(p.address || '—')}</div>
          <div class="fc-tb-search-result-meta">
            ${hl(p.city || '')}, ${hl(p.state || 'VA')} ${hl(p.zip || '')} ·
            ${hl(p.county || '')} ·
            ${escapeHtml(p.source || '')}
            ${p.firm_file_number ? ' · #' + hl(p.firm_file_number) : ''}
          </div>
        </div>
      `).join('');
      results.style.display = 'block';

      // Wire the "view all" action
      const filterAllEl = results.querySelector('#fc-tb-search-filter-all');
      if (filterAllEl) {
        filterAllEl.onclick = () => applySearchFilter(query, matches.map(p => p.id));
      }

      // Wire result clicks
      results.querySelectorAll('.fc-tb-search-result').forEach(el => {
        el.onclick = () => {
          const id = el.getAttribute('data-prop-id');
          if (id) openPropertyDrawer(id);
          input.value = '';
          render([], '');
        };
      });
    };

    // Stash the latest search state so the Enter handler can reach it.
    let __lastMatches = [];
    let __lastQuery = '';

    const runSearch = (q) => {
      const d = window.__fcData;
      if (!d || !q) return [];
      const needle = q.toLowerCase();
      const haystack = (d.foreclosures || []);
      const matches = [];
      for (const p of haystack) {
        const fields = [
          p.address, p.city, p.county, p.zip, p.state,
          p.firm_file_number, p.source, p.id,
        ].map(v => (v || '').toString().toLowerCase());
        if (fields.some(f => f.includes(needle))) matches.push(p);
        if (matches.length >= 50) break; // cap work
      }
      return matches;
    };

    let debounceTimer = null;
    input.addEventListener('input', (e) => {
      const q = (e.target.value || '').trim();
      __searchSelectedIndex = -1; // start with no item selected → Enter = filter-all
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        __lastQuery = q;
        __lastMatches = runSearch(q);
        render(__lastMatches, q);
      }, 80);
    });

    // Keyboard: arrows navigate individual items, Enter applies the
    // "view all" filter when nothing specific is selected, or opens the
    // highlighted property's drawer when one is. Escape clears.
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.fc-tb-search-result');
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        __searchSelectedIndex = Math.min(__searchSelectedIndex + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('selected', i === __searchSelectedIndex));
        items[__searchSelectedIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault();
        if (__searchSelectedIndex <= 0) {
          __searchSelectedIndex = -1; // bounce back to "view all" row
          items.forEach((el) => el.classList.remove('selected'));
        } else {
          __searchSelectedIndex -= 1;
          items.forEach((el, i) => el.classList.toggle('selected', i === __searchSelectedIndex));
          items[__searchSelectedIndex].scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (__searchSelectedIndex >= 0 && items[__searchSelectedIndex]) {
          const id = items[__searchSelectedIndex].getAttribute('data-prop-id');
          if (id) openPropertyDrawer(id);
          input.value = '';
          render([], '');
        } else if (__lastMatches.length) {
          // No individual item selected → filter Listings to all matches.
          applySearchFilter(__lastQuery, __lastMatches.map(p => p.id));
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        render([], '');
        input.blur();
      }
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        results.style.display = 'none';
      }
    });

    // Re-open results when re-focusing an input with existing text
    input.addEventListener('focus', () => {
      const q = (input.value || '').trim();
      if (q) render(runSearch(q), q);
    });

    // Global keyboard shortcut: Cmd+K / Ctrl+K focuses the search.
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  // ─── Data Keys modal ────────────────────────────────────────────────────
  // Single source of truth for all API keys. Each field reads/writes the
  // same localStorage entries the legacy modals use, so keys stay in sync
  // whether set from here or from the mobile-frame's legacy UI.
  function wireDataKeysButton(root) {
    const btn = root.querySelector('#fc-tb-keys');
    if (btn) btn.addEventListener('click', openDataKeysModal);
  }

  // ─── Topbar Watchlist button ────────────────────────────────────────────
  // Click: navigate to Listings filtered to watchlisted properties only.
  // Badge auto-refreshes when items are added/removed via updateTopbarWatchlistBadge().
  function wireTopbarWatchlist(root) {
    const btn = root.querySelector('#fc-tb-watchlist');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const list = getWatchlist();
      if (list.length === 0) {
        // Nothing to show — nudge user toward the Zillow Queue where the
        // primary add-flow lives.
        alert('No properties in your watchlist yet.\n\nTag interesting listings from the Zillow Queue or any property drawer.');
        return;
      }
      const ids = new Set(list.map(e => e.id));
      __listingsFilter = {
        label: `Watchlist (${list.length})`,
        predicate: (p) => ids.has(p.id),
        sortBy: 'score',
      };
      location.hash = 'listings';
      if (window.__fcData) renderListings(window.__fcData);
    });
    updateTopbarWatchlistBadge();
  }

  function updateTopbarWatchlistBadge() {
    const el = document.getElementById('fc-tb-watchlist-count');
    if (!el) return;
    const n = getWatchlist().length;
    el.textContent = n;
    el.style.display = n > 0 ? '' : 'none';
  }

  function openDataKeysModal() {
    if (document.getElementById('fc-keys-modal')) return;

    const fields = [
      {
        id:     'fc-k-gemini',
        label:  'Gemini API Key',
        ls:     'fs_gemini_key',
        hint:   'aistudio.google.com/apikey — powers AI analysis + offer letter',
      },
      {
        id:     'fc-k-court',
        label:  'CourtListener Token',
        ls:     'fs_key_court',
        hint:   'courtlistener.com → Profile → API Token',
      },
      {
        id:     'fc-k-hud',
        label:  'HUD USER Token',
        ls:     'fs_key_hud',
        hint:   'huduser.gov/portal/dataset/fmr-api.html',
      },
      {
        id:     'fc-k-estated',
        label:  'Estated API Key',
        ls:     'fs_key_estated',
        hint:   'estated.com (property enrichment, optional)',
      },
    ];

    const overlay = document.createElement('div');
    overlay.id = 'fc-keys-modal';
    overlay.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 10000',
      'background: rgba(14, 23, 40, 0.45)',
      'display: flex', 'align-items: center', 'justify-content: center',
      'padding: 40px',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background: var(--white)', 'border-radius: 6px',
      'box-shadow: 0 20px 60px rgba(14, 23, 40, 0.25)',
      'width: min(520px, 100%)', 'max-height: 85vh', 'overflow: auto',
      'padding: 24px', 'font-family: var(--f-ui)',
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div class="fc-eyebrow" style="margin-bottom:4px">Settings</div>
          <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;color:var(--ink)">Data keys</div>
        </div>
        <button class="fc-btn fc-btn-sm" id="fc-keys-close" aria-label="Close">×</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.5">
        Keys are stored locally in your browser only. They never leave your device.
      </div>
      ${fields.map(f => `
        <div style="margin-bottom:16px">
          <label for="${f.id}" style="display:block;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:4px">${f.label}</label>
          <input id="${f.id}" type="password" autocomplete="off" spellcheck="false"
            style="width:100%;padding:8px 10px;border:1px solid var(--hair);border-radius:3px;font-family:var(--f-mono);font-size:12px;color:var(--ink);background:var(--paper-2);box-sizing:border-box">
          <div style="font-size:10px;color:var(--muted);margin-top:4px;font-family:var(--f-mono)">${f.hint}</div>
        </div>
      `).join('')}

      <!-- Keys backup section — export ALL keys at once, for moving to
           a new device or onboarding a trusted teammate. Treat the file
           like a password (sensitive tokens). -->
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--hair)">
        <div class="fc-eyebrow" style="margin-bottom:6px">Keys backup (all four)</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">
          Export your API keys as a single JSON file so you can load them on a new device without
          retyping. <strong style="color:var(--coral)">Contains sensitive tokens — treat like a password.</strong>
          Don't email, don't commit to git.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="fc-btn" id="fc-keys-export" type="button">⬇︎ Export keys JSON</button>
          <label class="fc-btn" style="cursor:pointer;position:relative">
            <span>⬆︎ Import keys JSON…</span>
            <input type="file" id="fc-keys-import" accept="application/json,.json"
              style="position:absolute;inset:0;opacity:0;cursor:pointer">
          </label>
          <span id="fc-keys-backup-status" style="font-family:var(--f-mono);font-size:11px;color:var(--sage);margin-left:auto"></span>
        </div>
      </div>

      <!-- Zillow backup section -->
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--hair)">
        <div class="fc-eyebrow" style="margin-bottom:6px">Zillow data backup</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">
          Export your saved Zestimate + rent values as a JSON file. Useful before switching domains, clearing browser data, or moving to a new device.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="fc-btn" id="fc-zillow-export" type="button">⬇︎ Export JSON</button>
          <label class="fc-btn" style="cursor:pointer;position:relative">
            <span>⬆︎ Import JSON…</span>
            <input type="file" id="fc-zillow-import" accept="application/json,.json"
              style="position:absolute;inset:0;opacity:0;cursor:pointer">
          </label>
          <span id="fc-zillow-backup-status" style="font-family:var(--f-mono);font-size:11px;color:var(--sage);margin-left:auto"></span>
        </div>
        <div style="font-size:10px;color:var(--muted2);margin-top:8px;font-family:var(--f-mono)">
          Current domain: <strong id="fc-zillow-origin">${window.location.origin}</strong>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:24px">
        <button class="fc-btn" id="fc-keys-cancel">Cancel</button>
        <button class="fc-btn fc-btn-dark" id="fc-keys-save">Save</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Load existing values
    for (const f of fields) {
      const el = document.getElementById(f.id);
      if (el) el.value = localStorage.getItem(f.ls) || '';
    }

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('fc-keys-close').onclick = close;
    document.getElementById('fc-keys-cancel').onclick = close;

    // Wire Zillow export/import
    const statusEl = document.getElementById('fc-zillow-backup-status');
    const flash = (msg, color) => {
      if (!statusEl) return;
      statusEl.style.color = color || 'var(--sage)';
      statusEl.textContent = msg;
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    };
    const exportBtn = document.getElementById('fc-zillow-export');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const count = exportZillowData();
        flash(count === 0 ? '⚠ No entries to export' : `✓ Exported ${count} entries`,
              count === 0 ? 'var(--coral)' : 'var(--sage)');
      };
    }
    const importInput = document.getElementById('fc-zillow-import');
    if (importInput) {
      importInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const { imported, skipped } = importZillowData(text);
          flash(`✓ Imported ${imported}${skipped ? ' (skipped ' + skipped + ' non-Zillow keys)' : ''}`, 'var(--sage)');
          // User just restored from a file, so treat this as a fresh
          // backup moment — clear the stale-export nudge.
          setLastExportAt(Date.now());
          updateExportReminderBadge();
          // Apply overrides + re-render so the newly-imported entries take effect.
          if (window.__fcData) {
            applyAllZillowOverrides(window.__fcData);
            renderKPIs(window.__fcData);
            renderPriorityQueue(window.__fcData);
            renderListings(window.__fcData);
          }
        } catch (err) {
          flash(`⚠ ${err.message}`, 'var(--coral)');
        } finally {
          importInput.value = ''; // allow re-selecting the same file
        }
      };
    }

    // Wire API keys export / import. Status uses a separate element from
    // the Zillow backup so both sections can flash independently.
    const keysStatusEl = document.getElementById('fc-keys-backup-status');
    const flashKeys = (msg, color) => {
      if (!keysStatusEl) return;
      keysStatusEl.style.color = color || 'var(--sage)';
      keysStatusEl.textContent = msg;
      setTimeout(() => { if (keysStatusEl) keysStatusEl.textContent = ''; }, 3500);
    };
    const keysExportBtn = document.getElementById('fc-keys-export');
    if (keysExportBtn) {
      keysExportBtn.onclick = () => {
        const count = exportDataKeys();
        flashKeys(count === 0 ? '⚠ No keys to export — set at least one first' : `✓ Exported ${count} key${count === 1 ? '' : 's'}`,
                  count === 0 ? 'var(--coral)' : 'var(--sage)');
      };
    }
    const keysImportInput = document.getElementById('fc-keys-import');
    if (keysImportInput) {
      keysImportInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const { imported, skipped } = importDataKeys(text);
          flashKeys(`✓ Imported ${imported} key${imported === 1 ? '' : 's'}${skipped ? ' (skipped ' + skipped + ')' : ''}`, 'var(--sage)');
          // Repopulate the input fields so user sees what loaded.
          for (const f of fields) {
            const el = document.getElementById(f.id);
            if (el) el.value = localStorage.getItem(f.ls) || '';
          }
          // Notify legacy page globals so status dots refresh.
          try {
            if (window.KEYS) {
              window.KEYS.court   = localStorage.getItem('fs_key_court')   || '';
              window.KEYS.hud     = localStorage.getItem('fs_key_hud')     || '';
              window.KEYS.estated = localStorage.getItem('fs_key_estated') || '';
            }
            if (typeof window.refreshGeminiStatus === 'function') window.refreshGeminiStatus();
          } catch (err) { /* best-effort */ }
        } catch (err) {
          flashKeys(`⚠ ${err.message}`, 'var(--coral)');
        } finally {
          keysImportInput.value = '';
        }
      };
    }

    document.getElementById('fc-keys-save').onclick = () => {
      for (const f of fields) {
        const el = document.getElementById(f.id);
        const v = (el && el.value || '').trim();
        if (v) localStorage.setItem(f.ls, v);
        else localStorage.removeItem(f.ls);
      }
      // Nudge the legacy KEYS/status objects in foreclosure-scout.html so
      // indicators update without a page reload. Falls through silently if
      // any of those globals aren't defined yet.
      try {
        if (window.KEYS) {
          window.KEYS.court   = localStorage.getItem('fs_key_court')   || '';
          window.KEYS.hud     = localStorage.getItem('fs_key_hud')     || '';
          window.KEYS.estated = localStorage.getItem('fs_key_estated') || '';
        }
        if (typeof window.setDot === 'function') {
          window.setDot('court', window.KEYS && window.KEYS.court ? 'live' : 'error', window.KEYS && window.KEYS.court ? 'COURTLISTENER' : 'COURTLISTENER — NO KEY');
          window.setDot('hud',   window.KEYS && window.KEYS.hud   ? 'live' : 'error', window.KEYS && window.KEYS.hud   ? 'HUD USER FMR' : 'HUD USER — NO KEY');
        }
      } catch (e) { /* best-effort */ }
      close();
      // Auto-trigger CourtListener load if a token was just added.
      if (localStorage.getItem('fs_key_court') && typeof window.loadCourtProperties === 'function') {
        window.loadCourtProperties().catch(() => {});
      }
    };

    // Focus first empty field
    for (const f of fields) {
      const el = document.getElementById(f.id);
      if (el && !el.value) { el.focus(); break; }
    }
  }

  // ─── Zillow manual-lookup overrides ─────────────────────────────────────
  // Users open Zillow, copy the Zestimate + Rent Zestimate for a property,
  // and paste them into the drawer. localStorage is the client-side cache
  // for instant reads; the source of truth is the Cloudflare Worker D1
  // table `nestscoop_zillow`, which lets desktop + iPhone share one queue.
  const ZILLOW_LS_PREFIX = 'fs_zillow_';
  // Standalone Nestscoop worker — deliberately NOT on sales-hq-api so a
  // Nestscoop bug can't affect BeyondPayroll / AJAX Dev.
  const ZILLOW_SYNC_BASE = 'https://nestscoop-api.ajbb705.workers.dev/api/zillow';
  const ZILLOW_TOKEN_LS_KEY = 'fs_zillow_sync_token';

  function getZillowSyncToken() {
    try { return localStorage.getItem(ZILLOW_TOKEN_LS_KEY) || ''; }
    catch (e) { return ''; }
  }

  function setZillowSyncToken(token) {
    try {
      if (token) localStorage.setItem(ZILLOW_TOKEN_LS_KEY, token);
      else localStorage.removeItem(ZILLOW_TOKEN_LS_KEY);
    } catch (e) {}
  }
  window.fcSetZillowSyncToken = setZillowSyncToken;

  function getZillowValues(propId) {
    if (!propId) return null;
    try {
      const raw = localStorage.getItem(ZILLOW_LS_PREFIX + propId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setZillowValues(propId, values, property) {
    if (!propId) return;
    if (values && (values.zestimate || values.rent || values.notes)) {
      // Include property metadata so the entry can be recovered if the
      // property ID changes (e.g., sale_date postponed → new hash → new ID).
      const meta = property ? {
        _address: property.address || '',
        _city:    property.city    || '',
        _state:   property.state   || '',
        _zip:     property.zip     || property.zip_code || '',
      } : {};
      const entry = {
        zestimate: values.zestimate ? Number(values.zestimate) : null,
        rent:      values.rent      ? Number(values.rent)      : null,
        notes:     values.notes || '',
        updatedAt: new Date().toISOString(),
        ...meta,
      };
      localStorage.setItem(ZILLOW_LS_PREFIX + propId, JSON.stringify(entry));
      // Fire-and-forget push to the worker so other devices see it.
      // Swallow failures silently — localStorage still has the value.
      const token = getZillowSyncToken();
      if (token) {
        fetch(`${ZILLOW_SYNC_BASE}/${encodeURIComponent(propId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Nestscoop-Token': token },
          body: JSON.stringify(entry),
        }).catch(() => {});
      }
    } else {
      localStorage.removeItem(ZILLOW_LS_PREFIX + propId);
      const token = getZillowSyncToken();
      if (token) {
        fetch(`${ZILLOW_SYNC_BASE}/${encodeURIComponent(propId)}`, {
          method: 'DELETE',
          headers: { 'X-Nestscoop-Token': token },
        }).catch(() => {});
      }
    }
  }

  // ─── Assessor intelligence (server-side fetch, D1-cached) ────────────────
  // Calls the nestscoop-api /api/assessor/<jurisdiction> endpoint which
  // does the county-portal scrape worker-side and caches 30d in D1.
  const ASSESSOR_BASE = 'https://nestscoop-api.ajbb705.workers.dev/api/assessor';

  // Dispatch per jurisdiction. Arlington is the only one wired up today;
  // returns null for everything else so the section self-hides.
  function assessorJurisdiction(p) {
    const state = (p.state || '').toUpperCase();
    const county = (p.county || '').trim();
    if (state === 'VA' && county === 'Arlington County') return 'arlington';
    // Fairfax County + Fairfax City both fall under Fairfax County's
    // assessment jurisdiction in our scraping coverage. The backend uses
    // zip + sqft for comp scoping since the source dataset doesn't always
    // contain the subject foreclosure property.
    if (state === 'VA' && (county === 'Fairfax County' || county === 'Fairfax City')) return 'fairfax';
    // Loudoun's open ArcGIS gives parcel + year-built + structure use only —
    // assessed value / sales / owner / beds / baths require auth-walled lisweb.
    // The handler returns a partial dataset and a deep-link to lisweb.
    if (state === 'VA' && county === 'Loudoun County') return 'loudoun';
    // Prince William's CAMA Public layer exposes owner, structured address,
    // sqft above grade, acreage, last deed refs. No sale prices, year built,
    // or beds/baths — those aren't in PW open data.
    if (state === 'VA' && county === 'Prince William County') return 'pwc';
    // Winchester City publishes a fat parcels feed with full CAMA data —
    // owner, beds, baths, year built, assessed value, last sale price + date,
    // deed refs, zoning, acreage. Richer than most counties.
    if (state === 'VA' && county === 'Winchester City') return 'winchester';
    return null;
  }

  async function fetchAssessorIntel(p) {
    const jur = assessorJurisdiction(p);
    if (!jur) return { ok: false, reason: 'no-parser' };
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };
    try {
      const params = { prop_id: p.id, address: p.address || '' };
      // Fairfax wants zip + sqft for comp scoping when subject isn't
      // present in the public sales feed (most foreclosure properties).
      if (jur === 'fairfax') {
        if (p.zip || p.zip_code) params.zip = p.zip || p.zip_code;
        if (p.sqft) params.sqft = p.sqft;
      }
      const qs = new URLSearchParams(params);
      const res = await fetch(`${ASSESSOR_BASE}/${jur}?${qs}`, {
        headers: { 'X-Nestscoop-Token': token },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, reason: err.error || `http-${res.status}` };
      }
      const body = await res.json();
      return { ok: true, cached: body.cached, data: body.data };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  // Pull the server-side overrides on page load and merge into localStorage.
  // Last-write-wins on updatedAt. Called once at init; safe to call again.
  async function syncZillowFromServer() {
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };
    try {
      const res = await fetch(ZILLOW_SYNC_BASE, {
        headers: { 'X-Nestscoop-Token': token },
      });
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      const data = await res.json();
      const remote = data.overrides || {};
      let pulled = 0;
      for (const [propId, remoteEntry] of Object.entries(remote)) {
        const localRaw = localStorage.getItem(ZILLOW_LS_PREFIX + propId);
        if (!localRaw) {
          localStorage.setItem(ZILLOW_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
          continue;
        }
        try {
          const local = JSON.parse(localRaw);
          // Last-write-wins. If remote has a newer updatedAt, replace local.
          if ((remoteEntry.updatedAt || '') > (local.updatedAt || '')) {
            localStorage.setItem(ZILLOW_LS_PREFIX + propId, JSON.stringify(remoteEntry));
            pulled++;
          }
        } catch (e) {
          localStorage.setItem(ZILLOW_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
        }
      }
      return { ok: true, pulled, total: Object.keys(remote).length };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
  window.fcSyncZillowFromServer = syncZillowFromServer;

  // One-shot: upload every fs_zillow_* in localStorage to the server.
  // Use after first-time activation on a device that already has entries
  // (e.g. the desktop that accumulated 55 validations pre-sync). Serial
  // to stay well inside Worker concurrent-connection limits.
  async function uploadAllZillowToServer() {
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };
    const keys = Object.keys(localStorage).filter(k => k.startsWith(ZILLOW_LS_PREFIX) && k !== ZILLOW_TOKEN_LS_KEY);
    let pushed = 0, failed = 0;
    for (const k of keys) {
      const propId = k.slice(ZILLOW_LS_PREFIX.length);
      let entry;
      try { entry = JSON.parse(localStorage.getItem(k)); } catch (e) { failed++; continue; }
      if (!entry || (!entry.zestimate && !entry.rent && !entry.notes)) continue;
      try {
        const res = await fetch(`${ZILLOW_SYNC_BASE}/${encodeURIComponent(propId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Nestscoop-Token': token },
          body: JSON.stringify(entry),
        });
        if (res.ok) pushed++; else failed++;
      } catch (e) { failed++; }
    }
    return { ok: true, pushed, failed, total: keys.length };
  }
  window.fcUploadAllZillowToServer = uploadAllZillowToServer;

  // One-tap activation via URL param: if the page is opened with
  // ?sync=<token>, save the token, strip the param from the URL (so
  // it doesn't get shared/bookmarked/screenshotted), then kick sync.
  // This is how you activate a new device (e.g. iPhone) without ever
  // pasting into a text field.
  (function consumeActivationLink() {
    try {
      const params = new URLSearchParams(location.search);
      const t = params.get('sync');
      if (!t) return;
      setZillowSyncToken(t);
      params.delete('sync');
      const qs = params.toString();
      const clean = location.pathname + (qs ? '?' + qs : '') + location.hash;
      history.replaceState(null, '', clean);
      // Flash a quick confirmation — showToast is defined in the legacy
      // HTML and may not exist if the shell loads before it, so guard.
      setTimeout(() => {
        if (typeof window.showToast === 'function') {
          window.showToast('Sync activated on this device', 'green');
        }
      }, 400);
    } catch (e) { /* non-fatal */ }
  })();

  // Kick off an initial sync — don't block, UI uses localStorage immediately.
  syncZillowFromServer();

  // ─── AI roof check (Gemini Vision over Google Maps satellite) ────────────
  // Frontend fetches the satellite tile (cheap, browser already has the
  // Maps API key + referrer matches the key's restriction), converts to
  // base64, posts to /api/roof/analyze. Worker calls Gemini Vision with
  // a structured prompt and caches the result 90d in D1. Per-property cost
  // is one Static Maps call (~free at our volume) + one Gemini Vision call
  // (~$0.001 per drawer open, capped by the 90d cache).
  const ROOF_API = 'https://nestscoop-api.ajbb705.workers.dev/api/roof/analyze';

  function buildSatelliteUrl(lat, lng, zoom = 20, size = 600) {
    const key = window.GOOGLE_MAPS_API_KEY || '';
    if (!key || !lat || !lng) return null;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}x${size}&maptype=satellite&key=${key}`;
  }

  async function fetchRoofIntel(p) {
    const lat = p.lat || p.latitude;
    const lng = p.lng || p.longitude;
    if (!lat || !lng) return { ok: false, reason: 'no-coords' };
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };

    const satUrl = buildSatelliteUrl(lat, lng);
    if (!satUrl) return { ok: false, reason: 'no-maps-key' };

    try {
      // Fetch the satellite tile, convert to base64. Maps Static API
      // serves with permissive CORS, so direct fetch + arrayBuffer works.
      const tile = await fetch(satUrl);
      if (!tile.ok) return { ok: false, reason: `tile-${tile.status}` };
      const buf = await tile.arrayBuffer();
      // ArrayBuffer → base64 in chunks (large buffers blow the call stack
      // when passed via spread to String.fromCharCode).
      const bytes = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(bin);

      const res = await fetch(ROOF_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nestscoop-Token': token },
        body: JSON.stringify({ prop_id: p.id, image_base64: b64 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const reason = err.detail
          ? `${err.error || `http-${res.status}`} — ${err.detail}`
          : (err.error || `http-${res.status}`);
        return { ok: false, reason };
      }
      const body = await res.json();
      return { ok: true, cached: body.cached, data: body.data, satUrl };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  function roofIntelSection(p) {
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const lat = p.lat || p.latitude;
    const lng = p.lng || p.longitude;
    // Render the section header in either case so the user understands the
    // feature exists; surface a clear reason when coords are missing rather
    // than silently disappearing the section. The roof check needs a Static
    // Maps satellite tile, which requires lat/lng.
    if (!lat || !lng) {
      return section('Roof check (AI)', `
        <div style="font-family:var(--f-mono);font-size:12px;color:var(--muted);line-height:1.5">
          ⚠ No GPS coordinates for this property — roof analysis needs a satellite tile to inspect.
          <div style="margin-top:6px;font-size:11px">
            Geocoding will retry on the next weekly scrape.
            If this persists, check Workers logs and the Maps API key restrictions.
          </div>
        </div>
      `);
    }
    return section('Roof check (AI)', `
      <div id="fc-roof-${sid}" style="font-family:var(--f-mono);font-size:12px;color:var(--muted);min-height:40px">
        Analyzing roof from satellite imagery…
      </div>
    `);
  }

  function renderRoofIntel(container, p, res) {
    if (!res.ok) {
      container.innerHTML = `<span style="color:var(--muted)">Roof analysis unavailable: ${escapeHtml(res.reason || 'unknown')}</span>`;
      return;
    }
    const d = res.data || {};
    const condColor = {
      excellent: 'sage', good: 'sage', fair: 'gold', poor: 'coral', unknown: 'muted',
    }[d.condition] || 'muted';
    const confLabel = d.confidence === 'high' ? '' : ` · ${d.confidence} confidence`;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start">
        <div>
          ${res.satUrl ? `<img src="${escapeAttr(res.satUrl)}" alt="Satellite view" style="width:100%;border-radius:6px;border:1px solid var(--hair)">` : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:4px;text-align:center">
            Google Maps · zoom 20
          </div>
        </div>
        <div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
            <span class="fc-pill ${condColor}" style="font-size:11px;font-weight:600;text-transform:capitalize">
              ${escapeHtml(d.condition || 'unknown')}${confLabel}
            </span>
            ${(d.materials || []).map(m => `<span class="fc-pill" style="font-size:10px">${escapeHtml(m)}</span>`).join('')}
          </div>
          ${(d.flags || []).length ? `
            <div style="margin-bottom:10px">
              <div class="fc-eyebrow" style="margin-bottom:4px">Flags</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${d.flags.map(f => `<span class="fc-pill coral" style="font-size:10px">⚠ ${escapeHtml(f)}</span>`).join('')}
              </div>
            </div>` : ''}
          <div style="font-size:13px;color:var(--ink-2);line-height:1.5">${escapeHtml(d.summary || '')}</div>
          ${res.cached ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;font-family:var(--f-mono)">Cached (${res.ageHours || ''}h ago)</div>` : ''}
        </div>
      </div>
    `;
  }

  async function wireDrawerRoof(p) {
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const container = document.getElementById(`fc-roof-${sid}`);
    if (!container) return;
    if (!getZillowSyncToken()) {
      container.innerHTML = '<span style="color:var(--muted)">Paste sync token in Settings to enable AI roof analysis.</span>';
      return;
    }
    const res = await fetchRoofIntel(p);
    renderRoofIntel(container, p, res);
  }

  // ─── Liens (manual title-search findings) ───────────────────────────────
  // User clicks deep-links to county recorder / land-records portals from
  // the drawer, does the title check manually, and records what they find
  // here. Cached in localStorage for instant reads + synced to nestscoop-api
  // D1 so desktop + iPhone see the same intelligence.
  const LIEN_LS_PREFIX = 'fs_liens_';
  const LIEN_SYNC_BASE = 'https://nestscoop-api.ajbb705.workers.dev/api/liens';

  function getLiens(propId) {
    if (!propId) return null;
    try {
      const raw = localStorage.getItem(LIEN_LS_PREFIX + propId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLiens(propId, data) {
    if (!propId) return;
    const entry = { ...data, updated_at: new Date().toISOString() };
    localStorage.setItem(LIEN_LS_PREFIX + propId, JSON.stringify(entry));
    const token = getZillowSyncToken();
    if (token) {
      fetch(`${LIEN_SYNC_BASE}/${encodeURIComponent(propId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Nestscoop-Token': token },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
    return entry;
  }

  async function syncLiensFromServer() {
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };
    try {
      const res = await fetch(LIEN_SYNC_BASE, {
        headers: { 'X-Nestscoop-Token': token },
      });
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      const data = await res.json();
      const remote = data.liens || {};
      let pulled = 0;
      for (const [propId, remoteEntry] of Object.entries(remote)) {
        const localRaw = localStorage.getItem(LIEN_LS_PREFIX + propId);
        if (!localRaw) {
          localStorage.setItem(LIEN_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
          continue;
        }
        try {
          const local = JSON.parse(localRaw);
          if ((remoteEntry.updated_at || '') > (local.updated_at || '')) {
            localStorage.setItem(LIEN_LS_PREFIX + propId, JSON.stringify(remoteEntry));
            pulled++;
          }
        } catch (e) {
          localStorage.setItem(LIEN_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
        }
      }
      return { ok: true, pulled, total: Object.keys(remote).length };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
  window.fcSyncLiensFromServer = syncLiensFromServer;
  syncLiensFromServer();

  // ─── Auction intel (manual cross-check from auction.com) ─────────────────
  // Direct auction.com scraping is blocked by ToS, so this is the manual
  // bridge: user logs in, looks up the property, types the current bid +
  // auction time into the drawer. Saved per-device + synced via worker D1
  // so iPhone/desktop see the same numbers. Same shape as liens.
  const AUCTION_LS_PREFIX = 'fs_auction_';
  const AUCTION_SYNC_BASE = 'https://nestscoop-api.ajbb705.workers.dev/api/auction';

  function getAuction(propId) {
    if (!propId) return null;
    try {
      const raw = localStorage.getItem(AUCTION_LS_PREFIX + propId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveAuction(propId, data) {
    if (!propId) return;
    const entry = { ...data, updated_at: new Date().toISOString() };
    localStorage.setItem(AUCTION_LS_PREFIX + propId, JSON.stringify(entry));
    const token = getZillowSyncToken();
    if (token) {
      fetch(`${AUCTION_SYNC_BASE}/${encodeURIComponent(propId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Nestscoop-Token': token },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
    return entry;
  }

  function deleteAuction(propId) {
    if (!propId) return;
    localStorage.removeItem(AUCTION_LS_PREFIX + propId);
    const token = getZillowSyncToken();
    if (token) {
      fetch(`${AUCTION_SYNC_BASE}/${encodeURIComponent(propId)}`, {
        method: 'DELETE',
        headers: { 'X-Nestscoop-Token': token },
      }).catch(() => {});
    }
  }

  async function syncAuctionFromServer() {
    const token = getZillowSyncToken();
    if (!token) return { ok: false, reason: 'no-token' };
    try {
      const res = await fetch(AUCTION_SYNC_BASE, {
        headers: { 'X-Nestscoop-Token': token },
      });
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      const data = await res.json();
      const remote = data.auction || {};
      let pulled = 0;
      for (const [propId, remoteEntry] of Object.entries(remote)) {
        const localRaw = localStorage.getItem(AUCTION_LS_PREFIX + propId);
        if (!localRaw) {
          localStorage.setItem(AUCTION_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
          continue;
        }
        try {
          const local = JSON.parse(localRaw);
          if ((remoteEntry.updated_at || '') > (local.updated_at || '')) {
            localStorage.setItem(AUCTION_LS_PREFIX + propId, JSON.stringify(remoteEntry));
            pulled++;
          }
        } catch (e) {
          localStorage.setItem(AUCTION_LS_PREFIX + propId, JSON.stringify(remoteEntry));
          pulled++;
        }
      }
      return { ok: true, pulled, total: Object.keys(remote).length };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
  window.fcSyncAuctionFromServer = syncAuctionFromServer;
  syncAuctionFromServer();

  // Compute the cross-check metrics that drive the auto-comparison panel.
  // All inputs are optional — math gracefully degrades when fields are
  // missing (e.g. no assessor cache, no BWW original loan amount).
  function computeAuctionMetrics(p, bid, assessedValue, originalLoan) {
    if (!bid || bid <= 0) return null;
    const arv = Number(p.arv) || 0;
    const eav = Number(p.price) || 0;
    const rehab = Number(p.rehabEstimate) || 0;
    const monthlyRent = Number(p.monthlyRent) || 0;

    // Bid vs ARV: discount to retail. Industry rule: aim for >= 30% discount.
    const discountToARV = arv ? ((arv - bid) / arv) * 100 : null;

    // Bid vs heuristic EAV: positive = paying more than our model predicted.
    const eavDeltaPct = eav ? ((bid - eav) / eav) * 100 : null;

    // Bid vs assessed value (when assessor has it): >100% = paying premium
    // over govt valuation; <80% = significant discount.
    const assessedRatio = assessedValue ? (bid / assessedValue) * 100 : null;

    // Bid vs original loan (BWW only): ratio at this bid. >100% = bidder is
    // paying more than the loan balance, lender is whole. <80% = lender
    // already eating a haircut.
    const loanRatio = originalLoan ? (bid / originalLoan) * 100 : null;

    // 70% rule: MAO = ARV * 0.7 - rehab. Bid <= MAO is the classic flip
    // viability check. Delta tells how much margin/over-pay there is.
    const mao70 = arv ? (arv * 0.7 - rehab) : null;
    const mao70Pass = mao70 != null ? bid <= mao70 : null;
    const mao70Delta = mao70 != null ? mao70 - bid : null;

    // Cap rate at this bid using the existing rent estimate. 55%-NOI is a
    // conservative-but-realistic operating-expense ratio for SFR rentals.
    const grossCap = monthlyRent && bid ? ((monthlyRent * 12) / bid) * 100 : null;
    const noiCap55 = monthlyRent && bid ? ((monthlyRent * 12 * 0.55) / bid) * 100 : null;

    // Total all-in if you bought at this bid + rehab.
    const allIn = bid + rehab;
    const allInVsARV = arv ? (allIn / arv) * 100 : null;

    return {
      bid, arv, eav, rehab, monthlyRent, assessedValue, originalLoan,
      discountToARV, eavDeltaPct, assessedRatio, loanRatio,
      mao70, mao70Pass, mao70Delta,
      grossCap, noiCap55,
      allIn, allInVsARV,
    };
  }

  // ── Watchlist ──────────────────────────────────────────────────────────
  // Lightweight flag-based watchlist. Single localStorage key holds an array
  // of { id, address, city, state, zip, addedAt } entries. Persisted client-
  // side only (no backend) — same pattern as Zillow overrides.
  const WATCHLIST_LS_KEY = 'fs_watchlist';

  function getWatchlist() {
    try {
      const raw = localStorage.getItem(WATCHLIST_LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveWatchlist(arr) {
    try { localStorage.setItem(WATCHLIST_LS_KEY, JSON.stringify(arr || [])); }
    catch (e) { /* quota or disabled */ }
  }
  function isWatchlisted(propId) {
    if (!propId) return false;
    return getWatchlist().some(e => e.id === propId);
  }
  function addToWatchlist(p) {
    if (!p || !p.id) return false;
    const list = getWatchlist();
    if (list.some(e => e.id === p.id)) return false;
    list.push({
      id:      p.id,
      address: p.address || '',
      city:    p.city    || '',
      state:   p.state   || '',
      zip:     p.zip || p.zip_code || '',
      addedAt: new Date().toISOString(),
    });
    saveWatchlist(list);
    return true;
  }
  function removeFromWatchlist(propId) {
    if (!propId) return false;
    const list = getWatchlist().filter(e => e.id !== propId);
    saveWatchlist(list);
    return true;
  }
  function toggleWatchlist(p) {
    if (!p || !p.id) return false;
    if (isWatchlisted(p.id)) { removeFromWatchlist(p.id); return false; }
    addToWatchlist(p); return true;
  }
  // Expose for inline handlers + cross-module use (drawer, AI coach, etc.).
  window.fcToggleWatchlist = toggleWatchlist;
  window.fcIsWatchlisted   = isWatchlisted;
  window.fcGetWatchlist    = getWatchlist;

  // ── Zillow backup helpers ──────────────────────────────────────────────
  // Export all Zillow entries as a single JSON blob and trigger a download.
  // Safe to run anytime as a local backup. The exported file is plain JSON
  // so it can be hand-edited or committed to a private repo for safekeeping.
  const LAST_EXPORT_LS_KEY = 'fs_zillow_last_export';
  const EXPORT_REMINDER_DAYS = 7;

  function countZillowEntries() {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ZILLOW_LS_PREFIX)) n += 1;
    }
    return n;
  }
  function getLastExportAt() {
    const v = localStorage.getItem(LAST_EXPORT_LS_KEY);
    return v ? Number(v) : 0;
  }
  function setLastExportAt(ts) {
    try { localStorage.setItem(LAST_EXPORT_LS_KEY, String(ts || Date.now())); }
    catch (e) { /* ignore quota */ }
  }

  function exportZillowData() {
    const entries = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ZILLOW_LS_PREFIX)) {
        try { entries[k] = JSON.parse(localStorage.getItem(k)); }
        catch (e) { entries[k] = localStorage.getItem(k); }
      }
    }
    const payload = {
      app:        'Nestscoop',
      exportedAt: new Date().toISOString(),
      count:      Object.keys(entries).length,
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nestscoop-zillow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // Record successful export so the stale-backup badge can clear.
    setLastExportAt(Date.now());
    updateExportReminderBadge();
    return payload.count;
  }

  // Yellow dot + tooltip on the ⚙ gear icon if the user has >5 Zillow
  // validations but hasn't exported in > EXPORT_REMINDER_DAYS days (or
  // has never exported). Keeps the work safe against a browser wipe.
  function updateExportReminderBadge() {
    const btn = document.getElementById('fc-tb-keys');
    if (!btn) return;
    const entries = countZillowEntries();
    const lastExport = getLastExportAt();
    const now = Date.now();
    const daysSince = lastExport ? (now - lastExport) / (1000 * 60 * 60 * 24) : Infinity;
    const shouldNudge = entries >= 5 && daysSince >= EXPORT_REMINDER_DAYS;
    btn.classList.toggle('fc-tb-btn-nudge', shouldNudge);
    if (shouldNudge) {
      const d = daysSince === Infinity ? 'never exported' : `${Math.round(daysSince)} days since last export`;
      btn.title = `${entries} Zillow validations · ${d}. Tap to back up.`;
    } else {
      btn.title = 'Data Keys';
    }
  }
  window.fcUpdateExportBadge = updateExportReminderBadge;

  // Parse an import JSON blob and write entries back to localStorage. Accepts
  // either the wrapped export format OR a flat {key: value} dictionary (for
  // pasted clipboard content from the one-liner recovery script).
  function importZillowData(jsonString) {
    let parsed;
    try { parsed = JSON.parse(jsonString); }
    catch (e) { throw new Error('Invalid JSON: ' + e.message); }

    const entries = parsed.entries && typeof parsed.entries === 'object'
      ? parsed.entries
      : parsed;

    let imported = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith(ZILLOW_LS_PREFIX)) {
        skipped += 1;
        continue;
      }
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, raw);
      imported += 1;
    }
    return { imported, skipped };
  }

  window.fcExportZillowData = exportZillowData;
  window.fcImportZillowData = importZillowData;

  // ── Data keys export / import ──────────────────────────────────────────
  // Lets users onboard a new device in seconds: export a JSON blob on the
  // device that has keys set, paste/import on a fresh device. All four
  // API keys (Gemini, CourtListener, HUD, Estated) are bundled together.
  // NOTE: contains sensitive tokens — file should be treated like a
  // password. Same localStorage pattern as Zillow backup.
  const KEY_LS_NAMES = ['fs_gemini_key', 'fs_key_court', 'fs_key_hud', 'fs_key_estated'];

  function exportDataKeys() {
    const entries = {};
    KEY_LS_NAMES.forEach(k => {
      const v = localStorage.getItem(k);
      if (v) entries[k] = v;
    });
    const payload = {
      app:        'Nestscoop',
      kind:       'data-keys',
      exportedAt: new Date().toISOString(),
      count:      Object.keys(entries).length,
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nestscoop-keys-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return payload.count;
  }

  function importDataKeys(jsonString) {
    let parsed;
    try { parsed = JSON.parse(jsonString); }
    catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    const entries = parsed.entries && typeof parsed.entries === 'object'
      ? parsed.entries
      : parsed;
    let imported = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(entries)) {
      if (!KEY_LS_NAMES.includes(key)) { skipped += 1; continue; }
      if (typeof value !== 'string' || !value.trim()) { skipped += 1; continue; }
      localStorage.setItem(key, value.trim());
      imported += 1;
    }
    return { imported, skipped };
  }

  window.fcExportDataKeys = exportDataKeys;
  window.fcImportDataKeys = importDataKeys;

  // County tiers for scoring. Mirrors TIER_1_COUNTIES / TIER_2_COUNTIES in
  // scraper/va_foreclosure_scraper.py — keep in sync when either list changes.
  const TIER_1_COUNTIES = new Set([
    'Fairfax County', 'Arlington County', 'Loudoun County',
    'Prince William County', 'Alexandria City',
  ]);
  const TIER_2_COUNTIES = new Set([
    'Stafford County', 'Spotsylvania County', 'Fredericksburg City',
    'Henrico County', 'Chesterfield County', 'Virginia Beach City',
    'Chesapeake City',
  ]);

  function applyZillowOverrides(p) {
    if (!p || !p.id) return;
    const z = getZillowValues(p.id);
    if (!z) { p._zillowValidated = false; return; }

    if (z.zestimate) p.arv = z.zestimate;
    if (z.rent)      p.monthlyRent = z.rent;

    // Downstream recompute — mirrors Python build_pricing()'s math so the
    // drawer, listings table, and priority queue all reflect the Zillow data.
    if (p.arv > 0 && p.price > 0) {
      p.discount = Math.round((1 - p.price / p.arv) * 100);
    }
    p.rehabEstimate = Math.round((p.arv || 0) * 0.08);
    p.mao70 = Math.round((p.arv || 0) * 0.70 - p.rehabEstimate);
    p.passes70 = p.price > 0 && p.price <= p.mao70;

    if (p.price > 0 && p.monthlyRent > 0) {
      const loan = p.price * 0.75;
      const monthlyRate = 0.07 / 12;
      const pi = loan * monthlyRate / (1 - Math.pow(1 + monthlyRate, -360));
      const tax = (p.arv || 0) * 0.01 / 12;
      const ins = (p.arv || 0) * 0.005 / 12;
      const vacancy = p.monthlyRent * 0.08;
      p.cashFlow = Math.round(p.monthlyRent - pi - tax - ins - vacancy);
      const noi = p.monthlyRent * 12 - ((p.arv || 0) * 0.015 + vacancy * 12);
      p.capRate = p.price > 0 ? Number(((noi / p.price) * 100).toFixed(1)) : 0;
      p.dscr = pi > 0 ? Number((p.monthlyRent / pi).toFixed(2)) : 0;
    }

    // ── Investment score (0-100) — matches build_pricing() in Python ──
    // Zillow-validated data counts as HIGH confidence (real market value
    // vs. county averages), so it earns the HIGH confidence bonus.
    let score = 0;
    score += Math.min(30, Math.max(0, (p.discount || 0) * 1.2));
    score += Math.min(25, Math.max(0, (p.capRate || 0) * 3));
    score += Math.min(20, Math.max(0, (p.cashFlow || 0) / 50));
    if      (TIER_1_COUNTIES.has(p.county)) score += 15;
    else if (TIER_2_COUNTIES.has(p.county)) score += 10;
    else                                     score += 5;
    score += 10; // HIGH-confidence bonus (Zillow is real market data)
    if (p.passes70)             score += 5;
    if ((p.dscr || 0) >= 1.25)  score += 5;
    else if (p.dscr > 0 && p.dscr < 1.0) score -= 5;
    if (!p.sqft)                score -= 5;
    p.score = Math.max(0, Math.min(100, Math.round(score)));

    // Letter grade — matches FlipperForce / Rehab Valuator convention.
    if      (p.score >= 90) p.grade = 'A+';
    else if (p.score >= 80) p.grade = 'A';
    else if (p.score >= 70) p.grade = 'B';
    else if (p.score >= 60) p.grade = 'C';
    else                    p.grade = 'D';

    p._zillowValidated = true;
    p._zillowNotes = z.notes;
    p._zillowUpdatedAt = z.updatedAt;
  }

  function applyAllZillowOverrides(data) {
    if (!data || !data.foreclosures) return;
    for (const p of data.foreclosures) applyZillowOverrides(p);
  }

  // Called from the drawer Save button's onclick attribute. Global for
  // inline-onclick reachability. Saves values, re-applies overrides,
  // re-renders every affected view.
  window.fcSaveZillowValues = function (propId, sanitizedId) {
    const zEl = document.getElementById(`fc-z-arv-${sanitizedId}`);
    const rEl = document.getElementById(`fc-z-rent-${sanitizedId}`);
    const nEl = document.getElementById(`fc-z-notes-${sanitizedId}`);
    const d = window.__fcData;
    const property = d ? (d.foreclosures || []).find(x => x.id === propId) : null;
    setZillowValues(propId, {
      zestimate: zEl ? zEl.value : '',
      rent:      rEl ? rEl.value : '',
      notes:     nEl ? nEl.value : '',
    }, property);
    if (d) {
      applyAllZillowOverrides(d);
      renderKPIs(d);
      renderPriorityQueue(d);
      renderHotCounties(d);
      renderAICoach(d);
      renderListings(d);
      openPropertyDrawer(propId); // re-render drawer with new values
    }
  };

  window.fcClearZillowValues = function (propId) {
    setZillowValues(propId, null);
    const d = window.__fcData;
    if (d) {
      applyAllZillowOverrides(d);
      renderKPIs(d);
      renderPriorityQueue(d);
      renderHotCounties(d);
      renderAICoach(d);
      renderListings(d);
      openPropertyDrawer(propId);
    }
  };

  // ─── View routing ───────────────────────────────────────────────────────
  // Each sidebar item has data-view. Switching views shows/hides sections
  // in the main area. URL hash keeps state across refreshes.
  function wireNav(root) {
    const items = root.querySelectorAll('.fc-side-item');
    items.forEach((el) => {
      el.addEventListener('click', () => {
        const view = el.getAttribute('data-view');
        if (!view) return;
        setView(view);
        // On mobile, auto-close the sidebar drawer after selecting a view so
        // the main content becomes immediately visible.
        closeSidebarDrawer();
      });
    });
    // Restore view from URL hash
    const initial = (location.hash || '#dashboard').replace('#', '');
    setView(initial);
    window.addEventListener('hashchange', () => {
      const v = (location.hash || '#dashboard').replace('#', '');
      setView(v);
    });
  }

  // Measure the fixed topbar's actual height and publish it as the CSS var
  // --topbar-h so fc-body's padding-top + sidebar's top offset match
  // exactly. Eliminates the dead gap between the topbar and page-head.
  // Called on init, on window resize, and after any layout that can change
  // the topbar (e.g. auth state → role chip visibility flips).
  //
  // Always add a small buffer so content never tucks UNDER the topbar —
  // measurement can under-report height while fonts/layout are still
  // settling, and the cost of an 8px over-reserve is tiny vs the
  // UX cost of the topbar covering the eyebrow + title.
  function measureTopbar() {
    const tb = document.querySelector('#fc-dash-root .fc-topbar');
    const root = document.getElementById('fc-dash-root');
    if (!tb || !root) return;
    const h = Math.ceil(tb.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty('--topbar-h', (h + 8) + 'px');
  }
  window.addEventListener('resize', () => {
    // Debounce lightly: topbar height stabilizes after font/layout settle.
    requestAnimationFrame(measureTopbar);
  });
  // Run measurement again after fonts finish loading — Inter Tight + Source
  // Serif 4 reflow changes line-heights, which changes topbar height.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureTopbar);
  }

  // ─── Mobile sidebar drawer ──────────────────────────────────────────────
  // On viewports ≤768px the sidebar becomes an off-canvas drawer. Hamburger
  // button toggles it; backdrop click + view selection close it. Desktop is
  // unaffected — CSS only activates the drawer styles at the mobile bp.
  function wireSidebarDrawer(root) {
    const hamburger = root.querySelector('#fc-tb-hamburger');
    const backdrop  = root.querySelector('#fc-sidebar-backdrop');
    const sidebar   = root.querySelector('#fc-sidebar');
    if (hamburger && sidebar) {
      hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('open');
        document.body.classList.toggle('fc-sidebar-locked');
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', closeSidebarDrawer);
    }
  }
  function closeSidebarDrawer() {
    const sidebar  = document.getElementById('fc-sidebar');
    const backdrop = document.getElementById('fc-sidebar-backdrop');
    if (sidebar)  sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('fc-sidebar-locked');
  }

  // Robustly fit the Google Map viewport to DC/MD/VA on mobile.
  //
  // Why the naive fitBounds(markers) approach failed on mobile:
  //   1. The map container starts display:none (map only shown when Map view
  //      is selected). Google Maps initializes its internal size tracking
  //      with 0×0 and never fully recovers, even after a resize event.
  //   2. Calling fitBounds on a 0-dimension map projects coordinates
  //      incorrectly → viewport lands on Ottawa/Montreal instead of DC/MD/VA.
  //   3. One-shot setTimeout(300ms) races with the data-fetch that populates
  //      markers (`markers` is module-scoped in foreclosure-scout.html, now
  //      accessed via window.__fcGetMarkers / window.__fcGetMap closures).
  //
  // Fix: multi-phase recovery.
  //   Phase A: fire resize on the map to re-measure its container
  //   Phase B: wait two animation frames so layout/paint commits
  //   Phase C: setCenter + setZoom to an explicit DC-region viewport
  //            (guaranteed correct regardless of marker state)
  //   Phase D: once markers land, call fitAll as an enhancement
  // Retries Phase A–C until the container has real dimensions, then D when
  // markers are populated.
  const DC_CENTER = { lat: 38.9, lng: -77.2 };   // matches initMap default
  const DC_REGIONAL_ZOOM = 8;                     // DC → Richmond, DC → Baltimore
  let __fcMapSeeded = false;

  function fitMapWhenReady(attempt) {
    attempt = attempt || 0;
    const MAX_ATTEMPTS = 14;
    const DELAY_MS = 350;
    try {
      const g = window.google;
      const mapRef = typeof window.__fcGetMap === 'function' ? window.__fcGetMap() : null;
      if (g && g.maps && mapRef) {
        // Phase A: re-measure
        g.maps.event.trigger(mapRef, 'resize');
        // Phase B + C: wait for layout, then seed DC viewport
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              const mapEl = document.getElementById('map');
              const w = mapEl ? mapEl.offsetWidth  : 0;
              const h = mapEl ? mapEl.offsetHeight : 0;
              if (w > 50 && h > 50) {
                // Guaranteed-correct viewport. Overrides any prior bad fit.
                if (!__fcMapSeeded) {
                  mapRef.setCenter(DC_CENTER);
                  mapRef.setZoom(DC_REGIONAL_ZOOM);
                  __fcMapSeeded = true;
                }
                // Phase D: enhance with marker-based fit if markers loaded.
                const markersRef = typeof window.__fcGetMarkers === 'function'
                  ? window.__fcGetMarkers() : null;
                if (Array.isArray(markersRef) && markersRef.length > 0) {
                  const bounds = new g.maps.LatLngBounds();
                  markersRef.forEach(m => {
                    try {
                      const pos = m.getPosition && m.getPosition();
                      if (pos) bounds.extend(pos);
                    } catch (e) { /* skip bad marker */ }
                  });
                  if (!bounds.isEmpty()) {
                    mapRef.fitBounds(bounds, 40);
                  }
                  return; // done — full fit succeeded
                }
              }
            } catch (e) { /* fall through to retry */ }
            if (attempt < MAX_ATTEMPTS) {
              setTimeout(() => fitMapWhenReady(attempt + 1), DELAY_MS);
            }
          });
        });
        return;
      }
    } catch (e) { /* retry below */ }
    if (attempt < MAX_ATTEMPTS) {
      setTimeout(() => fitMapWhenReady(attempt + 1), DELAY_MS);
    }
  }

  function setView(view) {
    const valid = ['dashboard', 'listings', 'map', 'alerts', 'zillow-queue', 'financing-203k', 'rehab', 'market', 'brrrr', 'settings'];
    if (!valid.includes(view)) view = 'dashboard';
    if (location.hash !== '#' + view) {
      history.replaceState(null, '', '#' + view);
    }
    // Nav active state
    document.querySelectorAll('#fc-dash-root .fc-side-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });
    // Toggle visibility of the existing mobile-frame (hosts Google Map) when
    // user picks Map — it becomes a full-width canvas.
    // Show / hide views within fc-main. Map view is special: it shows the
    // mobile-frame we relocated into #fc-view-map on init.
    const mobileFrame = document.querySelector('#fc-view-map .mobile-frame');
    const appInner = mobileFrame ? mobileFrame.querySelector('.app') : null;

    ['dashboard', 'listings', 'map', 'alerts', 'zillow-queue', 'financing-203k', 'rehab', 'market', 'brrrr', 'settings'].forEach(v => {
      const el = document.getElementById(`fc-view-${v}`);
      if (el) el.style.display = (v === view) ? '' : 'none';
    });

    // The mobile-frame inside #fc-view-map has its own display toggle so
    // Google Maps doesn't get torn down on every view switch.
    if (mobileFrame) {
      mobileFrame.style.display = (view === 'map') ? 'block' : 'none';
    }
    if (appInner && view === 'map') {
      appInner.style.cssText = [
        'max-height: none',
        'height: 100%',
        'overflow: hidden',
        'position: relative',
      ].join('; ') + ';';

      // Reset the one-shot seed flag so returning to Map view re-centers
      // on DC (user may have panned somewhere else last time). The retry
      // loop then re-seeds + fits to markers.
      __fcMapSeeded = false;
      fitMapWhenReady();
    }

    // Browser-level hash navigation (#map, #listings, etc.) auto-scrolls
    // to any element whose id matches. The legacy Google Map div has
    // id="map" — so loading with #map jumps fc-main's scroll past the
    // topbar + page-head. Reset scroll to top on every view change so
    // the page chrome is always visible when a view opens. Both sync and
    // async reset: browser hash-anchor-scroll runs after layout commit,
    // so rAF catches the late scroll.
    const resetScroll = () => {
      const mainPane = document.querySelector('#fc-dash-root .fc-main');
      if (mainPane) mainPane.scrollTop = 0;
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    };
    resetScroll();
    requestAnimationFrame(resetScroll);
    setTimeout(resetScroll, 80);

    // Update page title + eyebrow per view
    const titles = {
      dashboard: 'Command Center',
      listings:  'All Listings',
      map:       'Property Map',
      alerts:    'Alerts',
      rehab:     'Rehab Calculator',
      market:    'Market Analysis',
      brrrr:     'BRRRR Calculator',
      settings:  'Settings',
      'zillow-queue': 'Zillow Queue',
      'financing-203k': 'FHA 203(k) Financing',
    };
    const titleEl = document.querySelector('#fc-dash-root .fc-page-title');
    if (titleEl && titles[view]) titleEl.textContent = titles[view];

    // Lazily render listings when shown
    if (view === 'listings' && window.__fcData) renderListings(window.__fcData);
    if (view === 'zillow-queue' && window.__fcData) renderZillowQueue(window.__fcData);
    if (view === 'financing-203k' && window.__fcData) render203k(window.__fcData);
    if (view === 'settings') wireSettingsView();
  }

  // ─── Settings view: Zillow sync token UI ────────────────────────────────
  // Bound lazily (every time user navigates to Settings) because the view
  // markup exists in SHELL_HTML but its buttons need live references to
  // sync helpers. Idempotent — re-binding replaces prior listeners.
  function wireSettingsView() {
    const input  = document.getElementById('fc-sync-token-input');
    const save   = document.getElementById('fc-sync-save');
    const upload = document.getElementById('fc-sync-upload');
    const linkBtn = document.getElementById('fc-sync-link');
    const clear  = document.getElementById('fc-sync-clear');
    const status = document.getElementById('fc-sync-status');
    const log    = document.getElementById('fc-sync-log');
    if (!input || !save) return;

    const existing = getZillowSyncToken();
    if (existing) {
      input.value = existing;
      status.textContent = 'connected';
      status.className = 'fc-pill sage';
    } else {
      status.textContent = 'not connected';
      status.className = 'fc-pill';
    }

    const writeLog = (msg) => { log.textContent = msg; };

    save.onclick = async () => {
      const t = input.value.trim();
      if (!t) { writeLog('Paste a token first.'); return; }
      setZillowSyncToken(t);
      writeLog('Token saved. Syncing from server…');
      const res = await syncZillowFromServer();
      if (res.ok) {
        writeLog(`✓ Synced. Pulled ${res.pulled} of ${res.total} remote entries into this device.`);
        status.textContent = 'connected';
        status.className = 'fc-pill sage';
      } else {
        writeLog(`✗ Sync failed: ${res.reason}`);
        status.textContent = 'error';
        status.className = 'fc-pill coral';
      }
    };

    upload.onclick = async () => {
      if (!getZillowSyncToken()) { writeLog('Save a token first.'); return; }
      writeLog('Uploading local entries to server…');
      const res = await uploadAllZillowToServer();
      writeLog(res.ok
        ? `✓ Uploaded ${res.pushed} entries. ${res.failed} failed. (${res.total} total in localStorage)`
        : `✗ Upload failed: ${res.reason}`);
    };

    linkBtn.onclick = async () => {
      const t = getZillowSyncToken();
      if (!t) { writeLog('No token saved. Save one first, then generate a link.'); return; }
      const link = `${location.origin}${location.pathname}?sync=${encodeURIComponent(t)}#settings`;
      try {
        await navigator.clipboard.writeText(link);
        writeLog('✓ Activation link copied. Text it to your other device — opening the link auto-activates sync, then cleans itself out of the URL.');
      } catch (e) {
        // Fallback: show in the log so user can long-press to copy
        writeLog('Copy failed. Long-press to copy:\n' + link);
      }
    };

    clear.onclick = () => {
      setZillowSyncToken('');
      input.value = '';
      writeLog('Token cleared. Syncing disabled on this device.');
      status.textContent = 'not connected';
      status.className = 'fc-pill';
    };
  }

  // ─── State filter ───────────────────────────────────────────────────────
  // 'ALL' shows every foreclosure regardless of state; 'VA' or 'MD' narrows
  // the entire dashboard (KPIs, Priority Queue, Signals, Hot Counties, AI
  // Coach, Listings) and also the legacy map via applyFilters().
  let __stateFilter = 'ALL';

  function filterByState(d) {
    if (!d || __stateFilter === 'ALL') return d;
    const foreclosures = (d.foreclosures || []).filter(
      p => (p.state || 'VA').toUpperCase() === __stateFilter
    );
    // Return a new d-shaped object so downstream renderers work unchanged.
    return { ...d, foreclosures };
  }

  function updateStateChipCounts(d) {
    const props = (d && d.foreclosures) || [];
    const counts = { ALL: props.length, VA: 0, MD: 0, DC: 0 };
    for (const p of props) {
      const s = (p.state || 'VA').toUpperCase();
      if (counts[s] != null) counts[s] += 1;
    }
    for (const s of ['ALL', 'VA', 'MD', 'DC']) {
      const el = document.getElementById(`fc-state-count-${s}`);
      if (el) el.textContent = counts[s];
    }
  }

  function wireStateChips() {
    document.querySelectorAll('#fc-state-chips .fc-state-chip').forEach(btn => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.onclick = () => {
        const s = btn.getAttribute('data-state') || 'ALL';
        if (s === __stateFilter) return;
        __stateFilter = s;
        document.querySelectorAll('#fc-state-chips .fc-state-chip')
          .forEach(b => b.classList.toggle('active', b === btn));

        // Re-render every dashboard surface from the current dataset.
        const d = window.__fcData;
        if (d) {
          renderKPIs(d);
          renderPriorityQueue(d);
          renderSignals(d);
          renderHotCounties(d);
          renderAICoach(d);
          updateSubline(d);
          updateSidebarCounts(d);
          renderListings(d);
        }

        // Sync to the legacy map: the hidden #stateFilter input feeds
        // applyFilters(), which rebuilds filteredProperties + calls
        // renderMarkers(). If applyFilters doesn't exist (e.g. mobile
        // layout not loaded), skip silently.
        const legacyInput = document.getElementById('stateFilter');
        if (legacyInput) legacyInput.value = (s === 'ALL') ? '' : s;
        if (typeof window.applyFilters === 'function') {
          try { window.applyFilters(); } catch (e) { /* best-effort */ }
        }
      };
    });
  }

  // ─── Fetch foreclosure data + populate dashboard ────────────────────────
  async function loadData() {
    try {
      const r = await fetch('data/foreclosures_va.json?t=' + Date.now(), { cache: 'no-cache' });
      if (!r.ok) throw new Error('fetch failed: ' + r.status);
      const d = await r.json();
      window.__fcData = d;
      applyAllZillowOverrides(d);
      wireStateChips();
      updateStateChipCounts(d);
      renderKPIs(d);
      renderPriorityQueue(d);
      renderSignals(d);
      renderHotCounties(d);
      renderAICoach(d);
      updateSubline(d);
      updateSidebarCounts(d);
      // Lazy views (Zillow Queue, 203(k), Listings) only render when their
      // setView runs with __fcData present. If the user lands directly on
      // one of those hashes, __fcData is still null at first setView call,
      // so we need to re-render here once data is in.
      const currentView = (location.hash || '').replace('#', '');
      if (currentView === 'listings')        renderListings(d);
      if (currentView === 'zillow-queue')    renderZillowQueue(d);
      if (currentView === 'financing-203k')  render203k(d);
      // Map: if the user landed on #map, setView's initial fit may have
      // fired before markers existed. Retry once data is in.
      if (currentView === 'map')             fitMapWhenReady();
      // Deep-link: ?p=<propId> auto-opens that property's drawer after load.
      handleShareDeepLink();
    } catch (e) {
      console.warn('[FC Dash] data load failed:', e);
    }
  }

  // ─── Share deep-links ───────────────────────────────────────────────────
  // Format: ?p=<propId> — when present, auto-opens that property's drawer
  // after the data finishes loading. Used by the Share section's generated
  // links so recipients land directly on the shared property.
  function handleShareDeepLink() {
    try {
      const params = new URLSearchParams(window.location.search);
      const propId = params.get('p');
      if (!propId) return;
      // Small delay so the drawer render has the updated DOM available.
      setTimeout(() => openPropertyDrawer(propId), 250);
    } catch (e) { /* no-op */ }
  }

  function buildShareUrl(propId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?p=${encodeURIComponent(propId)}`;
  }

  function buildShareContent(p) {
    const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    const priceStr = p.price ? '$' + p.price.toLocaleString() : '—';
    const arvStr   = p.arv   ? '$' + p.arv.toLocaleString()   : '—';
    const rentStr  = p.monthlyRent ? '$' + p.monthlyRent.toLocaleString() + '/mo' : '—';
    const cfStr    = p.cashFlow != null ? ((p.cashFlow >= 0 ? '+$' : '−$') + Math.abs(p.cashFlow).toLocaleString() + '/mo') : '—';
    const saleStr  = p.sale_date || (p.days_to_sale != null ? `in ${p.days_to_sale}d` : 'TBD');
    const url      = buildShareUrl(p.id || '');

    const subject = `Nestscoop lead: ${addr}`;
    const body = [
      addr,
      '',
      `Price:       ${priceStr}`,
      `ARV:         ${arvStr}`,
      `Discount:    ${p.discount || 0}% below ARV`,
      `Rent est.:   ${rentStr}`,
      `Cash flow:   ${cfStr}`,
      `Cap rate:    ${p.capRate || 0}%`,
      `Grade:       ${p.grade || '—'} (score ${p.score || 0}/100)`,
      `70% rule:    ${p.passes70 ? 'Passes' : 'Fails'} (MAO $${(p.mao70 || 0).toLocaleString()})`,
      `Source:      ${p.source || '—'}`,
      `Sale date:   ${saleStr}`,
      '',
      `Details: ${url}`,
    ].join('\n');

    // SMS body needs to be shorter — most carriers concatenate but links
    // can break if the message is too long. Keep it tight.
    const smsBody = `${addr}\nPrice ${priceStr} · ARV ${arvStr} · ${p.discount || 0}% below ARV · Grade ${p.grade || '—'}\n${url}`;

    return { subject, body, smsBody, url };
  }

  function updateSidebarCounts(d) {
    const filtered = filterByState(d);
    const count = (filtered.foreclosures || []).length;
    const el = document.getElementById('fc-sc-listings');
    if (el) el.textContent = count;
    updateZQueueSidebarCount(d);
    updateExportReminderBadge();
  }

  // ─── Listings view — full sortable table ────────────────────────────────
  let __listingsSortKey = 'score';
  // Quick-filter dropdowns at the top of the Command Center Listings view.
  // Empty string = "All <dimension>". Single-select; populated from the
  // dropdowns themselves and applied in renderListings() after state +
  // live-signal filtering.
  let __listingsTypeFilter = '';
  let __listingsPropertyFilter = '';
  let __listingsSourceFilter = '';
  function renderListings(d) {
    const body = document.getElementById('fc-listings-body');
    const countPill = document.getElementById('fc-listings-count');
    if (!body) return;

    // Wire up sort buttons (idempotent)
    document.querySelectorAll('.fc-list-sort').forEach(btn => {
      if (!btn.__wired) {
        btn.__wired = true;
        btn.onclick = () => {
          document.querySelectorAll('.fc-list-sort').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          __listingsSortKey = btn.getAttribute('data-sort');
          renderListings(window.__fcData);
        };
      }
    });

    const filtered = filterByState(d);
    let props = (filtered.foreclosures || []).slice();

    // Apply Live-Signal drill-down filter if one is active.
    if (__listingsFilter && typeof __listingsFilter.predicate === 'function') {
      const beforeCount = props.length;
      props = props.filter(__listingsFilter.predicate);
      renderSignalFilterChip(__listingsFilter.label, props.length, beforeCount);
      // Respect the signal's preferred sort if the user hasn't picked one.
      if (__listingsFilter.sortBy && __listingsSortKey === 'score') {
        __listingsSortKey = __listingsFilter.sortBy;
        document.querySelectorAll('.fc-list-sort').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-sort') === __listingsSortKey);
        });
      }
    } else {
      renderSignalFilterChip(null);
    }

    // Apply quick-filter dropdowns (listing type / property type / source).
    if (__listingsTypeFilter)     props = props.filter(p => p.listingType === __listingsTypeFilter);
    if (__listingsPropertyFilter) props = props.filter(p => p.property_type === __listingsPropertyFilter);
    if (__listingsSourceFilter)   props = props.filter(p => p.source === __listingsSourceFilter);

    // Populate Source dropdown from observed source values (idempotent — same
    // input → same DOM after first run). Done here so newly-added sources
    // appear without a page reload.
    const sourceSel = document.getElementById('fc-qf-source');
    if (sourceSel) {
      const observed = [...new Set((filtered.foreclosures || []).map(p => p.source).filter(Boolean))].sort();
      const desiredOptions = '<option value="">All Sources</option>' +
        observed.map(s => `<option value="${s.replace(/"/g, '&quot;')}"${s === __listingsSourceFilter ? ' selected' : ''}>${s}</option>`).join('');
      if (sourceSel.innerHTML !== desiredOptions) sourceSel.innerHTML = desiredOptions;
    }
    // Visual emphasis when a quick-filter is active.
    const setActive = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('fc-qf-active', !!on); };
    setActive('fc-qf-type',     !!__listingsTypeFilter);
    setActive('fc-qf-property', !!__listingsPropertyFilter);
    setActive('fc-qf-source',   !!__listingsSourceFilter);

    const sortFns = {
      score:    (a, b) => (b.score || 0) - (a.score || 0),
      days:     (a, b) => (a.days_to_sale == null ? 9999 : a.days_to_sale) - (b.days_to_sale == null ? 9999 : b.days_to_sale),
      price:    (a, b) => (b.price || 0) - (a.price || 0),
      discount: (a, b) => {
        const da = a.arv && a.price ? (1 - a.price/a.arv) : 0;
        const db = b.arv && b.price ? (1 - b.price/b.arv) : 0;
        return db - da;
      },
    };
    props.sort(sortFns[__listingsSortKey] || sortFns.score);

    if (countPill) countPill.textContent = `${props.length} properties`;

    if (props.length === 0) {
      body.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--muted)">No properties.</td></tr>`;
      return;
    }

    body.innerHTML = props.map(p => {
      const initials = (p.city || p.address || '??').slice(0, 2).toUpperCase();
      const sourceTag = p.source === 'HUD HomeStore' ? 'HUD' : (p.source || '').split(' ')[0] || 'VA';
      const days = p.days_to_sale;
      const saleLabel = days == null ? '—' : (days <= 0 ? 'Today' : days === 1 ? 'Tmrw' : `${days}d`);
      const saleUrgent = days != null && days >= 0 && days <= 3;
      return `
        <tr data-prop-id="${escapeAttr(p.id || '')}" class="fc-row-clickable">
          <td><div class="fc-prop-init">${escapeHtml(initials)}</div></td>
          <td>
            <div class="fc-prop-addr">${escapeHtml(p.address || '—')}${p._zillowValidated ? ' <span class="fc-z-badge" title="Zillow-validated">Z ✓</span>' : ''}</div>
            <div class="fc-prop-meta">${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')}</div>
          </td>
          <td style="font-size:12px;color:var(--ink-3)">${escapeHtml(p.county || '—')}</td>
          <td>${typePill(p.listingType)}</td>
          <td><span class="fc-pill">${escapeHtml(sourceTag)}</span></td>
          <td class="fc-mono" style="font-size:12px">${p.beds || 0}/${p.baths || 0}</td>
          <td style="text-align:right" class="fc-mono">${(p.sqft || 0).toLocaleString()}</td>
          <td style="text-align:right" class="fc-mono" style="font-weight:500">$${Math.round((p.price || 0)/1000)}K</td>
          <td style="text-align:right" class="fc-mono">$${Math.round((p.arv || 0)/1000)}K</td>
          <td style="text-align:right" class="fc-mono" style="color:var(--ink-3)">$${Math.round((p.mao70 || 0)/1000)}K</td>
          <td style="text-align:center">${gradeBadge(p.grade)}</td>
          <td style="text-align:right">${rule70Pill(p)}</td>
          <td style="text-align:right">
            <div class="fc-mono" style="color:${saleUrgent ? 'var(--coral)' : 'var(--ink)'}">${saleLabel}</div>
          </td>
        </tr>
      `;
    }).join('');
    body.querySelectorAll('tr[data-prop-id]').forEach(tr => {
      tr.onclick = () => openPropertyDrawer(tr.getAttribute('data-prop-id'));
    });
  }

  // ─── Zillow Queue — rapid manual lookup workflow ────────────────────────
  // One property at a time, focused input fields, keyboard shortcuts, auto-
  // advance. Designed to take manual Zillow validation from ~2 min/property
  // down to ~30 sec/property.
  let __zqueueIndex = 0;
  const ZQUEUE_AUTO_OPEN_KEY = 'fs_zqueue_auto_open';

  function getZillowQueue(d) {
    // Properties without Zillow data, prioritized by: auctions first (HUD +
    // Trustee), then soonest auction date, then highest heuristic discount.
    // Distressed (DC Vacant) entries are leads without an auction date so
    // they queue last — still actionable but lower urgency.
    const props = filterByState(d).foreclosures || [];
    const unvalidated = props.filter(p => !getZillowValues(p.id));

    const typeOrder = { 'Auction': 0, 'HUD Home': 1, 'Distressed': 2 };
    unvalidated.sort((a, b) => {
      const ta = typeOrder[a.listingType] ?? 9;
      const tb = typeOrder[b.listingType] ?? 9;
      if (ta !== tb) return ta - tb;
      const da = a.days_to_sale == null ? 9999 : a.days_to_sale;
      const db = b.days_to_sale == null ? 9999 : b.days_to_sale;
      if (da !== db) return da - db;
      return (b.discount || 0) - (a.discount || 0);
    });
    return unvalidated;
  }

  function updateZQueueSidebarCount(d) {
    const el = document.getElementById('fc-sc-zqueue');
    if (el) el.textContent = getZillowQueue(d).length;
  }

  function renderZillowQueue(d) {
    const container = document.getElementById('fc-view-zillow-queue');
    if (!container) return;

    const queue = getZillowQueue(d);
    const allProps = filterByState(d).foreclosures || [];
    const validatedCount = allProps.filter(p => getZillowValues(p.id)).length;
    const totalCount = allProps.length;
    const percent = totalCount ? Math.round((validatedCount / totalCount) * 100) : 0;

    if (queue.length === 0) {
      container.innerHTML = `
        <div class="fc-card" style="padding:48px;text-align:center">
          <div class="fc-eyebrow" style="margin-bottom:12px">All caught up</div>
          <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;color:var(--ink);margin-bottom:8px">
            ${validatedCount} of ${totalCount} properties have Zillow data.
          </div>
          <div style="color:var(--muted);font-size:13px">
            New properties from the next weekly scrape will queue here automatically.
          </div>
        </div>
      `;
      updateZQueueSidebarCount(d);
      return;
    }

    // Clamp index so Previous/Next stay inside bounds after save/skip.
    if (__zqueueIndex >= queue.length) __zqueueIndex = queue.length - 1;
    if (__zqueueIndex < 0) __zqueueIndex = 0;

    const p = queue[__zqueueIndex];
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const addressSlug = (p.address || '').replace(/\s+/g, '-');
    const citySlug = (p.city || '').replace(/\s+/g, '-');
    const zillowUrl = `https://www.zillow.com/homes/${addressSlug},-${citySlug},-${p.state || 'VA'}-${p.zip || ''}_rb/`;

    const daysLabel = p.days_to_sale == null ? '—'
      : p.days_to_sale <= 0 ? 'Sale passed/today'
      : p.days_to_sale === 1 ? 'Tomorrow'
      : `${p.days_to_sale} days`;
    const daysColor = (p.days_to_sale != null && p.days_to_sale <= 7 && p.days_to_sale >= 0) ? 'var(--coral)' : 'var(--ink)';

    const autoOpen = localStorage.getItem(ZQUEUE_AUTO_OPEN_KEY) !== '0';

    container.innerHTML = `
      <div class="fc-card" style="max-width:720px;margin:0 auto;padding:0;overflow:hidden">
        <!-- Progress bar -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--hair);background:var(--paper-2)">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <div>
              <span class="fc-eyebrow">Progress</span>
              <span style="margin-left:8px;font-family:var(--f-mono);font-size:12px;color:var(--muted)">
                ${validatedCount} / ${totalCount} validated · ${queue.length} remaining in queue
              </span>
            </div>
            <div style="font-family:var(--f-mono);font-size:12px;font-weight:600;color:var(--ink)">${percent}%</div>
          </div>
          <div style="height:6px;background:var(--hair);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${percent}%;background:var(--sage);transition:width 240ms"></div>
          </div>
        </div>

        <!-- Property header -->
        <div style="padding:24px">
          <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px">
            <div>${gradeBadgeLarge(p.grade)}</div>
            <div style="flex:1">
              <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;color:var(--ink);line-height:1.2;margin-bottom:4px">
                ${escapeHtml(p.address || '—')}
              </div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:12px">
                ${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')} · ${escapeHtml(p.county || '')}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${typePill(p.listingType)}
                <span class="fc-pill" style="color:${daysColor}">${daysLabel}</span>
                ${rule70Pill(p)}
              </div>
            </div>
          </div>

          <!-- Current heuristic values (for context before Zillow override) -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;padding:12px;background:var(--paper-2);border-radius:4px">
            <div>
              <div class="fc-eyebrow" style="margin-bottom:3px">Purchase</div>
              <div class="fc-mono" style="font-size:14px;font-weight:600">$${(p.price || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="fc-eyebrow" style="margin-bottom:3px">Heuristic ARV</div>
              <div class="fc-mono" style="font-size:14px;font-weight:600;color:var(--muted)">$${(p.arv || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="fc-eyebrow" style="margin-bottom:3px">Heuristic Rent</div>
              <div class="fc-mono" style="font-size:14px;font-weight:600;color:var(--muted)">$${(p.monthlyRent || 0).toLocaleString()}/mo</div>
            </div>
          </div>

          <!-- Open Zillow in a separate popup window (not a tab) so users
               can park it on a secondary monitor for side-by-side validation. -->
          <button type="button"
             id="fc-zq-open"
             data-zillow-url="${escapeAttr(zillowUrl)}"
             class="fc-btn fc-btn-dark"
             style="width:100%;justify-content:center;margin-bottom:20px;height:40px;font-size:14px">
             Open on Zillow ↗ <span style="opacity:0.6;font-size:11px;margin-left:6px">(new window)</span>
          </button>

          <!-- Input fields -->
          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px">
            <div>
              <label for="fc-zq-arv" style="display:block;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:4px">
                Zestimate (ARV)
              </label>
              <input id="fc-zq-arv" type="number" inputmode="numeric" placeholder="e.g. 425000"
                style="width:100%;padding:10px 12px;border:1px solid var(--hair);border-radius:4px;font-family:var(--f-mono);font-size:14px;box-sizing:border-box">
            </div>
            <div>
              <label for="fc-zq-rent" style="display:block;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:4px">
                Rent Zestimate (monthly)
              </label>
              <input id="fc-zq-rent" type="number" inputmode="numeric" placeholder="e.g. 2400"
                style="width:100%;padding:10px 12px;border:1px solid var(--hair);border-radius:4px;font-family:var(--f-mono);font-size:14px;box-sizing:border-box">
            </div>
            <div>
              <label for="fc-zq-notes" style="display:block;font-size:12px;font-weight:600;color:var(--ink);margin-bottom:4px">
                Notes (optional)
              </label>
              <input id="fc-zq-notes" type="text" placeholder="Condition, red flags, comps..."
                style="width:100%;padding:10px 12px;border:1px solid var(--hair);border-radius:4px;font-family:var(--f-ui);font-size:13px;box-sizing:border-box">
            </div>
          </div>

          <!-- Keyboard hint -->
          <div style="font-size:11px;color:var(--muted);margin-bottom:14px;font-family:var(--f-mono)">
            <kbd style="padding:1px 5px;background:var(--paper-2);border:1px solid var(--hair);border-radius:3px">Tab</kbd>
            between fields ·
            <kbd style="padding:1px 5px;background:var(--paper-2);border:1px solid var(--hair);border-radius:3px">Enter</kbd>
            to save + next ·
            <kbd style="padding:1px 5px;background:var(--paper-2);border:1px solid var(--hair);border-radius:3px">Esc</kbd>
            to skip
          </div>

          <!-- Action buttons -->
          <div style="display:flex;gap:8px">
            <button class="fc-btn fc-btn-dark" id="fc-zq-save" style="flex:1">Save + Next →</button>
            <button class="fc-btn" id="fc-zq-skip">Skip</button>
            <button class="fc-btn fc-btn-ghost" id="fc-zq-prev" ${__zqueueIndex === 0 ? 'disabled' : ''}>← Previous</button>
            <button class="fc-btn fc-btn-ghost" id="fc-zq-drawer">Open full drawer</button>
          </div>

          <!-- Watchlist tag: lets user flag interesting properties without
               leaving the queue. Toggles on/off, persisted to localStorage. -->
          <button class="fc-btn" id="fc-zq-watch"
                  style="width:100%;margin-top:10px;justify-content:center;height:38px;font-size:13px">
            ${isWatchlisted(p.id)
              ? '★ Saved to watchlist · click to remove'
              : '☆ Add to watchlist'}
          </button>

          <!-- Auto-open toggle -->
          <label style="display:flex;align-items:center;gap:6px;margin-top:16px;font-size:11px;color:var(--muted);cursor:pointer">
            <input type="checkbox" id="fc-zq-autoopen" ${autoOpen ? 'checked' : ''}>
            Auto-open Zillow for next property after save
          </label>

          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--hair);font-size:11px;color:var(--muted2);text-align:center">
            Property ${__zqueueIndex + 1} of ${queue.length} in queue
          </div>
        </div>
      </div>
    `;

    wireZillowQueue(queue);
    updateZQueueSidebarCount(d);

    // Focus Zestimate field for immediate pasting. Done BEFORE the
    // Zillow popup opens so the popup's win.focus() doesn't race us.
    // The input retains its DOM-level focus while the Nestscoop window
    // is in the background; when the user switches back from Zillow,
    // the cursor is already in place.
    const arvEl = document.getElementById('fc-zq-arv');
    if (arvEl) arvEl.focus();

    // Auto-open Zillow for this property if the toggle is on.
    if (autoOpen) {
      setTimeout(() => openZillowWindow(zillowUrl), 200);
    }
  }

  // Extra safety net: when the Nestscoop window regains focus (e.g. user
  // Cmd+Tabs back from the Zillow popup), re-focus the Zestimate field
  // if we're on the Zillow Queue view and focus isn't already inside one
  // of its inputs. Registered once — guarded by __zqFocusWired.
  if (!window.__zqFocusWired) {
    window.__zqFocusWired = true;
    const reFocusZQueue = () => {
      if ((location.hash || '').replace('#', '') !== 'zillow-queue') return;
      const active = document.activeElement;
      const zqIds = ['fc-zq-arv', 'fc-zq-rent', 'fc-zq-notes'];
      if (active && zqIds.includes(active.id)) return; // already inside
      const arv = document.getElementById('fc-zq-arv');
      if (arv) arv.focus();
    };
    window.addEventListener('focus', reFocusZQueue);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reFocusZQueue();
    });
  }

  // Open Zillow in a SEPARATE POPUP WINDOW (not a tab). Modern Chrome/Edge
  // ignore generic "popup=yes" and keep routing to tabs unless the feature
  // string explicitly strips browser chrome (menubar, toolbar, location,
  // status) AND includes dimensions. Once those two conditions are met,
  // Chromium creates a true WindowType::POPUP.
  //
  // The fixed window name ('nestscoop-zillow') means every call reuses the
  // same popup — user drags it to a secondary monitor once, subsequent
  // advances update the URL in place (no accumulation of windows).
  //
  // Placed near screen top-left by default (left=60, top=60). User can
  // reposition; the OS remembers window position across reopens.
  function openZillowWindow(url) {
    if (!url) return null;
    // Order matters in some Chrome versions. 'popup' first as an explicit
    // hint, followed by dimensions + chrome-strip flags.
    const features = [
      'popup=1',
      'width=1280',
      'height=900',
      'left=60',
      'top=60',
      'menubar=no',
      'toolbar=no',
      'location=no',
      'status=no',
      'scrollbars=yes',
    ].join(',');
    const win = window.open(url, 'nestscoop-zillow', features);
    if (!win) {
      // Popup blocked (typically on auto-open without a user gesture).
      // Fall back to a plain tab so users don't get stuck.
      window.open(url, '_blank', 'noopener,noreferrer');
      return null;
    }
    try { win.focus(); } catch (e) { /* cross-origin, ignore */ }
    return win;
  }

  function wireZillowQueue(queue) {
    const arvEl = document.getElementById('fc-zq-arv');
    const rentEl = document.getElementById('fc-zq-rent');
    const notesEl = document.getElementById('fc-zq-notes');

    const saveAndAdvance = () => {
      if (!queue.length) return;
      const p = queue[__zqueueIndex];
      if (!p) return;
      const arv = arvEl ? arvEl.value.trim() : '';
      const rent = rentEl ? rentEl.value.trim() : '';
      const notes = notesEl ? notesEl.value.trim() : '';
      // Require at least Zestimate or Rent to save. Otherwise treat as skip.
      if (!arv && !rent) {
        advanceQueue(1);
        return;
      }
      setZillowValues(p.id, { zestimate: arv, rent, notes }, p);
      applyAllZillowOverrides(window.__fcData);
      // Re-render other views silently so they reflect the new data.
      renderKPIs(window.__fcData);
      renderPriorityQueue(window.__fcData);
      renderHotCounties(window.__fcData);
      renderListings(window.__fcData);
      // Refresh the stale-backup nudge — an entry was just added so
      // the badge may need to light up.
      updateExportReminderBadge();
      // Advance (queue will shrink since this property is now validated).
      renderZillowQueue(window.__fcData);
    };

    const advanceQueue = (delta) => {
      __zqueueIndex += delta;
      renderZillowQueue(window.__fcData);
    };

    const saveBtn = document.getElementById('fc-zq-save');
    const skipBtn = document.getElementById('fc-zq-skip');
    const prevBtn = document.getElementById('fc-zq-prev');
    const drawerBtn = document.getElementById('fc-zq-drawer');
    const autoToggle = document.getElementById('fc-zq-autoopen');
    const openBtn = document.getElementById('fc-zq-open');
    const watchBtn = document.getElementById('fc-zq-watch');

    if (saveBtn) saveBtn.onclick = saveAndAdvance;
    if (skipBtn) skipBtn.onclick = () => advanceQueue(1);
    if (prevBtn) prevBtn.onclick = () => advanceQueue(-1);
    if (drawerBtn) {
      drawerBtn.onclick = () => {
        const p = queue[__zqueueIndex];
        if (p && p.id) openPropertyDrawer(p.id);
      };
    }
    if (openBtn) {
      openBtn.onclick = () => openZillowWindow(openBtn.dataset.zillowUrl);
    }
    if (watchBtn) {
      watchBtn.onclick = () => {
        const p = queue[__zqueueIndex];
        if (!p) return;
        const nowOn = toggleWatchlist(p);
        watchBtn.textContent = nowOn
          ? '★ Saved to watchlist · click to remove'
          : '☆ Add to watchlist';
        updateTopbarWatchlistBadge();
      };
    }
    if (autoToggle) {
      autoToggle.onchange = (e) => {
        localStorage.setItem(ZQUEUE_AUTO_OPEN_KEY, e.target.checked ? '1' : '0');
      };
    }

    // Keyboard shortcuts — Enter anywhere in the input group saves+advances,
    // Escape skips. Arrow keys don't conflict with number inputs.
    [arvEl, rentEl, notesEl].forEach(el => {
      if (!el) return;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveAndAdvance();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          advanceQueue(1);
        }
      });
    });
  }

  // ─── FHA 203(k) Financing view ──────────────────────────────────────────
  // HUD homes are natural candidates for FHA 203(k) rehabilitation loans:
  // the property + the repair budget get financed in a single FHA-backed
  // mortgage. This view filters to HUD HomeStore listings, surfaces FHA
  // insurability flag, calculates the 203(k) loan math per property, and
  // deep-links to top 203(k) lender applications.

  let __203kFilter = 'ALL'; // ALL | IN | IE | UI

  // FHA status codes on HUD HomeStore listings:
  //   IN = Insured         → 203(b) standard FHA + eligible for 203(k)
  //   IE = Insured Escrow  → Eligible for 203(k) with escrow for repairs
  //   UI = Uninsured       → Needs repairs before FHA insurability; 203(k) can finance them
  //   null = unknown / not coded
  function fhaStatusCode(p) {
    const s = (p.hud_fha || '').toUpperCase();
    if (s.startsWith('IN')) return 'IN';
    if (s.startsWith('IE')) return 'IE';
    if (s.startsWith('UI')) return 'UI';
    return null;
  }

  function render203k(d) {
    const container = document.getElementById('fc-view-financing-203k');
    if (!container) return;

    const hudProps = (filterByState(d).foreclosures || [])
      .filter(p => p.source === 'HUD HomeStore');

    // Sidebar count: number of HUD homes eligible (IN or IE)
    const eligibleCount = hudProps.filter(p => ['IN', 'IE'].includes(fhaStatusCode(p))).length;
    const sidebarCount = document.getElementById('fc-sc-203k');
    if (sidebarCount) sidebarCount.textContent = eligibleCount;

    if (hudProps.length === 0) {
      container.innerHTML = `
        <div class="fc-card" style="padding:48px;text-align:center">
          <div class="fc-eyebrow" style="margin-bottom:12px">No HUD listings</div>
          <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;color:var(--ink);margin-bottom:8px">
            No HUD HomeStore properties in scope.
          </div>
          <div style="color:var(--muted);font-size:13px">
            Adjust the state filter above (All / VA / MD / DC) or wait for the next weekly scrape.
          </div>
        </div>`;
      return;
    }

    // Filter by FHA status chip, or the special WATCH chip (watchlist ∩ HUD)
    let filtered;
    if (__203kFilter === 'WATCH') {
      filtered = hudProps.filter(p => isWatchlisted(p.id));
    } else if (__203kFilter === 'ALL') {
      filtered = hudProps;
    } else {
      filtered = hudProps.filter(p => fhaStatusCode(p) === __203kFilter);
    }

    // Counts by status for the filter chips, plus watchlist intersection
    const watchCount = hudProps.filter(p => isWatchlisted(p.id)).length;
    const counts = {
      ALL:   hudProps.length,
      IN:    hudProps.filter(p => fhaStatusCode(p) === 'IN').length,
      IE:    hudProps.filter(p => fhaStatusCode(p) === 'IE').length,
      UI:    hudProps.filter(p => fhaStatusCode(p) === 'UI').length,
      WATCH: watchCount,
    };

    // Compute fit scores once, sort by them descending (best approval fit first).
    const filteredWithFit = filtered
      .map(p => ({ p, fit: compute203kFit(p) }))
      .sort((a, b) => b.fit.score - a.fit.score);

    const propertyRows = filteredWithFit.map(({ p, fit }) => render203kRow(p, fit)).join('');

    container.innerHTML = `
      <div class="fc-card" style="padding:0;overflow:hidden">
        <!-- Intro + FHA status chips -->
        <div style="padding:24px;border-bottom:1px solid var(--hair)">
          <div class="fc-eyebrow" style="margin-bottom:8px">Financing · HUD homes</div>
          <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;color:var(--ink);margin-bottom:6px">
            FHA 203(k) Rehabilitation Loans
          </div>
          <div style="font-size:13px;color:var(--muted);line-height:1.6;max-width:720px">
            203(k) loans let you finance the purchase + repairs of a HUD home in a single FHA mortgage.
            3.5% down, up to $35K rehab (Limited) or larger (Standard), 30-year fixed. All HUD HomeStore
            homes below are candidates — IN and IE status are most straightforward; UI requires 203(k)
            specifically (repairs are needed for FHA insurability).
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;align-items:center">
            ${['ALL', 'IN', 'IE', 'UI'].map(k => `
              <button class="fc-btn fc-btn-sm fc-203k-chip ${__203kFilter === k ? 'active' : ''}"
                      data-status="${k}">
                ${k === 'ALL' ? 'All' : k} <span class="fc-state-count">${counts[k]}</span>
              </button>`).join('')}
            <span style="width:1px;height:20px;background:var(--hair-2);margin:0 4px"></span>
            <button class="fc-btn fc-btn-sm fc-203k-chip ${__203kFilter === 'WATCH' ? 'active' : ''}"
                    data-status="WATCH"
                    title="HUD homes you've tagged to your watchlist">
              ★ Watchlist <span class="fc-state-count">${counts.WATCH}</span>
            </button>
          </div>
        </div>

        <!-- Property rows -->
        <div>${propertyRows || `
          <div style="padding:48px;text-align:center;color:var(--muted);font-size:13px">
            No HUD homes with status ${__203kFilter}.
          </div>`}</div>

        <!-- Resources footer -->
        <div style="padding:20px 24px;background:var(--paper-2);border-top:1px solid var(--hair)">
          <div class="fc-eyebrow" style="margin-bottom:10px">203(k) Resources</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="fc-btn fc-btn-sm" href="https://www.hud.gov/program_offices/housing/sfh/203k" target="_blank" rel="noopener">📘 HUD 203(k) Overview</a>
            <a class="fc-btn fc-btn-sm" href="https://entp.hud.gov/idapp/html/hicostlook.cfm" target="_blank" rel="noopener">📊 FHA Loan Limits (by county)</a>
            <a class="fc-btn fc-btn-sm" href="https://www.hud.gov/program_offices/housing/sfh/203k/203k--df" target="_blank" rel="noopener">🏗️ 203(k) Consultant Roster</a>
            <a class="fc-btn fc-btn-sm" href="https://entp.hud.gov/idapp/html/f17lender.cfm" target="_blank" rel="noopener">🏦 Find FHA-approved Lenders</a>
          </div>
        </div>
      </div>
    `;

    // Wire filter chips
    container.querySelectorAll('.fc-203k-chip').forEach(btn => {
      btn.onclick = () => {
        __203kFilter = btn.getAttribute('data-status') || 'ALL';
        render203k(window.__fcData);
      };
    });

    // Wire per-row watchlist toggle buttons. Re-renders the whole view so
    // the star badge, button state, and WATCH chip count all update in sync.
    container.querySelectorAll('.fc-203k-watch-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const propId = btn.getAttribute('data-prop-id');
        const prop = (filterByState(d).foreclosures || []).find(x => x.id === propId);
        if (!prop) return;
        toggleWatchlist(prop);
        updateTopbarWatchlistBadge();
        render203k(window.__fcData);
      };
    });
  }

  // 2026 FHA single-unit loan limits for DC/MD/VA counties we cover. Sourced
  // from HUD's loan-limit lookup (entp.hud.gov/idapp/html/hicostlook.cfm).
  // High-cost metros (DC metro, Baltimore corridor) get the ceiling; rural
  // counties get the floor. Used to check loan-limit headroom per property.
  const FHA_LOAN_LIMITS_2026 = {
    // DC metro (high-cost ceiling)
    'DC:District of Columbia': 977500,
    'VA:Fairfax County':       977500,
    'VA:Arlington County':     977500,
    'VA:Loudoun County':       977500,
    'VA:Prince William County':977500,
    'VA:Alexandria City':      977500,
    'VA:Falls Church City':    977500,
    'VA:Manassas City':        977500,
    'VA:Manassas Park City':   977500,
    'VA:Stafford County':      977500,
    'VA:Spotsylvania County':  977500,
    'VA:Fredericksburg City':  977500,
    'MD:Montgomery County':    977500,
    "MD:Prince George's County": 977500,
    'MD:Charles County':       977500,
    'MD:Calvert County':       977500,
    // Baltimore corridor (mid-high)
    'MD:Anne Arundel County':  660000,
    'MD:Baltimore County':     660000,
    'MD:Baltimore City':       660000,
    'MD:Howard County':        660000,
    'MD:Carroll County':       660000,
    'MD:Harford County':       660000,
    'MD:Frederick County':     660000,
    // Richmond metro
    'VA:Henrico County':       524225,
    'VA:Chesterfield County':  524225,
    'VA:Richmond City':        524225,
    'VA:Hanover County':       524225,
    // Hampton Roads
    'VA:Virginia Beach City':  524225,
    'VA:Norfolk City':         524225,
    'VA:Chesapeake City':      524225,
    'VA:Newport News City':    524225,
    'VA:Hampton City':         524225,
    'VA:Suffolk City':         524225,
    'VA:Portsmouth City':      524225,
    // Shenandoah Valley + rural (floor)
    'VA:Frederick County':     524225,
    'VA:Winchester City':      524225,
    'VA:Rockingham County':    524225,
    'VA:Augusta County':       524225,
    // Default floor
    'DEFAULT':                 524225,
  };

  function fhaLoanLimit(p) {
    const key = `${(p.state || 'VA').toUpperCase()}:${p.county || ''}`;
    return FHA_LOAN_LIMITS_2026[key] || FHA_LOAN_LIMITS_2026.DEFAULT;
  }

  // Compute a 0-100 FHA 203(k) approval-fit score. Higher = easier deal for
  // an underwriter to approve. Breakdown is returned alongside the score so
  // the UI can explain why a property ranks where it does.
  function compute203kFit(p) {
    const reasons = [];
    let score = 0;

    // 1) FHA insurability status (max 30)
    const fhaCode = fhaStatusCode(p);
    if (fhaCode === 'IN') { score += 30; reasons.push({k:'FHA status', v:'IN Insured', pts:30, tone:'sage'}); }
    else if (fhaCode === 'IE') { score += 22; reasons.push({k:'FHA status', v:'IE Escrow', pts:22, tone:'sky'}); }
    else if (fhaCode === 'UI') { score += 12; reasons.push({k:'FHA status', v:'UI Uninsured', pts:12, tone:'coral'}); }
    else                       { score += 0;  reasons.push({k:'FHA status', v:'Unknown',    pts:0,  tone:'muted'}); }

    // 2) Post-rehab LTV / equity cushion (max 25)
    // Total loan basis = purchase + rehab. ARV = post-rehab value.
    // Cushion ratio = ARV / loan_basis. >1.25 is excellent.
    const purchasePrice = p.price || 0;
    const rehab = p.rehabEstimate || Math.round((p.arv || 0) * 0.08);
    const loanBasis = purchasePrice + rehab;
    const arv = p.arv || 0;
    const cushion = loanBasis > 0 ? arv / loanBasis : 0;
    if (cushion >= 1.25)      { score += 25; reasons.push({k:'Equity cushion', v:`${cushion.toFixed(2)}× (strong)`, pts:25, tone:'sage'}); }
    else if (cushion >= 1.10) { score += 18; reasons.push({k:'Equity cushion', v:`${cushion.toFixed(2)}× (ok)`, pts:18, tone:'sky'}); }
    else if (cushion >= 1.00) { score += 10; reasons.push({k:'Equity cushion', v:`${cushion.toFixed(2)}× (thin)`, pts:10, tone:'muted'}); }
    else if (cushion > 0)     { score += 0;  reasons.push({k:'Equity cushion', v:`${cushion.toFixed(2)}× (underwater)`, pts:0, tone:'coral'}); }
    else                      { score += 0;  reasons.push({k:'Equity cushion', v:'No ARV data', pts:0, tone:'muted'}); }

    // 3) Rehab complexity (max 15)
    const rehabPct = loanBasis > 0 ? rehab / loanBasis : 0;
    if (rehabPct < 0.15)      { score += 15; reasons.push({k:'Rehab complexity', v:'Qualifies for Limited 203(k)', pts:15, tone:'sage'}); }
    else if (rehabPct < 0.25) { score += 10; reasons.push({k:'Rehab complexity', v:'Limited 203(k) likely', pts:10, tone:'sky'}); }
    else                      { score += 5;  reasons.push({k:'Rehab complexity', v:'Standard 203(k) (complex)', pts:5,  tone:'muted'}); }

    // 4) FHA loan limit headroom (max 15)
    const limit = fhaLoanLimit(p);
    const usage = limit > 0 ? loanBasis / limit : 1;
    if (usage < 0.80)      { score += 15; reasons.push({k:'Loan-limit headroom', v:`${Math.round(usage*100)}% of FHA limit`, pts:15, tone:'sage'}); }
    else if (usage < 1.00) { score += 8;  reasons.push({k:'Loan-limit headroom', v:`${Math.round(usage*100)}% (tight)`, pts:8, tone:'sky'}); }
    else                   { score -= 10; reasons.push({k:'Loan-limit headroom', v:`${Math.round(usage*100)}% (OVER LIMIT)`, pts:-10, tone:'coral'}); }

    // 5) Property type (max 10)
    const pt = (p.property_type || '').toLowerCase();
    if (pt.includes('single'))          { score += 10; reasons.push({k:'Property type', v:'Single-family (simplest)', pts:10, tone:'sage'}); }
    else if (pt.includes('townhouse'))  { score += 8;  reasons.push({k:'Property type', v:'Townhouse', pts:8, tone:'sky'}); }
    else if (pt.includes('condo'))      { score += 4;  reasons.push({k:'Property type', v:'Condo (needs approved HOA)', pts:4, tone:'muted'}); }
    else if (pt.includes('multi'))      { score += 3;  reasons.push({k:'Property type', v:'Multi-unit (complex)', pts:3, tone:'muted'}); }
    else                                { score += 5;  reasons.push({k:'Property type', v:p.property_type || 'Unknown', pts:5, tone:'muted'}); }

    // 6) Market tier bonus (max 5) — comps density matters for appraisal
    if (TIER_1_COUNTIES.has(p.county))      { score += 5; reasons.push({k:'Market tier', v:'Tier 1 (high liquidity)', pts:5, tone:'sage'}); }
    else if (TIER_2_COUNTIES.has(p.county)) { score += 3; reasons.push({k:'Market tier', v:'Tier 2 (stable)', pts:3, tone:'sky'}); }
    else                                    { score += 1; reasons.push({k:'Market tier', v:'Rural / thin comps', pts:1, tone:'muted'}); }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Grade
    let tier;
    if (score >= 75)      tier = { label: 'Strong Fit', color: 'sage' };
    else if (score >= 55) tier = { label: 'Good Fit',   color: 'sky'  };
    else if (score >= 35) tier = { label: 'Possible',   color: 'muted'};
    else                  tier = { label: 'Difficult',  color: 'coral'};

    return { score, tier, reasons, loanBasis, rehabPct, cushion, fhaLimit: limit };
  }

  // Top FHA 203(k) lenders. `specialist: true` means this lender has a
  // dedicated 203(k) team — pushed to the top for Standard deals where the
  // coordination complexity matters. Generalists still handle Limited fine.
  const FHA_203K_LENDERS = [
    {
      name:  'loanDepot',
      url:   'https://www.loandepot.com/loans/fha-loans/203k-loan',
      note:  '203(k) specialist team',
      specialist: true,
    },
    {
      name:  'AnnieMac Home Mortgage',
      url:   'https://anniemac.com/203k-loan/',
      note:  'Mid-Atlantic 203(k) presence',
      specialist: true,
    },
    {
      name:  'Rocket Mortgage',
      url:   'https://www.rocketmortgage.com/purchase',
      note:  'Online application, 203(k) through their network',
      specialist: false,
    },
    {
      name:  'Movement Mortgage',
      url:   'https://movement.com/',
      note:  'DC/MD/VA licensed, FHA-approved',
      specialist: false,
    },
    {
      name:  'Chase',
      url:   'https://www.chase.com/personal/mortgage',
      note:  'Major bank, FHA 203(k) available',
      specialist: false,
    },
  ];

  // Program type classifier. Based on HUD rules: rehab budget ≤ $35K =
  // Limited 203(k) (streamline, no consultant, cosmetic/non-structural only).
  // > $35K = Standard 203(k) (full program, HUD-approved consultant required,
  // structural repairs allowed).
  const LIMITED_203K_CAP = 35000;
  function program203k(rehab) {
    if ((rehab || 0) <= LIMITED_203K_CAP) {
      return {
        type: 'LIMITED',
        label: 'Limited 203(k)',
        pillClass: 'sage',
        consultant: false,
        consultantNote: 'No consultant required',
        blurb: 'Streamline · cosmetic/non-structural only · up to $35K rehab',
      };
    }
    return {
      type: 'STANDARD',
      label: 'Standard 203(k)',
      pillClass: 'sky',
      consultant: true,
      consultantNote: 'HUD-approved consultant required',
      blurb: 'Full program · structural repairs allowed · > $35K rehab',
    };
  }

  // HUD forms for consultant + FHA-approved lender lookups are POST-only, so
  // we can't URL-prefill the state. But we can route to the right form + show
  // the state in the button label so the user types one field and hits go.
  function hudConsultantSearchUrl() {
    return 'https://entp.hud.gov/idapp/html/f17cnslt.cfm';
  }
  function hudLenderSearchUrl() {
    return 'https://entp.hud.gov/idapp/html/f17lender.cfm';
  }

  function render203kRow(p, fit) {
    const watched = isWatchlisted(p.id);
    const status = fhaStatusCode(p);
    const statusLabel = {
      IN: 'IN · Insured',
      IE: 'IE · Insured Escrow',
      UI: 'UI · Uninsured',
    }[status] || '—';
    const statusColor = {
      IN: 'sage',
      IE: 'sky',
      UI: 'coral',
    }[status] || 'muted';

    // 203(k) loan math
    const purchasePrice = p.price || 0;
    const rehabEstimate = p.rehabEstimate || Math.round((p.arv || 0) * 0.08);
    const totalLoanNeeded = purchasePrice + rehabEstimate;
    const downPayment = Math.round(totalLoanNeeded * 0.035);
    const loanAmount = totalLoanNeeded - downPayment;
    // Monthly P&I at 7% fixed, 30 years (current FHA typical).
    const monthlyRate = 0.07 / 12;
    const piPayment = loanAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -360));
    // Add FHA MIP (~0.55% annually) + property tax + insurance
    const mip = (loanAmount * 0.0055) / 12;
    const estTax = (p.arv || totalLoanNeeded) * 0.01 / 12;
    const estIns = (p.arv || totalLoanNeeded) * 0.005 / 12;
    const totalPITI = piPayment + mip + estTax + estIns;

    // Program classification: Limited (≤$35K rehab, no consultant) vs
    // Standard (>$35K, consultant required). Rehab amount drives which
    // lender flow + what lookup deep-links to surface.
    const program = program203k(rehabEstimate);
    const stateCode = (p.state || 'VA').toUpperCase();

    // Re-rank lenders by program type: Standard deals benefit from
    // specialist teams (coordination-heavy). Limited is fine with
    // generalists. Stable sort so same-category lenders keep original order.
    const rankedLenders = FHA_203K_LENDERS.slice().sort((a, b) => {
      if (program.type === 'STANDARD') {
        return (b.specialist ? 1 : 0) - (a.specialist ? 1 : 0);
      }
      return 0;
    });
    const lenderButtons = rankedLenders.slice(0, 3).map(l => `
      <a class="fc-btn fc-btn-sm fc-btn-ghost" href="${escapeAttr(l.url)}" target="_blank" rel="noopener"
         title="${escapeAttr(l.note)}">
        ${escapeHtml(l.name)}${l.specialist ? ' ★' : ''} ↗
      </a>`).join('');

    // Fit score reason tooltip
    const reasonLines = fit.reasons
      .map(r => `${r.k}: ${r.v} (${r.pts >= 0 ? '+' : ''}${r.pts})`)
      .join(' · ');

    return `
      <div class="fc-203k-row">
        <!-- Left: property ID + fit score -->
        <div class="fc-203k-prop">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div class="fc-203k-fit fc-203k-fit-${fit.tier.color}"
                 title="${escapeAttr(reasonLines)}">
              <div class="fc-203k-fit-score">${fit.score}</div>
              <div class="fc-203k-fit-label">${fit.tier.label}</div>
            </div>
            <div>
              ${gradeBadge(p.grade)}
              <div style="margin-top:4px">
                <span class="fc-pill ${statusColor}">${escapeHtml(statusLabel)}</span>
              </div>
            </div>
          </div>
          <div style="font-family:var(--f-serif);font-size:15px;font-weight:600;color:var(--ink);line-height:1.2;margin-bottom:3px;display:flex;align-items:center;gap:6px">
            ${watched ? '<span class="fc-203k-star" title="On your watchlist">★</span>' : ''}
            <span>${escapeHtml(p.address || '—')}</span>
          </div>
          <div style="font-family:var(--f-mono);font-size:11px;color:var(--muted)">
            ${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')} · Case #${escapeHtml(p.firm_file_number || '—')}
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <button class="fc-btn fc-btn-sm"
                    onclick="openPropertyDrawer('${escapeAttr(p.id || '')}')">
              View full drawer →
            </button>
            <button class="fc-btn fc-btn-sm fc-203k-watch-btn ${watched ? 'watched' : ''}"
                    data-prop-id="${escapeAttr(p.id || '')}"
                    title="${watched ? 'Remove from watchlist' : 'Add to watchlist'}">
              ${watched ? '★ Watchlisted' : '☆ Watchlist'}
            </button>
          </div>
        </div>

        <!-- Middle: 203(k) loan math -->
        <div class="fc-203k-math">
          <!-- Program type pill: Limited (≤$35K) vs Standard (>$35K) -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--hair-2)">
            <span class="fc-pill ${program.pillClass}" title="${escapeAttr(program.blurb)}">
              ${escapeHtml(program.label)}
            </span>
            <span style="font-family:var(--f-mono);font-size:9px;color:var(--muted);letter-spacing:0.04em;text-transform:uppercase">
              ${program.type === 'LIMITED' ? 'Streamline' : 'Full program'}
            </span>
          </div>
          <div class="fc-203k-math-row">
            <span class="fc-203k-key">Purchase</span>
            <span class="fc-203k-val">$${purchasePrice.toLocaleString()}</span>
          </div>
          <div class="fc-203k-math-row">
            <span class="fc-203k-key">+ Rehab (est. 8%)</span>
            <span class="fc-203k-val">$${rehabEstimate.toLocaleString()}</span>
          </div>
          <div class="fc-203k-math-row fc-203k-total">
            <span class="fc-203k-key">Total loan basis</span>
            <span class="fc-203k-val">$${totalLoanNeeded.toLocaleString()}</span>
          </div>
          <div class="fc-203k-math-row">
            <span class="fc-203k-key">Down (3.5%)</span>
            <span class="fc-203k-val sage">$${downPayment.toLocaleString()}</span>
          </div>
          <div class="fc-203k-math-row">
            <span class="fc-203k-key">Financed</span>
            <span class="fc-203k-val">$${loanAmount.toLocaleString()}</span>
          </div>
          <div class="fc-203k-math-row fc-203k-piti">
            <span class="fc-203k-key">Est. monthly PITI*</span>
            <span class="fc-203k-val">$${Math.round(totalPITI).toLocaleString()}/mo</span>
          </div>
          <div class="fc-203k-math-row" style="color:var(--muted);font-size:10px">
            <span class="fc-203k-key">FHA county limit</span>
            <span class="fc-203k-val">$${fit.fhaLimit.toLocaleString()}</span>
          </div>
          <div style="font-size:9px;color:var(--muted);margin-top:6px;font-family:var(--f-mono);line-height:1.4">
            *P&I @ 7% / 30yr + MIP + est. tax & insurance.
            Actual rate + fees vary by lender.
          </div>
        </div>

        <!-- Right: apply actions + fit breakdown -->
        <div class="fc-203k-actions">
          <!-- Consultant requirement callout: Standard needs one, Limited doesn't -->
          <div class="fc-203k-consult fc-203k-consult-${program.consultant ? 'req' : 'none'}">
            <div class="fc-203k-consult-head">
              <span class="fc-203k-consult-ico">${program.consultant ? '⚠' : '✓'}</span>
              <span>${escapeHtml(program.consultantNote)}</span>
            </div>
            ${program.consultant ? `
              <a class="fc-btn fc-btn-sm" href="${hudConsultantSearchUrl()}" target="_blank" rel="noopener"
                 title="HUD consultant roster — pick ${escapeAttr(stateCode)} in the state field"
                 style="margin-top:6px">
                🏗️ Find consultant in ${escapeHtml(stateCode)} ↗
              </a>` : `
              <div style="font-size:10px;color:var(--muted);margin-top:4px;line-height:1.4">
                Cosmetic/non-structural repairs only. Max $35K rehab. No 1099 consultant fee.
              </div>`}
          </div>

          <div class="fc-eyebrow" style="margin-top:14px;margin-bottom:6px">Approval factors</div>
          <div class="fc-203k-reasons">
            ${fit.reasons.map(r => `
              <div class="fc-203k-reason fc-203k-reason-${r.tone}">
                <span class="fc-203k-reason-k">${escapeHtml(r.k)}</span>
                <span class="fc-203k-reason-v">${escapeHtml(r.v)}</span>
              </div>`).join('')}
          </div>
          <div class="fc-eyebrow" style="margin-top:14px;margin-bottom:6px">
            Launch application ${program.type === 'STANDARD' ? '· ★ = 203(k) specialist' : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${lenderButtons}
            <a class="fc-btn fc-btn-sm fc-btn-ghost" href="${hudLenderSearchUrl()}" target="_blank" rel="noopener"
               title="HUD FHA-approved lender search — filter by state + ZIP on the form"
               style="border-style:dashed">
              🏦 Find FHA lenders in ${escapeHtml(stateCode)} ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Hot counties — ranked by volume with score signal + ring ──────────
  function renderHotCounties(d) {
    d = filterByState(d);
    const el = document.getElementById('fc-hot-counties');
    const countPill = document.getElementById('fc-hc-count');
    if (!el) return;

    const props = d.foreclosures || [];
    // Group by county
    const groups = {};
    props.forEach(p => {
      const c = p.county || 'Unknown County';
      if (!groups[c]) groups[c] = { county: c, count: 0, scores: [], hiConf: 0, priceSum: 0, priceN: 0 };
      groups[c].count += 1;
      if (p.score) groups[c].scores.push(p.score);
      const conf = (p.pricing && p.pricing.confidence) || '';
      if (conf.startsWith('HIGH')) groups[c].hiConf += 1;
      if (p.price) { groups[c].priceSum += p.price; groups[c].priceN += 1; }
    });
    const ranked = Object.values(groups)
      .filter(g => g.count >= 2)                 // drop one-offs
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    if (countPill) countPill.textContent = `${Object.keys(groups).length} counties`;

    if (ranked.length === 0) {
      el.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">No county data.</div>`;
      return;
    }

    el.innerHTML = ranked.map(g => {
      const avgScore = g.scores.length ? Math.round(g.scores.reduce((a,b)=>a+b,0) / g.scores.length) : 0;
      const avgPrice = g.priceN ? Math.round(g.priceSum / g.priceN / 1000) : 0;
      const initials = g.county.replace(/County|City/g, '').trim().slice(0, 2).toUpperCase();
      const ringColor = avgScore >= 75 ? 'var(--sage)' : avgScore >= 60 ? 'var(--gold-deep)' : 'var(--muted)';
      return `
        <div class="fc-hc-row">
          <div class="fc-prop-init" style="width:32px;height:32px;font-size:12px">${escapeHtml(initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;color:var(--ink)">${escapeHtml(g.county)}</div>
            <div style="font-size:11px;color:var(--muted)">${g.count} listings · ${g.hiConf} HIGH conf · avg $${avgPrice}K</div>
          </div>
          <div style="text-align:right">
            <div class="fc-mono" style="font-size:13px;color:var(--ink)">${g.count}</div>
            <div style="font-size:10px;color:var(--muted)">listings</div>
          </div>
          <div>${ringSvg(avgScore, 32, 3, ringColor)}</div>
        </div>
      `;
    }).join('');
  }

  // ─── AI Coach — static heuristic insight (Gemini wiring optional later) ─
  function renderAICoach(d) {
    d = filterByState(d);
    const el = document.getElementById('fc-ai-coach');
    if (!el) return;
    const props = d.foreclosures || [];
    const m = d.metadata || {};

    // Identify the strongest heuristic signal in the data.
    const hiConf = props.filter(p => (p.pricing && p.pricing.confidence || '').startsWith('HIGH'));
    const soon = props.filter(p => p.days_to_sale != null && p.days_to_sale >= 0 && p.days_to_sale <= 7);
    const highScore = props.filter(p => (p.score || 0) >= 75);
    const biggestDiscount = props.slice().sort((a, b) =>
      ((b.arv && b.price) ? (1 - b.price/b.arv) : 0) - ((a.arv && a.price) ? (1 - a.price/a.arv) : 0)
    )[0];

    const topCounty = (() => {
      const counts = {};
      highScore.forEach(p => { counts[p.county] = (counts[p.county] || 0) + 1; });
      const ranked = Object.entries(counts).sort((a,b) => b[1] - a[1]);
      return ranked[0] ? ranked[0][0] : null;
    })();

    let insight = '';
    if (hiConf.length && soon.length && topCounty) {
      insight = `You're sitting on <strong>${hiConf.length} HIGH-confidence deals</strong> with known list prices, and <strong>${soon.length}</strong> auctions close in the next 7 days. <u>${escapeHtml(topCounty)}</u> has the densest cluster of ${highScore.length >= 1 ? highScore.filter(p => p.county === topCounty).length : 'scored'} high-score properties — start there.`;
    } else if (biggestDiscount && biggestDiscount.arv && biggestDiscount.price) {
      const pct = Math.round((1 - biggestDiscount.price / biggestDiscount.arv) * 100);
      insight = `Deepest discount in the pipeline: <strong>${escapeHtml(biggestDiscount.address)}</strong> in ${escapeHtml(biggestDiscount.city)} is listed ${pct}% below ARV. Run the comps before ${escapeHtml(biggestDiscount.sale_date || 'sale')}.`;
    } else {
      insight = `Pipeline is warming up. Re-check on Monday for the weekly scrape refresh.`;
    }

    const followUps = [
      ['Deals to underwrite', hiConf.length.toString()],
      ['Sales this week', soon.length.toString()],
      ['Avg score ≥75', highScore.length.toString()],
    ];

    // Pick the property the coach is actually talking about — highest-score
    // property in the top county when that branch fires, otherwise the
    // biggest-discount property. Used by the Pin button.
    let pinTarget = null;
    if (hiConf.length && soon.length && topCounty) {
      pinTarget = highScore.filter(p => p.county === topCounty)
                           .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
    } else if (biggestDiscount && biggestDiscount.arv && biggestDiscount.price) {
      pinTarget = biggestDiscount;
    }
    const pinLabel = pinTarget && isWatchlisted(pinTarget.id)
      ? '★ On watchlist'
      : 'Pin to watchlist';
    const pinDisabled = pinTarget ? '' : 'disabled';

    el.innerHTML = `
      <div class="fc-coach-quote">"${insight}"</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button class="fc-btn fc-btn-gold" id="fc-coach-pin" ${pinDisabled}>${pinLabel}</button>
        <button class="fc-btn" id="fc-coach-dismiss">Dismiss</button>
      </div>
      <div class="fc-coach-stats">
        ${followUps.map(([l, v]) => `
          <div>
            <div class="fc-eyebrow" style="font-size:9px;margin-bottom:3px">${escapeHtml(l)}</div>
            <div class="fc-mono" style="font-size:15px;color:var(--ink)">${escapeHtml(v)}</div>
          </div>
        `).join('')}
      </div>
    `;

    const pinBtn = document.getElementById('fc-coach-pin');
    if (pinBtn && pinTarget) {
      pinBtn.onclick = () => {
        const nowOn = toggleWatchlist(pinTarget);
        pinBtn.textContent = nowOn ? '★ On watchlist' : 'Pin to watchlist';
        updateTopbarWatchlistBadge();
      };
    }
    const dismissBtn = document.getElementById('fc-coach-dismiss');
    if (dismissBtn) {
      dismissBtn.onclick = () => { el.style.display = 'none'; };
    }
  }

  // ─── Priority queue — top N scored properties ──────────────────────────
  function renderPriorityQueue(d) {
    d = filterByState(d);
    const body = document.getElementById('fc-priority-body');
    const countPill = document.getElementById('fc-pq-count');
    if (!body) return;

    const filterBtns = document.querySelectorAll('.fc-pq-filter');
    filterBtns.forEach((btn) => {
      btn.onclick = () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderPriorityTable(d, btn.getAttribute('data-filter'));
      };
    });
    renderPriorityTable(d, 'all');
    const total = (d.foreclosures || []).length;
    if (countPill) countPill.textContent = `${total} tracked`;
  }

  function renderPriorityTable(d, filter) {
    // d is already filtered by state when called from renderPriorityQueue;
    // called standalone (filter-button onclick) we re-filter defensively.
    d = (d && d.__stateFiltered) ? d : filterByState(d);
    const body = document.getElementById('fc-priority-body');
    if (!body) return;
    let props = (d.foreclosures || []).slice();
    // Filter by listingType (matches the map legend). 'all' is pass-through.
    // Legacy 'hud'/'trustee' values still work as aliases for back-compat.
    if (filter === 'hud') {
      props = props.filter(p => p.listingType === 'HUD Home');
    } else if (filter === 'trustee') {
      props = props.filter(p => p.listingType === 'Auction');
    } else if (filter && filter !== 'all') {
      props = props.filter(p => p.listingType === filter);
    }
    // Sort by score descending, break ties by days_to_sale ascending (soonest first)
    props.sort((a, b) => {
      const sa = (a.score || 0), sb = (b.score || 0);
      if (sa !== sb) return sb - sa;
      const da = a.days_to_sale == null ? 9999 : a.days_to_sale;
      const db = b.days_to_sale == null ? 9999 : b.days_to_sale;
      return da - db;
    });
    const top = props.slice(0, 8);
    if (top.length === 0) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">No properties match.</td></tr>`;
      return;
    }
    body.innerHTML = top.map(p => {
      const sourceTag = p.source === 'HUD HomeStore' ? 'HUD' : (p.source || '').split(' ')[0] || 'VA';
      const days = p.days_to_sale;
      const saleLabel = days == null ? '—' : (days <= 0 ? 'Today' : days === 1 ? 'Tmrw' : `${days}d`);
      const saleUrgent = days != null && days >= 0 && days <= 3;
      const initials = (p.city || p.address || '??').slice(0, 2).toUpperCase();
      return `
        <tr data-prop-id="${escapeAttr(p.id || '')}" class="fc-row-clickable">
          <td><div class="fc-prop-init">${escapeHtml(initials)}</div></td>
          <td>
            <div class="fc-prop-addr">${escapeHtml(p.address || '—')}${p._zillowValidated ? ' <span class="fc-z-badge" title="Zillow-validated">Z ✓</span>' : ''}</div>
            <div class="fc-prop-meta">${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')} · ${escapeHtml(sourceTag)}</div>
          </td>
          <td>${typePill(p.listingType)}</td>
          <td><span class="fc-pill ink">${escapeHtml((p.status || 'Active').slice(0, 14))}</span></td>
          <td>${gradeBadge(p.grade)}</td>
          <td style="text-align:right">${rule70Pill(p)}</td>
          <td style="text-align:right">
            <div class="fc-mono" style="color:${saleUrgent ? 'var(--coral)' : 'var(--ink)'}">${saleLabel}</div>
            <div class="fc-mono" style="font-size:10px;color:var(--muted)">${escapeHtml(p.sale_date || '')}</div>
          </td>
          <td><button class="fc-btn fc-btn-sm fc-open-btn">Open →</button></td>
        </tr>
      `;
    }).join('');
    // Wire row clicks → open drawer
    body.querySelectorAll('tr[data-prop-id]').forEach(tr => {
      tr.onclick = () => openPropertyDrawer(tr.getAttribute('data-prop-id'));
    });
  }

  // ─── Signals feed — derive from live data (sources, recency, status) ────
  // Active listings filter set by clicking a Live Signal. Null when no
  // signal is applied. The full property is stashed in module scope so we
  // can restore on view refresh + show a dismiss chip in Listings view.
  let __listingsFilter = null;  // { label, predicate, sortBy? }
  const __signalIndex = new Map(); // signal idx → filter spec (for click handler)

  function renderSignalFilterChip(label, matchCount, totalBeforeFilter) {
    const container = document.querySelector('#fc-listings-filter-chip');
    if (!container) return;
    if (!label) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    container.innerHTML = `
      <div class="fc-filter-chip-active">
        <span class="fc-filter-chip-icon">⚡</span>
        <span class="fc-filter-chip-label">Filtered: <strong>${escapeHtml(label)}</strong></span>
        <span class="fc-filter-chip-count">${matchCount} of ${totalBeforeFilter}</span>
        <button class="fc-filter-chip-clear" onclick="fcClearListingsFilter()" title="Clear filter">✕</button>
      </div>
    `;
  }

  window.fcApplyListingsFilter = function (idx) {
    const filter = __signalIndex.get(Number(idx));
    if (!filter) return;
    __listingsFilter = filter;
    location.hash = 'listings';
    // setView happens on hashchange; force render if we're already there.
    if (window.__fcData) renderListings(window.__fcData);
  };

  window.fcClearListingsFilter = function () {
    __listingsFilter = null;
    if (window.__fcData) renderListings(window.__fcData);
  };

  function renderSignals(d) {
    d = filterByState(d);
    const el = document.getElementById('fc-signals');
    if (!el) return;
    const props = d.foreclosures || [];
    const m = d.metadata || {};

    const signals = [];
    __signalIndex.clear();

    // Upcoming sales this week
    const soonSales = props.filter(p => p.days_to_sale != null && p.days_to_sale >= 0 && p.days_to_sale <= 7);
    if (soonSales.length) {
      signals.push({
        type: 'coral', tag: 'URGENT',
        who: `${soonSales.length} sales`,
        what: `scheduled this week, earliest ${soonSales[0].days_to_sale === 0 ? 'today' : 'in ' + soonSales[0].days_to_sale + 'd'}.`,
        ctx: `${soonSales.slice(0, 3).map(p => p.city).join(' · ')}…`,
        time: soonSales[0].days_to_sale === 0 ? 'Now' : `${soonSales[0].days_to_sale}d`,
        filter: {
          label: 'Sales within 7 days',
          predicate: p => p.days_to_sale != null && p.days_to_sale >= 0 && p.days_to_sale <= 7,
          sortBy: 'days',
        },
      });
    }

    // HUD price-reduced properties (actionable for flippers)
    const priceReduced = props.filter(p => (p.status || '').toLowerCase().includes('reduced'));
    if (priceReduced.length) {
      signals.push({
        type: 'gold', tag: 'PRICE CUT',
        who: `${priceReduced.length} HUD homes`,
        what: `marked Price Reduced — lender cutting losses.`,
        ctx: `Avg new list $${Math.round(priceReduced.reduce((s,p) => s + (p.price||0), 0) / priceReduced.length / 1000)}K.`,
        time: 'Active',
        filter: {
          label: 'Price Reduced listings',
          predicate: p => (p.status || '').toLowerCase().includes('reduced'),
          sortBy: 'score',
        },
      });
    }


    // HUD REO additions
    const hudProps = props.filter(p => p.source === 'HUD HomeStore');
    if (hudProps.length) {
      const hudStates = new Set(hudProps.map(p => (p.state || 'VA').toUpperCase()));
      const stateList = Array.from(hudStates).sort().join('/');
      signals.push({
        type: '', tag: 'HUD INTEL',
        who: `${hudProps.length} HUD homes`,
        what: `active in ${stateList} — FHA financing available on ${hudProps.filter(p => (p.hud_fha || '').startsWith('IN')).length} of them.`,
        ctx: `List price median $${Math.round(median(hudProps.map(p => p.price || 0).filter(v => v > 0)) / 1000)}K.`,
        time: 'Weekly',
        filter: {
          label: 'HUD HomeStore listings',
          predicate: p => p.source === 'HUD HomeStore',
          sortBy: 'score',
        },
      });
    }

    // Top county concentration — uses whichever states are currently in
    // scope (respects the state filter chip). Label reads "DC/MD/VA" when
    // unfiltered, or the specific state code when filtered.
    const counties = {};
    props.forEach(p => { counties[p.county] = (counties[p.county] || 0) + 1; });
    const top = Object.entries(counties).sort((a,b) => b[1] - a[1]).slice(0, 1)[0];
    if (top) {
      const scopeLabel = __stateFilter === 'ALL' ? 'DC/MD/VA' : __stateFilter;
      const topCounty = top[0];
      signals.push({
        type: 'sky', tag: 'CONCENTRATION',
        who: topCounty,
        what: `has the highest foreclosure volume — ${top[1]} active listings.`,
        ctx: `${Math.round(top[1] / props.length * 100)}% of all ${scopeLabel} activity this week.`,
        time: 'Now',
        filter: {
          label: topCounty,
          predicate: p => p.county === topCounty,
          sortBy: 'score',
        },
      });
    }

    if (signals.length === 0) {
      el.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">No signals this cycle.</div>`;
      return;
    }

    el.innerHTML = signals.map((s, i) => {
      __signalIndex.set(i, s.filter);
      return `
        <div class="fc-signal fc-signal-clickable" role="button" tabindex="0"
             onclick="fcApplyListingsFilter(${i})"
             onkeydown="if(event.key==='Enter'||event.key===' ')fcApplyListingsFilter(${i})"
             title="Click to view ${escapeAttr(s.filter.label)} in Listings">
          <div class="fc-signal-head">
            <span class="fc-pill ${s.type}">${escapeHtml(s.tag)}</span>
            <span class="fc-mono fc-signal-time">${escapeHtml(s.time)}</span>
          </div>
          <div class="fc-signal-body"><strong>${escapeHtml(s.who)}</strong> ${escapeHtml(s.what)}</div>
          <div class="fc-signal-ctx">${escapeHtml(s.ctx)}</div>
          <div class="fc-signal-cta">View ${escapeHtml(s.filter.label)} →</div>
        </div>
      `;
    }).join('');
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── Property drawer — full profile slide-over ─────────────────────────
  // Exposed on window so inline onclick handlers (203(k) rows, etc.) and
  // the legacy foreclosure-scout.html map-pin click path can route here
  // instead of showing the older legacy drawer.
  window.openPropertyDrawer = openPropertyDrawer;

  // Quick-filter handlers for the Listings view dropdowns.
  window.fcSetListingsFilter = function(group, value) {
    if (group === 'type')     __listingsTypeFilter = value || '';
    if (group === 'property') __listingsPropertyFilter = value || '';
    if (group === 'source')   __listingsSourceFilter = value || '';
    if (window.__fcData) renderListings(window.__fcData);
  };
  window.fcClearListingsFilters = function() {
    __listingsTypeFilter = '';
    __listingsPropertyFilter = '';
    __listingsSourceFilter = '';
    const ids = ['fc-qf-type', 'fc-qf-property', 'fc-qf-source'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (window.__fcData) renderListings(window.__fcData);
  };
  window.closePropertyDrawer = closePropertyDrawer;

  function openPropertyDrawer(propId) {
    const data = window.__fcData;
    if (!data) return;
    const p = (data.foreclosures || []).find(x => x.id === propId);
    if (!p) return;

    // Create or reuse drawer container
    let drawer = document.getElementById('fc-drawer');
    let backdrop = document.getElementById('fc-drawer-backdrop');
    if (!drawer) {
      backdrop = document.createElement('div');
      backdrop.id = 'fc-drawer-backdrop';
      backdrop.className = 'fc-drawer-backdrop';
      backdrop.onclick = closePropertyDrawer;
      document.body.appendChild(backdrop);

      drawer = document.createElement('aside');
      drawer.id = 'fc-drawer';
      drawer.className = 'fc-drawer';
      document.body.appendChild(drawer);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePropertyDrawer();
      });
    }

    // Re-apply Zillow overrides fresh on each drawer open, in case the
    // user saved values in a previous session.
    applyZillowOverrides(p);
    drawer.innerHTML = renderDrawerContent(p);
    // Wire close button
    const closeBtn = drawer.querySelector('#fc-drawer-close');
    if (closeBtn) closeBtn.onclick = closePropertyDrawer;

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      drawer.classList.add('open');
    });

    // Initialize the embedded Street View + Map using the already-loaded
    // JS API (avoids needing Street View Static API or Maps Embed API as
    // separate activations).
    initDrawerMedia(p);

    // Kick off async sections — AI analysis, property intel, offer letter.
    // All three call global functions defined in foreclosure-scout.html's
    // main <script>; they fail gracefully if any API key is missing.
    initDrawerAsyncSections(p);

    // Wire the Share section buttons (Copy link + native Share).
    wireDrawerShareButtons(p);

    // Wire the Title & Liens save/clear buttons.
    wireDrawerLiens(p);

    // Fire-and-forget fetch of county assessor data (renders when ready).
    // wireDrawerAssessor also re-renders auction metrics once the assessor
    // cache is populated (so Bid-vs-Assessed unlocks for Winchester etc.).
    wireDrawerAssessor(p);

    // Fire-and-forget AI roof analysis from satellite imagery.
    wireDrawerRoof(p);

    // Render the auction-metrics panel synchronously from current saved bid.
    // It re-renders after the assessor data lands (handled inside
    // wireDrawerAssessor) so Bid-vs-Assessed populates without a manual save.
    renderAuctionMetrics(p);
  }

  function wireDrawerShareButtons(p) {
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const copyBtn = document.getElementById(`fc-share-copy-${sanitizedId}`);
    const nativeBtn = document.getElementById(`fc-share-native-${sanitizedId}`);
    const feedback  = document.getElementById(`fc-share-feedback-${sanitizedId}`);
    const share = buildShareContent(p);

    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(share.url);
          if (feedback) {
            feedback.textContent = '✓ Link copied';
            setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2000);
          }
        } catch (e) {
          // Fallback for very old browsers: use execCommand.
          const ta = document.createElement('textarea');
          ta.value = share.url;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (_) { /* no-op */ }
          document.body.removeChild(ta);
          if (feedback) feedback.textContent = '✓ Link copied';
        }
      };
    }

    // Reveal native share on browsers that support it (mostly mobile + some
    // desktop Chrome/Safari). Gives access to WhatsApp, iMessage, Airdrop,
    // and any other installed share target.
    if (nativeBtn && typeof navigator.share === 'function') {
      nativeBtn.style.display = '';
      nativeBtn.onclick = async () => {
        try {
          await navigator.share({
            title: share.subject,
            text: share.smsBody,
            url: share.url,
          });
        } catch (e) { /* user cancelled */ }
      };
    }
  }

  async function initDrawerAsyncSections(p) {
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');

    // AI analysis (Gemini 2-sentence opportunity/risk)
    const aiEl = document.getElementById(`fc-drawer-ai-${sanitizedId}`);
    if (aiEl && typeof window.callGemini === 'function') {
      const cf    = p.cashFlow || 0;
      const cfStr = (cf >= 0 ? '+' : '') + '$' + cf.toLocaleString();
      const rn    = p.rentSource === 'HUD FMR' ? 'Rent validated by HUD Fair Market Rent. ' : '';
      const tags  = Array.isArray(p.tags) ? p.tags.join(', ') : '';
      try {
        const analysis = await window.callGemini(
          `2 sentences only. One biggest opportunity, one biggest risk for this DC/MD/VA foreclosure. Be specific.
${p.address}, ${p.city} ${p.state} | ${p.listingType || 'Trustee Sale'} via ${p.source}
Price: $${(p.price || 0).toLocaleString()} | ARV: $${(p.arv || 0).toLocaleString()} | Rehab: $${(p.rehabEstimate || 0).toLocaleString()}
Cash Flow: ${cfStr}/mo | Cap Rate: ${p.capRate || 0}% | Score: ${p.score || 0}/100
${rn}Tags: ${tags}
Return ONLY the 2-sentence analysis.`,
          'You are a seasoned real estate investor. Direct, specific, concise. No labels, no preamble.'
        );
        aiEl.className = 'ai-box';
        aiEl.textContent = analysis;
      } catch (e) {
        aiEl.className = 'ai-box';
        aiEl.textContent = 'AI analysis unavailable. Review the metrics above for deal assessment.';
      }
    }

    // Property intelligence (Street View + FEMA + Census + BLS)
    if (typeof window.loadPropertyIntelligence === 'function') {
      try {
        await window.loadPropertyIntelligence(p, `fc-drawer-intel-${sanitizedId}`);
      } catch (e) {
        const intelEl = document.getElementById(`fc-drawer-intel-${sanitizedId}`);
        if (intelEl) intelEl.innerHTML = '<div style="font-family:IBM Plex Mono,monospace;font-size:10px;color:var(--muted);padding:10px">Property intelligence unavailable.</div>';
      }
    }

    // Offer letter (Gemini-drafted)
    if (typeof window.generateOfferLetter === 'function') {
      try {
        await window.generateOfferLetter(p);
      } catch (e) { /* generateOfferLetter handles its own failure state */ }
    }
  }

  function initDrawerMedia(p) {
    if (!window.google || !window.google.maps) {
      // JS Maps API not ready yet — retry briefly, then give up silently.
      let retries = 10;
      const waitForMaps = setInterval(() => {
        if (window.google && window.google.maps) {
          clearInterval(waitForMaps);
          initDrawerMedia(p);
        } else if (--retries <= 0) {
          clearInterval(waitForMaps);
          console.warn('[FC Drawer] Google Maps JS API never loaded');
        }
      }, 200);
      return;
    }
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const mapEl = document.getElementById(`fc-drawer-map-${sanitizedId}`);
    const svEl  = document.getElementById(`fc-drawer-sv-${sanitizedId}`);

    const hasCoords = p.lat && p.lng && (typeof p.lat === 'number') && (typeof p.lng === 'number');
    const locate = (cb) => {
      if (hasCoords) { cb({ lat: p.lat, lng: p.lng }); return; }
      const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: fullAddress }, (results, status) => {
          if (status === 'OK' && results[0]) {
            const loc = results[0].geometry.location;
            cb({ lat: loc.lat(), lng: loc.lng() });
          } else {
            cb(null);
          }
        });
      } catch (e) { cb(null); }
    };

    locate((coords) => {
      if (!coords) {
        if (mapEl) mapEl.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:12px">Map unavailable for this address.</div>`;
        showSvFallback(svEl);
        return;
      }
      renderDrawerMap(mapEl, coords, p);
      renderDrawerStreetView(svEl, coords);
    });
  }

  function renderDrawerMap(el, coords, p) {
    if (!el) return;
    const map = new google.maps.Map(el, {
      center: coords,
      zoom: 16,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
    });
    new google.maps.Marker({
      position: coords,
      map,
      title: p.address,
      icon: {
        path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
        fillColor: '#D4A93A',
        fillOpacity: 1,
        strokeColor: '#0E1728',
        strokeWeight: 1.5,
        scale: 1.6,
        anchor: new google.maps.Point(12, 22),
      },
    });
  }

  function renderDrawerStreetView(el, coords) {
    if (!el) return;
    const svService = new google.maps.StreetViewService();
    // Progressive search: try a close radius first for accuracy, then
    // expand if nothing's found. 50m misses addresses inside gated
    // communities or rural private drives where the nearest public
    // Street View imagery can be hundreds of meters away.
    const attempt = (radii) => {
      if (!radii.length) {
        showSvFallback(el);
        return;
      }
      const [radius, ...rest] = radii;
      svService.getPanorama({ location: coords, radius, source: 'outdoor' }, (data, status) => {
        if (status !== 'OK' || !data || !data.location) {
          attempt(rest);
          return;
        }
        new google.maps.StreetViewPanorama(el, {
          pano: data.location.pano,
          pov: { heading: computeHeadingToward(data.location.latLng, coords), pitch: 5 },
          zoom: 0.6,
          addressControl: false,
          linksControl: false,
          panControl: true,
          enableCloseButton: false,
          fullscreenControl: true,
          zoomControl: true,
          motionTracking: false,
          motionTrackingControl: false,
        });
      });
    };
    attempt([100, 300, 800]);
  }

  function computeHeadingToward(fromLatLng, toCoords) {
    // Aim Street View camera toward the target address from the nearest
    // pano location — otherwise it can point backward or sideways.
    try {
      const to = new google.maps.LatLng(toCoords.lat, toCoords.lng);
      return google.maps.geometry && google.maps.geometry.spherical
        ? google.maps.geometry.spherical.computeHeading(fromLatLng, to)
        : 0;
    } catch (e) { return 0; }
  }

  function showSvFallback(el) {
    if (!el) return;
    el.style.display = 'none';
    const fb = el.nextElementSibling;
    if (fb && fb.classList.contains('fc-streetview-fallback')) {
      fb.style.display = 'flex';
    }
  }

  function closePropertyDrawer() {
    const drawer = document.getElementById('fc-drawer');
    const backdrop = document.getElementById('fc-drawer-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function renderDrawerContent(p) {
    const pr = p.pricing || {};
    const conf = pr.confidence || '';
    const confTier = conf.split('—')[0].trim();
    const confSource = conf.split('—')[1] ? conf.split('—')[1].trim() : '';

    const rehabEstimate = p.rehabEstimate || Math.round((pr.arv || 0) * 0.08);
    const passes70 = pr.passes_70_rule;
    const gap = (p.price || 0) - (pr.mao_70 || 0);

    // Source-specific closing playbook
    const isHUD = p.source === 'HUD HomeStore';

    const GMAPS_KEY = window.GOOGLE_MAPS_API_KEY || '';
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    const encAddr = encodeURIComponent(fullAddress);
    // Interactive Street View + Map — both rendered via the JS API that's
    // already enabled for the main app. Avoids needing Street View Static
    // API or Maps Embed API as separate activations.
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const mapDivId = `fc-drawer-map-${sanitizedId}`;
    const svDivId  = `fc-drawer-sv-${sanitizedId}`;

    // HUD.gov deep-link removed — HUD's search page doesn't reliably land
    // on the right property by case number. Trustee-source URLs still work.
    const listingUrl = isHUD ? '' : (p.source_url || '');
    const openOnGMaps = `https://www.google.com/maps/search/?api=1&query=${encAddr}`;
    const addressSlug = (p.address || '').replace(/\s+/g, '-');
    const citySlug = (p.city || '').replace(/\s+/g, '-');
    const zillowUrl  = `https://www.zillow.com/homes/${addressSlug},-${citySlug},-${p.state || 'VA'}-${p.zip || ''}_rb/`;
    const playbook = isHUD ? {
      title: 'HUD REO Purchase',
      icon: 'H',
      steps: [
        'Get mortgage preapproval or proof of funds',
        'Submit sealed bid via HUDHomeStore.gov (investor period after 15-day owner-occupant window)',
        'If accepted: sales docs within 48 hours',
        'Close on HUD-contracted settlement date (typically 30-45 days)',
      ],
      notes: 'Property sold as-is. FHA financing may apply (see FHA status below). Earnest deposit is forfeited if investor walks.',
    } : {
      title: 'VA Trustee Sale',
      icon: 'T',
      steps: [
        'Research: title search + drive-by + ARV comps (30-45 days pre-sale)',
        'Sale day: certified funds for 10% deposit; cash-only auction on courthouse steps',
        'Winning bid: pay remaining balance in full within 24 hours',
        'Trustee\'s Deed recorded 3-14 days later',
        'Eviction (if occupied): 5-day notice + unlawful detainer',
      ],
      notes: 'Cash-only purchase. Property as-is with occupants (if any). Quiet title action strongly recommended post-purchase ($1.5-5K, 60-120 days).',
    };

    return `
      <div class="fc-drawer-head">
        <button id="fc-drawer-close" class="fc-drawer-close" aria-label="Close">×</button>
        <div class="fc-drawer-hero">
          <div class="fc-drawer-hero-left">
            ${gradeBadgeLarge(p.grade)}
          </div>
          <div class="fc-drawer-hero-body">
            <div class="fc-drawer-address">${escapeHtml(p.address || '—')}</div>
            <div class="fc-drawer-subaddr">${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')} · ${escapeHtml(p.county || '')}</div>
            <div class="fc-drawer-tags">
              <span class="fc-pill ink">${escapeHtml(p.source || '')}</span>
              ${confTier ? `<span class="fc-pill ${confTier === 'HIGH' ? 'gold' : confTier === 'MEDIUM' ? 'sky' : ''}">${escapeHtml(confTier)} conf</span>` : ''}
              ${rule70Pill(p)}
              ${p.days_to_sale != null ? `<span class="fc-pill ${p.days_to_sale <= 7 ? 'coral' : ''}">${p.days_to_sale <= 0 ? 'Sale today' : p.days_to_sale + 'd to sale'}</span>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="fc-drawer-body">
        <div class="fc-drawer-media">
          <div id="${escapeAttr(svDivId)}" class="fc-streetview"></div>
          <div class="fc-streetview-fallback">
            <div class="fc-eyebrow" style="margin-bottom:6px">Street view unavailable</div>
            <div style="font-size:12px;color:var(--muted)">No Street View coverage for this address — try the map below or search the photo links.</div>
          </div>
        </div>

        <div class="fc-drawer-map-wrap">
          <div id="${escapeAttr(mapDivId)}" class="fc-map-embed"></div>
        </div>

        <div class="fc-drawer-media-actions">
          <div class="fc-eyebrow" style="margin-bottom:8px">Photos & external listings</div>
          <div class="fc-media-btnrow">
            ${listingUrl ? `
              <a href="${escapeAttr(listingUrl)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm fc-btn-gold">
                ${isHUD ? 'HUD.gov listing (photos) →' : 'Source listing →'}
              </a>` : ''}
            <a href="${escapeAttr(zillowUrl)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">Zillow →</a>
            <a href="${escapeAttr(openOnGMaps)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">Google Maps →</a>
          </div>
          ${!isHUD ? `
            <div class="fc-media-note">
              Trustee-sale properties rarely have official photos. Zillow often has prior listing photos if the property sold retail in the last 5-10 years.
            </div>
          ` : ''}
        </div>

        ${section('Deal summary', `
          ${kvRow('Purchase Price', '$' + (p.price || 0).toLocaleString())}
          ${kvRow('After Repair Value (ARV)', '$' + (p.arv || 0).toLocaleString())}
          ${kvRow('Rehab Estimate (8% ARV)', '$' + rehabEstimate.toLocaleString())}
          ${kvRow('MAO — 70% Rule', '$' + (pr.mao_70 || 0).toLocaleString())}
          ${kvRow('Gap to MAO', (gap <= 0 ? '−' : '+') + '$' + Math.abs(gap).toLocaleString(),
                  gap <= 0 ? 'sage' : 'coral', gap <= 0 ? '✓ clears 70% rule' : '⚠ above max offer')}
          ${kvRow('Discount to ARV', (pr.discount_to_arv || 0).toFixed(1) + '%', (pr.discount_to_arv || 0) >= 25 ? 'sage' : 'muted')}
        `)}

        ${section('Rental financials', `
          ${kvRow('Monthly Rent', '$' + (p.monthlyRent || 0).toLocaleString(), 'ink', p._zillowValidated ? 'Zillow Rent Zestimate ✓' : 'Heuristic (0.7% of ARV)')}
          ${kvRow('Cash Flow', '$' + (p.cashFlow || 0).toLocaleString() + '/mo', (p.cashFlow || 0) > 0 ? 'sage' : 'coral')}
          ${kvRow('Cap Rate', (p.capRate || 0) + '%')}
          ${kvRow('DSCR', ((p._zillowValidated ? p.dscr : pr.dscr) || 0).toFixed(2),
                  ((p._zillowValidated ? p.dscr : pr.dscr) || 0) >= 1.25 ? 'sage' : ((p._zillowValidated ? p.dscr : pr.dscr) || 0) >= 1.0 ? 'muted' : 'coral',
                  ((p._zillowValidated ? p.dscr : pr.dscr) || 0) >= 1.25 ? 'BRRRR-ready' : ((p._zillowValidated ? p.dscr : pr.dscr) || 0) >= 1.0 ? 'Covers mortgage' : 'Negative leverage')}
          ${kvRow('Investment Score', (p.score || 0) + ' / 100')}
        `)}

        ${zillowLookupSection(p, zillowUrl, sanitizedId)}

        ${section('AI analysis', `
          <div class="ai-box loading" id="fc-drawer-ai-${sanitizedId}">
            <div class="spinner"></div>Generating AI analysis...
          </div>
        `)}

        ${section('Property intelligence', `
          <div id="fc-drawer-intel-${sanitizedId}">
            <div class="data-loading">
              <div class="spinner"></div>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:10px">Loading Street View · FEMA · Census · BLS...</span>
            </div>
          </div>
        `)}

        ${section('Property details', `
          ${kvRow('Beds / Baths', `${p.beds || 0}bd / ${p.baths || 0}ba`)}
          ${kvRow('Square Footage', (p.sqft || 0).toLocaleString() + ' sf')}
          ${kvRow('Year Built', p.yearBuilt || p.year_built || '—')}
          ${kvRow('Property Type', p.property_type || '—')}
          ${p.lot_size ? kvRow('Lot Size', (p.lot_size || 0).toLocaleString() + ' sf') : ''}
        `)}

        ${section('Sale', `
          ${kvRow('Sale Date', p.sale_date || p.sale_date_raw || '—')}
          ${kvRow('Sale Time', p.sale_time || '—')}
          ${kvRow('Location', p.sale_location || '—')}
          ${kvRow('Status', p.status || 'Active')}
          ${p.days_to_sale != null ? kvRow('Days to Sale', p.days_to_sale <= 0 ? 'Today / past' : p.days_to_sale + ' days',
                                          p.days_to_sale <= 7 && p.days_to_sale >= 0 ? 'coral' : 'ink') : ''}
        `)}

        ${isHUD ? section('HUD details', `
          ${p.hud_fha ? kvRow('FHA Financing', escapeHtml(p.hud_fha),
                              (p.hud_fha || '').startsWith('IN') ? 'sage' : 'muted') : ''}
          ${p.hud_list_date ? kvRow('Listed', escapeHtml(p.hud_list_date)) : ''}
          ${p.hud_bid_open ? kvRow('Bid Opens', escapeHtml(p.hud_bid_open)) : ''}
          ${p.hud_deadline ? kvRow('Period Deadline', escapeHtml(p.hud_deadline)) : ''}
        `) : ''}

        ${section('Source', `
          ${kvRow('Trustee / Firm', p.source || '—')}
          ${p.firm_file_number ? kvRow('File Number', p.firm_file_number) : ''}
          ${listingUrl ? `
            <div class="fc-kv">
              <a href="${escapeAttr(listingUrl)}" target="_blank" rel="noopener"
                 style="color:var(--gold-ink);font-size:12px;font-weight:500">
                View source listing →
              </a>
            </div>` : ''}
          ${isHUD ? '<div class="fc-kv-caption" style="margin-top:6px;color:var(--muted);font-size:11px">Search this case number directly at hudhomestore.gov to see photos, disclosures, and submit a bid.</div>' : ''}
        `)}

        ${ownershipSection(p)}

        ${assessorIntelSection(p)}

        ${roofIntelSection(p)}

        ${crossPlatformSection(p)}

        ${auctionSection(p)}

        ${liensSection(p)}

        ${neighborhoodSection(p)}

        ${(() => {
          const s = buildShareContent(p);
          const subject = encodeURIComponent(s.subject);
          const body    = encodeURIComponent(s.body);
          const smsBody = encodeURIComponent(s.smsBody);
          const emailHref = `mailto:?subject=${subject}&body=${body}`;
          const smsHref   = `sms:?&body=${smsBody}`;
          const shortUrl = s.url.replace(/^https?:\/\//, '');
          const typeBadge = typePill(p.listingType);
          const priceStr = '$' + (p.price || 0).toLocaleString();
          const arvStr   = '$' + (p.arv || 0).toLocaleString();
          const discountStr = (p.discount || 0) + '%';
          return section('Share this property', `
            <div class="fc-share-card">
              <!-- Preview card (what recipient sees) -->
              <div class="fc-share-preview">
                <div class="fc-share-preview-head">
                  ${gradeBadge(p.grade)}
                  <div style="flex:1;min-width:0">
                    <div class="fc-share-preview-addr" title="${escapeAttr(p.address || '')}">${escapeHtml(p.address || '—')}</div>
                    <div class="fc-share-preview-sub">
                      ${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')}
                    </div>
                  </div>
                  ${typeBadge}
                </div>
                <div class="fc-share-preview-stats">
                  <div class="fc-share-stat">
                    <div class="fc-share-stat-val">${priceStr}</div>
                    <div class="fc-share-stat-key">Price</div>
                  </div>
                  <div class="fc-share-stat">
                    <div class="fc-share-stat-val">${arvStr}</div>
                    <div class="fc-share-stat-key">ARV</div>
                  </div>
                  <div class="fc-share-stat">
                    <div class="fc-share-stat-val sage">${discountStr}</div>
                    <div class="fc-share-stat-key">Below ARV</div>
                  </div>
                </div>
                <div class="fc-share-preview-url" id="fc-share-url-${sanitizedId}">
                  <span class="fc-share-url-icon">🔗</span>
                  <span class="fc-share-url-text">${escapeHtml(shortUrl)}</span>
                </div>
              </div>

              <!-- Action tiles -->
              <div class="fc-share-actions">
                <a class="fc-share-tile" href="${escapeAttr(emailHref)}">
                  <div class="fc-share-tile-icon">📧</div>
                  <div class="fc-share-tile-label">Email</div>
                </a>
                <a class="fc-share-tile" href="${escapeAttr(smsHref)}">
                  <div class="fc-share-tile-icon">💬</div>
                  <div class="fc-share-tile-label">Text</div>
                </a>
                <button class="fc-share-tile" id="fc-share-copy-${sanitizedId}" type="button">
                  <div class="fc-share-tile-icon">🔗</div>
                  <div class="fc-share-tile-label">Copy link</div>
                </button>
                <button class="fc-share-tile" id="fc-share-native-${sanitizedId}" type="button" style="display:none">
                  <div class="fc-share-tile-icon">📱</div>
                  <div class="fc-share-tile-label">More…</div>
                </button>
              </div>

              <div class="fc-share-feedback" id="fc-share-feedback-${sanitizedId}"></div>
            </div>
          `);
        })()}

        ${section('Mortgage calculator', `
          <div class="calc-section">
            <div class="calc-row">
              <div class="calc-field"><span class="calc-label">Purchase Price ($)</span>
                <input class="calc-input" id="calc-price-${p.id}" type="number" value="${p.price || 0}" oninput="recalcMortgage('${p.id}')"></div>
              <div class="calc-field"><span class="calc-label">Down Payment (%)</span>
                <input class="calc-input" id="calc-down-${p.id}" type="number" value="25" min="3" max="100" oninput="recalcMortgage('${p.id}')"></div>
              <div class="calc-field"><span class="calc-label">Interest Rate (%)</span>
                <input class="calc-input" id="calc-rate-${p.id}" type="number" value="7.0" step="0.1" oninput="recalcMortgage('${p.id}')"></div>
              <div class="calc-field"><span class="calc-label">Monthly Rent ($)</span>
                <input class="calc-input" id="calc-rent-${p.id}" type="number" value="${p.monthlyRent || 0}" oninput="recalcMortgage('${p.id}')"></div>
            </div>
            <div class="calc-result" id="calc-result-${p.id}">
              <div><div class="cr-val ${(p.cashFlow || 0) >= 300 ? 'pos' : (p.cashFlow || 0) < 0 ? 'neg' : 'neu'}" id="cr-cf-${p.id}">${(p.cashFlow || 0) >= 0 ? '+$' : '−$'}${Math.abs(p.cashFlow || 0).toLocaleString()}</div><div class="cr-key">Cash Flow/mo</div></div>
              <div><div class="cr-val neu" id="cr-pi-${p.id}">${p.monthlyPI ? '$' + p.monthlyPI.toLocaleString() : '—'}</div><div class="cr-key">P&I Payment</div></div>
              <div><div class="cr-val neu" id="cr-cap-${p.id}">${p.capRate || 0}%</div><div class="cr-key">Cap Rate</div></div>
            </div>
          </div>
        `)}

        ${section('Offer letter generator', `
          <div class="offer-box loading" id="offer-${p.id}">
            <div class="spinner"></div>Generating offer letter...
          </div>
          <div class="offer-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="offer-btn offer-btn-copy" onclick="copyOffer('${p.id}')">Copy Letter</button>
            <button class="offer-btn offer-btn-regen" onclick="regenOffer('${p.id}')">↻ Regenerate</button>
            <button class="offer-btn" style="background:rgba(45,106,79,0.1);color:var(--green);border-color:rgba(45,106,79,0.3)"
                    onclick="toggleSaveDeal('${p.id}');this.textContent=isSaved('${p.id}')?'★ Saved':'☆ Save Deal'">
              ${typeof isSaved === 'function' && isSaved(p.id) ? '★ Saved' : '☆ Save Deal'}
            </button>
          </div>
        `)}

        ${section(`Closing playbook — ${playbook.title}`, `
          <ol class="fc-playbook">
            ${playbook.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ol>
          <div class="fc-playbook-note">${escapeHtml(playbook.notes)}</div>
        `)}
      </div>
    `;
  }

  // ── Public records & ownership ──────────────────────────────────────────
  // For properties we have owner data on (DC Vacant via ArcGIS layer 80),
  // render the owner block. For all properties, add external deep-links to
  // county assessor + deed/land-records sites so the user can click through
  // to verify owner, tax status, and recorded mortgages.

  // Mapping of state/county → {assessor, deeds} public portal URLs.
  // Some counties don't support query-string presets; those links just open
  // the portal landing page and the user searches manually from there.
  const COUNTY_PORTALS = {
    // ── DC ──
    'DC:District of Columbia': {
      assessor: (p) => `https://mytax.dc.gov/_/#6`, // Real Property Assessment Search
      deeds:    (p) => `https://otr.cfo.dc.gov/page/recorder-deeds-services`,
    },
    // ── VA — Northern Virginia / DC metro ──
    'VA:Fairfax County': {
      assessor: (p) => `https://icare.fairfaxcounty.gov/ffxcare/search/commonsearch.aspx?mode=address`,
      deeds:    () => `https://lisweb.fairfaxcounty.gov/PaxWorld/`,
    },
    'VA:Arlington County': {
      assessor: () => `https://propertysearch.arlingtonva.us/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Loudoun County': {
      assessor: () => `https://lonet.loudoun.gov/assessment/Search.aspx`,
      deeds:    () => `https://lisweb.loudoun.gov/PaxWorld/`,
    },
    'VA:Prince William County': {
      assessor: () => `https://www.pwcva.gov/office/real-estate-assessments`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Alexandria City': {
      assessor: () => `https://realestate.alexandriava.gov/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Falls Church City': {
      assessor: () => `https://www.fallschurchva.gov/1079/Real-Estate-Assessments`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Manassas City': {
      assessor: () => `https://www.manassascity.org/169/Real-Estate-Assessment`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Stafford County': {
      assessor: () => `https://realestate.staffordcountyva.gov/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Spotsylvania County': {
      assessor: () => `https://realestate.spotsylvania.va.us/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Fredericksburg City': {
      assessor: () => `https://www.fredericksburgva.gov/185/Real-Estate-Assessments`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    // ── VA — Shenandoah Valley ──
    'VA:Frederick County': {
      assessor: () => `https://www.fcva.us/commissioner-of-the-revenue/real-estate`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Winchester City': {
      assessor: () => `https://www.winchesterva.gov/assessor`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Rockingham County': {
      assessor: () => `https://www.rockinghamcountyva.gov/261/Real-Estate`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Augusta County': {
      assessor: () => `https://www.co.augusta.va.us/government/commissioner-of-the-revenue`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    // ── VA — Richmond metro ──
    'VA:Chesterfield County': {
      assessor: () => `https://www.chesterfield.gov/176/Real-Estate-Assessment-Database`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Henrico County': {
      assessor: () => `https://realestate.henrico.us/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Hanover County': {
      assessor: () => `https://realestate.hanovercounty.gov/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Richmond City': {
      assessor: () => `https://www.richmondgov.com/Assessor/RealEstate.aspx`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    // ── VA — Hampton Roads ──
    'VA:Virginia Beach City': {
      assessor: () => `https://www.vbgov.com/property-search`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Norfolk City': {
      assessor: () => `https://airassessment.norfolk.gov/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Chesapeake City': {
      assessor: () => `https://www.cityofchesapeake.net/government/city-departments/departments/Real-Estate/index.htm`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Newport News City': {
      assessor: () => `https://realestate.nnva.gov/`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Hampton City': {
      assessor: () => `https://www.hampton.gov/247/Real-Estate-Assessor`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Portsmouth City': {
      assessor: () => `https://www.portsmouthva.gov/195/Real-Estate-Assessor`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    'VA:Suffolk City': {
      assessor: () => `https://www.suffolkva.us/216/Real-Estate-Assessor`,
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    // ── MD ──
    'MD:Montgomery County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    "MD:Prince George's County": {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Howard County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Anne Arundel County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Baltimore County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Baltimore City': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Frederick County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Carroll County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Harford County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    'MD:Charles County': {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
  };

  // Statewide fallbacks when a specific county isn't in the map.
  const STATE_FALLBACKS = {
    VA: {
      assessor: null, // VA has no statewide property search
      deeds:    () => `https://risweb.vacourts.gov/jsra/sra/`,
    },
    MD: {
      assessor: () => `https://sdat.dat.maryland.gov/RealProperty/`,
      deeds:    () => `https://mdlandrec.net/msa/stagsere/s1400/s1401/html/ssearch.html`,
    },
    DC: {
      assessor: () => `https://mytax.dc.gov/_/#6`,
      deeds:    () => `https://otr.cfo.dc.gov/page/recorder-deeds-services`,
    },
  };

  function getCountyPortals(p) {
    const key = `${(p.state || 'VA').toUpperCase()}:${p.county || ''}`;
    const county = COUNTY_PORTALS[key];
    const state = STATE_FALLBACKS[(p.state || 'VA').toUpperCase()] || {};
    // Last-resort fallback: a Google search seeded with the county name +
    // "real estate assessment". Better than no button — user can usually
    // find the correct portal in the first result.
    const googleAssessor = (p.county && p.state)
      ? `https://www.google.com/search?q=${encodeURIComponent(p.county + ' ' + p.state + ' real estate assessment property search')}`
      : null;
    return {
      assessor: county && county.assessor ? county.assessor(p) : (state.assessor ? state.assessor(p) : googleAssessor),
      deeds:    county && county.deeds    ? county.deeds(p)    : (state.deeds    ? state.deeds(p)    : null),
    };
  }

  function ownershipSection(p) {
    const portals = getCountyPortals(p);
    const hasOwner = !!(p.owner_name || p.owner_address || p.assessed_value);

    // Skip the section entirely if there's nothing useful (no owner data + no
    // portal links — unlikely since we have statewide fallbacks).
    if (!hasOwner && !portals.assessor && !portals.deeds) return '';

    const ownerRows = !hasOwner ? '' : `
      ${p.owner_name ? kvRow('Owner', escapeHtml(p.owner_name)) : ''}
      ${p.owner_address ? kvRow('Mailing address', escapeHtml(p.owner_address),
            p.absentee_owner ? 'coral' : 'ink',
            p.absentee_owner ? 'Absentee (out-of-DC)' : '') : ''}
      ${p.assessed_value ? kvRow('Assessed value', '$' + p.assessed_value.toLocaleString()) : ''}
      ${p.tax_class ? kvRow('Tax class', escapeHtml(p.tax_class),
            (p.tax_class || '').includes('3') ? 'coral' : 'muted',
            (p.tax_class || '').includes('3') ? 'Class 3 = blighted (5× tax rate)' : '') : ''}
    `;

    const portalButtons = [];
    if (portals.assessor) {
      portalButtons.push(`
        <a class="fc-btn fc-btn-sm" href="${escapeAttr(portals.assessor)}" target="_blank" rel="noopener">
          🏛️ County assessor
        </a>`);
    }
    if (portals.deeds) {
      portalButtons.push(`
        <a class="fc-btn fc-btn-sm" href="${escapeAttr(portals.deeds)}" target="_blank" rel="noopener">
          📜 Deed / land records
        </a>`);
    }

    const portalRow = portalButtons.length ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:${hasOwner ? '12px' : '0'}">
        ${portalButtons.join('')}
      </div>
      <div class="fc-kv-caption" style="margin-top:6px;color:var(--muted);font-size:10px">
        Search the property address on the county site to verify ownership, tax status, and any recorded mortgage (deed of trust).
      </div>
    ` : '';

    return section('Ownership & public records', ownerRows + portalRow);
  }

  // ── County assessor intelligence ────────────────────────────────────────
  // Placeholder card rendered synchronously; wireDrawerAssessor fires the
  // worker-side fetch and populates it. Returns '' for jurisdictions without
  // a parser so the section self-hides.
  function assessorIntelSection(p) {
    if (!assessorJurisdiction(p)) return '';
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    return section('Assessor intelligence', `
      <div id="fc-assessor-${sid}" style="font-family:var(--f-mono);font-size:12px;color:var(--muted);min-height:40px">
        Loading county assessor data…
      </div>
    `);
  }

  function renderAssessorIntel(container, p, data) {
    const fmt$ = (n) => n ? '$' + Number(n).toLocaleString() : '—';
    const yearsOfHistory = (data.assessment_history || []).length;
    const oldest = data.assessment_history?.[data.assessment_history.length - 1];
    const growthPct = (data.assessed_value && oldest?.total)
      ? Math.round((data.assessed_value - oldest.total) / oldest.total * 100) : null;
    const compsMed = (() => {
      const prices = (data.neighborhood_comps || []).map(c => c.price).filter(Boolean).sort((a, b) => a - b);
      if (!prices.length) return null;
      return prices[Math.floor(prices.length / 2)];
    })();
    // vs heuristic ARV — is the assessor saying we're under/over?
    const heuristic = p.arv || 0;
    const vsHeur = (data.assessed_value && heuristic)
      ? Math.round((data.assessed_value - heuristic) / heuristic * 100) : null;

    const compRows = (data.neighborhood_comps || []).slice(0, 5).map(c =>
      `<tr>
         <td style="padding:3px 6px">${c.date}</td>
         <td style="padding:3px 6px;text-align:right">${fmt$(c.price)}</td>
         <td style="padding:3px 6px;color:var(--muted)">${escapeHtml(c.address || '')}</td>
       </tr>`
    ).join('');

    const historyRows = (data.assessment_history || []).slice(0, 5).map(a =>
      `<tr>
         <td style="padding:3px 6px">${a.date.replace('1/1/','')}</td>
         <td style="padding:3px 6px;text-align:right">${fmt$(a.total)}</td>
         <td style="padding:3px 6px;color:var(--muted);text-align:right">land ${fmt$(a.land)}</td>
       </tr>`
    ).join('');

    const salesRows = (data.sales_history || []).map(s =>
      `<tr>
         <td style="padding:3px 6px">${s.date}</td>
         <td style="padding:3px 6px;text-align:right">${s.price ? fmt$(s.price) : '—'}</td>
         <td style="padding:3px 6px;color:var(--muted)">${escapeHtml(s.grantee || '')}</td>
         <td style="padding:3px 6px;color:var(--muted);font-size:11px">${escapeHtml(s.deed || '')}</td>
       </tr>`
    ).join('');

    // Deed refs — only meaningful when we have a deed book/page and the
    // user actually needs to request docs (Arlington's workflow). Build a
    // clipboard-ready text block per property for a Clerk email.
    const deedRefs = (data.sales_history || []).filter(s => s.deed);
    const hasRefs = deedRefs.length > 0;

    // Tax pill only rendered when we actually know the tax status. Some
    // jurisdictions (e.g. Loudoun open data) don't expose tax info, so the
    // handler returns 'unknown' and we suppress the pill rather than
    // misleadingly claiming taxes are owed.
    const taxPill = data.tax_status === 'paid'
      ? '<span class="fc-pill sage" style="font-size:10px">Tax balance $0 · paid</span>'
      : data.tax_status === 'unknown' || data.tax_balance_due == null
        ? ''
        : `<span class="fc-pill coral" style="font-size:10px">Tax balance ${fmt$(data.tax_balance_due)} · OWED</span>`;
    // Optional structure-use pill (Loudoun) — surfaces "Single Family
    // Detached" / "Townhouse" / etc. when the open data exposes it.
    const structureUsePill = data.raw?.structure_use
      ? `<span class="fc-pill" style="font-size:10px">${escapeHtml(data.raw.structure_use)}</span>`
      : '';
    // Loudoun-specific notice — only shown when the handler flagged the
    // dataset as limited. Tells the user why fields are missing and points
    // them at the auth-walled portal for the rest.
    const limitedNoticeHtml = data.raw?.notice
      ? `<div style="padding:8px 10px;border:1px dashed var(--hair);border-radius:6px;margin-bottom:12px;
                     font-size:11px;color:var(--ink-2);background:var(--paper-2);line-height:1.5">
           <strong>⚠ Limited data:</strong> ${escapeHtml(data.raw.notice)}
         </div>`
      : '';

    container.innerHTML = `
      ${limitedNoticeHtml}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
        <div>
          <div class="fc-eyebrow" style="margin-bottom:3px">Assessed value (${data.assessed_year || ''})</div>
          <div style="font-family:var(--f-serif);font-size:20px;font-weight:600">${fmt$(data.assessed_value)}</div>
          ${vsHeur != null ? `<div style="font-size:11px;color:${vsHeur >= 0 ? 'var(--sage)' : 'var(--coral)'}">
            ${vsHeur >= 0 ? '+' : ''}${vsHeur}% vs heuristic ARV
          </div>` : ''}
        </div>
        <div>
          <div class="fc-eyebrow" style="margin-bottom:3px">Last sale</div>
          <div style="font-family:var(--f-serif);font-size:20px;font-weight:600">${fmt$(data.last_sale_price)}</div>
          <div style="font-size:11px;color:var(--muted)">${data.last_sale_date || '—'}</div>
        </div>
        <div>
          <div class="fc-eyebrow" style="margin-bottom:3px">Median neighbor comp</div>
          <div style="font-family:var(--f-serif);font-size:20px;font-weight:600">${fmt$(compsMed)}</div>
          <div style="font-size:11px;color:var(--muted)">${(data.neighborhood_comps || []).length} recent sales</div>
        </div>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        <span class="fc-pill" style="font-size:10px">${escapeHtml(data.owner_name || 'Owner unknown')}</span>
        <span class="fc-pill" style="font-size:10px">Built ${data.year_built || '—'}</span>
        ${structureUsePill}
        <span class="fc-pill" style="font-size:10px">${(data.total_sqft || '—').toLocaleString()} sqft · ${data.baths_total || '—'} ba</span>
        <span class="fc-pill" style="font-size:10px">Lot ${data.lot_size_sqft ? data.lot_size_sqft.toLocaleString() + ' sqft' : '—'}</span>
        <span class="fc-pill" style="font-size:10px">${escapeHtml(data.zoning || '—')}</span>
        ${taxPill}
        ${growthPct != null ? `<span class="fc-pill" style="font-size:10px">+${growthPct}% assessed in ${yearsOfHistory} yrs</span>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px">
        <div>
          <div class="fc-eyebrow" style="margin-bottom:6px">Recent neighbor sales</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            ${compRows || '<tr><td style="color:var(--muted)">No recent comps</td></tr>'}
          </table>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div class="fc-eyebrow">Property sale history (deed bk/pg)</div>
            ${hasRefs ? `<button id="fc-assessor-copyrefs-${(p.id || 'x').replace(/[^a-z0-9]/gi, '')}"
              class="fc-btn fc-btn-sm fc-btn-ghost" style="font-size:10px;padding:2px 8px">Copy refs</button>` : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            ${salesRows || '<tr><td style="color:var(--muted)">No sale history</td></tr>'}
          </table>
        </div>
      </div>

      <details>
        <summary style="cursor:pointer;font-size:11px;color:var(--muted);font-family:var(--f-mono)">
          Assessment history (${yearsOfHistory} yrs)
        </summary>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
          ${historyRows}
        </table>
      </details>

      <div style="margin-top:12px;font-size:11px;color:var(--muted);font-family:var(--f-mono)">
        <a href="${escapeAttr(data.source_url || '')}" target="_blank" rel="noopener" style="color:var(--muted)">
          Source: ${(() => {
            const j = (assessorJurisdiction(p) || '').toLowerCase();
            return j === 'arlington'  ? 'Arlington County Property Search'
                 : j === 'fairfax'    ? 'Fairfax County Open GIS'
                 : j === 'loudoun'    ? 'Loudoun County WebLogis (open data)'
                 : j === 'pwc'        ? 'Prince William County QuickInfo'
                 : j === 'winchester' ? 'Winchester City GIS (open data)'
                 : 'County records';
          })()} ↗
        </a>
      </div>
    `;

    // Auto-pre-fill the Liens form's senior holder + search URL if user
    // hasn't typed anything — saves one manual step in the workflow.
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const holderEl = document.getElementById(`fc-liens-holder-${sid}`);
    const searchUrlEl = document.getElementById(`fc-liens-search-url-${sid}`);
    if (holderEl && !holderEl.value && data.owner_name) {
      holderEl.placeholder = `Search deeds for: ${data.owner_name}`;
    }
    if (searchUrlEl && !searchUrlEl.value && data.source_url) {
      searchUrlEl.placeholder = data.source_url;
    }

    // Wire the Copy-refs button — emits a clipboard-ready email body
    // the user can paste to the Arlington Clerk to request documents.
    const copyBtn = document.getElementById(`fc-assessor-copyrefs-${sid}`);
    if (copyBtn && hasRefs) {
      copyBtn.onclick = async () => {
        const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
        const lines = [
          `Document request — ${addr}`,
          `Owner: ${data.owner_name || ''}`,
          `Property: ${data.legal_description || ''}`,
          '',
          'Recorded transactions per Arlington Property Search:',
          ...deedRefs.map(s => `  ${s.date}  Deed Bk/Pg ${s.deed}  ·  ${s.grantee || ''}  ${s.code ? '('+s.code+')' : ''}`.trim()),
          '',
          `Requesting copies of all deeds of trust, releases, and any judgment liens recorded against the property or ${data.owner_name || 'owner'} since ${(deedRefs[0] && deedRefs[0].date) || 'the last sale'}.`,
        ].join('\n');
        try {
          await navigator.clipboard.writeText(lines);
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy refs'; }, 2000);
        } catch (e) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(() => { copyBtn.textContent = 'Copy refs'; }, 2000);
        }
      };
    }
  }

  // Module-level cache so the Judgment-search button can read the owner
  // name even though the lien section renders before the assessor section
  // resolves (assessor is an async fetch).
  const assessorIntelCache = new Map();

  async function wireDrawerAssessor(p) {
    if (!assessorJurisdiction(p)) return;
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const container = document.getElementById(`fc-assessor-${sid}`);
    if (!container) return;

    if (!getZillowSyncToken()) {
      container.innerHTML = '<span style="color:var(--muted)">Paste sync token in Settings to enable assessor data.</span>';
      return;
    }

    const res = await fetchAssessorIntel(p);
    if (!res.ok) {
      container.innerHTML = `<span style="color:var(--muted)">Assessor data unavailable: ${escapeHtml(res.reason)}</span>`;
      return;
    }
    assessorIntelCache.set(p.id, res.data);
    // Refresh the judgment-search hint now that we know the owner.
    const hintEl = document.getElementById(`fc-judgment-hint-${sid}`);
    if (hintEl && res.data && res.data.owner_name) {
      hintEl.textContent = `Search owner: ${res.data.owner_name}`;
      hintEl.dataset.owner = res.data.owner_name;
    }
    renderAssessorIntel(container, p, res.data);
    // The auction metrics panel needs assessed_value to render the
    // "vs Assessed" tile. Now that we have it, re-render that panel.
    if (typeof renderAuctionMetrics === 'function') renderAuctionMetrics(p);
  }

  // Click handler for the Judgment search button. Opens the state-specific
  // court portal in a new tab AND copies the property owner's name to the
  // clipboard (when available from assessor cache) so the user can paste
  // straight into the search form instead of typing it.
  window.fcOpenJudgmentSearch = function(propId, portalUrl) {
    const intel = assessorIntelCache.get(propId);
    const ownerName = (intel && intel.owner_name) ? String(intel.owner_name).trim() : '';
    if (ownerName && navigator.clipboard) {
      navigator.clipboard.writeText(ownerName).catch(() => {});
    }
    window.open(portalUrl, '_blank', 'noopener');
  };

  // ── Title & Liens: deep-links + manually-entered findings ─────────────
  // Surfaces the county deeds/land-records URL + a Google search for
  // judgments, then a simple form to record what the user finds. Saves
  // to localStorage (instant) + syncs to nestscoop-api D1 (cross-device).
  // sanitizedId ensures form element ids are unique per-property in case
  // multiple drawers are ever rendered back-to-back.
  function liensSection(p) {
    const portals = getCountyPortals(p);
    const saved = getLiens(p.id) || {};
    const sanitizedId = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const sid = sanitizedId; // shorthand for id template keys
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    // Per-state court portal where civil JUDGMENTS docket against the owner.
    // VA is non-judicial for foreclosure, so the deed-of-trust + most lien
    // recordings (mechanic's, HOA, IRS NFTL, lis pendens) live in Land
    // Records, NOT here — see the Deeds button. OCIS catches the personal
    // judgments (credit card, medical, divorce decrees) that become real
    // property liens once docketed.
    const stateUp = (p.state || '').toUpperCase();
    const judgmentPortal =
      stateUp === 'VA' ? 'https://eapps.courts.state.va.us/ocis/' :
      stateUp === 'DC' ? 'https://eaccess.dccourts.gov/eaccess/' :
      stateUp === 'MD' ? 'https://casesearch.courts.state.md.us/casesearch/' :
      null;
    // PACER bankruptcy index — bankruptcy auto-stays foreclosure and can
    // void junior liens, so it's a critical title check separate from the
    // state civil-judgment search. Free name lookup (registration required,
    // case index free, document downloads cost). The "1" jurisdiction code
    // narrows to bankruptcy courts (4th Circuit covers VA + MD + DC).
    const pacerSearch = `https://pcl.uscourts.gov/pcl/index.jsf`;
    // County / municipal property tax + treasurer (delinquent RE tax,
    // water/sewer arrears, code-enforcement liens). Per-state primary
    // entry points; deeper county-specific links could be added later.
    const taxSearchDC = p.state === 'DC' ? `https://mytax.dc.gov/_/` : null;
    const taxSearchMD = p.state === 'MD' ? `https://sdat.dat.maryland.gov/RealProperty/` : null;
    // Per-county direct treasurer / RE tax portals when known. Falls back
    // to a Google query for unmapped counties so the button still works.
    const VA_TREASURER_URLS = {
      'Arlington County':       'https://taxes.arlingtonva.us/RealEstate/Search',
      'Fairfax County':         'https://icare.fairfaxcounty.gov/ffxcare/search/CommonSearch.aspx?mode=realtaxes',
      'Fairfax City':           'https://www.fairfaxva.gov/government/finance/real-estate-tax-rates-due-dates',
      'Loudoun County':         'https://www.loudoun.gov/2153/Pay-Real-Estate-Tax-Online',
      'Prince William County':  'https://www.pwcva.gov/department/finance/real-estate-assessments',
      'Stafford County':        'https://www.staffordcountyva.gov/186/Treasurer',
      'Spotsylvania County':    'https://www.spotsylvania.va.us/171/Treasurer',
      'Alexandria City':        'https://www.alexandriava.gov/Finance',
      'Manassas City':          'https://www.manassascity.org/169/Real-Estate-Assessment',
      'Manassas Park City':     'https://www.cityofmanassaspark.us/180/Treasurer',
      'Falls Church City':      'https://www.fallschurchva.gov/1078/Treasurer',
      'Fauquier County':        'https://www.fauquiercounty.gov/government/departments-h-z/treasurer',
      'Winchester City':        'https://www.winchesterva.gov/government/city-departments/treasurer',
      'Frederick County':       'https://www.fcva.us/departments/treasurer',
    };
    const taxSearchVA = stateUp === 'VA'
      ? (VA_TREASURER_URLS[p.county]
          || `https://www.google.com/search?q=${encodeURIComponent((p.county || '') + ' VA real estate tax payment portal')}`)
      : null;

    const v = (k, def='') => saved[k] != null ? saved[k] : def;
    const num = (k) => saved[k] != null ? saved[k] : '';
    const seniorLoanFromNotice = p.pricing && p.pricing.original_loan;

    // Status pill rendered inside the body — section() escapes the title
    // string, so HTML tags in the section header get shown as literal text.
    const headerRight = saved.updated_at
      ? `<span class="fc-pill ${saved.clear_title ? 'sage' : ''}" style="font-size:10px">
           ${saved.clear_title ? 'Clear title' : 'Encumbrances logged'}
           · ${new Date(saved.updated_at).toLocaleDateString()}
         </span>`
      : `<span class="fc-pill" style="font-size:10px">Not yet searched</span>`;
    const statusBar = `<div style="margin-bottom:10px">${headerRight}</div>`;

    // Deep-link buttons — open county sites in new tabs
    const linkBtn = (label, href) => href
      ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">${escapeHtml(label)} ↗</a>`
      : '';

    // Arlington Circuit Court isn't on the VA statewide SRA and doesn't
    // publish a free public deed search — requests go through the Clerk.
    // Suppress the generic "Deeds" button and surface the actionable path.
    const isArlington = p.state === 'VA' && p.county === 'Arlington County';
    const arlingtonNote = isArlington ? `
      <div style="padding:10px 12px;border:1px dashed var(--hair);border-radius:6px;margin-bottom:12px;
                  font-size:12px;color:var(--ink-2);background:var(--paper-2);line-height:1.5">
        <strong>Arlington deeds:</strong> Circuit Court Clerk does not publish online.
        Use the <em>Deed Bk/Pg refs</em> from Property sale history (in the Assessor card above)
        and request documents from the Clerk.
        <div style="margin-top:4px;color:var(--muted);font-size:11px">
          Phone <a href="tel:+17032287010">703-228-7010</a> ·
          Email <a href="mailto:clerkoffice@arlingtonva.us">clerkoffice@arlingtonva.us</a> ·
          1425 N Courthouse Rd
        </div>
      </div>` : '';

    // Civil judgments (state OCIS) — auto-copies owner name to clipboard
    // at click time so user can paste-and-search instead of typing.
    const judgmentBtnHtml = judgmentPortal
      ? `<button class="fc-btn fc-btn-sm" type="button"
                 onclick="window.fcOpenJudgmentSearch('${escapeAttr(p.id)}', '${escapeAttr(judgmentPortal)}')">
           Civil judgments (${stateUp === 'VA' ? 'OCIS' : stateUp === 'DC' ? 'eAccess' : 'Casesearch'}) ↗
         </button>`
      : '';
    const judgmentLabelText = stateUp === 'VA'
      ? 'VA OCIS · Circuit Court · search by name'
      : stateUp === 'DC'
        ? 'DC Courts eAccess · search by name'
        : stateUp === 'MD'
          ? 'MD Casesearch · search by name'
          : '';
    const judgmentHintHtml = judgmentPortal ? `
      <div id="fc-judgment-hint-${sid}" style="font-size:11px;color:var(--muted);margin:-2px 0 4px 0;font-family:var(--f-mono)">
        ${escapeHtml(judgmentLabelText)} — owner name auto-copies on click.
      </div>` : '';

    // Methodology tooltip: VA is a non-judicial foreclosure state, so the
    // typical "judgment search" idiom from FL/NY doesn't fully apply here.
    // This explains the multi-source title-search stack so the user knows
    // why we surface OCIS + PACER + Land Records + Treasurer separately.
    const titleStackTooltip = `
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-size:11px;color:var(--accent2);font-family:var(--f-mono);user-select:none">
          ⓘ Where do liens actually live? (VA is non-judicial)
        </summary>
        <div style="margin-top:8px;padding:10px 12px;background:var(--paper-2);border-radius:6px;font-size:11px;line-height:1.6;color:var(--ink-2)">
          VA is a <strong>non-judicial foreclosure state</strong> — foreclosures run through the trustee under the Deed of Trust, not court. So the standard "judgment search" only catches one slice of liens. Full title-search stack:
          <ul style="margin:6px 0 0 0;padding-left:16px">
            <li><strong>Land Records</strong> (Deeds button) — DOTs, releases, mechanic's, HOA, IRS NFTL, state tax liens, lis pendens</li>
            <li><strong>Civil judgments</strong> (OCIS / eAccess / Casesearch) — personal judgments against owner that docket as real-property liens (credit card, medical, divorce decrees)</li>
            <li><strong>PACER</strong> — bankruptcy filings (4th Circuit, VA Eastern + Western Districts)</li>
            <li><strong>Treasurer</strong> — delinquent RE tax, water/sewer, code-enforcement liens</li>
          </ul>
          <div style="margin-top:6px;color:var(--muted)">For a clear title, all four should come back empty (or with releases). For Arlington, Land Records is offline — request from the Clerk via phone/email.</div>
        </div>
      </details>
    `;

    const links = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        ${isArlington ? '' : linkBtn('Deeds / Land records', portals.deeds)}
        ${linkBtn('Assessor', portals.assessor)}
        ${judgmentBtnHtml}
        ${linkBtn('PACER bankruptcy', pacerSearch)}
        ${taxSearchDC ? linkBtn('DC tax liens', taxSearchDC) : ''}
        ${taxSearchMD ? linkBtn('MD SDAT tax', taxSearchMD) : ''}
        ${taxSearchVA ? linkBtn('VA treasurer / RE tax', taxSearchVA) : ''}
      </div>
      ${judgmentHintHtml}
      ${titleStackTooltip}
      ${arlingtonNote}
    `;

    const noticeHint = seniorLoanFromNotice
      ? `<div class="fc-kv-caption" style="color:var(--muted);font-size:11px;margin-bottom:10px">
           💡 Notice lists original loan $${seniorLoanFromNotice.toLocaleString()} — pre-fill as senior lien estimate if no payoff quote yet.
         </div>`
      : '';

    // Compact form — one row per category. Optional fields.
    const inputStyle = `width:100%;padding:7px 9px;border:1px solid var(--hair);border-radius:4px;font-family:var(--f-mono);font-size:12px;box-sizing:border-box;background:var(--paper)`;
    const labelStyle = `display:block;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px`;

    const body = `
      ${links}
      ${noticeHint}
      <div id="fc-liens-form-${sid}" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="${labelStyle}">Senior lien (1st DoT) $</label>
          <input id="fc-liens-senior-${sid}" type="number" inputmode="numeric" placeholder="${seniorLoanFromNotice ? seniorLoanFromNotice.toLocaleString() : 'e.g. 285000'}" value="${num('senior_lien')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Senior lien holder</label>
          <input id="fc-liens-holder-${sid}" type="text" placeholder="e.g. Wells Fargo" value="${escapeAttr(v('senior_lien_holder'))}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Junior liens total $</label>
          <input id="fc-liens-junior-${sid}" type="number" inputmode="numeric" placeholder="sum of 2nd+" value="${num('junior_liens_total')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Tax liens $</label>
          <input id="fc-liens-tax-${sid}" type="number" inputmode="numeric" placeholder="property + IRS" value="${num('tax_liens_total')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Judgments $</label>
          <input id="fc-liens-judge-${sid}" type="number" inputmode="numeric" placeholder="sum" value="${num('judgments_total')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">HOA liens $</label>
          <input id="fc-liens-hoa-${sid}" type="number" inputmode="numeric" placeholder="assessment arrears" value="${num('hoa_liens_total')}" style="${inputStyle}">
        </div>
        <div style="grid-column:1 / -1">
          <label style="${labelStyle}">Where did you search?</label>
          <input id="fc-liens-search-url-${sid}" type="text" placeholder="paste URL from land records portal" value="${escapeAttr(v('search_url'))}" style="${inputStyle}">
        </div>
        <div style="grid-column:1 / -1">
          <label style="${labelStyle}">Notes</label>
          <input id="fc-liens-notes-${sid}" type="text" placeholder="subordinations, pending releases, red flags" value="${escapeAttr(v('notes'))}" style="${inputStyle}">
        </div>
        <label style="grid-column:1 / -1;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2);margin-top:4px;cursor:pointer">
          <input id="fc-liens-clear-${sid}" type="checkbox" ${saved.clear_title ? 'checked' : ''}>
          Title is clear (no encumbrances beyond senior mortgage)
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center">
        <button id="fc-liens-save-${sid}" class="fc-btn fc-btn-dark">Save findings</button>
        ${saved.updated_at ? `<button id="fc-liens-clear-btn-${sid}" class="fc-btn fc-btn-ghost">Clear</button>` : ''}
        <div id="fc-liens-status-${sid}" style="font-size:11px;color:var(--muted);font-family:var(--f-mono)"></div>
      </div>
    `;

    return section('Title & liens', statusBar + body);
  }

  // Wired after the drawer DOM is in place. Idempotent — replaces prior handlers.
  function wireDrawerLiens(p) {
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const byId = (s) => document.getElementById(s + sid);
    const save = byId('fc-liens-save-');
    if (!save) return;
    const status = byId('fc-liens-status-');

    const readForm = () => {
      const num = (s) => { const el = byId(s); const v = el ? el.value.trim() : ''; return v === '' ? null : Number(v); };
      return {
        senior_lien:         num('fc-liens-senior-'),
        senior_lien_holder:  byId('fc-liens-holder-')?.value.trim() || '',
        junior_liens_total:  num('fc-liens-junior-'),
        tax_liens_total:     num('fc-liens-tax-'),
        judgments_total:     num('fc-liens-judge-'),
        hoa_liens_total:     num('fc-liens-hoa-'),
        total_encumbrances:  (num('fc-liens-senior-') || 0) + (num('fc-liens-junior-') || 0)
                           + (num('fc-liens-tax-') || 0)    + (num('fc-liens-judge-') || 0)
                           + (num('fc-liens-hoa-') || 0),
        clear_title:         !!byId('fc-liens-clear-')?.checked,
        search_url:          byId('fc-liens-search-url-')?.value.trim() || '',
        notes:               byId('fc-liens-notes-')?.value.trim() || '',
      };
    };

    save.onclick = () => {
      const data = readForm();
      saveLiens(p.id, data);
      if (status) {
        status.textContent = '✓ Saved · syncing to other devices';
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
      }
    };

    const clearBtn = byId('fc-liens-clear-btn-');
    if (clearBtn) {
      clearBtn.onclick = () => {
        localStorage.removeItem(LIEN_LS_PREFIX + p.id);
        const token = getZillowSyncToken();
        if (token) {
          fetch(`${LIEN_SYNC_BASE}/${encodeURIComponent(p.id)}`, {
            method: 'DELETE',
            headers: { 'X-Nestscoop-Token': token },
          }).catch(() => {});
        }
        // Re-open drawer to reset UI
        openPropertyDrawer(p.id);
      };
    }
  }

  // ── Neighborhood / nearby points of interest ─────────────────────────────
  // Each category button opens a Google Maps search centered on the property's
  // coordinates (falls back to the full address if no coords). Zero API cost.
  //
  // For HOA / community amenities / planned development — genuinely gated by
  // MLS data, so we direct users to Zillow (usually has prior listing data)
  // and a Google search for HOA management company by address.

  const NEIGHBORHOOD_CATEGORIES = [
    { icon: '🚆', label: 'Transit',     query: 'public transportation' },
    { icon: '🛒', label: 'Grocery',     query: 'grocery stores' },
    { icon: '🏬', label: 'Shopping',    query: 'shopping malls' },
    { icon: '🏥', label: 'Hospitals',   query: 'hospitals' },
    { icon: '🏫', label: 'Schools',     query: 'schools' },
    { icon: '🌳', label: 'Parks',       query: 'parks' },
    { icon: '🍽️', label: 'Restaurants', query: 'restaurants' },
    { icon: '💪', label: 'Gyms',        query: 'gyms' },
  ];

  // ─── Live Auction (auction.com cross-check) ──────────────────────────────
  // Manual entry form + auto-comparison panel. The form captures starting
  // bid, current bid, auction date/time, listing URL, and notes. The panel
  // below the form computes deal-quality metrics live from those inputs +
  // everything else we already know about the property (ARV, heuristic EAV,
  // assessed value when available, BWW original loan amount when available,
  // rehab estimate, rent estimate). All math is documented in
  // computeAuctionMetrics().
  // ─── Cross-platform listing check ────────────────────────────────────────
  // Compact row of deep-link buttons for the major REO + auction platforms.
  // For each platform, if the property's source IS that platform we open the
  // original listing URL directly (saved by the scraper); otherwise we open
  // that platform's search/listings page so the user can match by address.
  function crossPlatformSection(p) {
    const source = (p.source || '').toLowerCase();
    const stateLow = (p.state || '').toLowerCase();
    const citySlug = (p.city || '').toLowerCase().trim()
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    const stateUp = (p.state || '').toUpperCase();

    // Per-platform URL builder. Returns { url, isOriginal, label } where
    // isOriginal=true means we're linking to the actual listing page, not a
    // search; label adapts ("View on" vs "Cross-check on").
    const platforms = [
      {
        key: 'auction',
        name: 'auction.com',
        original: source.includes('auction.com'),
        // No saved direct URL for auction.com — always falls back to search.
        url: stateLow && citySlug
          ? `https://www.auction.com/residential/${stateLow}/${citySlug}_ct/`
          : stateLow
            ? `https://www.auction.com/residential/${stateLow}/`
            : 'https://www.auction.com/',
        bidding: true,
      },
      {
        key: 'homepath',
        name: 'HomePath',
        original: source === 'homepath',
        url: source === 'homepath' && p.source_url
          ? p.source_url
          : 'https://homepath.fanniemae.com/property-finder',
        bidding: false,
      },
      {
        key: 'homesteps',
        name: 'HomeSteps',
        original: source === 'homesteps',
        url: source === 'homesteps' && p.source_url
          ? p.source_url
          : (fullAddress
              ? `https://www.homesteps.com/listing/search?search=${encodeURIComponent(fullAddress)}`
              : 'https://www.homesteps.com/listing/search'),
        bidding: false,
      },
      {
        key: 'vendee',
        name: 'VA Vendee',
        original: source === 'va vendee' || source === 'vendee',
        url: (source.includes('vendee')) && p.source_url
          ? p.source_url
          : (stateUp
              ? `https://www.vrmproperties.com/Properties-For-Sale?state=${stateUp}`
              : 'https://www.vrmproperties.com/'),
        bidding: false,
      },
      {
        key: 'hud',
        name: 'HUD HomeStore',
        original: source.includes('hud'),
        url: 'https://www.hudhomestore.gov/Listing/PropertySearch.aspx',
        bidding: true,  // HUD uses sealed-bid system w/ deadlines
      },
    ];

    const btns = platforms.map(plat => {
      const cls = plat.original
        ? 'fc-btn fc-btn-sm'
        : 'fc-btn fc-btn-sm fc-btn-ghost';
      const label = plat.original
        ? `View on ${plat.name} ↗`
        : `${plat.name} ↗`;
      const title = plat.original
        ? `Open the original ${plat.name} listing for this property`
        : `Search ${plat.name} for this property — useful for cross-checking ${plat.bidding ? 'bid status' : 'list price + photos + days on market'}`;
      return `<a href="${escapeAttr(plat.url)}" target="_blank" rel="noopener" class="${cls}" title="${escapeAttr(title)}">${escapeHtml(label)}</a>`;
    }).join('');

    return section('Cross-platform check', `
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-family:var(--f-mono)">
        Verify this property on other listing platforms. Bold buttons link to the original source listing; ghost buttons search by address/city.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${btns}
      </div>
    `);
  }

  function auctionSection(p) {
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const saved = getAuction(p.id) || {};
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    // Auction.com uses path-based URLs, not query-string search. Pattern:
    //   /residential/{state-lower}/{city-slug}_ct/   (city listings page)
    //   /residential/{state-lower}/                  (state listings page)
    // Their `/search-results?searchTerm=...` does not exist (404). City
    // pages let the user scan listings + match by address; state-level is
    // the fallback when we don't have a city.
    const stateLow = (p.state || '').toLowerCase();
    const citySlug = (p.city || '').toLowerCase().trim()
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    const auctionSearchUrl = stateLow && citySlug
      ? `https://www.auction.com/residential/${stateLow}/${citySlug}_ct/`
      : stateLow
        ? `https://www.auction.com/residential/${stateLow}/`
        : 'https://www.auction.com/';

    const inputStyle = `width:100%;padding:7px 9px;border:1px solid var(--hair);border-radius:4px;font-family:var(--f-mono);font-size:12px;box-sizing:border-box;background:var(--paper)`;
    const labelStyle = `display:block;font-size:10px;color:var(--muted);font-family:var(--f-mono);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px`;

    const lastObserved = saved.observed_at
      ? `<span class="fc-pill" style="font-size:10px">Last checked ${new Date(saved.observed_at).toLocaleString()}</span>`
      : `<span class="fc-pill" style="font-size:10px">Not yet checked</span>`;

    return section('Live Auction (auction.com)', `
      <div style="margin-bottom:10px">${lastObserved}</div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        <a href="${escapeAttr(auctionSearchUrl)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">
          Search auction.com ↗
        </a>
        ${saved.auction_url
          ? `<a href="${escapeAttr(saved.auction_url)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">Open saved listing ↗</a>`
          : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="${labelStyle}">Starting bid $</label>
          <input id="fc-auction-start-${sid}" type="number" inputmode="numeric" placeholder="e.g. 185000" value="${saved.starting_bid != null ? saved.starting_bid : ''}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Current bid $</label>
          <input id="fc-auction-current-${sid}" type="number" inputmode="numeric" placeholder="latest visible" value="${saved.current_bid != null ? saved.current_bid : ''}" style="${inputStyle}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label style="${labelStyle}">Auction date</label>
          <input id="fc-auction-date-${sid}" type="date" value="${escapeAttr(saved.auction_date || '')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Auction time</label>
          <input id="fc-auction-time-${sid}" type="text" placeholder="11:00 AM ET" value="${escapeAttr(saved.auction_time || '')}" style="${inputStyle}">
        </div>
        <div>
          <label style="${labelStyle}">Bid count</label>
          <input id="fc-auction-bidcount-${sid}" type="number" inputmode="numeric" placeholder="optional" value="${saved.bid_count != null ? saved.bid_count : ''}" style="${inputStyle}">
        </div>
      </div>

      <div style="margin-bottom:8px">
        <label style="${labelStyle}">Auction.com listing URL</label>
        <input id="fc-auction-url-${sid}" type="url" placeholder="https://www.auction.com/details/..." value="${escapeAttr(saved.auction_url || '')}" style="${inputStyle}">
      </div>

      <div style="margin-bottom:10px">
        <label style="${labelStyle}">Notes (reserve status, photos, condition, etc.)</label>
        <textarea id="fc-auction-notes-${sid}" rows="2" placeholder="reserve met / no reserve / etc." style="${inputStyle};font-family:var(--f-sans);resize:vertical">${escapeHtml(saved.notes || '')}</textarea>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:14px">
        <button class="fc-btn fc-btn-sm" type="button" onclick="window.fcSaveAuction('${escapeAttr(p.id)}')">Save bid + recompute</button>
        ${saved.updated_at
          ? `<button class="fc-btn fc-btn-sm fc-btn-ghost" type="button" onclick="window.fcDeleteAuction('${escapeAttr(p.id)}')">Clear</button>`
          : ''}
      </div>

      <div id="fc-auction-metrics-${sid}"></div>
    `);
  }

  function renderAuctionMetrics(p) {
    const sid = (p.id || 'x').replace(/[^a-z0-9]/gi, '');
    const container = document.getElementById(`fc-auction-metrics-${sid}`);
    if (!container) return;
    const saved = getAuction(p.id) || {};
    const bid = Number(saved.current_bid) || Number(saved.starting_bid) || 0;
    if (!bid) {
      container.innerHTML = `<div style="font-size:11px;color:var(--muted);font-family:var(--f-mono);padding:10px;border:1px dashed var(--hair);border-radius:6px">
        Enter a starting or current bid above and click Save to see deal metrics.
      </div>`;
      return;
    }

    const intel = assessorIntelCache.get(p.id);
    const assessedValue = intel && intel.assessed_value ? Number(intel.assessed_value) : null;
    const originalLoan = (p.pricing && p.pricing.original_loan) ? Number(p.pricing.original_loan) : null;

    const m = computeAuctionMetrics(p, bid, assessedValue, originalLoan);
    if (!m) {
      container.innerHTML = `<div style="font-size:11px;color:var(--muted)">Cannot compute metrics — missing inputs.</div>`;
      return;
    }

    // Color coding for each metric. Standard underwriting thresholds.
    const fmt$ = (n) => n != null ? '$' + Math.round(n).toLocaleString() : '—';
    const fmtPct = (n, dec=0) => n != null ? n.toFixed(dec) + '%' : '—';
    const colorByDiscount = (d) => d == null ? 'muted' : d >= 30 ? 'sage' : d >= 15 ? 'gold' : 'coral';
    const colorByCap = (c) => c == null ? 'muted' : c >= 8 ? 'sage' : c >= 5 ? 'gold' : 'coral';

    const tile = (label, value, color, hint) => `
      <div style="padding:10px 12px;background:var(--paper-2);border-left:3px solid var(--${color === 'muted' ? 'hair' : color});border-radius:4px;min-width:0">
        <div class="fc-eyebrow" style="margin-bottom:3px;font-size:9px">${escapeHtml(label)}</div>
        <div style="font-family:var(--f-serif);font-size:18px;font-weight:600;color:var(--${color === 'muted' ? 'ink' : color});line-height:1.1">${value}</div>
        ${hint ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(hint)}</div>` : ''}
      </div>
    `;

    const maoColor = m.mao70Pass === true ? 'sage' : m.mao70Pass === false ? 'coral' : 'muted';
    const maoHint = m.mao70 != null
      ? `MAO ${fmt$(m.mao70)} · ${m.mao70Delta >= 0 ? 'room ' + fmt$(m.mao70Delta) : 'over by ' + fmt$(-m.mao70Delta)}`
      : '';
    const eavColor = m.eavDeltaPct == null ? 'muted'
      : m.eavDeltaPct <= -10 ? 'sage' : m.eavDeltaPct <= 10 ? 'gold' : 'coral';
    const assessedColor = m.assessedRatio == null ? 'muted'
      : m.assessedRatio <= 80 ? 'sage' : m.assessedRatio <= 110 ? 'gold' : 'coral';
    const loanColor = m.loanRatio == null ? 'muted'
      : m.loanRatio <= 80 ? 'sage' : m.loanRatio <= 100 ? 'gold' : 'coral';

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px">
        ${tile('Bid', fmt$(m.bid), 'muted', m.allIn ? `All-in w/ rehab ${fmt$(m.allIn)}` : '')}
        ${tile('Discount to ARV', fmtPct(m.discountToARV, 1), colorByDiscount(m.discountToARV),
               m.arv ? `ARV ${fmt$(m.arv)}` : 'no ARV')}
        ${tile('70% Rule', m.mao70Pass === true ? 'PASS' : m.mao70Pass === false ? 'FAIL' : '—', maoColor, maoHint)}
        ${tile('vs Heuristic EAV', fmtPct(m.eavDeltaPct, 1), eavColor,
               m.eav ? `EAV ${fmt$(m.eav)}` : '')}
        ${m.assessedRatio != null
          ? tile('vs Assessed', fmtPct(m.assessedRatio, 0), assessedColor, fmt$(m.assessedValue))
          : ''}
        ${m.loanRatio != null
          ? tile('vs Original Loan (LTV)', fmtPct(m.loanRatio, 0), loanColor, fmt$(m.originalLoan))
          : ''}
        ${m.noiCap55 != null
          ? tile('Cap rate (55% NOI)', fmtPct(m.noiCap55, 1), colorByCap(m.noiCap55), `Rent ${fmt$(m.monthlyRent)}/mo`)
          : ''}
        ${m.allInVsARV != null
          ? tile('All-in / ARV', fmtPct(m.allInVsARV, 0),
                 m.allInVsARV <= 70 ? 'sage' : m.allInVsARV <= 85 ? 'gold' : 'coral',
                 `Bid + rehab ${fmt$(m.allIn)}`)
          : ''}
      </div>

      <div style="font-size:10px;color:var(--muted);font-family:var(--f-mono)">
        Color: <span style="color:var(--sage)">green</span> = good underwriting ·
        <span style="color:var(--gold)">gold</span> = marginal ·
        <span style="color:var(--coral)">red</span> = avoid.
        Tile thresholds: discount&nbsp;30%/15%, cap&nbsp;8%/5%, all-in/ARV&nbsp;70%/85%.
      </div>
    `;
  }

  // Save handler — collect form values, persist, recompute metrics in place.
  window.fcSaveAuction = function(propId) {
    const sid = (propId || 'x').replace(/[^a-z0-9]/gi, '');
    const $val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const data = {
      starting_bid: $val(`fc-auction-start-${sid}`) || null,
      current_bid:  $val(`fc-auction-current-${sid}`) || null,
      auction_date: $val(`fc-auction-date-${sid}`) || null,
      auction_time: $val(`fc-auction-time-${sid}`) || null,
      auction_url:  $val(`fc-auction-url-${sid}`) || null,
      bid_count:    $val(`fc-auction-bidcount-${sid}`) || null,
      notes:        $val(`fc-auction-notes-${sid}`) || null,
      observed_at:  new Date().toISOString(),
    };
    saveAuction(propId, data);
    const props = (typeof window.__fcGetAllProperties === 'function' && window.__fcGetAllProperties()) || [];
    const p = props.find(x => x.id === propId);
    if (p) renderAuctionMetrics(p);
  };

  window.fcDeleteAuction = function(propId) {
    if (!confirm('Clear saved auction data for this property?')) return;
    deleteAuction(propId);
    // Re-render section by reopening drawer
    if (typeof window.openPropertyDrawer === 'function') {
      window.openPropertyDrawer(propId);
    }
  };

  function neighborhoodSection(p) {
    const fullAddress = [p.address, p.city, p.state, p.zip]
      .filter(Boolean).join(', ');
    if (!fullAddress && !(p.lat && p.lng)) return '';

    // Google Maps search URL that centers on the property
    const center = (p.lat && p.lng)
      ? `/@${p.lat},${p.lng},14z`
      : '';

    const categoryTiles = NEIGHBORHOOD_CATEGORIES.map(c => {
      const q = encodeURIComponent(`${c.query} near ${fullAddress}`);
      const href = `https://www.google.com/maps/search/${q}${center}`;
      return `
        <a class="fc-nbhd-tile" href="${escapeAttr(href)}" target="_blank" rel="noopener"
           title="${escapeAttr(c.query)} near ${escapeAttr(fullAddress || '')}">
          <span class="fc-nbhd-tile-icon">${c.icon}</span>
          <span class="fc-nbhd-tile-label">${escapeHtml(c.label)}</span>
        </a>`;
    }).join('');

    // HOA / community-info deep-links. Zillow has community + HOA for any
    // property that was listed retail in the last 5-10 years. Google search
    // finds HOA management companies + neighborhood websites.
    const zillowAddrSlug = (p.address || '').replace(/\s+/g, '-');
    const zillowCitySlug = (p.city || '').replace(/\s+/g, '-');
    const zillowUrl  = `https://www.zillow.com/homes/${zillowAddrSlug},-${zillowCitySlug},-${p.state || 'VA'}-${p.zip || ''}_rb/`;
    const hoaSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullAddress + ' HOA OR homeowners association OR subdivision')}`;

    const verifyRow = `
      <div class="fc-eyebrow" style="margin-top:16px;margin-bottom:6px">HOA · Community · Amenities</div>
      <div class="fc-kv-caption" style="color:var(--muted);font-size:11px;margin-bottom:8px;line-height:1.5">
        Amenities (gym, pool, clubhouse), HOA dues, and planned-development status aren't in public data.
        These links surface what's known elsewhere:
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="fc-btn fc-btn-sm" href="${escapeAttr(zillowUrl)}" target="_blank" rel="noopener">
          🏠 Zillow listing (HOA / amenities)
        </a>
        <a class="fc-btn fc-btn-sm" href="${escapeAttr(hoaSearchUrl)}" target="_blank" rel="noopener">
          🔍 Google: HOA / Subdivision
        </a>
      </div>
    `;

    return section('Neighborhood & nearby', `
      <div class="fc-kv-caption" style="color:var(--muted);font-size:11px;margin-bottom:10px">
        Click any category to open a Google Maps search centered on this property.
      </div>
      <div class="fc-nbhd-grid">${categoryTiles}</div>
      ${verifyRow}
    `);
  }

  function section(title, bodyHtml) {
    return `
      <div class="fc-drawer-section">
        <div class="fc-drawer-section-hd">${escapeHtml(title)}</div>
        <div class="fc-drawer-section-body">${bodyHtml}</div>
      </div>
    `;
  }

  function zillowLookupSection(p, zillowUrl, sanitizedId) {
    const z = getZillowValues(p.id) || {};
    const zestimate = z.zestimate || '';
    const rent      = z.rent || '';
    const notes     = z.notes || '';
    const updated   = z.updatedAt
      ? new Date(z.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const savedBadge = p._zillowValidated
      ? `<span class="fc-pill sage" style="margin-left:8px">Zillow ✓</span>`
      : '';

    return `
      <div class="fc-drawer-section">
        <div class="fc-drawer-section-hd">Zillow lookup${savedBadge}</div>
        <div class="fc-drawer-section-body">
          <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5">
            Open the address on Zillow, then paste the Zestimate and Rent
            Zestimate here. Overrides the heuristic ARV + rent so Cash Flow,
            Cap Rate, and the 70% rule reflect real market values.
          </div>
          <a href="${escapeAttr(zillowUrl)}" target="_blank" rel="noopener"
             class="fc-btn fc-btn-sm fc-btn-ghost" style="margin-bottom:12px;display:inline-block">
            Open on Zillow ↗
          </a>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label for="fc-z-arv-${sanitizedId}"
                style="display:block;font-size:11px;font-weight:500;color:var(--ink);margin-bottom:4px">
                Zestimate (ARV)
              </label>
              <input id="fc-z-arv-${sanitizedId}" type="number" inputmode="numeric"
                placeholder="e.g. 425000" value="${zestimate}"
                style="width:100%;padding:6px 10px;border:1px solid var(--hair);border-radius:3px;font-family:var(--f-mono);font-size:12px;background:var(--paper-2);box-sizing:border-box">
            </div>
            <div>
              <label for="fc-z-rent-${sanitizedId}"
                style="display:block;font-size:11px;font-weight:500;color:var(--ink);margin-bottom:4px">
                Rent Zestimate (monthly)
              </label>
              <input id="fc-z-rent-${sanitizedId}" type="number" inputmode="numeric"
                placeholder="e.g. 2400" value="${rent}"
                style="width:100%;padding:6px 10px;border:1px solid var(--hair);border-radius:3px;font-family:var(--f-mono);font-size:12px;background:var(--paper-2);box-sizing:border-box">
            </div>
          </div>
          <div style="margin-bottom:10px">
            <label for="fc-z-notes-${sanitizedId}"
              style="display:block;font-size:11px;font-weight:500;color:var(--ink);margin-bottom:4px">
              Notes
            </label>
            <textarea id="fc-z-notes-${sanitizedId}" rows="2"
              placeholder="Condition, comps, rehab scope…"
              style="width:100%;padding:6px 10px;border:1px solid var(--hair);border-radius:3px;font-family:var(--f-ui);font-size:12px;background:var(--paper-2);box-sizing:border-box;resize:vertical">${escapeHtml(notes)}</textarea>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="fc-btn fc-btn-sm fc-btn-dark"
              onclick="fcSaveZillowValues('${escapeAttr(p.id || '')}', '${sanitizedId}')">Save</button>
            ${p._zillowValidated ? `<button class="fc-btn fc-btn-sm fc-btn-ghost"
              onclick="fcClearZillowValues('${escapeAttr(p.id || '')}')">Clear</button>` : ''}
            ${updated ? `<span style="font-size:10px;color:var(--muted);font-family:var(--f-mono)">Saved ${escapeHtml(updated)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function kvRow(label, value, valueClass, caption) {
    const colorMap = {
      sage:  'color:var(--sage)',
      coral: 'color:var(--coral)',
      gold:  'color:var(--gold-ink)',
      muted: 'color:var(--muted)',
      ink:   'color:var(--ink)',
    };
    const style = colorMap[valueClass] || 'color:var(--ink)';
    return `
      <div class="fc-kv">
        <div class="fc-kv-label">${escapeHtml(label)}</div>
        <div class="fc-kv-value" style="${style}">
          ${String(value)}
          ${caption ? `<span class="fc-kv-caption">${escapeHtml(caption)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function gradeBadgeLarge(grade) {
    const g = grade || 'D';
    const colors = {
      'A+': { bg: 'var(--sage-soft)',  fg: 'var(--sage)' },
      'A':  { bg: 'var(--sage-soft)',  fg: 'var(--sage)' },
      'B':  { bg: 'var(--gold-soft)',  fg: 'var(--gold-ink)' },
      'C':  { bg: 'var(--paper-2)',   fg: 'var(--ink-3)' },
      'D':  { bg: 'var(--coral-soft)', fg: 'var(--coral)' },
    };
    const c = colors[g] || colors.D;
    return `<div class="fc-grade-large" style="background:${c.bg};color:${c.fg}">${escapeHtml(g)}</div>`;
  }

  // ─── Deal-quality badge helpers ─────────────────────────────────────────
  // Letter grade badge (A+/A/B/C/D) with color coding — FlipperForce convention
  function gradeBadge(grade) {
    const g = grade || 'D';
    const colors = {
      'A+': { bg: 'var(--sage-soft)',  fg: 'var(--sage)',     bd: 'var(--sage)' },
      'A':  { bg: 'var(--sage-soft)',  fg: 'var(--sage)',     bd: 'transparent' },
      'B':  { bg: 'var(--gold-soft)',  fg: 'var(--gold-ink)', bd: 'transparent' },
      'C':  { bg: 'var(--paper-2)',   fg: 'var(--ink-3)',    bd: 'var(--hair)'  },
      'D':  { bg: 'var(--coral-soft)', fg: 'var(--coral)',    bd: 'transparent' },
    };
    const c = colors[g] || colors.D;
    return `<span class="fc-grade" style="background:${c.bg};color:${c.fg};border-color:${c.bd}">${escapeHtml(g)}</span>`;
  }

  // 70% Rule status pill — "Passes" in sage if below MAO, or "$+15K over" if over
  function rule70Pill(p) {
    if (!p.arv || !p.price) return `<span class="fc-mono" style="font-size:11px;color:var(--muted)">—</span>`;
    const gap = p.price - (p.mao70 || 0);
    if (gap <= 0) {
      const under = Math.abs(gap);
      return `<span class="fc-pill sage" title="Clears 70% rule (MAO $${(p.mao70/1000).toFixed(0)}K)">✓ $${Math.round(under/1000)}K under</span>`;
    }
    return `<span class="fc-pill coral" title="Over MAO of $${(p.mao70/1000).toFixed(0)}K">$${Math.round(gap/1000)}K over</span>`;
  }

  // Colored pill matching the map legend. Colors mirror markerColor() in
  // foreclosure-scout.html so the list and map stay visually consistent.
  function typePill(listingType) {
    const colors = {
      'REO/Bank-Owned':  { bg: '#c84b2f', label: 'REO'        },
      'Auction':         { bg: '#b8860b', label: 'Auction'    },
      'Pre-Foreclosure': { bg: '#2d6a4f', label: 'Pre-FC'     },
      'HUD Home':        { bg: '#2a6496', label: 'HUD'        },
      'HomePath':        { bg: '#2a6496', label: 'HomePath'   },
      'Short Sale':      { bg: '#6644aa', label: 'Short'      },
      'Distressed':      { bg: '#e67e22', label: 'Distressed' },
    };
    const t = colors[listingType];
    if (!t) return `<span class="fc-pill" title="${escapeAttr(listingType || 'Unknown')}">${escapeHtml(listingType || '—')}</span>`;
    return `<span class="fc-pill" title="${escapeAttr(listingType)}"
      style="background:${t.bg};color:#fff;border-color:${t.bg};font-weight:500">${t.label}</span>`;
  }

  function updateSubline(d) {
    const filtered = filterByState(d);
    const props = filtered.foreclosures || [];
    const counties = new Set(props.map(p => p.county).filter(c => c && c !== 'Unknown County'));
    const hi = props.filter(p => ((p.pricing && p.pricing.confidence) || '').startsWith('HIGH')).length;
    const stateLabel = __stateFilter === 'ALL' ? 'DC/MD/VA' : __stateFilter;
    const sub = document.getElementById('fc-subline');
    const eyebrow = document.getElementById('fc-date-eyebrow');
    if (sub) {
      sub.textContent = `${props.length} active listings across ${counties.size} ${stateLabel} counties. ${hi} high-confidence deals ready to underwrite.`;
    }
    if (eyebrow) {
      const d2 = new Date();
      const opts = { weekday: 'long', month: 'long', day: 'numeric' };
      const week = Math.ceil(((d2 - new Date(d2.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
      eyebrow.textContent = `${d2.toLocaleDateString('en-US', opts)} · Week ${week}`;
    }
  }

  // ─── KPI computation + rendering ────────────────────────────────────────
  function renderKPIs(d) {
    d = filterByState(d);
    const props = d.foreclosures || [];
    const m = d.metadata || {};
    const totalCount = props.length;

    // Avg price (list/EAV) of active properties
    const prices = props.map(p => p.price || 0).filter(v => v > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a,b) => a+b, 0) / prices.length) : 0;

    // Avg below-ARV discount (shows deal quality)
    const discounts = props.map(p => {
      if (!p.arv || !p.price || p.arv <= p.price) return null;
      return (1 - p.price / p.arv) * 100;
    }).filter(v => v !== null);
    const avgDiscount = discounts.length
      ? (discounts.reduce((a,b) => a+b, 0) / discounts.length).toFixed(1)
      : '0';

    // High-confidence count — recompute from filtered props since metadata
    // reflects unfiltered totals.
    const hiConfCount = props.filter(p => ((p.pricing && p.pricing.confidence) || '').startsWith('HIGH')).length;
    const medConfCount = props.filter(p => ((p.pricing && p.pricing.confidence) || '').startsWith('MEDIUM')).length;

    // Generate sparkline shapes. We don't yet have real history — use deterministic
    // variations of the current value so the sparkline feels "alive" without lying.
    // TODO: store data/kpi_history.json in the scraper for real week-over-week trends.
    const sparkUp   = [6, 7, 7, 8, 9, 8, 9, 10, 10, 11];
    const sparkFlat = [8, 8, 9, 7, 8, 9, 8, 8, 9, 8];
    const sparkDown = [11, 10, 10, 9, 9, 8, 7, 8, 7, 6];
    const sparkMid  = [7, 8, 9, 8, 10, 9, 10, 11, 10, 11];

    const grid = document.getElementById('fc-kpi-grid');
    if (!grid) return;

    grid.innerHTML = `
      ${kpiTile({
        label: 'Total Properties',
        value: totalCount.toLocaleString(),
        delta: (() => {
          const hud = props.filter(p => p.listingType === 'HUD Home').length;
          const trustee = props.filter(p => p.listingType === 'Auction').length;
          const distressed = props.filter(p => p.listingType === 'Distressed').length;
          const other = props.length - hud - trustee - distressed;
          const parts = [];
          if (hud)        parts.push(`${hud} HUD`);
          if (trustee)    parts.push(`${trustee} Trustee`);
          if (distressed) parts.push(`${distressed} Distressed`);
          if (other)      parts.push(`${other} Other`);
          return parts.join(' + ');
        })(),
        deltaClass: 'muted',
        spark: sparkUp,
        sparkColor: 'var(--gold-deep)',
      })}
      ${kpiTile({
        label: 'Avg List Price',
        value: '$' + (avgPrice / 1000).toFixed(0) + 'K',
        delta: `${prices.length} with price`,
        deltaClass: 'muted',
        spark: sparkMid,
        sparkColor: 'var(--ink)',
      })}
      ${kpiTile({
        label: 'Avg Below ARV',
        value: avgDiscount + '%',
        delta: `${discounts.length} scored`,
        deltaClass: 'sage',
        spark: sparkFlat,
        sparkColor: 'var(--sage)',
      })}
      ${kpiTile({
        label: 'High-Conf Deals',
        value: hiConfCount.toLocaleString(),
        delta: `+${medConfCount} Medium`,
        deltaClass: 'muted',
        spark: sparkUp,
        sparkColor: 'var(--gold-deep)',
        ringPct: totalCount > 0 ? Math.round((hiConfCount / totalCount) * 100) : 0,
      })}
    `;
  }

  function kpiTile({ label, value, delta, deltaClass = 'muted', spark, sparkColor, ringPct }) {
    const sparkSvg = ringPct !== undefined
      ? ringSvg(ringPct, 32, 3, sparkColor)
      : sparkSvg_(spark, 64, 24, sparkColor);
    return `
      <div class="fc-kpi">
        <div class="fc-kpi-label"><span class="fc-eyebrow">${label}</span></div>
        <div class="fc-kpi-value">${value}</div>
        <div class="fc-kpi-delta ${deltaClass}">${delta}</div>
        <div class="fc-kpi-spark">${sparkSvg}</div>
      </div>
    `;
  }

  // ─── Tiny sparkline SVG ─────────────────────────────────────────────────
  function sparkSvg_(data, w = 64, h = 24, stroke = 'var(--gold-deep)') {
    const max = Math.max(...data), min = Math.min(...data);
    const step = w / (data.length - 1);
    const pts = data.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
      return [x, y];
    });
    const pathD = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<svg width="${w}" height="${h}" style="display:block">
      <path d="${pathD}" stroke="${stroke}" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function ringSvg(pct, size = 32, strokeW = 3, color = 'var(--gold-deep)') {
    const r = (size - strokeW) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    return `<svg width="${size}" height="${size}" style="display:block">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--hair)" stroke-width="${strokeW}" fill="none"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${strokeW}" fill="none"
              stroke-dasharray="${c}" stroke-dashoffset="${off}"
              stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
      <text x="${size/2}" y="${size/2 + 3}" text-anchor="middle" font-family="var(--f-mono)" font-size="9" fill="var(--ink)">${pct}</text>
    </svg>`;
  }

  // ─── Initialize ─────────────────────────────────────────────────────────
  // Builds the dashboard shell on all viewports now. Mobile adaptations
  // happen via responsive CSS (sidebar becomes an off-canvas drawer,
  // condensed topbar, single-column layouts).
  // Feature flag: when true, the passphrase gate + role-based UI hides
  // are active. localStorage persists the role so users stay signed in
  // across reloads — explicit Sign Out (role chip click) clears it.
  const AUTH_ENABLED = true;

  async function init() {
    loadFonts();
    injectCSS();

    // PREVENT BROWSER HASH-ANCHOR-SCROLL: the legacy Google Maps div has
    // id="map" so loading with URL "#map" causes the browser to
    // auto-scroll that element into view, which shoves fc-main's scroll
    // past the topbar + page-head. Strip the hash NOW before the browser
    // can anchor-scroll to it. Restore after buildShell via replaceState
    // (replaceState does NOT trigger anchor-scroll, so it's safe).
    const deferredHash = (location.hash || '').replace('#', '');
    if (deferredHash) {
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { /* safari private mode */ }
    }

    if (AUTH_ENABLED) {
      if (!isAuthed()) await showAuthGate();
      applyRoleToDom();
    }
    buildShell();
    loadData();

    // Now that the shell is up and setView('dashboard') ran (because hash
    // was empty at buildShell time), re-apply the user's intended view.
    if (deferredHash && deferredHash !== 'dashboard') {
      try { history.replaceState(null, '', location.pathname + location.search + '#' + deferredHash); }
      catch (e) { /* ignore */ }
      setView(deferredHash);
    }
  }

  // Run after DOM is parsed so the mobile-frame exists to hide.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle viewport changes (dev-tools device emulation, window resize).
  // Shell builds once on init now; resize keeps it.
  window.addEventListener('resize', () => {
    const hasDash = !!document.getElementById('fc-dash-root');
    if (!hasDash) buildShell();
  });

  // ─── Icons as tiny inline SVGs (stroke-current) ─────────────────────────
  const ICO = {
    home: `<svg viewBox="0 0 20 20"><path d="M3 9l7-6 7 6v8a1 1 0 0 1-1 1h-4v-5h-4v5H4a1 1 0 0 1-1-1z"/></svg>`,
    building: `<svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="15"/><path d="M7 7h2M11 7h2M7 11h2M11 11h2M7 15h2M11 15h2"/></svg>`,
    map: `<svg viewBox="0 0 20 20"><path d="M2 5v12l6-3 4 3 6-3V2l-6 3-4-3z"/><path d="M8 2v12M12 5v12"/></svg>`,
    bell: `<svg viewBox="0 0 20 20"><path d="M5 14h10l-1-2V9a4 4 0 0 0-8 0v3z"/><path d="M8 17a2 2 0 0 0 4 0"/></svg>`,
    calc: `<svg viewBox="0 0 20 20"><rect x="4" y="2" width="12" height="16" rx="1"/><rect x="6" y="4" width="8" height="3"/><path d="M7 11h1M10 11h1M13 11h1M7 14h1M10 14h1M13 14h1"/></svg>`,
    chart: `<svg viewBox="0 0 20 20"><path d="M3 17h14"/><path d="M5 14V9M9 14V5M13 14v-6M17 14v-8"/></svg>`,
    book: `<svg viewBox="0 0 20 20"><path d="M3 4a2 2 0 0 1 2-2h11v14H5a2 2 0 0 0-2 2z"/><path d="M3 4v14"/></svg>`,
    gear: `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.5 3.5l2 2M14.5 14.5l2 2M3.5 16.5l2-2M14.5 5.5l2-2"/></svg>`,
    search: `<svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg>`,
    plus: `<svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg>`,
    chevR: `<svg viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none"/></svg>`,
  };

  // ─── Shell HTML ─────────────────────────────────────────────────────────
  const SHELL_HTML = `
    <div class="fc-topbar">
      <!-- Hamburger: visible only on mobile via CSS, toggles the sidebar drawer -->
      <button class="fc-tb-hamburger" id="fc-tb-hamburger" aria-label="Open menu" title="Menu">
        <svg viewBox="0 0 20 20" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.8">
          <path d="M3 6h14M3 10h14M3 14h14"/>
        </svg>
      </button>
      <div class="fc-brand">
        <img class="fc-brand-mark" src="fc-icon.svg?v=3" alt="Nestscoop" width="26" height="26">
        <span>Nestscoop</span>
      </div>
      <div class="fc-topbar-sep"></div>
      <div class="fc-workspace">
        <strong>DC/MD/VA Foreclosures</strong>
        ${ICO.chevR}
        <span>Command Center</span>
      </div>
      <div class="fc-tb-search" id="fc-tb-search-wrap">
        ${ICO.search}
        <input id="fc-tb-search-input" type="text"
          placeholder="Search address, county, zip, case #…"
          autocomplete="off" spellcheck="false">
        <kbd id="fc-tb-search-kbd">⌘K</kbd>
        <div id="fc-tb-search-results" class="fc-tb-search-results" style="display:none"></div>
      </div>
      <div class="fc-tb-right">
        <button class="fc-tb-btn" title="Notifications">${ICO.bell}</button>
        <button class="fc-tb-btn" id="fc-tb-keys" title="Data Keys">${ICO.gear}</button>
        <button class="fc-tb-btn fc-primary" id="fc-tb-watchlist" title="View watchlisted properties">${ICO.plus} Watchlist <span id="fc-tb-watchlist-count" class="fc-state-count" style="margin-left:4px">0</span></button>
        <!-- Role indicator + sign out: click to log out. -->
        <button class="fc-tb-btn fc-role-chip" id="fc-tb-role" title="Sign out"></button>
      </div>
    </div>

    <!-- Mobile sidebar backdrop: visible only when drawer is open -->
    <div class="fc-sidebar-backdrop" id="fc-sidebar-backdrop"></div>

    <div class="fc-body">
      <div class="fc-sidebar" id="fc-sidebar">
        <div class="fc-side-section">
          <div class="fc-side-label">Properties</div>
          <div class="fc-side-item active" data-view="dashboard">${ICO.home}<span>Dashboard</span></div>
          <div class="fc-side-item" data-view="listings">${ICO.building}<span>Listings</span><span class="fc-side-count" id="fc-sc-listings">—</span></div>
          <div class="fc-side-item" data-view="map">${ICO.map}<span>Map</span></div>
          <div class="fc-side-item" data-view="alerts">${ICO.bell}<span>Alerts</span><span class="fc-side-count">0</span></div>
        </div>
        <div class="fc-side-section">
          <div class="fc-side-label">Tools</div>
          <div class="fc-side-item" data-view="zillow-queue">${ICO.plus}<span>Zillow Queue</span><span class="fc-side-count" id="fc-sc-zqueue">—</span></div>
          <div class="fc-side-item" data-view="rehab">${ICO.calc}<span>Rehab Calculator</span></div>
          <div class="fc-side-item" data-view="market">${ICO.chart}<span>Market Analysis</span></div>
          <div class="fc-side-item" data-view="brrrr">${ICO.book}<span>BRRRR Calculator</span></div>
        </div>
        <div class="fc-side-section">
          <div class="fc-side-label">Financing</div>
          <div class="fc-side-item" data-view="financing-203k">${ICO.book}<span>203(k) HUD Homes</span><span class="fc-side-count" id="fc-sc-203k">—</span></div>
        </div>
        <div class="fc-side-section">
          <div class="fc-side-label">Workspace</div>
          <div class="fc-side-item" data-view="settings">${ICO.gear}<span>Settings</span></div>
        </div>
        <div class="fc-side-footer">
          <div class="fc-eyebrow" style="margin-bottom:6px">Coverage</div>
          <span class="fc-pill gold">DC · MD · VA</span>
        </div>
      </div>

      <div class="fc-main">
        <div class="fc-main-inner">
          <div class="fc-page-head">
            <div>
              <div class="fc-eyebrow" style="margin-bottom:8px" id="fc-date-eyebrow">Loading…</div>
              <h1 class="fc-page-title">Command Center</h1>
              <div class="fc-page-sub">
                <span class="fc-pill sage" style="margin-right:8px"><span class="fc-dot"></span> Live data</span>
                <span id="fc-subline">Pipeline warming up.</span>
              </div>
            </div>
            <div class="fc-page-actions">
              <div class="fc-state-chips" id="fc-state-chips" role="group" aria-label="Filter by state">
                <button class="fc-btn fc-btn-sm fc-state-chip active" data-state="ALL">All <span class="fc-state-count" id="fc-state-count-ALL">—</span></button>
                <button class="fc-btn fc-btn-sm fc-state-chip" data-state="VA">VA <span class="fc-state-count" id="fc-state-count-VA">—</span></button>
                <button class="fc-btn fc-btn-sm fc-state-chip" data-state="MD">MD <span class="fc-state-count" id="fc-state-count-MD">—</span></button>
                <button class="fc-btn fc-btn-sm fc-state-chip" data-state="DC">DC <span class="fc-state-count" id="fc-state-count-DC">—</span></button>
              </div>
              <button class="fc-btn">${ICO.plus} Add watchlist</button>
              <button class="fc-btn fc-btn-dark">${ICO.search} Search listings</button>
            </div>
          </div>

          <div id="fc-view-dashboard">
          <div class="fc-kpi-grid" id="fc-kpi-grid">
            <div class="fc-kpi">
              <div class="fc-kpi-label"><span class="fc-eyebrow">Loading…</span></div>
              <div class="fc-kpi-value">—</div>
              <div class="fc-kpi-delta muted">fetching data</div>
            </div>
          </div>

          <div class="fc-two-col" style="margin-top:24px">
            <div class="fc-card">
              <div class="fc-card-hd">
                <div class="fc-card-title">Top-scoring properties</div>
                <span class="fc-pill" id="fc-pq-count">—</span>
                <div style="margin-left:auto;display:flex;gap:4px">
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter active" data-filter="all">All</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="Auction">Auction</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="HUD Home">HUD</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="Distressed">Distressed</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="REO/Bank-Owned">REO</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="Pre-Foreclosure">Pre-FC</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="Short Sale">Short Sale</button>
                </div>
              </div>
              <table class="fc-table" id="fc-priority-table">
                <thead>
                  <tr>
                    <th style="width:28px"></th>
                    <th>Property / source</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th style="text-align:center">Grade</th>
                    <th style="text-align:right">70% Rule</th>
                    <th style="text-align:right">Sale</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="fc-priority-body">
                  <tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">Loading…</td></tr>
                </tbody>
              </table>
            </div>

            <div class="fc-card">
              <div class="fc-card-hd">
                <div class="fc-card-title">Live signals</div>
                <span class="fc-pill sage"><span class="fc-dot"></span> Weekly refresh</span>
              </div>
              <div id="fc-signals">
                <div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">Loading…</div>
              </div>
            </div>
          </div>

          <div class="fc-two-col" style="margin-top:20px; grid-template-columns: 1fr 1.2fr">
            <div class="fc-card">
              <div class="fc-card-hd">
                <div class="fc-card-title">Hot counties · concentration</div>
                <span class="fc-pill" id="fc-hc-count">—</span>
              </div>
              <div id="fc-hot-counties">
                <div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">Loading…</div>
              </div>
            </div>

            <div class="fc-card">
              <div class="fc-card-hd">
                <div class="fc-card-title">Coach · AI reads your pipeline</div>
                <span class="fc-pill gold"><span class="fc-dot"></span> Gemini</span>
              </div>
              <div id="fc-ai-coach" style="padding:14px 16px">
                <div style="padding:14px;color:var(--muted);font-size:13px">Analyzing your pipeline…</div>
              </div>
            </div>
          </div>
          </div><!-- /fc-view-dashboard -->

          <!-- Listings view -->
          <div id="fc-view-listings" style="display:none">
            <div class="fc-card">
              <div class="fc-card-hd">
                <div class="fc-card-title">All listings</div>
                <span class="fc-pill" id="fc-listings-count">—</span>
                <div style="margin-left:auto;display:flex;gap:4px">
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-list-sort active" data-sort="score">Score</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-list-sort" data-sort="days">Sale date</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-list-sort" data-sort="price">Price</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-list-sort" data-sort="discount">Discount</button>
                </div>
              </div>
              <!-- Quick-filter row: Listing Type / Property Type / Source.
                   Each dropdown is single-select; value drives renderListings().
                   Source options populated from data on render. -->
              <div style="display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid var(--hair);background:var(--paper-2);flex-wrap:wrap">
                <select id="fc-qf-type" class="fc-select fc-qf-select" onchange="window.fcSetListingsFilter('type', this.value)">
                  <option value="">All Listing Types</option>
                  <option value="Auction">Auction</option>
                  <option value="REO/Bank-Owned">REO / Bank-Owned</option>
                  <option value="HUD Home">HUD Home</option>
                  <option value="Pre-Foreclosure">Pre-Foreclosure</option>
                  <option value="Short Sale">Short Sale</option>
                </select>
                <select id="fc-qf-property" class="fc-select fc-qf-select" onchange="window.fcSetListingsFilter('property', this.value)">
                  <option value="">All Property Types</option>
                  <option value="Single Family">Single Family</option>
                  <option value="Townhouse">Townhouse</option>
                  <option value="Condo">Condo</option>
                  <option value="Multi-Family">Multi-Family</option>
                  <option value="Mobile Home">Mobile Home</option>
                  <option value="Land">Land</option>
                </select>
                <select id="fc-qf-source" class="fc-select fc-qf-select" onchange="window.fcSetListingsFilter('source', this.value)">
                  <option value="">All Sources</option>
                </select>
                <button class="fc-btn fc-btn-sm fc-btn-ghost" onclick="window.fcClearListingsFilters()">Clear filters</button>
              </div>
              <div id="fc-listings-filter-chip" style="display:none"></div>
              <table class="fc-table" id="fc-listings-table">
                <thead>
                  <tr>
                    <th style="width:28px"></th>
                    <th>Address</th>
                    <th>County</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Bd/Ba</th>
                    <th style="text-align:right">Sqft</th>
                    <th style="text-align:right">Price</th>
                    <th style="text-align:right">ARV</th>
                    <th style="text-align:right">MAO 70%</th>
                    <th style="text-align:center">Grade</th>
                    <th style="text-align:right">70% Rule</th>
                    <th style="text-align:right">Sale</th>
                  </tr>
                </thead>
                <tbody id="fc-listings-body"></tbody>
              </table>
            </div>
          </div>

          <!-- Map view — the existing mobile-frame will be moved inside this
               container on init so Google Maps keeps working but lives in the
               natural layout flow under the topbar/sidebar. -->
          <div id="fc-view-map" style="display:none; margin:-24px -32px"></div>

          <!-- Zillow Queue view — rapid manual lookup workflow -->
          <div id="fc-view-zillow-queue" style="display:none"></div>

          <!-- FHA 203(k) Financing view — HUD homes with rehab loan calc -->
          <div id="fc-view-financing-203k" style="display:none"></div>

          <!-- Placeholder views -->
          ${['alerts', 'rehab', 'market', 'brrrr'].map(v => `
            <div id="fc-view-${v}" style="display:none">
              <div class="fc-stage-placeholder">
                <div class="fc-eyebrow">${v.toUpperCase()}</div>
                <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;margin-top:6px;margin-bottom:4px">Coming soon.</div>
                <div style="font-size:13px;color:var(--muted)">This view is on the roadmap. In the meantime, Dashboard and Listings have the core functionality.</div>
              </div>
            </div>
          `).join('')}

          <!-- Settings view: Zillow Queue sync-token paste UI so iPhone /
               secondary devices can activate sync without DevTools. -->
          <div id="fc-view-settings" style="display:none">
            <div class="fc-card" style="max-width:640px">
              <div class="fc-card-hd">
                <div class="fc-card-title">Zillow Queue sync</div>
                <span class="fc-pill" id="fc-sync-status">checking…</span>
              </div>
              <div style="padding:16px 18px;font-size:13px;color:var(--ink-2);line-height:1.55">
                <p style="margin-bottom:12px">
                  Paste the sync token below to keep Zillow validations in step across devices.
                  Stored locally in this browser only — never sent anywhere except your own
                  <code style="font-family:var(--f-mono);font-size:12px">nestscoop-api</code> worker.
                </p>
                <label for="fc-sync-token-input" class="fc-eyebrow" style="display:block;margin-bottom:6px">Sync token</label>
                <input id="fc-sync-token-input" type="password" autocomplete="off" spellcheck="false"
                  placeholder="Paste 64-character token"
                  style="width:100%;padding:10px 12px;font-family:var(--f-mono);font-size:12px;
                         border:1px solid var(--hair);border-radius:6px;background:var(--paper-2);
                         color:var(--ink);outline:none;box-sizing:border-box" />
                <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                  <button id="fc-sync-save" class="fc-btn fc-btn-dark">Save &amp; sync</button>
                  <button id="fc-sync-upload" class="fc-btn">Upload local to server</button>
                  <button id="fc-sync-link" class="fc-btn">Copy activation link</button>
                  <button id="fc-sync-clear" class="fc-btn fc-btn-ghost">Clear token</button>
                </div>
                <div id="fc-sync-log" style="margin-top:14px;font-family:var(--f-mono);font-size:12px;
                     color:var(--muted);min-height:18px;white-space:pre-wrap"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ─── CSS ────────────────────────────────────────────────────────────────
  const CSS_CONTENT = `
/* Design tokens — promoted to :root so body background can resolve the var */
:root {
  --paper:   #FAF8F3;
  --paper-2: #F2EEE3;
  --paper-3: #EAE4D5;
  --white:   #FFFFFF;
  --ink:     #0E1728;
  --ink-2:   #1B2640;
  --ink-3:   #2A3655;
  --muted:   #6B6658;
  --muted-2: #8F897A;
  --hair:    #E6E1D6;
  --hair-2:  #D6CFBF;
  --gold:       oklch(0.72 0.13 85);
  --gold-deep:  oklch(0.56 0.12 78);
  --gold-soft:  oklch(0.94 0.04 85);
  --gold-ink:   oklch(0.38 0.1 75);
  --sage:       oklch(0.58 0.11 150);
  --sage-soft:  oklch(0.94 0.04 150);
  --coral:      oklch(0.58 0.17 30);
  --coral-soft: oklch(0.94 0.04 30);
  --sky:        oklch(0.58 0.11 235);
  --sky-soft:   oklch(0.94 0.03 235);
  --f-ui:    "Inter Tight", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --f-mono:  "JetBrains Mono", ui-monospace, Menlo, monospace;
  --f-serif: "Source Serif 4", Georgia, serif;
}

.fc-dash {
  --paper:   #FAF8F3;
  --paper-2: #F2EEE3;
  --paper-3: #EAE4D5;
  --white:   #FFFFFF;
  --ink:     #0E1728;
  --ink-2:   #1B2640;
  --ink-3:   #2A3655;
  --muted:   #6B6658;
  --muted-2: #8F897A;
  --hair:    #E6E1D6;
  --hair-2:  #D6CFBF;
  --gold:       oklch(0.72 0.13 85);
  --gold-deep:  oklch(0.56 0.12 78);
  --gold-soft:  oklch(0.94 0.04 85);
  --gold-ink:   oklch(0.38 0.1 75);
  --sage:       oklch(0.58 0.11 150);
  --sage-soft:  oklch(0.94 0.04 150);
  --coral:      oklch(0.58 0.17 30);
  --coral-soft: oklch(0.94 0.04 30);
  --sky:        oklch(0.58 0.11 235);
  --sky-soft:   oklch(0.94 0.03 235);
  --f-ui:    "Inter Tight", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --f-mono:  "JetBrains Mono", ui-monospace, Menlo, monospace;
  --f-serif: "Source Serif 4", Georgia, serif;
}

/* Dashboard renders on all viewports. Mobile adaptations (off-canvas sidebar,
   condensed topbar, stacked grids) are in a dedicated @media block at the
   very bottom of this stylesheet. */
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: var(--paper) !important;
    width: 100% !important;
    max-width: 100% !important;
    /* CRITICAL: original body CSS has display:flex + center alignment
       which causes fc-dash-root to shrink-wrap to content instead of
       filling the viewport. Force block layout so the dashboard spans
       the full window width. */
    display: block !important;
    align-items: stretch !important;
    justify-content: stretch !important;
    overflow-x: hidden !important;
    /* Prevent iOS body bounce when scrolling inside fc-main — keeps the
       shell locked so only the inner pane scrolls. */
    overscroll-behavior: none;
    overflow-y: hidden;
    /* Safe-area: the fixed .fc-topbar handles the top inset via its own
       padding-top, so body MUST NOT also pad top — that double-offsets
       fc-dash-root by ~60px on iPhone PWA, leaving a large gap between
       the topbar and first page content. Keep only the bottom inset
       for home-indicator clearance. */
    padding-bottom: env(safe-area-inset-bottom, 0) !important;
  }

  /* ─── Root layout ─── */
  #fc-dash-root.fc-dash {
    font-family: var(--f-ui);
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
    background: #FAF8F3;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "ss01", "cv11";
    font-variant-numeric: tabular-nums;
    /* iOS Safari 100vh bug: includes the address-bar area so content
       "jumps" when the bar collapses on scroll. 100dvh (dynamic viewport
       height) is the real visible area at any moment — locks the layout. */
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    /* Explicit width claim, independent of body's residual flex behavior */
    width: 100vw !important;
    max-width: 100vw !important;
    position: relative !important;
    left: 0 !important;
  }
  #fc-dash-root.fc-dash * { box-sizing: border-box; }
  #fc-dash-root.fc-dash svg { flex-shrink: 0; }

  /* ─── Topbar ─── */
  .fc-topbar {
    display: flex; align-items: center; gap: 12px;
    height: 48px; padding: 0 16px;
    border-bottom: 1px solid var(--hair);
    background: var(--paper);
    flex-shrink: 0;
  }
  .fc-brand {
    display: flex; align-items: center; gap: 10px;
    font-family: var(--f-serif); font-size: 17px; font-weight: 600;
    letter-spacing: -0.01em; color: var(--ink);
  }
  .fc-brand-mark {
    width: 26px; height: 26px;
    display: block;
    object-fit: contain;
    /* SVG already has its own rounded corners; no extra radius needed */
  }
  .fc-topbar-sep { width: 1px; height: 20px; background: var(--hair); }
  .fc-workspace {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--muted);
  }
  .fc-workspace strong { color: var(--ink); font-weight: 500; }
  .fc-workspace svg { width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 1.5; opacity: 0.5; }

  .fc-tb-search {
    position: relative;
    flex: 1; max-width: 420px;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--hair); border-radius: 5px;
    background: var(--paper-2);
    font-size: 12px; color: var(--muted);
    transition: border-color 120ms;
  }
  .fc-tb-search:focus-within {
    border-color: var(--gold-deep);
    background: var(--white);
  }
  .fc-tb-search svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .fc-tb-search input {
    flex: 1; min-width: 0;
    background: transparent; border: 0; outline: none;
    font-family: var(--f-ui); font-size: 12px;
    color: var(--ink);
  }
  .fc-tb-search input::placeholder { color: var(--muted); }
  .fc-tb-search kbd {
    font-family: var(--f-mono); font-size: 10px;
    padding: 1px 5px; border-radius: 3px;
    background: var(--paper); border: 1px solid var(--hair);
    color: var(--muted); margin-left: auto;
  }
  .fc-tb-search-results {
    position: absolute;
    top: calc(100% + 6px); left: 0; right: 0;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 5px;
    box-shadow: 0 8px 24px rgba(14, 23, 40, 0.12);
    max-height: 380px;
    overflow-y: auto;
    z-index: 100;
  }
  .fc-tb-search-result {
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--hair);
    transition: background 80ms;
  }
  .fc-tb-search-result:last-child { border-bottom: 0; }
  .fc-tb-search-result:hover,
  .fc-tb-search-result.selected {
    background: var(--paper-2);
  }
  .fc-tb-search-result-addr {
    font-size: 13px; font-weight: 500; color: var(--ink); margin-bottom: 2px;
  }
  .fc-tb-search-result-meta {
    font-family: var(--f-mono); font-size: 11px; color: var(--muted);
  }
  .fc-tb-search-result-empty {
    padding: 20px; text-align: center;
    font-family: var(--f-mono); font-size: 11px; color: var(--muted);
  }
  /* Sticky "View all N matches in Listings" row at top of the search results */
  .fc-tb-search-filter-all {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--hair);
    background: linear-gradient(90deg, var(--gold-soft) 0%, var(--paper-2) 100%);
    font-size: 12px; font-weight: 600; color: var(--gold-ink);
    transition: background 120ms;
    user-select: none;
  }
  .fc-tb-search-filter-all:hover { background: var(--gold-soft); }
  .fc-tb-search-filter-ico {
    width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--gold); color: var(--ink);
    border-radius: 3px;
    font-size: 12px; font-weight: 700;
  }
  .fc-tb-search-filter-all kbd {
    margin-left: auto;
    font-family: var(--f-mono); font-size: 10px;
    padding: 1px 6px; border-radius: 3px;
    background: var(--white); border: 1px solid var(--gold-deep);
    color: var(--gold-ink);
  }
  .fc-tb-search-result mark {
    background: var(--gold-soft); color: var(--gold-ink);
    padding: 0 2px; border-radius: 2px; font-weight: 600;
  }

  .fc-tb-right { margin-left: auto; display: flex; align-items: center; gap: 4px; }
  .fc-tb-btn {
    height: 28px; padding: 0 10px; border-radius: 5px;
    border: 1px solid transparent; background: transparent;
    color: var(--ink-3); font: inherit; font-size: 12px;
    display: inline-flex; align-items: center; gap: 6px;
    cursor: pointer;
  }
  .fc-tb-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .fc-tb-btn:hover { background: var(--paper-2); }
  .fc-tb-btn.fc-primary {
    background: var(--ink); color: var(--paper);
    border-color: var(--ink);
  }
  .fc-tb-btn.fc-primary svg { stroke-width: 2; }

  /* Stale-backup nudge: yellow dot on the gear icon when the user has
     unsaved Zillow validations and hasn't exported in 7+ days. */
  .fc-tb-btn.fc-tb-btn-nudge {
    position: relative;
  }
  .fc-tb-btn.fc-tb-btn-nudge::after {
    content: '';
    position: absolute;
    top: 4px; right: 4px;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--gold-deep);
    box-shadow: 0 0 0 2px var(--paper), 0 0 0 3px var(--gold-deep);
    animation: fc-nudge-pulse 2.2s ease-in-out infinite;
  }
  @keyframes fc-nudge-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.55; transform: scale(1.15); }
  }
  .fc-avatar {
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--gold); color: var(--ink);
    display: grid; place-items: center;
    font-size: 11px; font-weight: 600; letter-spacing: -0.02em;
    margin-left: 2px;
  }

  /* ─── Body: sidebar + main ─── */
  .fc-body { display: flex; flex: 1; min-height: 0; }

  /* ─── Sidebar ─── */
  .fc-sidebar {
    width: 220px; flex-shrink: 0;
    border-right: 1px solid var(--hair);
    background: var(--paper);
    display: flex; flex-direction: column;
    padding: 12px 0;
  }
  .fc-side-section { padding: 8px 10px; }
  .fc-side-label {
    font-family: var(--f-mono);
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--muted-2); padding: 6px 10px; font-weight: 500;
  }
  .fc-side-item {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px; margin: 1px 0;
    font-size: 13px; color: var(--ink-3);
    border-radius: 4px; cursor: pointer;
    position: relative;
    user-select: none;
  }
  .fc-side-item svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .fc-side-item:hover { background: var(--paper-2); color: var(--ink); }
  .fc-side-item.active {
    background: var(--ink); color: var(--paper);
  }
  .fc-side-item.active .fc-side-count { color: var(--gold); }
  .fc-side-count {
    margin-left: auto;
    font-family: var(--f-mono); font-size: 11px;
    color: var(--muted);
  }
  .fc-side-footer {
    margin-top: auto; padding: 12px 18px; border-top: 1px solid var(--hair);
  }

  /* ─── Main ─── */
  .fc-main {
    flex: 1 1 auto;
    min-width: 0;   /* critical — without it, flex children can shrink-wrap */
    overflow: auto;
    background: var(--paper);
  }
  .fc-main::-webkit-scrollbar { width: 10px; height: 10px; }
  .fc-main::-webkit-scrollbar-thumb { background: var(--hair-2); border-radius: 10px; border: 2px solid var(--paper); }
  .fc-main::-webkit-scrollbar-track { background: var(--paper); }
  /* Fully fluid — content fills whatever viewport width we have minus the
     sidebar. No max-width constraint. box-sizing: border-box ensures the
     32px padding is *inside* the 100% width rather than extending beyond. */
  .fc-main-inner {
    padding: 24px 32px;
    width: 100%;
    max-width: none !important;
    box-sizing: border-box;
  }

  /* NUCLEAR full-width: every direct child of .fc-main-inner and every
     direct child of a view container must claim 100% width. No element
     inside the main area gets to shrink-wrap. */
  .fc-main-inner > *,
  #fc-view-dashboard > *,
  #fc-view-listings > *,
  #fc-view-map,
  #fc-view-alerts > *,
  #fc-view-rehab > *,
  #fc-view-market > *,
  #fc-view-brrrr > *,
  #fc-view-settings > *,
  #fc-view-dashboard,
  #fc-view-listings,
  #fc-view-alerts,
  #fc-view-rehab,
  #fc-view-market,
  #fc-view-brrrr,
  #fc-view-settings,
  .fc-page-head,
  .fc-kpi-grid,
  .fc-two-col,
  .fc-card,
  .fc-stage-placeholder {
    width: 100% !important;
    max-width: none !important;
    box-sizing: border-box !important;
  }

  /* Tables: force full-width via table-layout auto so columns flex to fill
     the card horizontally. The 'hidden' overflow on .fc-card was clipping
     some tables visually — switch to auto so the table can drive width. */
  .fc-card {
    overflow: visible !important;
  }
  .fc-table {
    width: 100% !important;
    min-width: 100% !important;
    max-width: none !important;
    table-layout: auto !important;
    display: table !important;
    box-sizing: border-box !important;
  }

  /* Grid layouts use fr units so they fill the parent fully */
  .fc-kpi-grid {
    display: grid !important;
    grid-template-columns: repeat(4, 1fr) !important;
  }
  .fc-two-col {
    display: grid !important;
    grid-template-columns: 1.5fr 1fr !important;
  }

  /* Thinner scrollbar so it doesn't steal visible width from content */
  .fc-main::-webkit-scrollbar { width: 6px !important; height: 6px !important; }

  /* ─── Page head ─── */
  .fc-page-head {
    display: flex; align-items: flex-end; justify-content: space-between;
    padding-bottom: 20px; margin-bottom: 24px;
    border-bottom: 1px solid var(--hair);
  }
  .fc-page-title {
    font-family: var(--f-serif); font-weight: 600;
    font-size: 28px; letter-spacing: -0.02em;
    color: var(--ink); margin: 0;
  }
  .fc-page-sub { font-size: 13px; color: var(--muted); margin-top: 6px; }
  .fc-page-actions { display: flex; gap: 8px; align-items: center; }
  .fc-state-chips {
    display: inline-flex;
    gap: 0;
    background: var(--paper-2);
    border: 1px solid var(--hair);
    border-radius: 5px;
    padding: 2px;
    margin-right: 4px;
  }
  .fc-state-chips .fc-state-chip {
    border: 0;
    background: transparent;
    color: var(--muted);
    border-radius: 3px;
    font-weight: 500;
    padding: 0 10px;
    height: 24px;
    cursor: pointer;
    transition: background 120ms, color 120ms;
  }
  .fc-state-chips .fc-state-chip:hover { color: var(--ink); }
  .fc-state-chips .fc-state-chip.active {
    background: var(--white);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(14, 23, 40, 0.08);
  }
  .fc-state-count {
    display: inline-block;
    margin-left: 4px;
    font-size: 10px;
    color: var(--muted-2);
    font-family: var(--f-mono);
  }
  .fc-state-chips .fc-state-chip.active .fc-state-count { color: var(--muted); }
  .fc-z-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    font-size: 9px;
    font-family: var(--f-mono);
    font-weight: 600;
    background: var(--sage);
    color: var(--white);
    border-radius: 2px;
    letter-spacing: 0.3px;
    vertical-align: middle;
  }

  /* ─── Utilities ─── */
  .fc-eyebrow {
    font-family: var(--f-mono);
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--muted); font-weight: 500;
  }
  .fc-mono { font-family: var(--f-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .fc-pill {
    display: inline-flex; align-items: center; gap: 4px;
    font-family: var(--f-mono);
    font-size: 10.5px; font-weight: 500; letter-spacing: 0.02em;
    padding: 2px 7px; border-radius: 999px;
    background: var(--paper-2); color: var(--ink-3);
    border: 1px solid var(--hair);
    white-space: nowrap;
  }
  .fc-pill.sage  { background: var(--sage-soft); color: var(--sage); border-color: transparent; }
  .fc-pill.coral { background: var(--coral-soft); color: var(--coral); border-color: transparent; }
  .fc-pill.gold  { background: var(--gold-soft); color: var(--gold-ink); border-color: transparent; }
  .fc-pill.sky   { background: var(--sky-soft); color: var(--sky); border-color: transparent; }
  .fc-pill.ink   { background: var(--ink); color: var(--paper); border-color: transparent; }
  .fc-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: currentColor; }

  /* ─── Buttons ─── */
  .fc-btn {
    height: 30px; padding: 0 12px; border-radius: 4px;
    border: 1px solid var(--hair-2); background: var(--paper);
    color: var(--ink); font: inherit; font-size: 12px; font-weight: 500;
    display: inline-flex; align-items: center; gap: 6px;
    cursor: pointer; transition: background .15s;
    font-family: var(--f-ui);
  }
  .fc-btn:hover { background: var(--paper-2); }
  .fc-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .fc-btn.fc-btn-dark {
    background: var(--ink); color: var(--paper); border-color: var(--ink);
  }
  .fc-btn.fc-btn-dark:hover { background: var(--ink-2); }

  /* ─── Stage placeholder card ─── */
  .fc-stage-placeholder {
    background: var(--white);
    border: 1px dashed var(--hair-2);
    border-radius: 6px;
    padding: 24px 28px;
    color: var(--ink);
  }

  /* ─── Two-column grid ─── */
  .fc-two-col {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 20px;
  }

  /* ─── Card ─── */
  .fc-card {
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 6px;
    overflow: hidden;
  }
  .fc-card-hd {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--hair);
  }
  /* Quick-filter dropdowns at the top of the Listings view. */
  .fc-qf-select {
    padding: 6px 10px;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 4px;
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--ink-2);
    cursor: pointer;
    outline: none;
    flex: 0 1 auto;
    min-width: 130px;
  }
  .fc-qf-select:focus { border-color: var(--accent2); }
  .fc-qf-select.fc-qf-active {
    border-color: var(--accent);
    background: #fff8f6;
    color: var(--accent);
    font-weight: 600;
  }
  .fc-card-title {
    font-size: 13px; font-weight: 600;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  .fc-btn.fc-btn-sm { height: 24px; padding: 0 8px; font-size: 11px; border-radius: 3px; }
  .fc-btn.fc-btn-ghost { border-color: transparent; background: transparent; }
  .fc-btn.fc-btn-ghost:hover { background: var(--paper-2); }
  .fc-btn.fc-btn-ghost.active { background: var(--paper-2); color: var(--ink); }

  /* ─── Table ─── */
  .fc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .fc-table th {
    text-align: left;
    font-family: var(--f-mono);
    font-size: 10px; letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--muted);
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    background: var(--paper-2);
  }
  .fc-table td {
    padding: 10px 12px;
    color: var(--ink-2);
    border-bottom: 1px solid var(--hair);
    vertical-align: middle;
  }
  .fc-table tr:last-child td { border-bottom: none; }
  .fc-table tr:hover td { background: var(--paper-2); }

  .fc-prop-init {
    width: 28px; height: 28px;
    background: var(--paper-3); color: var(--ink);
    display: grid; place-items: center;
    border-radius: 4px;
    font-family: var(--f-serif);
    font-size: 11px; font-weight: 600;
  }
  .fc-prop-addr {
    font-weight: 500; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 240px;
  }
  .fc-prop-meta {
    font-size: 11px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 240px;
  }

  /* ─── Row click affordance ─── */
  .fc-row-clickable { cursor: pointer; }
  .fc-row-clickable:hover .fc-open-btn {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }

  /* ─── Property drawer ─── */
  .fc-drawer-backdrop {
    position: fixed; inset: 0;
    background: rgba(14, 23, 40, 0);
    z-index: 90;
    pointer-events: none;
    transition: background 0.2s ease;
  }
  .fc-drawer-backdrop.open {
    background: rgba(14, 23, 40, 0.28);
    pointer-events: auto;
  }
  .fc-drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 520px; max-width: calc(100vw - 40px);
    background: var(--paper);
    border-left: 1px solid var(--hair);
    box-shadow: -4px 0 24px rgba(14, 23, 40, 0.08);
    z-index: 100;
    transform: translateX(100%);
    transition: transform 0.25s cubic-bezier(.4,.0,.2,1);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .fc-drawer.open { transform: translateX(0); }

  .fc-drawer-head {
    position: relative;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--hair);
    background: var(--paper);
    flex-shrink: 0;
  }
  .fc-drawer-close {
    position: absolute; top: 14px; right: 16px;
    width: 28px; height: 28px;
    border-radius: 4px; border: 1px solid var(--hair);
    background: var(--white); color: var(--ink-3);
    font-size: 18px; line-height: 1;
    cursor: pointer;
    display: grid; place-items: center;
  }
  .fc-drawer-close:hover { background: var(--paper-2); }

  .fc-drawer-hero {
    display: flex; gap: 14px; align-items: flex-start;
  }
  .fc-drawer-hero-body { flex: 1; min-width: 0; padding-right: 32px; }
  .fc-drawer-address {
    font-family: var(--f-serif);
    font-size: 20px; font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
    line-height: 1.2;
    margin-bottom: 4px;
  }
  .fc-drawer-subaddr {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .fc-drawer-tags {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .fc-grade-large {
    display: grid; place-items: center;
    width: 56px; height: 56px;
    border-radius: 6px;
    font-family: var(--f-serif);
    font-weight: 700;
    font-size: 28px;
    letter-spacing: -0.02em;
  }

  .fc-drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 24px;
  }
  .fc-drawer-body::-webkit-scrollbar { width: 8px; }
  .fc-drawer-body::-webkit-scrollbar-thumb { background: var(--hair-2); border-radius: 8px; }
  .fc-drawer-body::-webkit-scrollbar-track { background: var(--paper); }

  /* ─── Media (street view + interactive map + external links) ─── */
  .fc-drawer-media {
    position: relative;
    margin: 16px 24px 12px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    overflow: hidden;
    background: var(--paper-2);
  }
  .fc-streetview {
    display: block;
    width: 100%;
    height: 220px;
    object-fit: cover;
    background: var(--paper-3);
  }
  .fc-streetview-fallback {
    display: none;
    flex-direction: column; align-items: center; justify-content: center;
    min-height: 140px;
    padding: 24px 20px;
    text-align: center;
    background: var(--paper-2);
  }

  .fc-drawer-map-wrap {
    margin: 0 24px 12px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    overflow: hidden;
    background: var(--paper-2);
  }
  .fc-map-embed {
    display: block;
    width: 100%;
    height: 260px;
    border: 0;
  }

  .fc-drawer-media-actions {
    margin: 0 24px 16px;
    padding: 14px 16px;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 6px;
  }
  .fc-media-btnrow {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .fc-media-note {
    margin-top: 10px;
    font-size: 11px;
    color: var(--muted);
    line-height: 1.5;
    padding-top: 10px;
    border-top: 1px solid var(--hair);
  }

  .fc-drawer-section {
    padding: 16px 24px;
    border-bottom: 1px solid var(--hair);
  }
  .fc-drawer-section:last-child { border-bottom: none; }
  .fc-drawer-section-hd {
    font-family: var(--f-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
    margin-bottom: 10px;
  }
  .fc-drawer-section-body { display: flex; flex-direction: column; gap: 6px; }

  /* ── Share card ──────────────────────────────────────────────────── */
  .fc-share-card {
    display: flex; flex-direction: column; gap: 14px;
  }
  .fc-share-preview {
    background: linear-gradient(135deg, var(--paper-2) 0%, var(--paper-3) 100%);
    border: 1px solid var(--hair);
    border-radius: 8px;
    padding: 16px;
    position: relative;
    overflow: hidden;
  }
  .fc-share-preview::before {
    content: '';
    position: absolute; inset: 0;
    background:
      radial-gradient(circle at top right, var(--gold-soft) 0%, transparent 40%);
    opacity: 0.5;
    pointer-events: none;
  }
  .fc-share-preview-head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 14px;
    position: relative;
  }
  .fc-share-preview-addr {
    font-family: var(--f-serif);
    font-size: 16px; font-weight: 600; color: var(--ink);
    line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fc-share-preview-sub {
    font-family: var(--f-mono); font-size: 10px; color: var(--muted);
    margin-top: 2px;
  }
  .fc-share-preview-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    padding: 12px;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 6px;
    margin-bottom: 10px;
    position: relative;
  }
  .fc-share-stat {
    text-align: center;
  }
  .fc-share-stat-val {
    font-family: var(--f-mono); font-size: 14px; font-weight: 600;
    color: var(--ink); line-height: 1.2;
  }
  .fc-share-stat-val.sage { color: var(--sage); }
  .fc-share-stat-key {
    font-family: var(--f-mono); font-size: 9px;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); margin-top: 3px;
  }
  .fc-share-preview-url {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px;
    background: var(--white);
    border: 1px dashed var(--hair-2);
    border-radius: 5px;
    font-family: var(--f-mono); font-size: 10px;
    color: var(--muted);
    position: relative;
  }
  .fc-share-url-icon { opacity: 0.6; }
  .fc-share-url-text {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--ink-3);
  }

  .fc-share-actions {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .fc-share-tile {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 12px 8px;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 6px;
    cursor: pointer;
    text-decoration: none;
    color: var(--ink);
    font-family: var(--f-ui);
    transition: transform 120ms, border-color 120ms, box-shadow 120ms, background 120ms;
  }
  .fc-share-tile:hover {
    border-color: var(--gold-deep);
    background: var(--gold-soft);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(14, 23, 40, 0.08);
  }
  .fc-share-tile:active { transform: translateY(0); }
  .fc-share-tile-icon { font-size: 20px; line-height: 1; }
  .fc-share-tile-label {
    font-size: 11px; font-weight: 500; color: var(--ink-2);
  }

  .fc-share-feedback {
    min-height: 14px;
    font-family: var(--f-mono); font-size: 11px;
    color: var(--sage);
    text-align: center;
    transition: opacity 200ms;
  }

  @media (max-width: 540px) {
    .fc-share-actions { grid-template-columns: repeat(2, 1fr); }
    .fc-nbhd-grid { grid-template-columns: repeat(2, 1fr); }
  }

  /* ── 203(k) Financing view ──────────────────────────────────────── */
  .fc-203k-chip {
    display: inline-flex; align-items: center; gap: 4px;
  }
  .fc-203k-chip.active {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .fc-203k-chip.active .fc-state-count {
    color: var(--gold);
  }
  .fc-203k-row {
    display: grid;
    grid-template-columns: 1.1fr 1fr 1.2fr;
    gap: 20px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--hair);
  }
  .fc-203k-row:last-of-type { border-bottom: 0; }
  .fc-203k-prop {
    display: flex; flex-direction: column;
  }
  /* Fit score badge */
  .fc-203k-fit {
    display: flex; flex-direction: column; align-items: center;
    padding: 8px 12px;
    border-radius: 8px;
    min-width: 70px;
    border: 1.5px solid;
    font-family: var(--f-mono);
    cursor: help;
  }
  .fc-203k-fit-score {
    font-size: 22px; font-weight: 700; line-height: 1;
  }
  .fc-203k-fit-label {
    font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase;
    margin-top: 3px; font-weight: 600;
  }
  .fc-203k-fit-sage  { background: var(--sage-soft);  border-color: var(--sage);       color: var(--sage); }
  .fc-203k-fit-sky   { background: var(--sky-soft);   border-color: var(--sky);        color: var(--sky); }
  .fc-203k-fit-muted { background: var(--paper-2);    border-color: var(--hair-2);     color: var(--muted); }
  .fc-203k-fit-coral { background: var(--coral-soft); border-color: var(--coral);      color: var(--coral); }

  .fc-203k-math {
    background: var(--paper-2);
    border: 1px solid var(--hair);
    border-radius: 6px;
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .fc-203k-math-row {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: var(--f-mono); font-size: 12px;
  }
  .fc-203k-math-row.fc-203k-total {
    padding-top: 6px; margin-top: 2px;
    border-top: 1px dashed var(--hair-2);
    font-weight: 600; color: var(--ink);
  }
  .fc-203k-math-row.fc-203k-piti {
    padding-top: 6px; margin-top: 2px;
    border-top: 1px solid var(--hair);
    font-weight: 600;
    font-size: 14px;
    color: var(--ink);
  }
  .fc-203k-key { color: var(--muted); }
  .fc-203k-val { color: var(--ink); font-weight: 500; }
  .fc-203k-val.sage { color: var(--sage); font-weight: 600; }

  .fc-203k-actions {
    display: flex; flex-direction: column;
  }
  .fc-203k-reasons {
    display: flex; flex-direction: column; gap: 3px;
  }
  .fc-203k-reason {
    display: flex; justify-content: space-between;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    line-height: 1.3;
    border-left: 2px solid transparent;
  }
  .fc-203k-reason-sage  { background: var(--sage-soft);  border-left-color: var(--sage); }
  .fc-203k-reason-sky   { background: var(--sky-soft);   border-left-color: var(--sky); }
  .fc-203k-reason-muted { background: var(--paper-2);    border-left-color: var(--hair-2); }
  .fc-203k-reason-coral { background: var(--coral-soft); border-left-color: var(--coral); }
  .fc-203k-reason-k { color: var(--muted); font-family: var(--f-mono); font-size: 10px; }
  .fc-203k-reason-v { color: var(--ink-2); font-weight: 500; }

  /* Watchlist star + toggle on 203(k) rows */
  .fc-203k-star {
    color: var(--gold-deep);
    font-size: 14px;
    line-height: 1;
    text-shadow: 0 1px 0 rgba(0,0,0,0.05);
  }
  .fc-203k-watch-btn.watched {
    background: var(--gold-soft, #FFF4D6);
    border-color: var(--gold-deep);
    color: var(--gold-deep);
    font-weight: 600;
  }

  /* Consultant requirement callout */
  .fc-203k-consult {
    padding: 10px 12px;
    border-radius: 4px;
    border-left: 3px solid;
    font-size: 11px;
  }
  .fc-203k-consult-head {
    display: flex; align-items: center; gap: 6px;
    font-weight: 600;
    font-size: 12px;
  }
  .fc-203k-consult-ico {
    font-size: 13px; line-height: 1;
  }
  .fc-203k-consult-req {
    background: var(--sky-soft);
    border-left-color: var(--sky);
    color: var(--ink);
  }
  .fc-203k-consult-req .fc-203k-consult-ico { color: var(--sky); }
  .fc-203k-consult-none {
    background: var(--sage-soft);
    border-left-color: var(--sage);
    color: var(--ink);
  }
  .fc-203k-consult-none .fc-203k-consult-ico { color: var(--sage); }

  @media (max-width: 900px) {
    .fc-203k-row {
      grid-template-columns: 1fr;
    }
  }

  /* ── Neighborhood tile grid (POI shortcuts) ─────────────────────── */
  .fc-nbhd-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .fc-nbhd-tile {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 10px 6px;
    background: var(--white);
    border: 1px solid var(--hair);
    border-radius: 6px;
    text-decoration: none;
    color: var(--ink);
    font-family: var(--f-ui);
    transition: transform 120ms, border-color 120ms, background 120ms;
  }
  .fc-nbhd-tile:hover {
    border-color: var(--gold-deep);
    background: var(--gold-soft);
    transform: translateY(-1px);
  }
  .fc-nbhd-tile:active { transform: translateY(0); }
  .fc-nbhd-tile-icon { font-size: 18px; line-height: 1; }
  .fc-nbhd-tile-label {
    font-size: 11px; font-weight: 500; color: var(--ink-2);
  }

  .fc-kv {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 12px;
    padding: 4px 0;
  }
  .fc-kv-label {
    font-size: 12px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .fc-kv-value {
    font-family: var(--f-mono);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .fc-kv-caption {
    display: block;
    font-family: var(--f-ui);
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0;
    margin-top: 2px;
  }

  .fc-playbook {
    padding-left: 20px;
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--ink);
    line-height: 1.55;
  }
  .fc-playbook li { margin-bottom: 5px; }
  .fc-playbook-note {
    font-size: 12px;
    color: var(--muted);
    padding: 10px 12px;
    background: var(--paper-2);
    border-radius: 4px;
    border-left: 3px solid var(--gold);
    line-height: 1.5;
  }

  .fc-drawer-actions {
    display: flex; gap: 8px;
    padding: 16px 24px 20px;
    border-top: 1px solid var(--hair);
    background: var(--paper);
    position: sticky; bottom: 0;
    margin-top: auto;
  }

  /* ─── Letter grade badge ─── */
  .fc-grade {
    display: inline-flex; align-items: center; justify-content: center;
    font-family: var(--f-serif); font-weight: 700;
    font-size: 14px; letter-spacing: -0.02em;
    min-width: 32px; height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid transparent;
  }

  /* ─── Hot counties rows ─── */
  .fc-hc-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--hair);
  }
  .fc-hc-row:last-child { border-bottom: none; }
  .fc-hc-row:hover { background: var(--paper-2); }

  /* ─── AI Coach ─── */
  .fc-coach-quote {
    font-family: var(--f-serif);
    font-size: 15px; font-style: italic;
    color: var(--ink);
    line-height: 1.55;
  }
  .fc-coach-quote strong { font-style: normal; font-weight: 600; }
  .fc-coach-quote u { text-decoration: underline; text-decoration-color: var(--gold); text-decoration-thickness: 2px; text-underline-offset: 3px; font-style: normal; }
  .fc-coach-stats {
    margin-top: 14px; padding-top: 14px;
    border-top: 1px solid var(--hair);
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
  }

  .fc-btn.fc-btn-gold {
    background: var(--gold);
    color: var(--ink);
    border-color: var(--gold-deep);
  }
  .fc-btn.fc-btn-gold:hover {
    background: oklch(0.76 0.13 85);
  }

  /* ─── Signals feed ─── */
  .fc-signal {
    padding: 12px 16px;
    border-bottom: 1px solid var(--hair);
  }
  .fc-signal:last-child { border-bottom: none; }
  .fc-signal-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
  }
  .fc-signal-time {
    margin-left: auto;
    font-size: 10px;
    color: var(--muted);
  }
  .fc-signal-body {
    font-size: 13px;
    color: var(--ink);
    line-height: 1.45;
  }
  .fc-signal-ctx {
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }

  /* Clickable live-signal rows (drill-down into Listings) */
  .fc-signal-clickable {
    cursor: pointer;
    transition: background 120ms, border-left-color 120ms;
    border-left: 3px solid transparent;
  }
  .fc-signal-clickable:hover {
    background: var(--paper-2);
    border-left-color: var(--gold);
  }
  .fc-signal-clickable:hover .fc-signal-cta {
    color: var(--gold-ink);
    transform: translateX(2px);
  }
  .fc-signal-clickable:focus-visible {
    outline: 2px solid var(--gold-deep);
    outline-offset: -2px;
  }
  .fc-signal-cta {
    margin-top: 8px;
    font-family: var(--f-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    transition: color 120ms, transform 200ms;
  }

  /* Active-filter chip at top of Listings view */
  #fc-listings-filter-chip { padding: 0 16px; }
  .fc-filter-chip-active {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: linear-gradient(90deg, var(--gold-soft) 0%, var(--paper-2) 100%);
    border: 1px solid var(--gold-deep);
    border-left: 3px solid var(--gold-deep);
    border-radius: 5px;
    margin: 12px 0;
    animation: fc-chip-in 220ms ease-out;
  }
  @keyframes fc-chip-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fc-filter-chip-icon { font-size: 14px; }
  .fc-filter-chip-label {
    flex: 1;
    font-family: var(--f-ui);
    font-size: 12px;
    color: var(--ink);
  }
  .fc-filter-chip-label strong { color: var(--gold-ink); }
  .fc-filter-chip-count {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--muted);
    padding: 2px 8px;
    background: var(--white);
    border-radius: 10px;
    border: 1px solid var(--hair);
  }
  .fc-filter-chip-clear {
    background: transparent;
    border: 0;
    font-size: 14px;
    line-height: 1;
    color: var(--muted);
    cursor: pointer;
    width: 22px; height: 22px;
    border-radius: 3px;
    transition: background 120ms, color 120ms;
  }
  .fc-filter-chip-clear:hover {
    background: var(--hair);
    color: var(--ink);
  }

  /* ─── KPI grid ─── */
  .fc-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border: 1px solid var(--hair);
    border-radius: 6px;
    overflow: hidden;
    background: var(--white);
  }
  .fc-kpi {
    padding: 16px 18px;
    border-right: 1px solid var(--hair);
    display: flex; flex-direction: column; gap: 6px;
    position: relative;
    min-height: 110px;
  }
  .fc-kpi:last-child { border-right: none; }
  .fc-kpi-label { display: flex; align-items: center; gap: 6px; }
  .fc-kpi-value {
    font-family: var(--f-mono);
    font-size: 28px; font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--ink);
    line-height: 1;
  }
  .fc-kpi-delta {
    display: inline-flex; align-items: center; gap: 3px;
    font-family: var(--f-mono);
    font-size: 11px; font-weight: 500;
    color: var(--muted);
  }
  .fc-kpi-delta.sage  { color: var(--sage); }
  .fc-kpi-delta.coral { color: var(--coral); }
  .fc-kpi-delta.muted { color: var(--muted); }
  .fc-kpi-spark {
    position: absolute;
    right: 14px; top: 14px;
    width: 64px; height: 32px;
    opacity: 0.8;
  }

  /* ───────────────────────────────────────────────────────────────────────
     Auth gate overlay + role-based visibility
     ─────────────────────────────────────────────────────────────────── */
  #fc-auth-overlay {
    position: fixed; inset: 0; z-index: 100000;
    background: linear-gradient(180deg, #0E1728 0%, #1B2640 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    font-family: "Inter Tight", "Inter", system-ui, -apple-system, sans-serif;
    animation: fc-auth-in 240ms ease-out;
  }
  @keyframes fc-auth-in { from { opacity: 0 } to { opacity: 1 } }
  .fc-auth-card {
    width: min(440px, 100%);
    background: #FAF8F3;
    border-radius: 10px;
    padding: 36px 32px 28px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.4);
  }
  .fc-auth-brand {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 4px;
  }
  .fc-auth-title {
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 26px; font-weight: 600; letter-spacing: -0.01em;
    color: #0E1728;
  }
  .fc-auth-sub {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
    color: #6B6658; margin-bottom: 26px;
  }
  .fc-auth-form {
    display: flex; flex-direction: column; gap: 10px;
  }
  .fc-auth-label {
    font-size: 12px; font-weight: 600; color: #0E1728;
  }
  .fc-auth-input {
    width: 100%;
    padding: 11px 12px;
    border: 1.5px solid #D6CFBF;
    border-radius: 5px;
    font-family: "JetBrains Mono", monospace;
    font-size: 14px; color: #0E1728;
    background: #FFFFFF;
    outline: none; box-sizing: border-box;
    transition: border-color 140ms;
  }
  .fc-auth-input:focus { border-color: oklch(0.56 0.12 78); }
  .fc-auth-error {
    min-height: 18px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px; color: oklch(0.58 0.17 30);
  }
  .fc-auth-submit {
    width: 100%;
    padding: 11px 14px;
    background: #0E1728; color: #FAF8F3;
    border: 0; border-radius: 5px;
    font-family: "Inter Tight", "Inter", system-ui, sans-serif;
    font-size: 14px; font-weight: 600;
    cursor: pointer;
    transition: opacity 120ms;
  }
  .fc-auth-submit:hover { opacity: 0.92; }
  .fc-auth-foot {
    margin-top: 14px;
    font-size: 11px; color: #6B6658; line-height: 1.5;
    text-align: center;
  }

  /* Topbar role chip */
  .fc-role-chip {
    font-family: var(--f-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: var(--paper-2);
    border: 1px solid var(--hair);
    color: var(--ink);
    padding: 0 8px;
  }
  .fc-role-chip:hover { background: var(--hair); }
  body.fc-role-admin  .fc-role-chip { color: var(--gold-ink); border-color: var(--gold-deep); }
  body.fc-role-viewer .fc-role-chip { color: var(--sky); border-color: var(--sky); }

  /* Viewer hides: keep the app clean + enforce read-only at the UI layer.
     (Bypassable in DevTools — client-side gate is intentional, not secure.) */
  body.fc-role-viewer .fc-side-item[data-view="zillow-queue"],
  body.fc-role-viewer #fc-tb-keys,
  body.fc-role-viewer #fc-tb-watchlist,
  body.fc-role-viewer .fc-203k-watch-btn,
  body.fc-role-viewer .fc-203k-chip[data-status="WATCH"],
  body.fc-role-viewer #fc-zq-watch,
  body.fc-role-viewer #fc-coach-pin {
    display: none !important;
  }
  /* Viewer — map-view relocates the mobile-frame. Hide the legacy mobile
     "Open watchlist" if any similar admin buttons exist in the drawer. */

  /* ───────────────────────────────────────────────────────────────────────
     Mobile adaptations (≤768px)
     - Sidebar becomes off-canvas drawer, hamburger in topbar toggles it
     - Topbar condenses: hide workspace breadcrumb + search bar
     - Main content: full-width single column
     - Grids (KPI, page-head actions) stack
     - Hide duplicate mobile-frame chrome when Map view relocates it in
     ─────────────────────────────────────────────────────────────────── */
  .fc-tb-hamburger {
    display: none; /* desktop default — shown in the mobile @media block */
    background: transparent; border: 0; padding: 4px; border-radius: 4px;
    color: var(--ink); cursor: pointer; align-items: center; justify-content: center;
  }
  .fc-tb-hamburger:hover { background: var(--paper-2); }
  .fc-sidebar-backdrop {
    display: none;
    position: fixed; inset: 0;
    background: rgba(14, 23, 40, 0.45);
    z-index: 998;
    backdrop-filter: blur(1px);
  }
  .fc-sidebar-backdrop.open { display: block; animation: fc-bd-in 180ms ease-out; }
  @keyframes fc-bd-in { from { opacity: 0 } to { opacity: 1 } }

  @media (max-width: 768px) {
    /* Lock horizontal — no element is allowed to push past the viewport
       edge. The page should ONLY scroll vertically on mobile; wide tables
       scroll inside their own containers (see .fc-table-scroll below). */
    html, body, #fc-dash-root, .fc-body, .fc-main, .fc-main-inner {
      overflow-x: hidden !important;
      max-width: 100vw !important;
    }
    #fc-dash-root.fc-dash { width: 100vw !important; }

    .fc-tb-hamburger { display: inline-flex; }
    .fc-topbar {
      flex-wrap: wrap;
      padding: 8px 10px;
      gap: 6px;
      height: auto;
      /* Pin topbar to viewport top absolutely so no scroll or layout
         shift can push it out of view. Sidebar + main compensate via
         padding-top so content starts below the fixed topbar. */
      position: fixed !important;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      background: var(--paper);
      box-shadow: 0 1px 0 var(--hair);
      padding-top: calc(8px + env(safe-area-inset-top, 0));
    }
    /* Reserve topbar space. The initial fallback (120px) covers a
       2-row wrapped topbar with safe-area insets; measureTopbar()
       overrides --topbar-h with the actual rendered height + 8px
       buffer once layout settles. */
    .fc-body {
      padding-top: var(--topbar-h, 120px);
    }
    /* Sidebar drawer starts below the fixed topbar */
    .fc-sidebar {
      top: var(--topbar-h, 120px) !important;
      height: calc(100dvh - var(--topbar-h, 120px)) !important;
    }
    /* Trim fc-main-inner top padding on mobile — page-head has its own
       rhythm, no need for extra gap above the eyebrow. */
    .fc-main-inner { padding-top: 6px !important; }
    /* Smooth momentum scroll on iOS for the main pane. Vertical-only. */
    .fc-main {
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      overflow-x: hidden !important;
      overflow-y: auto;
    }

    /* Tables: force them to scroll inside a container rather than pushing
       the whole page sideways. Apply to every .fc-table's parent element
       so users can swipe horizontally on the table alone. */
    .fc-table {
      display: block !important;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      white-space: nowrap;
      min-width: 100% !important;
      max-width: 100% !important;
      width: 100% !important;
    }
    .fc-table thead, .fc-table tbody {
      display: table !important;
      width: max-content;
      min-width: 100%;
    }
    .fc-table th, .fc-table td {
      padding: 8px 10px;
      font-size: 11.5px;
    }

    /* KPI tiles on mobile — avoid forcing a wide grid that overflows */
    .fc-kpi-grid { min-width: 0 !important; }
    .fc-kpi { min-height: 90px; padding: 12px; }

    /* Any card that has overflow:visible on desktop — clamp on mobile */
    .fc-card {
      max-width: 100% !important;
      min-width: 0 !important;
    }
    /* Hide the legacy floating Auction Calendar button — it's positioned
       fixed relative to the viewport (not inside .mobile-frame) so it
       bleeds through onto the dashboard on mobile. Its auction-calendar
       feature isn't wired into the new dashboard yet. */
    .floating-calendar-btn { display: none !important; }
    /* Hide breadcrumb on mobile — too cramped. Keep search visible so
       users can filter by city/zip/etc. on their phone. */
    .fc-topbar-sep,
    .fc-workspace { display: none; }
    /* Search bar drops to its own full-width row below the brand/buttons */
    .fc-tb-search {
      order: 10;
      flex: 1 1 100%;
      max-width: none;
    }
    .fc-tb-search kbd { display: none; } /* hide ⌘K hint on mobile */
    /* Condense topbar right side */
    .fc-tb-right { gap: 2px; }
    .fc-tb-btn { padding: 0 6px; font-size: 11px; height: 26px; }
    .fc-tb-btn[title="Notifications"] { display: none; } /* trim — notifications aren't wired yet */
    /* Keep Data Keys button on mobile — new devices need it to enter/import keys */

    /* Sidebar becomes off-canvas drawer */
    .fc-sidebar {
      position: fixed;
      top: 48px; left: 0;
      height: calc(100% - 48px); height: calc(100dvh - 48px);
      width: 260px;
      transform: translateX(-100%);
      transition: transform 240ms cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 999;
      box-shadow: 2px 0 24px rgba(14, 23, 40, 0.12);
    }
    .fc-sidebar.open { transform: translateX(0); }
    body.fc-sidebar-locked { overflow: hidden; }

    /* Sidebar is position:fixed (off-canvas drawer) so it's out of the
       normal flow. fc-body stays flex-row; fc-main is the only in-flow
       child and takes 100% width naturally. Keeping the flex parent is
       critical so fc-main inherits its height from the flex layout
       (without it, fc-main collapses to content height and the scroll
       wraps/clips the page-head). */
    .fc-main { width: 100%; }
    .fc-main-inner { padding: 12px !important; }

    /* Page head: stack title + state chips */
    .fc-page-head { flex-direction: column; align-items: flex-start; gap: 10px; }
    .fc-page-actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }

    /* KPI grid: 2 cols on mobile */
    .fc-kpi-grid { grid-template-columns: 1fr 1fr; }
    .fc-kpi { border-right: none; border-bottom: 1px solid var(--hair); }
    .fc-kpi:nth-child(odd) { border-right: 1px solid var(--hair); }
    .fc-kpi-spark { display: none; } /* sparks overflow on narrow cards */

    /* Dashboard layout card splits: stack everything */
    .fc-section-grid,
    .fc-coach-stats,
    .fc-share-actions,
    .fc-nbhd-grid { grid-template-columns: 1fr !important; }

    /* 203(k) rows are already @max-width:900px 1fr, good */

    /* Mobile-frame (hosts Google Map) — hide ALL legacy PWA chrome on
       mobile so the Map view is clean. Without these, users see leftover
       FC wordmark, filter bar, stats banner, "View All Properties" big
       orange button, "Filter by Type" legend, and floating calendar
       button bleeding through over the dashboard. */
    .mobile-frame .ptr-progress,
    .mobile-frame .ptr-indicator,
    .mobile-frame header,
    .mobile-frame .api-bar,
    .mobile-frame .filter-bar,
    .mobile-frame .stats-banner,
    .mobile-frame .filter-sidebar,
    .mobile-frame .mobile-bottom-bar,
    .mobile-frame [class*="mobile-bottom"],
    .mobile-frame .floating-calendar-btn,
    .mobile-frame .list-view-btn,
    .mobile-frame .map-overlay,
    .mobile-frame .source-legend {
      display: none !important;
    }
    /* Strip mobile-frame bg + padding so the map is edge-to-edge */
    .mobile-frame .app,
    .mobile-frame .app::before {
      padding: 0 !important;
      background-image: none !important;
      background: transparent !important;
    }
    .mobile-frame .map-panel {
      padding: 0 !important;
      margin: 0 !important;
    }
    .mobile-frame #map {
      width: 100% !important;
      height: 100% !important;
      min-height: 60vh !important;
    }

    /* fc-view-map has a negative margin (-24px -32px) to bleed the map
       edge-to-edge on desktop. On mobile that collapses past the 12px
       padding of fc-main-inner and causes horizontal overflow. Reset.
       Height tuned to fit within fc-main without forcing scroll — leaves
       page-head (~140px), topbar padding (88px) + safe-area (~50px) +
       bottom buffer visible above the map. */
    #fc-view-map {
      margin: 0 !important;
      width: 100%;
      height: calc(100dvh - 320px);
      min-height: 280px;
    }
    #fc-view-map .mobile-frame {
      height: 100% !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    /* Zillow Queue card — remove side padding buffer on tight screens */
    #fc-view-zillow-queue .fc-card { margin: 0 !important; }
  }

  @media (max-width: 420px) {
    .fc-kpi-grid { grid-template-columns: 1fr; }
    .fc-kpi { border-right: none !important; }
    .fc-kpi:nth-child(odd) { border-right: none !important; }
  }
`;

})();
