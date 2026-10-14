/* Formulaire de signalement : validation, position, photo réduite côté navigateur */
(function () {
  'use strict';
  const { api, esc } = FA;
  FA.entete('signaler');
  const $ = (s) => document.querySelector(s);
  let map, pin = null, coords = null;

  function setCoords(lat, lng, etat) {
    coords = { lat, lng };
    if (pin) pin.setLatLng([lat, lng]); else pin = L.marker([lat, lng], { keyboard: false }).addTo(map);
    $('#gps-etat').textContent = etat || 'Position enregistrée. Vous pouvez la corriger en touchant la carte.';
  }

  function nowLocalInput() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  async function init() {
    let cfg = { zone: { centre: [6.1725, 1.2314], zoom: 12 }, urgence: '' };
    try { cfg = await api('/api/config'); } catch (e) { /* valeurs par défaut */ }
    $('#urgence').textContent = 'FloodAlert n\'est pas un service de secours. ' + cfg.urgence;
    $('#urgence2').textContent = cfg.urgence;

    map = L.map('mini-carte').setView(cfg.zone.centre, cfg.zone.zoom);
    const t = cfg.tuiles || { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' };
    L.tileLayer(t.url, { maxZoom: 19, attribution: t.attribution }).addTo(map);
    map.on('click', (e) => setCoords(e.latlng.lat, e.latlng.lng));

    const d = $('#date_observation');
    d.value = nowLocalInput(); d.max = nowLocalInput();

    $('#btn-gps').addEventListener('click', () => {
      if (!navigator.geolocation) { $('#gps-etat').textContent = 'Votre navigateur ne propose pas la localisation. Touchez la carte ou indiquez un repère.'; return; }
      $('#gps-etat').textContent = 'Recherche de votre position…';
      navigator.geolocation.getCurrentPosition(
        (p) => { setCoords(p.coords.latitude, p.coords.longitude, 'Position trouvée (précision environ ' + Math.round(p.coords.accuracy) + ' m).'); map.setView([p.coords.latitude, p.coords.longitude], 16); },
        () => { $('#gps-etat').textContent = 'Position refusée ou indisponible. Touchez la carte ou indiquez un repère.'; },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });

    $('#contact').addEventListener('input', (e) => $('#bloc-consentement').classList.toggle('hidden', !e.target.value.trim()));
    $('#photo').addEventListener('change', onPhoto);
    $('#form').addEventListener('submit', onSubmit);
  }

  /* Réduction de la photo (max 1280 px, JPEG) : limite le poids et supprime les métadonnées EXIF */
  let photoData = null;
  function onPhoto(e) {
    const f = e.target.files[0];
    photoData = null; $('#apercu').classList.add('hidden');
    clearErr('photo');
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { showErr('photo', 'Format non accepté. Utilisez JPEG, PNG ou WebP.'); e.target.value = ''; return; }
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      photoData = c.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(url);
      $('#apercu').src = photoData; $('#apercu').classList.remove('hidden');
    };
    img.onerror = () => { showErr('photo', 'Cette image ne peut pas être lue.'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function showErr(champ, msg) {
    const c = document.querySelector('[data-champ="' + champ + '"]');
    if (!c) return false;
    c.classList.add('invalide');
    const p = c.querySelector('.erreur-champ'); if (p) p.textContent = msg;
    return true;
  }
  function clearErr(champ) {
    const c = document.querySelector('[data-champ="' + champ + '"]');
    if (c) { c.classList.remove('invalide'); const p = c.querySelector('.erreur-champ'); if (p) p.textContent = ''; }
  }
  function clearAll() { document.querySelectorAll('[data-champ]').forEach((c) => clearErr(c.dataset.champ)); $('#erreur-globale').classList.add('hidden'); }

  async function onSubmit(ev) {
    ev.preventDefault();
    clearAll();
    const body = {
      type_incident: $('#type_incident').value,
      description: $('#description').value.trim(),
      lieu_declare: $('#lieu_declare').value.trim(),
      lat: coords ? coords.lat : null, lng: coords ? coords.lng : null,
      date_observation: $('#date_observation').value ? new Date($('#date_observation').value).toISOString() : '',
      contact: $('#contact').value.trim(),
      consentement: $('#consentement').checked,
      photo: photoData,
      site_web: $('#site_web').value,
      confirmer_pas_doublon: false,
    };
    // Contrôles rapides côté navigateur (le serveur revérifie tout)
    let bad = false;
    if (!body.type_incident) bad = showErr('type_incident', 'Choisissez un type d\'incident.') || bad;
    if (body.description.length < 5) bad = showErr('description', 'Décrivez la situation en quelques mots.') || bad;
    if (!coords && body.lieu_declare.length < 3) bad = showErr('localisation', 'Indiquez votre position ou un lieu précis.') || bad;
    if (!body.date_observation) bad = showErr('date_observation', 'Indiquez quand vous avez constaté la situation.') || bad;
    if (body.contact && !body.consentement) bad = showErr('consentement', 'Cochez la case pour autoriser un recontact.') || bad;
    if (bad) { const f = document.querySelector('.invalide'); if (f) f.scrollIntoView({ block: 'center' }); return; }

    const btn = $('#envoyer'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const r = await api('/api/signalements', { method: 'POST', body });
      $('#form').classList.add('hidden');
      $('#ref').textContent = r.reference;
      $('#note-carte').textContent = r.sur_la_carte
        ? 'Notez cette référence pour suivre votre signalement. Il apparaîtra sur la carte avec la mention « à vérifier ».'
        : 'Notez cette référence pour suivre votre signalement. Sans position précise, il n\'apparaîtra pas sur la carte tant qu\'un vérificateur ne l\'aura pas localisé.';
      $('#succes').classList.remove('hidden');
      $('#succes').scrollIntoView();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Envoyer le signalement';
      
      // Gérer spécifiquement l'erreur de doublons
      if (e.status === 409 && e.doublons) {
        $('#form').classList.add('hidden');
        $('#avertissement-doublons').classList.remove('hidden');
        
        // Afficher la liste des doublons avec liens
        const listeHtml = e.doublons.map(d => {
          const raisons = d.raisons ? d.raisons.join(', ') : 'similaire';
          return '<div class="doublon-item">' +
            '<strong><a href="index.html" target="_blank">' + d.reference + '</a></strong> ' +
            '<span class="doublon-raisons">(' + raisons + ')</span>' +
            '</div>';
        }).join('');
        $('#liste-doublons').innerHTML = listeHtml;
        $('#avertissement-doublons').scrollIntoView();
        return;
      }
      
      if (e.details) {
        Object.entries(e.details).forEach(([k, v]) => { if (typeof v === 'string') showErr(k, v); });
        const g = $('#erreur-globale'); g.textContent = e.message; g.classList.remove('hidden');
      } else {
        const g = $('#erreur-globale'); g.textContent = e.message; g.classList.remove('hidden');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Forcer l'envoi malgré les doublons
  $('#confirmer-pas-doublon').addEventListener('click', async () => {
    const body = {
      type_incident: $('#type_incident').value,
      description: $('#description').value.trim(),
      lieu_declare: $('#lieu_declare').value.trim(),
      lat: coords ? coords.lat : null, lng: coords ? coords.lng : null,
      date_observation: $('#date_observation').value ? new Date($('#date_observation').value).toISOString() : '',
      contact: $('#contact').value.trim(),
      consentement: $('#consentement').checked,
      photo: photoData,
      site_web: $('#site_web').value,
      confirmer_pas_doublon: true, // Force l'envoi
    };
    
    const btn = $('#confirmer-pas-doublon'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const r = await api('/api/signalements', { method: 'POST', body });
      $('#avertissement-doublons').classList.add('hidden');
      $('#ref').textContent = r.reference;
      $('#note-carte').textContent = r.sur_la_carte
        ? 'Notez cette référence pour suivre votre signalement. Il apparaîtra sur la carte avec la mention « à vérifier ».'
        : 'Notez cette référence pour suivre votre signalement. Sans position précise, il n\'apparaîtra pas sur la carte tant qu\'un vérificateur ne l\'aura pas localisé.';
      $('#succes').classList.remove('hidden');
      $('#succes').scrollIntoView();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Confirmer et envoyer malgré tout';
      const g = $('#erreur-globale'); g.textContent = e.message; g.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Modifier le signalement (retour au formulaire)
  $('#modifier-signalement').addEventListener('click', () => {
    $('#avertissement-doublons').classList.add('hidden');
    $('#form').classList.remove('hidden');
    $('#form').scrollIntoView();
  });

  init();
})();
