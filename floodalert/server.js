'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./lib/config');
const store = require('./lib/store');
const auth = require('./lib/auth');
const sig = require('./lib/signalements');
const dup = require('./lib/duplicates');
const forecast = require('./lib/forecasting');
const wa = require('./lib/whatsapp');
const { rateLimit, clip } = require('./lib/util');

/* ───────────── Outils HTTP ───────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// Hôte des tuiles de carte autorisé dans la CSP (déduit de TILE_URL)
const TILE_HOST = (() => {
  try {
    const u = new URL(cfg.tiles.url.replace('{s}', 'a').replace(/\{[xyz]\}/g, '0'));
    return cfg.tiles.url.includes('{s}') ? '*.' + u.hostname.split('.').slice(1).join('.') : u.hostname;
  } catch (e) { return 'tile.openstreetmap.org'; }
})();

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' https://unpkg.com",
  "img-src 'self' data: blob: https://" + TILE_HOST + " https://unpkg.com",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // OpenStreetMap exige un Referer
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function clientIp(req) {
  if (cfg.trustProxy) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || 'inconnu';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Contenu trop volumineux'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(body);
}

/* ───────────── Routeur ───────────── */

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}

const admin = { auth: true };

/* ───────────── Routes publiques ───────────── */

route('GET', '/api/health', (c) => c.json({ ok: true, signalements: store.db.signalements.length }));

route('GET', '/api/config', (c) => c.json({
  zone: cfg.zone,
  tuiles: cfg.tiles,
  urgence: cfg.urgence,
  types: sig.TYPES,
  simulateur: cfg.simulator,
  whatsapp_officiel: wa.configured(),
  photo_max_octets: cfg.maxPhotoBytes,
}));

route('GET', '/api/public/signalements', (c) => {
  const list = store.db.signalements.filter((s) => s.statut !== 'rejete');
  c.json({
    signalements: list.map(sig.publicView),
    non_localises: list.filter((s) => s.latitude == null).length,
    mis_a_jour: new Date().toISOString(),
  });
});

route('POST', '/api/signalements', async (c) => {
  if (!rateLimit('post:' + c.ip, 20, 3600000)) return c.json({ error: 'Trop de signalements depuis cette connexion. Réessayez plus tard.' }, 429);
  const b = c.body || {};
  if (b.site_web) return c.json({ ok: true, reference: 'FA-0000' }); // champ piège pour les robots : on fait semblant
  
  // Vérifier les doublons potentiels avant création (sauf si forcé)
  if (!b.confirmer_pas_doublon) {
    const doublonsPotentiels = sig.checkDuplicatesBeforeCreate({
      type_incident: b.type_incident, description: b.description, lat: b.lat, lng: b.lng,
      lieu_declare: b.lieu_declare, date_observation: b.date_observation,
    });
    if (doublonsPotentiels.length > 0) {
      return c.json({ 
        error: 'Doublons potentiels détectés', 
        doublons: doublonsPotentiels,
        message: 'Ce signalement ressemble à des signalements existants. Veuillez vérifier s\'il s\'agit du même incident avant de confirmer.'
      }, 409);
    }
  }
  
  try {
    const s = await sig.create({
      type_incident: b.type_incident, description: b.description, lat: b.lat, lng: b.lng,
      lieu_declare: b.lieu_declare, date_observation: b.date_observation, contact: b.contact,
      consentement: b.consentement === true, photo: b.photo,
    }, { source: 'web' });
    c.json({ ok: true, reference: s.reference, sur_la_carte: s.latitude != null }, 201);
  } catch (e) {
    if (e instanceof sig.ValidationError) return c.json({ error: 'Vérifiez les champs signalés.', details: e.errors }, e.status);
    throw e;
  }
});

route('GET', '/api/suivi/:ref', (c) => {
  if (!rateLimit('suivi:' + c.ip, 60, 600000)) return c.json({ error: 'Trop de requêtes.' }, 429);
  const s = sig.getByRef(c.params.ref);
  if (!s) return c.json({ error: 'Référence introuvable.' }, 404);
  const lib = {
    a_verifier: 'Reçu, en attente de vérification',
    confirme: 'Confirmé par un vérificateur',
    resolu: 'Situation déclarée terminée',
    rejete: 'Non retenu',
  };
  c.json({ reference: s.reference, statut: s.statut, libelle: lib[s.statut], date_reception: s.date_reception, mis_a_jour_le: s.mis_a_jour_le, demo: s.demo });
});

/* ───────────── WhatsApp ───────────── */

route('GET', '/webhook/whatsapp', (c) => {
  const q = c.query;
  if (q['hub.mode'] === 'subscribe' && cfg.wa.verifyToken && q['hub.verify_token'] === cfg.wa.verifyToken) {
    return send(c.res, 200, String(q['hub.challenge'] || ''));
  }
  send(c.res, 403, 'Refusé');
}, { raw: true });

route('POST', '/webhook/whatsapp', async (c) => {
  // Signature Meta : obligatoire dès que le secret d'application est configuré
  if (cfg.wa.appSecret) {
    const sigHeader = String(c.req.headers['x-hub-signature-256'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', cfg.wa.appSecret).update(c.rawBody).digest('hex');
    const A = Buffer.from(sigHeader), B = Buffer.from(expected);
    if (A.length !== B.length || !crypto.timingSafeEqual(A, B)) return send(c.res, 401, 'Signature invalide');
  } else if (wa.configured()) {
    console.warn('[sécurité] WHATSAPP_APP_SECRET absent : signature des webhooks non vérifiée.');
  }
  send(c.res, 200, 'OK'); // on répond vite à Meta, puis on traite
  let payload;
  try { payload = JSON.parse(c.rawBody.toString('utf8')); } catch (e) { return store.logError('webhook JSON', e); }
  wa.processWebhook(payload).catch((e) => store.logError('webhook', e));
}, { raw: true });

route('POST', '/api/simulateur/whatsapp', async (c) => {
  if (!cfg.simulator) return c.json({ error: 'Simulateur désactivé.' }, 404);
  if (!rateLimit('sim:' + c.ip, 120, 3600000)) return c.json({ error: 'Trop de messages.' }, 429);
  const b = c.body || {};
  const phone = 'SIM-' + clip(b.phone || 'visiteur', 20).replace(/[^\w+-]/g, '');
  let msg;
  if (b.type === 'location') msg = { type: 'location', lat: b.lat, lng: b.lng };
  else if (b.type === 'image') {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (!m) return c.json({ error: 'Image non acceptée.' }, 400);
    msg = { type: 'image', photo: Buffer.from(m[1], 'base64') };
  } else msg = { type: 'text', text: b.text };
  const replies = await wa.handle(phone, msg, { simule: true });
  c.json({ replies });
});

/* ───────────── Administration ───────────── */

route('POST', '/api/admin/login', (c) => {
  if (!rateLimit('login:' + c.ip, 10, 15 * 60000)) return c.json({ error: 'Trop de tentatives. Patientez 15 minutes.' }, 429);
  const a = auth.login(c.body && c.body.email, c.body && c.body.password);
  if (!a) return c.json({ error: 'Identifiants incorrects.' }, 401);
  c.json({ ok: true, nom: a.nom, email: a.email }, 200, { 'Set-Cookie': auth.sessionCookie(a) });
});

route('POST', '/api/admin/logout', (c) => c.json({ ok: true }, 200, { 'Set-Cookie': auth.clearCookie() }));

route('GET', '/api/admin/me', (c) => c.json({ nom: c.admin.nom, email: c.admin.email }), admin);

route('GET', '/api/admin/signalements', (c) => {
  const list = sig.applyFilters(store.db.signalements, c.query)
    .sort((a, b) => b.date_reception.localeCompare(a.date_reception));
  c.json({ signalements: list.slice(0, 500).map((s) => sig.adminView(s, false)), stats: sig.stats(list), total_filtre: list.length });
}, admin);

route('GET', '/api/admin/signalements/:id', (c) => {
  const s = sig.getById(c.params.id);
  if (!s) return c.json({ error: 'Introuvable.' }, 404);
  c.json(sig.adminView(s, true));
}, admin);

route('PATCH', '/api/admin/signalements/:id', (c) => {
  try {
    const s = sig.update(c.params.id, c.body || {}, c.admin);
    c.json(sig.adminView(s, true));
  } catch (e) {
    if (e instanceof sig.ValidationError) return c.json({ error: Object.values(e.errors).find((x) => typeof x === 'string') || 'Données invalides.', details: e.errors }, e.status);
    throw e;
  }
}, admin);

route('POST', '/api/admin/signalements/:id/analyser', async (c) => {
  const s = sig.getById(c.params.id);
  if (!s) return c.json({ error: 'Introuvable.' }, 404);
  await sig.runAnalysis(s, false);
  c.json(sig.adminView(s, true));
}, admin);

route('GET', '/api/admin/photos/:file', (c) => {
  const f = path.basename(c.params.file);
  const p = path.join(cfg.dataDir, 'uploads', f);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(f) || !fs.existsSync(p)) return c.json({ error: 'Introuvable.' }, 404);
  c.res.writeHead(200, { 'Content-Type': MIME['.' + f.split('.').pop().replace('jpg', 'jpg')] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
  fs.createReadStream(p).pipe(c.res);
}, { auth: true, raw: true });

route('GET', '/api/admin/export.csv', (c) => {
  const list = sig.applyFilters(store.db.signalements, c.query);
  const cell = (v) => {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // protection contre l'injection de formules (tableur)
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const head = ['reference', 'source', 'type', 'statut', 'priorite', 'date_observation', 'date_reception', 'lieu', 'latitude', 'longitude', 'resume', 'description', 'demo'];
  const rows = list.map((s) => [s.reference, s.source, s.type_incident, s.statut, s.priorite, s.date_observation, s.date_reception, s.lieu_declare, s.latitude, s.longitude, s.resume_ia, s.description_originale, s.demo ? 'oui' : 'non'].map(cell).join(','));
  send(c.res, 200, '\ufeff' + [head.join(','), ...rows].join('\r\n'), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="floodalert-export.csv"',
  });
}, { auth: true, raw: true });

route('GET', '/api/admin/erreurs', (c) => c.json({ erreurs: store.db.erreurs.slice(-100).reverse() }), admin);

/* ───────────── Détection avancée des doublons ───────────── */

route('GET', '/api/admin/doublons/stats', (c) => {
  c.json(dup.duplicateStats(store.db.signalements));
}, admin);

route('GET', '/api/admin/doublons/groupes', (c) => {
  const groupes = dup.detectAllDuplicates(store.db.signalements);
  c.json({ groupes, total: groupes.length });
}, admin);

route('GET', '/api/admin/doublons/clusters', (c) => {
  const clusters = dup.clusterIncidents(store.db.signalements);
  c.json({ clusters, total: clusters.length });
}, admin);

route('GET', '/api/admin/doublons/:ref/suggestion', (c) => {
  const s = sig.getByRef(c.params.ref);
  if (!s) return c.json({ error: 'Signalement introuvable.' }, 404);
  const duplicates = s.doublons || [];
  const suggestion = dup.suggestAction(s.reference, duplicates.map(d => d.reference), store.db.signalements);
  c.json(suggestion);
}, admin);

/* ───────────── Prévision des risques ───────────── */

route('GET', '/api/admin/risques/rapport', (c) => {
  const rapport = forecast.generateRiskReport(store.db.signalements);
  c.json(rapport);
}, admin);

route('GET', '/api/admin/risques/actuel', (c) => {
  const riskScore = forecast.calculateRiskScore(store.db.signalements);
  c.json(riskScore);
}, admin);

route('GET', '/api/admin/risques/previsions', (c) => {
  const days = parseInt(c.query.days) || 7;
  const forecastData = forecast.generateForecast(store.db.signalements, days);
  c.json(forecastData);
}, admin);

route('GET', '/api/admin/risques/tendances', (c) => {
  const days = parseInt(c.query.days) || 30;
  const trends = forecast.analyzeTrends(store.db.signalements, days);
  c.json(trends);
}, admin);

route('GET', '/api/admin/risques/spatial', (c) => {
  const spatial = forecast.analyzeSpatialDistribution(store.db.signalements);
  c.json(spatial);
}, admin);

route('GET', '/api/admin/risques/recommandations', (c) => {
  const riskScore = forecast.calculateRiskScore(store.db.signalements);
  const recommendations = forecast.generateRecommendations(riskScore);
  c.json(recommendations);
}, admin);

/* ───────────── Fichiers statiques ───────────── */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(cfg.publicDir, rel));
  if (!file.startsWith(cfg.publicDir + path.sep) || path.basename(file).startsWith('.')) return send(res, 403, 'Accès refusé');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Page introuvable');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ───────────── Boucle principale ───────────── */

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    const match = routes.map((r) => ({ r, m: r.method === req.method ? r.re.exec(pathname) : null })).find((x) => x.m);
    if (!match) {
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
      return send(res, 404, { error: 'Route inconnue.' });
    }
    const { r, m } = match;
    const ctx = {
      req, res, ip: clientIp(req), query: Object.fromEntries(url.searchParams), params: {}, body: null, admin: null,
      json: (data, status = 200, headers = {}) => send(res, status, data, headers),
    };
    r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });

    if (r.opts.auth) {
      ctx.admin = auth.adminFromReq(req);
      if (!ctx.admin) return send(res, 401, { error: 'Connexion requise.' });
    }
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      const isWebhook = pathname.startsWith('/webhook/');
      // Protection CSRF : les appels d'écriture du site portent un en-tête que les formulaires externes ne peuvent pas envoyer
      if (!isWebhook && req.headers['x-requested-with'] !== 'fetch') return send(res, 403, { error: 'Requête refusée.' });
      const raw = await readBody(req, cfg.maxBodyBytes);
      ctx.rawBody = raw;
      if (!isWebhook && raw.length) {
        try { ctx.body = JSON.parse(raw.toString('utf8')); }
        catch { return send(res, 400, { error: 'Corps JSON invalide.' }); }
      }
    }
    await r.handler(ctx);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) store.logError(req.method + ' ' + pathname, e);
    if (!res.headersSent) send(res, status, { error: status === 413 ? 'Contenu trop volumineux.' : 'Erreur interne du serveur.' });
    else res.end();
  }
});

if (require.main === module) {
  const created = auth.ensureAdmin();
  server.listen(cfg.port, () => {
    console.log(`\nFloodAlert Togo démarré : http://localhost:${cfg.port}`);
    console.log(`Zone pilote : ${cfg.zone.nom}`);
    console.log(`WhatsApp officiel : ${wa.configured() ? 'configuré' : 'non configuré (utilisez le simulateur : /simulateur.html)'}`);
    console.log(`IA : ${process.env.GEMINI_API_KEY ? 'Gemini ' : ''}${process.env.GROQ_API_KEY ? 'Groq ' : ''}${process.env.OLLAMA_MODEL ? 'Ollama ' : ''}${!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OLLAMA_MODEL ? 'règles locales uniquement (ajoutez une clé gratuite dans .env pour une meilleure analyse)' : ''}`);
    if (created) {
      console.log(`\nCompte administrateur créé : ${created.email}`);
      if (created.password) console.log(`Mot de passe généré (notez-le, il ne sera plus affiché) : ${created.password}`);
    }
    console.log(`Espace administrateur : http://localhost:${cfg.port}/admin.html\n`);
  });
}

module.exports = server;
