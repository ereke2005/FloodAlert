(function () {
  'use strict';
  const { api, esc } = FA;
  FA.entete('simulateur');
  const $ = (s) => document.querySelector(s);
  let phone = 'visiteur-' + Math.random().toString(36).slice(2, 8);

  function bulle(txt, who) {
    const d = document.createElement('div');
    d.className = 'bulle ' + who; d.textContent = txt;
    $('#fil').appendChild(d); $('#fil').scrollTop = $('#fil').scrollHeight;
  }

  async function envoyer(payload, affichage) {
    bulle(affichage, 'moi');
    try {
      const r = await api('/api/simulateur/whatsapp', { method: 'POST', body: { phone, ...payload } });
      r.replies.forEach((t) => bulle(t, 'bot'));
    } catch (e) { bulle('Erreur : ' + e.message, 'bot'); }
  }

  api('/api/config').then((c) => { if (!c.simulateur) { $('#indispo').classList.remove('hidden'); $('#form').classList.add('hidden'); } }).catch(() => {});

  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#texte').value.trim(); if (!t) return;
    $('#texte').value = '';
    envoyer({ type: 'text', text: t }, t);
  });
  $('#btn-pos').addEventListener('click', () => envoyer({ type: 'location', lat: 6.1953, lng: 1.1744 }, '📍 Position partagée'));
  $('#btn-nouveau').addEventListener('click', () => { phone = 'visiteur-' + Math.random().toString(36).slice(2, 8); $('#fil').innerHTML = ''; bulle('Nouvelle conversation démarrée. Écrivez votre message.', 'bot'); });
  $('#photo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); e.target.value = '';
      envoyer({ type: 'image', image: c.toDataURL('image/jpeg', 0.8) }, '📷 Photo envoyée');
    };
    img.src = url;
  });
})();
