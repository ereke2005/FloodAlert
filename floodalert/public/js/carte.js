/* Carte publique : marqueurs, filtres, liste, fiche détaillée */
(function () {
  'use strict';
  const { esc, api, fmt, fmtLong, badge, LABELS, COULEURS } = FA;
  FA.entete('carte');

  const $ = (s) => document.querySelector(s);
  let map, layer, data = [], markers = new Map(), selected = null;

  async function init() {
    let cfg;
    try { cfg = await api('/api/config'); }
    catch (e) { $('#liste').innerHTML = '<li class="vide">' + esc(e.message) + '</li>'; return; }

    $('#zone-nom').textContent = 'Zone pilote : ' + cfg.zone.nom;
    const sel = $('#f-type');
    cfg.types.forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = LABELS.type[t]; sel.appendChild(o); });

    map = L.map('map').setView(cfg.zone.centre, cfg.zone.zoom);
    L.tileLayer(cfg.tuiles.url, { maxZoom: 19, attribution: cfg.tuiles.attribution }).addTo(map);
    layer = L.layerGroup().addTo(map);

    $('#filtres').addEventListener('change', render);
    await load();
    setInterval(load, 60000); // actualisation automatique chaque minute
  }

  async function load() {
    try {
      const r = await api('/api/public/signalements');
      data = r.signalements;
      $('#non-localises').textContent = r.non_localises
        ? r.non_localises + ' signalement(s) sans localisation exploitable ne figurent pas sur la carte.' : '';
      render();
    } catch (e) {
      $('#liste').innerHTML = '<li class="vide">Les signalements ne peuvent pas être chargés pour le moment. ' + esc(e.message) + '</li>';
    }
  }

  function filtered() {
    const statuts = [...document.querySelectorAll('input[name=statut]:checked')].map((i) => i.value);
    const type = $('#f-type').value;
    const jours = Number($('#f-periode').value);
    const limite = jours ? Date.now() - jours * 86400000 : 0;
    return data.filter((s) =>
      statuts.includes(s.statut) &&
      (!type || s.type_incident === type) &&
      new Date(s.date_observation).getTime() >= limite);
  }

  function style(s) {
    const resolu = s.statut === 'resolu';
    return {
      radius: resolu ? 7 : 10, color: '#10231F', weight: 2, dashArray: s.demo ? '3 3' : null,
      fillColor: COULEURS[s.statut], fillOpacity: resolu ? 0.35 : (s.statut === 'a_verifier' ? 0.6 : 0.92),
    };
  }

  function render() {
    const list = filtered().sort((a, b) => b.date_observation.localeCompare(a.date_observation));
    layer.clearLayers(); markers.clear();
    list.forEach((s) => {
      if (s.lat == null) return;
      const m = L.circleMarker([s.lat, s.lng], style(s)).addTo(layer);
      m.bindTooltip(LABELS.type[s.type_incident] + ' — ' + LABELS.statut[s.statut]);
      m.on('click', () => select(s.reference, false));
      markers.set(s.reference, m);
    });

    const n = (st) => list.filter((s) => s.statut === st).length;
    $('#chiffres').innerHTML =
      '<div class="chiffre"><b>' + list.length + '</b><span>affichés</span></div>' +
      '<div class="chiffre"><b>' + n('a_verifier') + '</b><span>à vérifier</span></div>' +
      '<div class="chiffre"><b>' + n('confirme') + '</b><span>confirmés</span></div>';

    const ul = $('#liste');
    if (!list.length) {
      ul.innerHTML = '<li class="vide">Aucun signalement pour ces filtres. Élargissez la période ou <a href="signaler.html">signalez une situation</a>.</li>';
    } else {
      ul.innerHTML = list.map((s) =>
        '<li><button type="button" class="l-' + esc(s.statut) + (selected === s.reference ? ' actif' : '') + '" data-ref="' + esc(s.reference) + '">' +
        '<span class="titre"><span>' + esc(LABELS.type[s.type_incident]) + '</span>' + badge(s.statut, s.demo) + '</span>' +
        '<span class="sous">' + esc(s.lieu || 'Lieu à préciser') + ' · ' + esc(fmt(s.date_observation)) + (s.lat == null ? ' · hors carte' : '') + '</span>' +
        '</button></li>').join('');
      ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => select(b.dataset.ref, true)));
    }
    if (selected && !list.find((s) => s.reference === selected)) closeFiche();
  }

  function select(ref, pan) {
    selected = ref;
    const s = data.find((x) => x.reference === ref);
    if (!s) return;
    if (pan && s.lat != null) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15));
    document.querySelectorAll('.liste button').forEach((b) => b.classList.toggle('actif', b.dataset.ref === ref));
    const f = $('#fiche');
    const avert = s.statut === 'a_verifier' ? '<p class="alerte info small">Ce signalement n\'a pas encore été vérifié. Il peut être inexact.</p>'
      : s.statut === 'resolu' ? '<p class="alerte ok small">Situation déclarée terminée. Conservé dans l\'historique.</p>' : '';
    f.innerHTML =
      '<button type="button" class="btn secondaire petit fermer" id="fermer" aria-label="Fermer la fiche">Fermer</button>' +
      '<h2>' + esc(LABELS.type[s.type_incident]) + '</h2>' + badge(s.statut, s.demo) +
      (s.simule ? ' <span class="badge demo">Simulé</span>' : '') +
      '<p>' + esc(s.resume) + '</p>' + avert +
      '<dl><dt>Référence</dt><dd>' + esc(s.reference) + '</dd>' +
      '<dt>Lieu</dt><dd>' + esc(s.lieu || 'À préciser') + '</dd>' +
      '<dt>Observé le</dt><dd>' + esc(fmtLong(s.date_observation)) + '</dd>' +
      '<dt>Mis à jour</dt><dd>' + esc(fmtLong(s.mis_a_jour_le)) + '</dd>' +
      '<dt>Position</dt><dd>' + (s.lat != null ? 'Approximative (arrondie)' : 'Non fournie') + '</dd></dl>' +
      (s.demo ? '<p class="small muted">Donnée de démonstration : elle ne correspond pas à un événement réel.</p>' : '');
    f.classList.remove('hidden');
    $('#fermer').addEventListener('click', closeFiche);
  }

  function closeFiche() { selected = null; $('#fiche').classList.add('hidden'); document.querySelectorAll('.liste button.actif').forEach((b) => b.classList.remove('actif')); }

  init();
})();
