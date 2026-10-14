'use strict';
const fs = require('fs');
const path = require('path');

// Lecture simple du fichier .env (aucune dépendance externe)
(function loadEnv() {
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const e = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

module.exports = {
  port: num(e.PORT, 3000),
  root: path.join(__dirname, '..'),
  publicDir: path.join(__dirname, '..', 'public'),
  dataDir: path.resolve(e.DATA_DIR || path.join(__dirname, '..', 'data')),
  zone: {
    nom: e.ZONE_NOM || 'Grand Lomé (zone pilote)',
    centre: [num(e.ZONE_LAT, 6.1725), num(e.ZONE_LNG, 1.2314)],
    zoom: num(e.ZONE_ZOOM, 12),
  },
  // Rectangle englobant le Togo : toute coordonnée hors de ce cadre est refusée
  togoBbox: { minLat: 6.0, maxLat: 11.2, minLng: -0.2, maxLng: 1.9 },
  tiles: {
    url: e.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: e.TILE_ATTRIBUTION || '© les contributeurs d\'<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  cookieSecure: e.COOKIE_SECURE === '1',
  trustProxy: e.TRUST_PROXY === '1',
  maxPhotoBytes: 3 * 1024 * 1024,
  maxBodyBytes: 6 * 1024 * 1024,
  urgence: e.URGENCE_TEXTE || 'En cas de danger immédiat, appelez les secours : pompiers 118, police 117.',
  simulator: e.SIMULATOR !== '0',
  wa: {
    token: e.WHATSAPP_TOKEN || '',
    phoneId: e.WHATSAPP_PHONE_ID || '',
    verifyToken: e.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: e.WHATSAPP_APP_SECRET || '',
    version: e.WHATSAPP_GRAPH_VERSION || 'v21.0',
  },
  adminEmail: e.ADMIN_EMAIL || 'admin@floodalert.tg',
  adminPassword: e.ADMIN_PASSWORD || '',
};
