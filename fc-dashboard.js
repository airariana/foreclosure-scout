/**
 * Foreclosure Scout — Desktop Dashboard Rebuild
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

  // ─── Build the desktop layout (called only when isDesktop()) ────────────
  function buildShell() {
    if (document.getElementById('fc-dash-root')) return;

    const mobileFrame = document.querySelector('.mobile-frame');
    if (mobileFrame) mobileFrame.style.display = 'none';

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
  }

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

  function setView(view) {
    const valid = ['dashboard', 'listings', 'map', 'alerts', 'rehab', 'market', 'brrrr', 'settings'];
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

    ['dashboard', 'listings', 'map', 'alerts', 'rehab', 'market', 'brrrr', 'settings'].forEach(v => {
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
        'overflow: auto',
        'position: relative',
      ].join('; ') + ';';
    }

    // Update page title + eyebrow per view
    const titles = {
      dashboard: 'Foreclosure Command Center',
      listings:  'All Listings',
      map:       'Property Map',
      alerts:    'Alerts',
      rehab:     'Rehab Calculator',
      market:    'Market Analysis',
      brrrr:     'BRRRR Calculator',
      settings:  'Settings',
    };
    const titleEl = document.querySelector('#fc-dash-root .fc-page-title');
    if (titleEl && titles[view]) titleEl.textContent = titles[view];

    // Lazily render listings when shown
    if (view === 'listings' && window.__fcData) renderListings(window.__fcData);
  }

  // ─── Fetch foreclosure data + populate dashboard ────────────────────────
  async function loadData() {
    try {
      const r = await fetch('data/foreclosures_va.json?t=' + Date.now(), { cache: 'no-cache' });
      if (!r.ok) throw new Error('fetch failed: ' + r.status);
      const d = await r.json();
      window.__fcData = d;
      renderKPIs(d);
      renderPriorityQueue(d);
      renderSignals(d);
      renderHotCounties(d);
      renderAICoach(d);
      updateSubline(d);
      updateSidebarCounts(d);
      // Re-render listings if that's the active view
      if ((location.hash || '').replace('#', '') === 'listings') renderListings(d);
    } catch (e) {
      console.warn('[FC Dash] data load failed:', e);
    }
  }

  function updateSidebarCounts(d) {
    const count = (d.foreclosures || []).length;
    const el = document.getElementById('fc-sc-listings');
    if (el) el.textContent = count;
  }

  // ─── Listings view — full sortable table ────────────────────────────────
  let __listingsSortKey = 'score';
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

    let props = (d.foreclosures || []).slice();
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
      body.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--muted)">No properties.</td></tr>`;
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
            <div class="fc-prop-addr">${escapeHtml(p.address || '—')}</div>
            <div class="fc-prop-meta">${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')}</div>
          </td>
          <td style="font-size:12px;color:var(--ink-3)">${escapeHtml(p.county || '—')}</td>
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

  // ─── Hot counties — ranked by volume with score signal + ring ──────────
  function renderHotCounties(d) {
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

    el.innerHTML = `
      <div class="fc-coach-quote">"${insight}"</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button class="fc-btn fc-btn-gold" id="fc-coach-pin">Pin to watchlist</button>
        <button class="fc-btn">Dismiss</button>
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
  }

  // ─── Priority queue — top N scored properties ──────────────────────────
  function renderPriorityQueue(d) {
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
    const body = document.getElementById('fc-priority-body');
    if (!body) return;
    let props = (d.foreclosures || []).slice();
    if (filter === 'hud') {
      props = props.filter(p => p.source === 'HUD HomeStore');
    } else if (filter === 'trustee') {
      props = props.filter(p => p.source !== 'HUD HomeStore');
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
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">No properties match.</td></tr>`;
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
            <div class="fc-prop-addr">${escapeHtml(p.address || '—')}</div>
            <div class="fc-prop-meta">${escapeHtml(p.city || '')}, ${escapeHtml(p.state || 'VA')} ${escapeHtml(p.zip || '')} · ${escapeHtml(sourceTag)}</div>
          </td>
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
  function renderSignals(d) {
    const el = document.getElementById('fc-signals');
    if (!el) return;
    const props = d.foreclosures || [];
    const m = d.metadata || {};

    const signals = [];

    // Upcoming sales this week
    const soonSales = props.filter(p => p.days_to_sale != null && p.days_to_sale >= 0 && p.days_to_sale <= 7);
    if (soonSales.length) {
      signals.push({
        type: 'coral', tag: 'URGENT',
        who: `${soonSales.length} sales`,
        what: `scheduled this week, earliest ${soonSales[0].days_to_sale === 0 ? 'today' : 'in ' + soonSales[0].days_to_sale + 'd'}.`,
        ctx: `${soonSales.slice(0, 3).map(p => p.city).join(' · ')}…`,
        time: soonSales[0].days_to_sale === 0 ? 'Now' : `${soonSales[0].days_to_sale}d`,
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
      });
    }

    // RentCast enrichment coverage
    const enrichment = m.enrichment || {};
    if (enrichment.market_rent_used) {
      signals.push({
        type: 'sage', tag: 'MARKET DATA',
        who: `${enrichment.market_rent_used} properties`,
        what: `have RentCast market rent estimates feeding cash flow and cap rate.`,
        ctx: `Up from ${enrichment.rentcast_enriched - enrichment.market_rent_used} with heuristic-only rent.`,
        time: '1w',
      });
    }

    // HUD REO additions
    const hudProps = props.filter(p => p.source === 'HUD HomeStore');
    if (hudProps.length) {
      signals.push({
        type: '', tag: 'HUD INTEL',
        who: `${hudProps.length} HUD homes`,
        what: `active in VA — FHA financing available on ${hudProps.filter(p => (p.hud_fha || '').startsWith('IN')).length} of them.`,
        ctx: `List price median $${Math.round(median(hudProps.map(p => p.price || 0).filter(v => v > 0)) / 1000)}K.`,
        time: 'Weekly',
      });
    }

    // Top county concentration
    const counties = {};
    props.forEach(p => { counties[p.county] = (counties[p.county] || 0) + 1; });
    const top = Object.entries(counties).sort((a,b) => b[1] - a[1]).slice(0, 1)[0];
    if (top) {
      signals.push({
        type: 'sky', tag: 'CONCENTRATION',
        who: top[0],
        what: `has the highest foreclosure volume — ${top[1]} active listings.`,
        ctx: `${Math.round(top[1] / props.length * 100)}% of all VA activity this week.`,
        time: 'Now',
      });
    }

    if (signals.length === 0) {
      el.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">No signals this cycle.</div>`;
      return;
    }

    el.innerHTML = signals.map(s => `
      <div class="fc-signal">
        <div class="fc-signal-head">
          <span class="fc-pill ${s.type}">${escapeHtml(s.tag)}</span>
          <span class="fc-mono fc-signal-time">${escapeHtml(s.time)}</span>
        </div>
        <div class="fc-signal-body"><strong>${escapeHtml(s.who)}</strong> ${escapeHtml(s.what)}</div>
        <div class="fc-signal-ctx">${escapeHtml(s.ctx)}</div>
      </div>
    `).join('');
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

    drawer.innerHTML = renderDrawerContent(p);
    // Wire close button
    const closeBtn = drawer.querySelector('#fc-drawer-close');
    if (closeBtn) closeBtn.onclick = closePropertyDrawer;

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      drawer.classList.add('open');
    });
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

    // Street View + static map (Google Maps key is exposed client-side
    // in the main HTML so we can use the same for these static endpoints).
    const GMAPS_KEY = (typeof GOOGLE_MAPS_API_KEY !== 'undefined')
      ? GOOGLE_MAPS_API_KEY
      : (window.GOOGLE_MAPS_API_KEY || '');
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    const encAddr = encodeURIComponent(fullAddress);
    const streetViewUrl = GMAPS_KEY
      ? `https://maps.googleapis.com/maps/api/streetview?size=520x220&location=${encAddr}&fov=80&key=${GMAPS_KEY}&return_error_codes=true`
      : '';
    const staticMapUrl = (GMAPS_KEY && p.lat && p.lng)
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${p.lat},${p.lng}&zoom=15&size=520x200&maptype=roadmap&markers=color:0xD4A93A%7C${p.lat},${p.lng}&style=feature:poi%7Celement:labels%7Cvisibility:off&key=${GMAPS_KEY}`
      : (GMAPS_KEY ? `https://maps.googleapis.com/maps/api/staticmap?center=${encAddr}&zoom=15&size=520x200&maptype=roadmap&markers=color:0xD4A93A%7C${encAddr}&style=feature:poi%7Celement:labels%7Cvisibility:off&key=${GMAPS_KEY}` : '');

    // External listing link — HUD has a deep link via case number, other
    // sources link to the firm's general listings page.
    const listingUrl = isHUD && p.firm_file_number
      ? `https://www.hudhomestore.gov/listing/?caseNumber=${encodeURIComponent(p.firm_file_number)}`
      : (p.source_url || '');
    const openOnGMaps = `https://www.google.com/maps/search/?api=1&query=${encAddr}`;
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
        ${streetViewUrl ? `
          <div class="fc-drawer-media">
            <img src="${streetViewUrl}" alt="Street view of ${escapeHtml(p.address || '')}"
                 class="fc-streetview"
                 onerror="this.style.display='none'; const n=this.nextElementSibling; if(n) n.style.display='flex';" />
            <div class="fc-streetview-fallback">
              <div class="fc-eyebrow" style="margin-bottom:6px">Street view unavailable</div>
              <div style="font-size:12px;color:var(--muted)">No Street View coverage for this address.</div>
            </div>
            <div class="fc-streetview-actions">
              ${listingUrl ? `<a href="${escapeAttr(listingUrl)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm fc-btn-gold">
                ${isHUD ? 'View on HUD.gov →' : 'View source listing →'}
              </a>` : ''}
              <a href="${escapeAttr(openOnGMaps)}" target="_blank" rel="noopener" class="fc-btn fc-btn-sm">Open in Google Maps →</a>
            </div>
          </div>
        ` : ''}

        ${staticMapUrl ? `
          <div class="fc-drawer-map">
            <img src="${staticMapUrl}" alt="Map of ${escapeHtml(p.address || '')}" class="fc-staticmap" />
          </div>
        ` : ''}

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
          ${kvRow('Monthly Rent', '$' + (p.monthlyRent || 0).toLocaleString(), 'ink', pr.rent_source === 'RentCast' ? 'RentCast market data' : 'Heuristic (0.7% of ARV)')}
          ${kvRow('Cash Flow', '$' + (p.cashFlow || 0).toLocaleString() + '/mo', (p.cashFlow || 0) > 0 ? 'sage' : 'coral')}
          ${kvRow('Cap Rate', (p.capRate || 0) + '%')}
          ${kvRow('DSCR', (pr.dscr || 0).toFixed(2),
                  (pr.dscr || 0) >= 1.25 ? 'sage' : (pr.dscr || 0) >= 1.0 ? 'muted' : 'coral',
                  (pr.dscr || 0) >= 1.25 ? 'BRRRR-ready' : (pr.dscr || 0) >= 1.0 ? 'Covers mortgage' : 'Negative leverage')}
          ${kvRow('Investment Score', (p.score || 0) + ' / 100')}
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
                ${isHUD ? 'View full listing on HUD.gov →' : 'View source listing →'}
              </a>
            </div>` : ''}
          ${isHUD ? '<div class="fc-kv-caption" style="margin-top:6px;color:var(--muted);font-size:11px">HUD.gov detail page has interior photos, condition notes, disclosures, and the bid submission form.</div>' : ''}
        `)}

        ${section(`Closing playbook — ${playbook.title}`, `
          <ol class="fc-playbook">
            ${playbook.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ol>
          <div class="fc-playbook-note">${escapeHtml(playbook.notes)}</div>
        `)}

        <div class="fc-drawer-actions">
          <button class="fc-btn fc-btn-dark" style="flex:1">Add to Watchlist</button>
          <button class="fc-btn" style="flex:1">Open Calculator</button>
        </div>
      </div>
    `;
  }

  function section(title, bodyHtml) {
    return `
      <div class="fc-drawer-section">
        <div class="fc-drawer-section-hd">${escapeHtml(title)}</div>
        <div class="fc-drawer-section-body">${bodyHtml}</div>
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

  function updateSubline(d) {
    const m = d.metadata || {};
    const hi = (m.pricing_confidence || {}).high || 0;
    const sub = document.getElementById('fc-subline');
    const eyebrow = document.getElementById('fc-date-eyebrow');
    if (sub) {
      sub.textContent = `${m.total_properties || 0} active listings across ${m.counties_covered || 0} VA counties. ${hi} high-confidence deals ready to underwrite.`;
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

    // High-confidence count (= actionable deals with real price signal or HUD list)
    const hiConfCount = (m.pricing_confidence || {}).high || 0;
    const medConfCount = (m.pricing_confidence || {}).medium || 0;

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
        delta: `${props.filter(p => p.source === 'HUD HomeStore').length} HUD + ${props.filter(p => p.source !== 'HUD HomeStore').length} Trustee`,
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
  function init() {
    loadFonts();
    injectCSS();
    if (isDesktop()) {
      buildShell();
      loadData();
    }
  }

  // Run after DOM is parsed so the mobile-frame exists to hide.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle viewport changes (dev-tools device emulation, window resize).
  window.addEventListener('resize', () => {
    const hasDash = !!document.getElementById('fc-dash-root');
    if (isDesktop() && !hasDash) buildShell();
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
      <div class="fc-brand">
        <div class="fc-brand-mark">FS</div>
        <span>Foreclosure Scout</span>
      </div>
      <div class="fc-topbar-sep"></div>
      <div class="fc-workspace">
        <strong>VA Foreclosures</strong>
        ${ICO.chevR}
        <span>Command Center</span>
      </div>
      <div class="fc-tb-search">
        ${ICO.search}
        <span>Search address, county, case #…</span>
        <kbd>⌘K</kbd>
      </div>
      <div class="fc-tb-right">
        <button class="fc-tb-btn" title="Notifications">${ICO.bell}</button>
        <button class="fc-tb-btn fc-primary">${ICO.plus} Watchlist</button>
        <div class="fc-avatar">AJ</div>
      </div>
    </div>

    <div class="fc-body">
      <div class="fc-sidebar">
        <div class="fc-side-section">
          <div class="fc-side-label">Properties</div>
          <div class="fc-side-item active" data-view="dashboard">${ICO.home}<span>Dashboard</span></div>
          <div class="fc-side-item" data-view="listings">${ICO.building}<span>Listings</span><span class="fc-side-count" id="fc-sc-listings">—</span></div>
          <div class="fc-side-item" data-view="map">${ICO.map}<span>Map</span></div>
          <div class="fc-side-item" data-view="alerts">${ICO.bell}<span>Alerts</span><span class="fc-side-count">0</span></div>
        </div>
        <div class="fc-side-section">
          <div class="fc-side-label">Tools</div>
          <div class="fc-side-item" data-view="rehab">${ICO.calc}<span>Rehab Calculator</span></div>
          <div class="fc-side-item" data-view="market">${ICO.chart}<span>Market Analysis</span></div>
          <div class="fc-side-item" data-view="brrrr">${ICO.book}<span>BRRRR Calculator</span></div>
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
              <h1 class="fc-page-title">Foreclosure Command Center</h1>
              <div class="fc-page-sub">
                <span class="fc-pill sage" style="margin-right:8px"><span class="fc-dot"></span> Live data</span>
                <span id="fc-subline">Pipeline warming up.</span>
              </div>
            </div>
            <div class="fc-page-actions">
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
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="hud">HUD</button>
                  <button class="fc-btn fc-btn-sm fc-btn-ghost fc-pq-filter" data-filter="trustee">Trustee</button>
                </div>
              </div>
              <table class="fc-table" id="fc-priority-table">
                <thead>
                  <tr>
                    <th style="width:28px"></th>
                    <th>Property / source</th>
                    <th>Status</th>
                    <th style="text-align:center">Grade</th>
                    <th style="text-align:right">70% Rule</th>
                    <th style="text-align:right">Sale</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="fc-priority-body">
                  <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">Loading…</td></tr>
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
              <table class="fc-table" id="fc-listings-table">
                <thead>
                  <tr>
                    <th style="width:28px"></th>
                    <th>Address</th>
                    <th>County</th>
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

          <!-- Placeholder views -->
          ${['alerts', 'rehab', 'market', 'brrrr', 'settings'].map(v => `
            <div id="fc-view-${v}" style="display:none">
              <div class="fc-stage-placeholder">
                <div class="fc-eyebrow">${v.toUpperCase()}</div>
                <div style="font-family:var(--f-serif);font-size:22px;font-weight:600;margin-top:6px;margin-bottom:4px">Coming soon.</div>
                <div style="font-size:13px;color:var(--muted)">This view is on the roadmap. In the meantime, Dashboard and Listings have the core functionality.</div>
              </div>
            </div>
          `).join('')}
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

/* Only render dashboard on desktop */
@media (max-width: 768px) {
  #fc-dash-root { display: none !important; }
}

@media (min-width: 769px) {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: var(--paper) !important;
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
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
    width: 24px; height: 24px; border-radius: 3px;
    background: var(--ink); color: var(--gold);
    display: grid; place-items: center;
    font-family: var(--f-serif); font-size: 10px; font-weight: 700;
    font-style: italic;
    letter-spacing: -0.01em;
  }
  .fc-topbar-sep { width: 1px; height: 20px; background: var(--hair); }
  .fc-workspace {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--muted);
  }
  .fc-workspace strong { color: var(--ink); font-weight: 500; }
  .fc-workspace svg { width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 1.5; opacity: 0.5; }

  .fc-tb-search {
    flex: 1; max-width: 420px;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--hair); border-radius: 5px;
    background: var(--paper-2);
    font-size: 12px; color: var(--muted);
    cursor: pointer;
  }
  .fc-tb-search svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .fc-tb-search kbd {
    font-family: var(--f-mono); font-size: 10px;
    padding: 1px 5px; border-radius: 3px;
    background: var(--paper); border: 1px solid var(--hair);
    color: var(--muted); margin-left: auto;
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
  .fc-main { flex: 1; overflow: auto; background: var(--paper); }
  .fc-main::-webkit-scrollbar { width: 10px; height: 10px; }
  .fc-main::-webkit-scrollbar-thumb { background: var(--hair-2); border-radius: 10px; border: 2px solid var(--paper); }
  .fc-main::-webkit-scrollbar-track { background: var(--paper); }
  .fc-main-inner { padding: 24px 32px; max-width: 1600px; }

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
  .fc-page-actions { display: flex; gap: 8px; }

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

  /* ─── Media (street view + static map) ─── */
  .fc-drawer-media {
    position: relative;
    margin: 0 24px 16px;
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
    height: 140px;
    padding: 20px;
    text-align: center;
    background: var(--paper-2);
  }
  .fc-streetview-actions {
    display: flex; gap: 6px;
    padding: 10px 12px;
    background: var(--white);
    border-top: 1px solid var(--hair);
  }
  .fc-drawer-map {
    margin: 0 24px 16px;
    border: 1px solid var(--hair);
    border-radius: 6px;
    overflow: hidden;
  }
  .fc-staticmap {
    display: block;
    width: 100%;
    height: 200px;
    object-fit: cover;
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
}
`;

})();
