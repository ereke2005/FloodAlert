'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const store = require('./store');

const SESSION_MS = 8 * 3600 * 1000;
const COOKIE = 'fa_session';

// Secret de signature : variable d'environnement, sinon fichier généré une fois
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  const f = path.join(cfg.dataDir, 'secret.key');
  if (fs.existsSync(f)) SECRET = fs.readFileSync(f, 'utf8');
  else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, SECRET, { mode: 0o600 }); }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
}

function verifyPassword(pw, stored) {
  try {
    const [, s, h] = String(stored).split('$');
    const x = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
  } catch { return false; }
}

const sign = (payload) => {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
};

function unsign(token) {
  if (!token || typeof token !== 'string') return null;
  const [b, m] = token.split('.');
  if (!b || !m) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  const A = Buffer.from(m), B = Buffer.from(expected);
  if (A.length !== B.length || !crypto.timingSafeEqual(A, B)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAdmin(email, password, nom) {
  email = String(email).trim().toLowerCase();
  const db = store.db;
  const existing = db.admins.find((a) => a.email === email);
  const rec = { email, nom: nom || email.split('@')[0], hash: hashPassword(password), actif: true };
  if (existing) Object.assign(existing, rec);
  else db.admins.push({ id: crypto.randomUUID(), role: 'administrateur', cree_le: new Date().toISOString(), ...rec });
  store.save();
}

/** Crée le premier compte au démarrage si aucun n'existe. */
function ensureAdmin() {
  if (store.db.admins.length) return null;
  const pw = cfg.adminPassword || crypto.randomBytes(9).toString('base64url');
  createAdmin(cfg.adminEmail, pw, 'Administrateur');
  return { email: cfg.adminEmail, password: cfg.adminPassword ? null : pw };
}

function login(email, password) {
  const a = store.db.admins.find((x) => x.email === String(email || '').trim().toLowerCase());
  // On exécute toujours un calcul de hachage pour limiter les attaques par chronométrage
  const ok = verifyPassword(String(password || ''), a ? a.hash : 's1$00$00');
  if (!a || !a.actif || !ok) return null;
  return a;
}

function sessionCookie(admin) {
  const token = sign({ id: admin.id, exp: Date.now() + SESSION_MS });
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` + (cfg.cookieSecure ? '; Secure' : '');
}
const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` + (cfg.cookieSecure ? '; Secure' : '');

/** Retourne l'administrateur de la requête, ou null. */
function adminFromReq(req) {
  const p = unsign(parseCookies(req.headers.cookie)[COOKIE]);
  if (!p) return null;
  const a = store.db.admins.find((x) => x.id === p.id && x.actif);
  return a || null;
}

module.exports = { createAdmin, ensureAdmin, login, sessionCookie, clearCookie, adminFromReq };
