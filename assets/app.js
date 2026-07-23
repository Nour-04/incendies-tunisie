/* Incendies en Tunisie — carte des foyers actifs (NASA FIRMS).
   Charge data/fires.json + data/tunisia-adm1.json et rend carte + classement. */

'use strict';

const DAY_MS = 24 * 3600 * 1000;
const state = { window: '24h', data: null, adm1: null };

const el = (id) => document.getElementById(id);
const fmtInt = (n) => n.toLocaleString('fr-FR');

// ---- Sévérité selon la puissance radiative (FRP, en MW) ----
function severity(frp) {
  if (frp == null || isNaN(frp)) return 'low';
  if (frp >= 20) return 'high';
  if (frp >= 5) return 'mid';
  return 'low';
}
const SEV_COLOR = { low: '#fab219', mid: '#ec835a', high: '#d03b3b' };
const SEV_LABEL = { low: 'Faible', mid: 'Modérée', high: 'Élevée' };
const CONF_LABEL = { h: 'élevée', n: 'nominale', l: 'faible' };

const isDark = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

// ---- Filtrage par période ----
function activeFires() {
  const fires = state.data.fires;
  if (state.window === '5j') return fires;
  const now = Date.now();
  return fires.filter((f) => now - Date.parse(f.t) <= DAY_MS);
}

// ---- Agrégation par gouvernorat (à partir des points filtrés) ----
function aggregate(fires) {
  const map = new Map();
  for (const f of fires) {
    const g = f.gov;
    if (!map.has(g)) map.set(g, { gov: g, count: 0, delegations: new Map() });
    const e = map.get(g);
    e.count++;
    if (f.del) e.delegations.set(f.del, (e.delegations.get(f.del) || 0) + 1);
  }
  return [...map.values()]
    .map((e) => ({
      gov: e.gov,
      count: e.count,
      delegations: [...e.delegations.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
}

// ================= Carte =================
let map, tileLayer, govLayer, fireLayer;

function basemapUrl() {
  return isDark()
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView([34.0, 9.6], 6);
  tileLayer = L.tileLayer(basemapUrl(), {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
  govLayer = L.layerGroup().addTo(map);
  fireLayer = L.layerGroup().addTo(map);
}

function renderGovernorates(agg) {
  govLayer.clearLayers();
  const counts = Object.fromEntries(agg.map((g) => [g.gov, g.count]));
  const max = Math.max(1, ...agg.map((g) => g.count));
  const dark = isDark();

  L.geoJSON(state.adm1, {
    style: (feat) => {
      const c = counts[feat.properties.shapeName] || 0;
      const t = c / max; // 0..1
      return {
        color: dark ? '#3a3a37' : '#c9c8c1',
        weight: 1,
        fillColor: dark ? '#e66767' : '#e34948',
        fillOpacity: c === 0 ? 0.02 : 0.12 + 0.55 * Math.sqrt(t),
      };
    },
    onEachFeature: (feat, lyr) => {
      const name = feat.properties.shapeName;
      const c = counts[name] || 0;
      lyr.bindTooltip(`<b>${name}</b><br>${fmtInt(c)} foyer(s)`, { sticky: true });
      lyr.on('click', () => highlightGov(name, true));
      lyr._govName = name;
    },
  }).addTo(govLayer);
}

function renderFires(fires) {
  fireLayer.clearLayers();
  for (const f of fires) {
    const sev = severity(f.frp);
    const r = Math.min(14, 4 + (f.frp ? Math.sqrt(f.frp) * 1.2 : 1));
    const localTime = new Date(f.t).toLocaleString('fr-FR', {
      timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const popup =
      `<div class="fire-pop"><b>${f.gov || 'Tunisie'}${f.del ? ' — ' + f.del : ''}</b>` +
      `<div class="row">Intensité : <span class="sev" style="color:${SEV_COLOR[sev]}">${SEV_LABEL[sev]}</span>` +
      `${f.frp != null ? ' (' + f.frp + ' MW)' : ''}</div>` +
      `<div class="row">Confiance : ${CONF_LABEL[f.conf] || f.conf || '—'}</div>` +
      `<div class="row">Détecté le ${localTime} (heure de Tunis)</div>` +
      `<div class="row">Satellite : ${f.sat}</div></div>`;
    L.circleMarker([f.lat, f.lon], {
      radius: r,
      color: '#ffffff', weight: 1, opacity: 0.85,
      fillColor: SEV_COLOR[sev], fillOpacity: 0.85,
    }).bindPopup(popup).addTo(fireLayer);
  }
}

function highlightGov(name, zoom) {
  let target = null;
  govLayer.eachLayer((grp) => {
    if (grp.eachLayer) grp.eachLayer((lyr) => { if (lyr._govName === name) target = lyr; });
  });
  if (target) {
    if (zoom) map.fitBounds(target.getBounds(), { padding: [30, 30], maxZoom: 9 });
    target.openTooltip();
  }
}

// ================= Panneaux HTML =================
function renderStats(agg, fires) {
  const total = state.data.total;
  const top = agg[0];
  const tiles = [
    { v: fmtInt(fires.length), l: state.window === '24h' ? 'Foyers actifs (24 h)' : 'Foyers actifs (5 jours)', accent: true },
    { v: fmtInt(agg.length), l: 'Gouvernorats touchés' },
    { v: top ? top.gov : '—', l: 'Gouvernorat le plus touché', small: true },
    { v: fmtInt(total), l: 'Total détecté (5 jours)' },
  ];
  el('stats').innerHTML = tiles.map((t) =>
    `<div class="tile${t.accent ? ' accent' : ''}">
       <div class="value" style="${t.small ? 'font-size:1.35rem' : ''}">${t.v}</div>
       <div class="label">${t.l}</div>
     </div>`).join('');
}

function renderRanking(agg) {
  const list = el('rankList');
  if (!agg.length) {
    list.innerHTML = '<li class="empty">Aucun foyer actif détecté sur cette période. 🌿</li>';
    return;
  }
  const max = agg[0].count;
  list.innerHTML = agg.map((g, i) => {
    const pct = Math.round((g.count / max) * 100);
    const delegs = g.delegations.map((d) =>
      `<div class="deleg-row"><span>${d.name}</span><span class="dc">${fmtInt(d.count)}</span></div>`).join('');
    return `<li class="rank-item" data-gov="${g.gov}">
      <button type="button" class="rank-row" aria-expanded="false">
        <span class="rank-num">${i + 1}</span>
        <span class="rank-name">${g.gov}
          <span class="bar-wrap"><span class="bar" style="width:${pct}%"></span></span>
        </span>
        <span class="rank-count">${fmtInt(g.count)}<span class="cap">foyers</span></span>
        <span class="rank-chevron">›</span>
      </button>
      <div class="delegs">${delegs || '<div class="deleg-row"><span>Délégation non identifiée</span></div>'}</div>
    </li>`;
  }).join('');

  list.querySelectorAll('.rank-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.rank-item');
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      highlightGov(item.dataset.gov, true);
    });
  });
}

// ================= Orchestration =================
function render() {
  const fires = activeFires();
  const agg = aggregate(fires);
  renderStats(agg, fires);
  renderGovernorates(agg);
  renderFires(fires);
  renderRanking(agg);
}

function setWindow(w) {
  state.window = w;
  document.querySelectorAll('.toggle-btn').forEach((b) => {
    const active = b.dataset.window === w;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  render();
}

async function boot() {
  initMap();
  document.querySelectorAll('.toggle-btn').forEach((b) =>
    b.addEventListener('click', () => setWindow(b.dataset.window)));

  // Bascule du fond de carte + recolorisation en cas de changement de thème.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      tileLayer.setUrl(basemapUrl());
      render();
    });
  }

  try {
    const [fires, adm1] = await Promise.all([
      fetch('data/fires.json').then((r) => r.json()),
      fetch('data/tunisia-adm1.json').then((r) => r.json()),
    ]);
    state.data = fires;
    state.adm1 = adm1;
    const upd = new Date(fires.updated).toLocaleString('fr-FR', {
      timeZone: 'Africa/Tunis', dateStyle: 'long', timeStyle: 'short',
    });
    el('updated').textContent = 'Dernière mise à jour : ' + upd;
    render();
  } catch (e) {
    el('updated').textContent = 'Erreur de chargement des données.';
    el('stats').innerHTML = '<div class="tile"><div class="value">—</div>' +
      '<div class="label">Impossible de charger les données. Réessayez plus tard.</div></div>';
    console.error(e);
  }
}

boot();
