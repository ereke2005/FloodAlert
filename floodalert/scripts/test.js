'use strict';
// Tests de bout en bout : lance un serveur isolé (base temporaire) et vérifie les scénarios T01 à T11
// du cahier des charges ainsi que des contrôles de sécurité. Usage : node scripts/test.js [--rapport]
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'floodalert-test-'));
const ADMIN = { email: 'test@floodalert.tg', password: 'Mot-de-passe-de-test-1' };
const APP_SECRET = 'secret-de-test';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const results = [];
let cookie = '';

async function http(method, p, { body, raw, headers = {}, auth = false, csrf = true } = {}) {
  const h = { ...headers };
  if (csrf && method !== 'GET') h['X-Requested-With'] = 'fetch';
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (auth && cookie) h.Cookie = cookie;
  const r = await fetch(BASE + p, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* texte brut */ }
  return { status: r.status, json, text, headers: r.headers };
}

async function check(id, titre, fn) {
  try { await fn(); results.push({ id, titre, ok: true }); console.log('  OK   ' + id + '  ' + titre); }
  catch (e) { results.push({ id, titre, ok: false, erreur: e.message }); console.log('  ÉCHEC ' + id + '  ' + titre + '\n        → ' + e.message); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion fausse'); };
const nowIso = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60000).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch (e) { /* pas prêt */ } await sleep(150); }
  throw new Error('Le serveur de test ne démarre pas');
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      GEMINI_API_KEY: 'cle-invalide-pour-test', AI_PROVIDER: 'auto', GROQ_API_KEY: '', OLLAMA_MODEL: '',
      WHATSAPP_VERIFY_TOKEN: 'jeton-test', WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', SIMULATOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = ''; srv.stdout.on('data', (d) => { sortie += d; }); srv.stderr.on('data', (d) => { sortie += d; });
  const stop = () => { try { srv.kill(); } catch (e) { /* déjà arrêté */ } };
  process.on('exit', stop);

  try {
    await waitReady();
    console.log('\nFloodAlert Togo — tests de bout en bout\n');

    const login = await http('POST', '/api/admin/login', { body: ADMIN });
    cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

    let refWeb, idWeb, refWa, refWa2;

    await check('T01', 'Signalement WhatsApp complet : enregistré, référence et accusé de réception retournés', async () => {
      const r = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'a1', type: 'text', text: "Il y a beaucoup d'eau près du marché d'Adidogomé et les motos ne passent plus." } });
      assert(r.status === 200, 'statut ' + r.status);
      const txt = r.json.replies.join('\n');
      const m = /référence (FA-\d{4})/.exec(txt);
      assert(m, 'pas de référence dans l\'accusé : ' + txt.slice(0, 120));
      assert(/en attente de vérification/.test(txt), 'accusé sans mention d\'attente');
      refWa = m[1];
      const list = await http('GET', '/api/admin/signalements', { auth: true });
      const s = list.json.signalements.find((x) => x.reference === refWa);
      assert(s && s.source === 'whatsapp' && s.statut === 'a_verifier', 'signalement absent ou mal enregistré');
    });

    await check('T02', 'Message sans lieu : le bot demande une localisation, puis enregistre avec la position partagée', async () => {
      const a = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'a2', type: 'text', text: 'La route est inondée et personne ne passe' } });
      assert(/position|quartier/i.test(a.json.replies[0]) && !/référence FA/.test(a.json.replies[0]), 'le bot n\'a pas demandé la localisation');
      const b = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'a2', type: 'location', lat: 6.2330, lng: 1.2230 } });
      const m = /référence (FA-\d{4})/.exec(b.json.replies.join('\n'));
      assert(m, 'pas d\'accusé après la position');
      refWa2 = m[1];
      const pub = await http('GET', '/api/public/signalements');
      assert(pub.json.signalements.find((x) => x.reference === refWa2 && x.lat != null), 'absent de la carte');
    });

    await check('T03', 'Formulaire web : signalement enregistré et référence affichée', async () => {
      const r = await http('POST', '/api/signalements', { body: { type_incident: 'inondation', description: 'Eau jusqu\'au genou devant l\'école de Tokoin', lat: 6.1550, lng: 1.2150, lieu_declare: 'École de Tokoin', date_observation: nowIso(-30), contact: '90000000', consentement: true } });
      assert(r.status === 201 && /^FA-\d{4}$/.test(r.json.reference), 'statut ' + r.status + ' ' + r.text.slice(0, 100));
      refWeb = r.json.reference;
      const list = await http('GET', '/api/admin/signalements', { auth: true });
      idWeb = list.json.signalements.find((x) => x.reference === refWeb).id;
    });

    await check('T03b', 'Formulaire web : champs obligatoires contrôlés côté serveur', async () => {
      const r = await http('POST', '/api/signalements', { body: { description: 'x' } });
      assert(r.status === 400 && r.json.details.type_incident && r.json.details.description && r.json.details.localisation && r.json.details.date_observation, 'erreurs attendues absentes : ' + r.text.slice(0, 200));
      const total = (await http('GET', '/api/admin/signalements', { auth: true })).json.total_filtre;
      assert(total >= 3, 'données invalides enregistrées ?');
    });

    await check('T04', 'Photo : stockée de façon sécurisée, visible des administrateurs seulement', async () => {
      const r = await http('POST', '/api/signalements', { body: { type_incident: 'route_bloquee', description: 'Route coupée par l\'eau avec photo', lat: 6.158, lng: 1.19, date_observation: nowIso(-10), photo: PNG } });
      assert(r.status === 201, 'statut ' + r.status + r.text);
      const list = await http('GET', '/api/admin/signalements', { auth: true });
      const s = list.json.signalements.find((x) => x.reference === r.json.reference);
      const d = await http('GET', '/api/admin/signalements/' + s.id, { auth: true });
      assert(d.json.photo_url, 'pas d\'URL de photo');
      const ph = await http('GET', d.json.photo_url, { auth: true });
      assert(ph.status === 200 && /image\/png/.test(ph.headers.get('content-type')), 'photo non servie à l\'admin');
      const anon = await http('GET', d.json.photo_url);
      assert(anon.status === 401, 'photo accessible sans connexion (' + anon.status + ')');
      const pub = JSON.stringify((await http('GET', '/api/public/signalements')).json);
      assert(!/photo/.test(pub), 'la photo fuit dans l\'API publique');
    });

    await check('T04b', 'Photo : un faux fichier image est refusé (signature contrôlée)', async () => {
      const fake = 'data:image/png;base64,' + Buffer.from('<?php echo 1; ?> ce n\'est pas une image').toString('base64');
      const r = await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Test fichier malveillant', lieu_declare: 'Quelque part à Lomé', date_observation: nowIso(-5), photo: fake } });
      assert(r.status === 400 && r.json.details.photo, 'faux fichier accepté : ' + r.status);
    });

    await check('T05', 'Coordonnées valides : marqueur disponible, position publique arrondie', async () => {
      const pub = (await http('GET', '/api/public/signalements')).json.signalements.find((x) => x.reference === refWeb);
      assert(pub && pub.lat === 6.155 && pub.lng === 1.215, 'position publique inattendue : ' + (pub && pub.lat) + ',' + (pub && pub.lng));
    });

    await check('T06', 'Description ambiguë : incertitudes signalées, validation humaine possible', async () => {
      const r = await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Il y a un problème avec l\'eau ici, ça devient compliqué', lieu_declare: 'Près de chez moi', date_observation: nowIso(-5) } });
      const id = (await http('GET', '/api/admin/signalements', { auth: true })).json.signalements.find((x) => x.reference === r.json.reference).id;
      const d = (await http('GET', '/api/admin/signalements/' + id, { auth: true })).json;
      assert(d.analyse && d.analyse.champs_incertains.length > 0, 'aucune incertitude signalée');
      assert(d.analyse.gravite === 'non_determinee', 'gravité inventée : ' + d.analyse.gravite);
      assert(d.latitude === null, 'des coordonnées ont été inventées');
    });

    await check('T07', 'L\'administrateur confirme un incident : statut mis à jour en base et sur la carte', async () => {
      const r = await http('PATCH', '/api/admin/signalements/' + idWeb, { auth: true, body: { statut: 'confirme' } });
      assert(r.status === 200 && r.json.statut === 'confirme', 'statut ' + r.status + r.text.slice(0, 150));
      const pub = (await http('GET', '/api/public/signalements')).json.signalements.find((x) => x.reference === refWeb);
      assert(pub.statut === 'confirme', 'carte non mise à jour');
      const h = r.json.historique.find((x) => x.type === 'statut');
      assert(h && h.auteur === ADMIN.email && h.date, 'historique sans auteur/date');
    });

    await check('T08', 'Rejet : motif obligatoire, conservé, incident exclu des incidents actifs', async () => {
      const no = await http('PATCH', '/api/admin/signalements/' + idWeb, { auth: true, body: { statut: 'rejete' } });
      assert(no.status === 400, 'rejet sans motif accepté');
      const c = await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Message à rejeter pour le test', lieu_declare: 'Lomé centre', lat: 6.17, lng: 1.23, date_observation: nowIso(-5) } });
      const id = (await http('GET', '/api/admin/signalements', { auth: true })).json.signalements.find((x) => x.reference === c.json.reference).id;
      const ok = await http('PATCH', '/api/admin/signalements/' + id, { auth: true, body: { statut: 'rejete', motif: 'Hors sujet' } });
      assert(ok.status === 200 && ok.json.motif_rejet === 'Hors sujet', 'motif non conservé');
      const pub = (await http('GET', '/api/public/signalements')).json.signalements;
      assert(!pub.find((x) => x.reference === c.json.reference), 'un signalement rejeté reste public');
    });

    await check('T09', 'Utilisateur non autorisé : accès refusé au tableau de bord', async () => {
      const a = await http('GET', '/api/admin/signalements');
      assert(a.status === 401, 'accès anonyme : ' + a.status);
      const b = await http('GET', '/api/admin/signalements', { headers: { Cookie: 'fa_session=forge.forge' } });
      assert(b.status === 401, 'cookie forgé accepté : ' + b.status);
      const c = await http('POST', '/api/admin/login', { body: { email: ADMIN.email, password: 'mauvais' } });
      assert(c.status === 401, 'mauvais mot de passe accepté');
      const d = await http('PATCH', '/api/admin/signalements/' + idWeb, { body: { statut: 'resolu' } });
      assert(d.status === 401, 'modification anonyme : ' + d.status);
    });

    await check('T10', 'Service IA indisponible : signalement conservé, repli sur l\'analyse locale, traitement manuel possible', async () => {
      const r = await http('POST', '/api/signalements', { body: { type_incident: 'inondation', description: 'Inondation à Baguida près du pont, eau jusqu\'à la cheville', lieu_declare: 'Baguida', date_observation: nowIso(-5) } });
      assert(r.status === 201, 'signalement perdu : ' + r.status);
      const id = (await http('GET', '/api/admin/signalements', { auth: true })).json.signalements.find((x) => x.reference === r.json.reference).id;
      const d = (await http('GET', '/api/admin/signalements/' + id, { auth: true })).json;
      assert(d.analyse && d.analyse.traitement === 'repli' && d.analyse.source === 'regles', 'pas de repli : ' + JSON.stringify(d.analyse && { t: d.analyse.traitement, s: d.analyse.source }));
      const u = await http('PATCH', '/api/admin/signalements/' + id, { auth: true, body: { resume_ia: 'Résumé corrigé à la main', type_incident: 'debordement' } });
      assert(u.status === 200 && u.json.resume_ia === 'Résumé corrigé à la main', 'correction manuelle impossible');
    });

    await check('T11', 'Données simulées : explicitement identifiées comme démonstration', async () => {
      const pub = (await http('GET', '/api/public/signalements')).json.signalements;
      const s = pub.find((x) => x.reference === refWa);
      assert(s && s.demo === true && s.simule === true, 'signalement du simulateur non marqué');
      const real = pub.find((x) => x.reference === refWeb);
      assert(real.demo === false, 'un signalement réel est marqué démo');
      const filtre = (await http('GET', '/api/admin/signalements?demo=0', { auth: true })).json;
      assert(filtre.signalements.every((x) => !x.demo), 'le filtre « terrain uniquement » laisse passer des démos');
    });

    // ───── Contrôles complémentaires ─────

    await check('S01', 'Protection CSRF : une écriture sans l\'en-tête du site est refusée', async () => {
      const r = await http('POST', '/api/signalements', { csrf: false, body: { type_incident: 'autre', description: 'test csrf' } });
      assert(r.status === 403, 'statut ' + r.status);
    });

    await check('S02', 'Coordonnées hors du Togo et date future refusées', async () => {
      const a = await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Hors pays test', lat: 48.85, lng: 2.35, date_observation: nowIso(-5) } });
      assert(a.status === 400 && a.json.details.localisation, 'coordonnées hors pays acceptées');
      const b = await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Futur test', lieu_declare: 'Lomé', date_observation: nowIso(600) } });
      assert(b.status === 400 && b.json.details.date_observation, 'date future acceptée');
    });

    await check('S03', 'Confidentialité : l\'API publique n\'expose ni contact, ni téléphone, ni description brute', async () => {
      const txt = (await http('GET', '/api/public/signalements')).text;
      assert(!/90000000|telephone|contact|description_originale|a1|SIM-/.test(txt), 'donnée privée exposée');
      const suivi = await http('GET', '/api/suivi/' + refWeb);
      assert(suivi.status === 200 && !/contact|telephone/.test(suivi.text), 'suivi trop bavard');
    });

    await check('S04', 'Doublons : des déclarations proches sont signalées, aucune n\'est supprimée', async () => {
      const mk = (d) => http('POST', '/api/signalements', { body: { type_incident: 'inondation', description: d, lat: 6.1371, lng: 1.2401, lieu_declare: 'Bè', date_observation: nowIso(-20) } });
      const a = await mk('Grosse inondation à Bè près du canal, les habitants évacuent');
      const b = await mk('Inondation importante à Bè près du canal, les habitants évacuent leurs maisons');
      const list = (await http('GET', '/api/admin/signalements', { auth: true })).json.signalements;
      const sb = list.find((x) => x.reference === b.json.reference);
      assert(sb.doublons.some((d) => d.reference === a.json.reference), 'doublon non détecté');
      assert(list.find((x) => x.reference === a.json.reference), 'un signalement a disparu');
    });

    await check('S05', 'Un incident doit être confirmé avant d\'être résolu ; réouverture possible', async () => {
      const bad = await http('PATCH', '/api/admin/signalements/' + (await http('GET', '/api/admin/signalements?q=Baguida', { auth: true })).json.signalements[0].id, { auth: true, body: { statut: 'resolu' } });
      assert(bad.status === 400, 'résolu sans confirmation accepté');
      const ok = await http('PATCH', '/api/admin/signalements/' + idWeb, { auth: true, body: { statut: 'resolu' } });
      assert(ok.status === 200, 'passage à résolu refusé');
      const re = await http('PATCH', '/api/admin/signalements/' + idWeb, { auth: true, body: { statut: 'a_verifier' } });
      assert(re.status === 200 && re.json.statut === 'a_verifier', 'réouverture impossible');
    });

    await check('S06', 'Statistiques cohérentes avec la liste filtrée', async () => {
      const r = (await http('GET', '/api/admin/signalements?statut=a_verifier', { auth: true })).json;
      assert(r.stats.total === r.total_filtre && r.stats.par_statut.a_verifier === r.total_filtre, 'incohérence stats/liste');
      const all = (await http('GET', '/api/admin/signalements', { auth: true })).json;
      assert(Object.values(all.stats.par_statut).reduce((a, b) => a + b, 0) === all.stats.total, 'somme des statuts ≠ total');
    });

    await check('S07', 'Export CSV : cellules neutralisées contre l\'injection de formules', async () => {
      await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: '=HYPERLINK("http://x.example","clic")', lieu_declare: 'Lomé', date_observation: nowIso(-5) } });
      const r = await http('GET', '/api/admin/export.csv', { auth: true });
      assert(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')), 'export indisponible');
      assert(!/(^|,)"=HYPERLINK/.test(r.text) && /"'=HYPERLINK/.test(r.text), 'formule non neutralisée');
      assert((await http('GET', '/api/admin/export.csv')).status === 401, 'export public');
    });

    await check('S08', 'Fichiers statiques : traversée de dossiers et fichiers cachés refusés', async () => {
      const a = await http('GET', '/..%2f..%2fetc%2fpasswd');
      assert(a.status !== 200 && !/root:/.test(a.text), 'traversée possible');
      const b = await http('GET', '/%2e%2e/server.js');
      assert(b.status !== 200, 'code source exposé');
      const c = await http('GET', '/index.html');
      assert(c.status === 200 && /Content-Security-Policy/i.test([...c.headers.keys()].join(' ') ? 'Content-Security-Policy' : ''), 'page d\'accueil indisponible');
      assert(c.headers.get('content-security-policy'), 'CSP absente');
    });

    await check('S09', 'Webhook WhatsApp : vérification du jeton et de la signature Meta', async () => {
      const ok = await http('GET', '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=jeton-test&hub.challenge=12345');
      assert(ok.status === 200 && ok.text === '12345', 'challenge non renvoyé');
      const ko = await http('GET', '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=mauvais&hub.challenge=1');
      assert(ko.status === 403, 'mauvais jeton accepté');
      const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '22890001111', id: 'wamid.TEST1', type: 'text', text: { body: 'Inondation devant le marché de Totsi, eau partout' } }] } }] }] });
      const bad = await http('POST', '/webhook/whatsapp', { csrf: false, raw: payload, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) } });
      assert(bad.status === 401, 'signature invalide acceptée');
      const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
      const good = await http('POST', '/webhook/whatsapp', { csrf: false, raw: payload, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig } });
      assert(good.status === 200, 'signature valide refusée');
      await sleep(1200);
      const list = (await http('GET', '/api/admin/signalements?q=Totsi', { auth: true })).json.signalements;
      assert(list.some((x) => x.source === 'whatsapp' && !x.simule), 'message du webhook non traité');
      // Rejeu du même message : pas de doublon
      const n1 = (await http('GET', '/api/admin/signalements?q=Totsi', { auth: true })).json.total_filtre;
      await http('POST', '/webhook/whatsapp', { csrf: false, raw: payload, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig } });
      await sleep(600);
      const n2 = (await http('GET', '/api/admin/signalements?q=Totsi', { auth: true })).json.total_filtre;
      assert(n1 === n2, 'message rejoué traité deux fois');
    });

    await check('S10', 'WhatsApp : message hors sujet = explication ; statut visible seulement par l\'auteur', async () => {
      const a = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'b1', type: 'text', text: 'Quel est le prix du riz ?' } });
      assert(/signalements d'inondation/.test(a.json.replies[0]) && !/référence FA/.test(a.json.replies[0]), 'réponse hors sujet inattendue');
      const mine = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'a1', type: 'text', text: 'STATUT ' + refWa } });
      assert(/Signalement FA-\d{4}/.test(mine.json.replies[0]), 'l\'auteur ne voit pas le statut');
      const other = await http('POST', '/api/simulateur/whatsapp', { body: { phone: 'intrus', type: 'text', text: 'STATUT ' + refWa } });
      assert(/introuvable/i.test(other.json.replies[0]), 'un tiers voit le statut');
    });

    await check('S11', 'Anti-robots : le champ piège ne crée aucun signalement', async () => {
      const before = (await http('GET', '/api/admin/signalements', { auth: true })).json.total_filtre;
      await http('POST', '/api/signalements', { body: { type_incident: 'autre', description: 'Spam de robot', lieu_declare: 'Lomé', date_observation: nowIso(-1), site_web: 'http://spam.example' } });
      const after = (await http('GET', '/api/admin/signalements', { auth: true })).json.total_filtre;
      assert(before === after, 'le spam a été enregistré');
    });

    await check('S12', 'Erreurs techniques journalisées et consultables par un administrateur', async () => {
      const r = await http('GET', '/api/admin/erreurs', { auth: true });
      assert(r.status === 200 && Array.isArray(r.json.erreurs), 'journal indisponible');
      assert((await http('GET', '/api/admin/erreurs')).status === 401, 'journal public');
    });
  } catch (e) {
    console.error('\nErreur fatale des tests :', e.message, '\n', sortie.slice(-800));
    results.push({ id: 'FATAL', titre: 'Exécution', ok: false, erreur: e.message });
  }

  stop();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} tests réussis\n`);

  if (process.argv.includes('--rapport')) {
    const md = ['# Rapport de tests FloodAlert Togo', '', `Exécuté le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC avec Node ${process.version}.`, '',
      `**Résultat : ${ok}/${results.length} tests réussis.**`, '', '| ID | Scénario | Résultat |', '| --- | --- | --- |',
      ...results.map((r) => `| ${r.id} | ${r.titre} | ${r.ok ? 'Réussi' : 'Échec : ' + r.erreur} |`), '',
      '## Ce que ces tests ne couvrent pas', '',
      '- Le fonctionnement réel avec les fournisseurs d\'IA (Gemini, Groq, Ollama) : les tests exécutent le repli par règles locales, car aucune clé n\'est fournie.',
      '- L\'envoi réel de messages par l\'API WhatsApp Business de Meta (le moteur de conversation et la sécurité du webhook sont testés, pas l\'envoi).',
      '- L\'affichage dans les navigateurs (carte Leaflet, mise en page mobile) : à vérifier manuellement avant la démonstration.',
      '- La charge : le stockage JSON convient à un prototype, pas à un fort trafic.'];
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'RAPPORT_TESTS.md'), md.join('\n') + '\n');
    console.log('Rapport écrit dans docs/RAPPORT_TESTS.md');
  }
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(ok === results.length ? 0 : 1);
})();
