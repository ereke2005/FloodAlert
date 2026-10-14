(function () {
  'use strict';
  const { api, esc, fmtLong, badge } = FA;
  FA.entete('suivi');
  const $ = (s) => document.querySelector(s);
  const p = new URLSearchParams(location.search).get('ref');
  if (p) { $('#ref').value = p; check(); }

  $('#form').addEventListener('submit', (e) => { e.preventDefault(); check(); });

  async function check() {
    const raw = $('#ref').value.trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) { $('#resultat').classList.remove('hidden'); $('#resultat').innerHTML = '<p class="alerte erreur">Saisissez d\'abord votre référence (exemple : FA-0001).</p>'; return; }
    const m = /^FA-?(\d{1,6})$/.exec(raw);
    const box = $('#resultat'); box.classList.remove('hidden');
    if (!m) { box.innerHTML = '<p class="alerte erreur">Référence invalide. Elle ressemble à FA-0001.</p>'; return; }
    const ref = 'FA-' + m[1].padStart(4, '0');
    box.innerHTML = '<p>Recherche…</p>';
    try {
      const s = await api('/api/suivi/' + encodeURIComponent(ref));
      box.innerHTML = '<h2>' + esc(s.reference) + '</h2><p>' + badge(s.statut, s.demo) + '</p>' +
        '<p><strong>' + esc(s.libelle) + '</strong></p>' +
        '<p class="muted">Reçu le ' + esc(fmtLong(s.date_reception)) + '<br>Dernière mise à jour : ' + esc(fmtLong(s.mis_a_jour_le)) + '</p>' +
        '<p class="small muted">Le statut « à vérifier » signifie que le message est bien arrivé mais n\'a pas encore été contrôlé par un vérificateur.</p>';
    } catch (e) {
      box.innerHTML = '<p class="alerte erreur">' + esc(e.status === 404 ? 'Aucun signalement ne porte cette référence. Vérifiez-la et réessayez.' : e.message) + '</p>';
    }
  }
})();
