/* FloodAlert Togo — fonctions partagées par toutes les pages */
(function () {
  'use strict';

  const LABELS = {
    statut: { a_verifier: 'À vérifier', confirme: 'Confirmé', resolu: 'Résolu', rejete: 'Rejeté' },
    type: { inondation: 'Inondation', route_bloquee: 'Route bloquée', debordement: 'Débordement', batiment_menace: 'Bâtiment menacé', autre: 'Autre' },
    source: { web: 'Formulaire web', whatsapp: 'WhatsApp' },
    gravite: { non_determinee: 'Non déterminée', faible: 'Faible (déclarée)', moyenne: 'Moyenne (déclarée)', elevee: 'Élevée (déclarée)' },
  };

  const COULEURS = { a_verifier: '#E3B100', confirme: '#CE1126', resolu: '#006A4E', rejete: '#77807D' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let r;
    try { r = await fetch(path, init); }
    catch (e) { const err = new Error('Connexion impossible. Vérifiez votre réseau et réessayez.'); err.network = true; throw err; }
    let j = null;
    try { j = await r.json(); } catch (e) { /* réponse vide */ }
    if (!r.ok) {
      const err = new Error((j && j.error) || 'Erreur ' + r.status);
      err.status = r.status; err.details = j && j.details;
      throw err;
    }
    return j;
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtLong = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—';

  function badge(statut, demo) {
    return '<span class="badge st-' + esc(statut) + '">' + esc(LABELS.statut[statut] || statut) + '</span>' +
      (demo ? ' <span class="badge demo">Démo</span>' : '');
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  const LOGO = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#14524A" stroke="#E3B100" stroke-width="2"/>' +
    '<path d="M20 7c4.5 6 7 9.6 7 13.2A7 7 0 0 1 13 20.2C13 16.6 15.5 13 20 7z" fill="#fff"/>' +
    '<path d="M6 29c3 0 3-2 6-2s3 2 6 2 3-2 6-2 3 2 6 2 3-2 4-2" fill="none" stroke="#E3B100" stroke-width="2.2" stroke-linecap="round"/></svg>';

  /** Dessine l'en-tête et le bandeau de prudence sur toutes les pages publiques. */
  function entete(active) {
    const liens = [
      ['index.html', 'Carte', 'carte'],
      ['signaler.html', 'Signaler', 'signaler'],
      ['suivi.html', 'Suivre un signalement', 'suivi'],
      ['simulateur.html', 'Simulateur WhatsApp', 'simulateur'],
      ['admin.html', 'Espace vérificateur', 'admin'],
    ];
    const el = document.getElementById('entete');
    if (!el) return;
    el.innerHTML =
      '<header class="entete"><div class="entete-int">' +
      '<a class="marque" href="index.html">' + LOGO + '<span>FloodAlert Togo</span></a>' +
      '<nav class="nav" aria-label="Navigation principale">' +
      liens.map((l) => '<a href="' + l[0] + '"' + (l[2] === active ? ' aria-current="page"' : '') + '>' + l[1] + '</a>').join('') +
      '</nav></div></header>' +
      '<div class="bandeau"><p><strong>Prototype.</strong> Les signalements « à vérifier » ne sont pas confirmés. FloodAlert n\'est pas un service de secours ni un système d\'alerte officiel.</p></div>';
  }

  window.FA = { LABELS, COULEURS, esc, api, fmt, fmtLong, badge, toast, entete, LOGO };
})();
