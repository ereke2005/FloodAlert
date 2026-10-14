/* Espace vérificateur : tableau de bord, fiche détaillée, validation humaine des incidents */
(function () {
  'use strict';
  const { esc, api, fmt, fmtLong, badge, LABELS, toast } = FA;
  FA.entete('admin');
  const $ = (s) => document.querySelector(s);

  const state = { cfg: null, list: [], current: null, map: null, pin: null, timer: null };

  /* ───────────── Connexion ───────────── */

  async function boot() {
    try { state.cfg = await api('/api/config'); } catch (e) { state.cfg = { zone: { centre: [6.1725, 1.2314], zoom: 12 } }; }
    try {
      const me = await api('/api/admin/me');
      showApp(me);
    } catch (e) { showLogin(); }
  }

  function showLogin() {
    $('#vue-login').classList.remove('hidden');
    $('#vue-app').classList.add('hidden');
  }

  function showApp(me) {
    $('#vue-login').classList.add('hidden');
    $('#vue-app').classList.remove('hidden');
    $('#qui').textContent = 'Connecté : ' + me.nom + ' (' + me.email + ')';
    load();
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('#login-erreur'); box.classList.add('hidden');
    try {
      const me = await api('/api/admin/login', { method: 'POST', body: { email: $('#email').value, password: $('#mdp').value } });
      $('#mdp').value = '';
      showApp(me);
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
  });

  $('#deconnexion').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch (e) { /* ignoré */ }
    closeDetail(); showLogin();
  });

  /* ───────────── Liste, filtres, statistiques ───────────── */

  function queryString() {
    const p = new URLSearchParams();
    const add = (k, v) => { if (v && v !== 'tous') p.set(k, v); };
    add('q', $('#f-q').value.trim());
    add('statut', $('#f-statut').value); add('source', $('#f-source').value); add('type', $('#f-type').value);
    add('localise', $('#f-localise').value); add('demo', $('#f-demo').value);
    if ($('#f-from').value) p.set('from', $('#f-from').value.slice(0, 10));
    if ($('#f-to').value) p.set('to', $('#f-to').value.slice(0, 10));
    return p.toString();
  }

  async function load() {
    const qs = queryString();
    $('#export').href = '/api/admin/export.csv' + (qs ? '?' + qs : '');
    try {
      const r = await api('/api/admin/signalements' + (qs ? '?' + qs : ''));
      state.list = r.signalements;
      renderStats(r.stats);
      renderTable(r);
    } catch (e) {
      if (e.status === 401) { showLogin(); return; }
      $('#corps').innerHTML = '<tr><td colspan="7" class="stat-vide">' + esc(e.message) + '</td></tr>';
    }
  }

  function renderStats(st) {
    const c = (cls, n, lib) => '<div class="carte-stat ' + cls + '"><b>' + n + '</b><span>' + esc(lib) + '</span></div>';
    $('#cartes').innerHTML =
      c('c-total', st.total, 'Signalements') +
      c('c-a_verifier', st.par_statut.a_verifier, 'À vérifier') +
      c('c-confirme', st.par_statut.confirme, 'Confirmés') +
      c('c-resolu', st.par_statut.resolu, 'Résolus') +
      c('c-rejete', st.par_statut.rejete, 'Rejetés') +
      c('c-info', st.sans_localisation, 'Sans position') +
      c('c-info', st.doublons_potentiels, 'Doublons potentiels');

    const max = Math.max(1, ...st.par_jour.map((j) => j.n));
    $('#g-jours').innerHTML = st.par_jour.map((j) =>
      '<div class="col" title="' + esc(j.jour) + ' : ' + j.n + '"><b>' + (j.n || '') + '</b><i data-h="' + Math.round((j.n / max) * 100) + '"></i><span>' + esc(j.jour.slice(8) + '/' + j.jour.slice(5, 7)) + '</span></div>').join('');
    $('#g-jours').querySelectorAll('i').forEach((i) => { i.style.height = i.dataset.h + '%'; });

    const hb = (obj, labels) => {
      const m = Math.max(1, ...Object.values(obj));
      return Object.entries(obj).map(([k, v]) => '<div class="hbar"><span>' + esc(labels[k] || k) + '</span><i data-w="' + Math.round((v / m) * 100) + '"></i><b>' + v + '</b></div>').join('');
    };
    $('#g-types').innerHTML = hb(st.par_type, LABELS.type);
    $('#g-sources').innerHTML = hb(st.par_source, LABELS.source);
    document.querySelectorAll('.hbar i').forEach((i) => { i.style.width = i.dataset.w + '%'; });
  }

  function renderTable(r) {
    $('#titre-liste').textContent = 'Signalements (' + r.total_filtre + ')';
    $('#pied-liste').textContent = r.total_filtre > r.signalements.length ? 'Les ' + r.signalements.length + ' plus récents sont affichés. Affinez les filtres pour en voir d\'autres.' : '';
    if (!r.signalements.length) {
      $('#corps').innerHTML = '<tr><td colspan="7" class="stat-vide">Aucun signalement ne correspond à ces filtres.</td></tr>';
      return;
    }
    $('#corps').innerHTML = r.signalements.map((s) =>
      '<tr class="ligne"><td><button type="button" class="lien" data-id="' + esc(s.id) + '">' + esc(s.reference) + '</button></td>' +
      '<td>' + esc(fmt(s.date_observation)) + '</td><td>' + esc(LABELS.type[s.type_incident]) + (s.priorite === 'haute' ? ' <span class="badge haute">Prioritaire</span>' : '') + '</td>' +
      '<td>' + esc(s.lieu_declare || '—') + '</td><td>' + esc(LABELS.source[s.source]) + '</td>' +
      '<td>' + badge(s.statut, s.demo) + (s.doublons.length ? ' <span class="badge demo">Doublon ?</span>' : '') + '</td>' +
      '<td>' + (s.latitude != null ? 'Oui' : 'Non') + '</td></tr>').join('');
    $('#corps').querySelectorAll('button.lien').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.id)));
  }

  $('#filtres').addEventListener('change', load);
  $('#f-q').addEventListener('input', () => { clearTimeout(state.timer); state.timer = setTimeout(load, 300); });
  $('#filtres').addEventListener('submit', (e) => e.preventDefault());
  $('#reset').addEventListener('click', () => { $('#filtres').reset(); load(); });

  /* ───────────── Fiche détaillée ───────────── */

  async function openDetail(id) {
    try {
      state.current = await api('/api/admin/signalements/' + encodeURIComponent(id));
      renderDetail();
      $('#detail').classList.remove('hidden'); $('#voile').classList.remove('hidden');
      $('#detail').scrollTop = 0;
    } catch (e) { toast(e.message); }
  }

  function closeDetail() {
    $('#detail').classList.add('hidden'); $('#voile').classList.add('hidden');
    if (state.map) { state.map.remove(); state.map = null; state.pin = null; }
  }
  $('#voile').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#detail').classList.contains('hidden')) closeDetail(); });

  const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(v) + '</option>').join('');

  function renderAnalyse(a, s) {
    if (!a) return '<p class="stat-vide">Aucune analyse disponible : le signalement peut être traité manuellement.</p>';
    if (a.traitement === 'echec') return '<p class="alerte erreur">L\'analyse a échoué. Le message original est conservé : traitez-le manuellement ou relancez l\'analyse.</p>';
    const inc = a.champs_incertains || [];
    const unc = (k) => inc.includes(k) ? ' <span class="puce">à vérifier</span>' : '';
    const manque = (a.infos_manquantes || []).map((x) => '<li>' + esc(x) + '</li>').join('');
    return (a.traitement === 'repli' ? '<p class="alerte info small">Le service d\'IA était indisponible (' + esc(a.erreur) + '). Une analyse par règles locales a été utilisée.</p>' : '') +
      '<dl><dt>Source</dt><dd>' + esc(a.source) + ' (' + esc(a.modele) + ')</dd>' +
      '<dt>Type proposé</dt><dd>' + esc(LABELS.type[a.type_incident] || 'Non déterminé') + unc('type_incident') + '</dd>' +
      '<dt>Lieu mentionné</dt><dd>' + esc(a.lieu_mentionne || 'Aucun') + unc('lieu_mentionne') + '</dd>' +
      '<dt>Conséquence</dt><dd>' + esc(a.consequence || 'Non précisée') + '</dd>' +
      '<dt>Gravité</dt><dd>' + esc(LABELS.gravite[a.gravite] || 'Non déterminée') + unc('gravite') + '</dd>' +
      '<dt>Position GPS</dt><dd>' + (s.latitude != null ? 'Fournie' : 'Non fournie — localisation à préciser') + '</dd>' +
      '<dt>Confiance</dt><dd>' + (a.confiance != null ? Math.round(a.confiance * 100) + ' %' : 'Non disponible') + '</dd></dl>' +
      (manque ? '<p><strong>Informations manquantes</strong></p><ul>' + manque + '</ul>' : '') +
      '<p class="small muted">Proposition automatique : elle n\'a aucune valeur de confirmation.</p>';
  }

  function renderHistorique(h) {
    return '<ol class="histo">' + h.map((x) => {
      let t;
      if (x.type === 'creation') t = 'Reçu (' + esc(x.auteur) + ')';
      else if (x.type === 'statut') t = esc(LABELS.statut[x.ancien] || x.ancien) + ' → <strong>' + esc(LABELS.statut[x.nouveau]) + '</strong> par ' + esc(x.auteur) + (x.motif ? '<br>Motif : ' + esc(x.motif) : '');
      else t = 'Corrections (' + esc(Object.keys(x.champs || {}).join(', ')) + ') par ' + esc(x.auteur);
      return '<li><time>' + esc(fmtLong(x.date)) + '</time>' + t + '</li>';
    }).join('') + '</ol>';
  }

  function renderDetail() {
    const s = state.current;
    if (state.map) { state.map.remove(); state.map = null; state.pin = null; }
    const actions = {
      a_verifier: [['confirme', 'Confirmer l\'incident', 'succes'], ['rejete', 'Rejeter', 'danger']],
      confirme: [['resolu', 'Marquer comme résolu', 'succes'], ['rejete', 'Rejeter', 'danger']],
      resolu: [['a_verifier', 'Rouvrir (à vérifier)', 'secondaire']],
      rejete: [['a_verifier', 'Rouvrir (à vérifier)', 'secondaire']],
    }[s.statut];

    $('#detail').innerHTML =
      '<div class="panneau"><h2><span>' + esc(s.reference) + ' ' + badge(s.statut, s.demo) + (s.simule ? ' <span class="badge demo">Simulé</span>' : '') + '</span>' +
      '<button type="button" class="btn secondaire petit" id="d-fermer">Fermer</button></h2>' +
      '<dl><dt>Canal</dt><dd>' + esc(LABELS.source[s.source]) + '</dd>' +
      '<dt>Observé le</dt><dd>' + esc(fmtLong(s.date_observation)) + '</dd>' +
      '<dt>Reçu le</dt><dd>' + esc(fmtLong(s.date_reception)) + '</dd>' +
      '<dt>Mis à jour</dt><dd>' + esc(fmtLong(s.mis_a_jour_le)) + '</dd>' +
      '<dt>Priorité proposée</dt><dd>' + esc(s.priorite === 'haute' ? 'Haute' : s.priorite === 'normale' ? 'Normale' : 'Non définie') + '</dd>' +
      '<dt>Contact (privé)</dt><dd>' + esc(s.contact || '—') + '</dd>' +
      '<dt>Téléphone WhatsApp (privé)</dt><dd>' + esc(s.telephone || '—') + '</dd>' +
      (s.motif_rejet ? '<dt>Motif de rejet</dt><dd>' + esc(s.motif_rejet) + '</dd>' : '') + '</dl></div>' +

      '<div class="panneau"><h3>Message original</h3><p class="original">' + esc(s.description_originale) + '</p>' +
      (s.photo_url ? '<h3 class="espace">Photo</h3><img class="photo-adm" src="' + esc(s.photo_url) + '" alt="Photo jointe au signalement ' + esc(s.reference) + '">' : '') + '</div>' +

      '<div class="panneau"><h3>Analyse automatique</h3>' + renderAnalyse(s.analyse, s) +
      '<button type="button" class="btn secondaire petit" id="d-relancer">Relancer l\'analyse</button></div>' +

      (s.doublons.length ? '<div class="panneau"><h3>Doublons potentiels</h3><p class="small muted">Aucun signalement n\'est supprimé automatiquement : à vous de décider.</p>' +
        s.doublons.map((d) => '<div class="doublon"><span><strong>' + esc(d.reference) + '</strong> · score ' + esc(d.score) + ' · ' + esc((d.raisons || []).join(', ')) + '</span>' +
          (d.id ? '<button type="button" class="btn secondaire petit" data-open="' + esc(d.id) + '">Ouvrir</button>' : '') + '</div>').join('') + '</div>' : '') +

      '<div class="panneau"><h3>Corriger les informations</h3>' +
      '<div class="deux-col"><div class="champ"><label for="d-type">Catégorie</label><select id="d-type">' + opts(LABELS.type, s.type_incident) + '</select></div>' +
      '<div class="champ"><label for="d-prio">Priorité</label><select id="d-prio"><option value="">Non définie</option><option value="normale"' + (s.priorite === 'normale' ? ' selected' : '') + '>Normale</option><option value="haute"' + (s.priorite === 'haute' ? ' selected' : '') + '>Haute</option></select></div></div>' +
      '<div class="champ"><label for="d-lieu">Lieu déclaré</label><input type="text" id="d-lieu" maxlength="160" value="' + esc(s.lieu_declare || '') + '"></div>' +
      '<div class="champ"><label for="d-resume">Résumé</label><textarea id="d-resume" maxlength="300">' + esc(s.resume_ia || '') + '</textarea></div>' +
      '<p class="aide">Position : touchez la carte pour placer l\'incident (' + (s.localisation_precision === 'admin' ? 'placé par un vérificateur' : s.localisation_precision === 'gps' ? 'fournie par le déclarant' : 'aucune position pour l\'instant') + ').</p>' +
      '<div id="adm-map" role="application" aria-label="Carte de localisation"></div>' +
      '<div class="deux-col"><div class="champ"><label for="d-lat">Latitude</label><input type="number" step="0.00001" id="d-lat" value="' + (s.latitude ?? '') + '"></div>' +
      '<div class="champ"><label for="d-lng">Longitude</label><input type="number" step="0.00001" id="d-lng" value="' + (s.longitude ?? '') + '"></div></div>' +
      '<button type="button" class="btn secondaire petit" id="d-effacer">Retirer la position</button>' +
      '<div class="champ espace"><label for="d-note">Note interne</label><textarea id="d-note" maxlength="2000">' + esc(s.note_interne || '') + '</textarea></div>' +
      '<button type="button" class="btn" id="d-enregistrer">Enregistrer les corrections</button></div>' +

      '<div class="panneau"><h3>Décision</h3>' +
      '<div class="champ"><label for="d-motif">Motif (obligatoire pour un rejet)</label><input type="text" id="d-motif" maxlength="500" placeholder="Exemple : doublon, hors sujet, information non exploitable"></div>' +
      '<div id="d-erreur" class="alerte erreur hidden" role="alert"></div>' +
      '<div class="actions-statut">' + actions.map((a) => '<button type="button" class="btn ' + a[2] + '" data-statut="' + a[0] + '">' + esc(a[1]) + '</button>').join('') + '</div></div>' +

      '<div class="panneau"><h3>Historique</h3>' + renderHistorique(s.historique) + '</div>';

    $('#d-fermer').addEventListener('click', closeDetail);
    $('#d-relancer').addEventListener('click', relancer);
    $('#d-enregistrer').addEventListener('click', enregistrer);
    $('#d-effacer').addEventListener('click', () => { $('#d-lat').value = ''; $('#d-lng').value = ''; if (state.pin) { state.pin.remove(); state.pin = null; } });
    $('#detail').querySelectorAll('[data-statut]').forEach((b) => b.addEventListener('click', () => changerStatut(b.dataset.statut)));
    $('#detail').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.open)));
    initMap(s);
  }

  function initMap(s) {
    const has = s.latitude != null;
    state.map = L.map('adm-map').setView(has ? [s.latitude, s.longitude] : state.cfg.zone.centre, has ? 16 : state.cfg.zone.zoom);
    const t = state.cfg.tuiles || { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' };
    L.tileLayer(t.url, { maxZoom: 19, attribution: t.attribution }).addTo(state.map);
    if (has) state.pin = L.marker([s.latitude, s.longitude]).addTo(state.map);
    const place = (lat, lng) => {
      if (state.pin) state.pin.setLatLng([lat, lng]); else state.pin = L.marker([lat, lng]).addTo(state.map);
      $('#d-lat').value = lat.toFixed(5); $('#d-lng').value = lng.toFixed(5);
    };
    state.map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    const sync = () => { const la = parseFloat($('#d-lat').value), ln = parseFloat($('#d-lng').value); if (Number.isFinite(la) && Number.isFinite(ln)) { place(la, ln); state.map.setView([la, ln]); } };
    $('#d-lat').addEventListener('change', sync); $('#d-lng').addEventListener('change', sync);
    setTimeout(() => state.map && state.map.invalidateSize(), 200);
  }

  async function patch(body) {
    const s = await api('/api/admin/signalements/' + encodeURIComponent(state.current.id), { method: 'PATCH', body });
    state.current = s; renderDetail(); load();
    return s;
  }

  function showDetailError(msg) { const b = $('#d-erreur'); if (b) { b.textContent = msg; b.classList.remove('hidden'); } else toast(msg); }

  async function enregistrer() {
    const lat = $('#d-lat').value.trim(), lng = $('#d-lng').value.trim();
    const body = {
      type_incident: $('#d-type').value, priorite: $('#d-prio').value,
      lieu_declare: $('#d-lieu').value, resume_ia: $('#d-resume').value, note_interne: $('#d-note').value,
      latitude: lat === '' ? null : Number(lat), longitude: lng === '' ? null : Number(lng),
    };
    try { await patch(body); toast('Corrections enregistrées'); }
    catch (e) { showDetailError(e.message); }
  }

  async function changerStatut(to, forcer) {
    const body = { statut: to, motif: $('#d-motif').value };
    if (forcer) body.confirmer_sans_position = true;
    try { await patch(body); toast('Statut mis à jour : ' + LABELS.statut[to]); }
    catch (e) {
      if (e.details && e.details.position_manquante) {
        if (confirm('Cet incident n\'a pas de position : il ne sera pas visible sur la carte. Le confirmer quand même ?')) return changerStatut(to, true);
        return;
      }
      showDetailError(e.message);
    }
  }

  async function relancer() {
    const b = $('#d-relancer'); b.disabled = true; b.textContent = 'Analyse en cours…';
    try { state.current = await api('/api/admin/signalements/' + encodeURIComponent(state.current.id) + '/analyser', { method: 'POST', body: {} }); renderDetail(); load(); toast('Analyse actualisée'); }
    catch (e) { b.disabled = false; b.textContent = 'Relancer l\'analyse'; toast(e.message); }
  }

  boot();
  setInterval(() => { if (!$('#vue-app').classList.contains('hidden') && $('#detail').classList.contains('hidden')) load(); }, 45000);
})();
