'use strict';
// Stockage JSON atomique : suffisant pour un prototype (quelques milliers de signalements).
// Pour la suite, remplacer par PostgreSQL (Supabase / Neon ont des offres gratuites).
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

fs.mkdirSync(path.join(cfg.dataDir, 'uploads'), { recursive: true });
const FILE = path.join(cfg.dataDir, 'db.json');

const empty = () => ({
  version: 1, counter: 0,
  signalements: [], historique: [], analyses: [], admins: [],
  wa_sessions: {}, wa_messages: [], erreurs: [],
});

let db = empty();
if (fs.existsSync(FILE)) {
  try { db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch (e) {
    fs.copyFileSync(FILE, FILE + '.corrompu-' + Date.now());
    console.error('db.json illisible : une copie a été conservée, base vide recréée.');
  }
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

/** Enregistre une erreur technique pour qu'elle puisse être examinée (critère F01). */
function logError(ctx, err) {
  db.erreurs.push({ date: new Date().toISOString(), ctx, message: String((err && err.message) || err).slice(0, 500) });
  if (db.erreurs.length > 500) db.erreurs = db.erreurs.slice(-500);
  try { save(); } catch (_) { /* rien de plus à faire */ }
  console.error(`[erreur] ${ctx}:`, (err && err.message) || err);
}

function nextRef() {
  db.counter++;
  return 'FA-' + String(db.counter).padStart(4, '0');
}

module.exports = { get db() { return db; }, save, logError, nextRef };
