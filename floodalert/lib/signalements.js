'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const cfg = require('./config');
const store = require('./store');
const ai = require('./ai');
const dup = require('./duplicates');
const { clip, norm, haversine, jaccard, redact } = require('./util');

const TYPES = ['inondation', 'route_bloquee', 'debordement', 'batiment_menace', 'autre'];
const STATUTS = ['a_verifier', 'confirme', 'resolu', 'rejete'];
const SOURCES = ['web', 'whatsapp'];
const PRIORITES = ['haute', 'normale'];

class ValidationError extends Error {
  constructor(errors, status = 400) { super('Données invalides'); this.errors = errors; this.status = status; }
}

/* ───────────── Validation ───────────── */

function coordsValid(lat, lng) {
  lat = Number(lat); lng = Number(lng);
  const b = cfg.togoBbox;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

const MAGIC = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

/** Enregistre une photo après contrôle de la taille et de la signature réelle du fichier. */
function savePhotoBuffer(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new ValidationError({ photo: 'Photo vide.' });
  if (buf.length > cfg.maxPhotoBytes) throw new ValidationError({ photo: 'Photo trop lourde (3 Mo maximum).' });
  const kind = MAGIC.find((m) => m.test(buf));
  if (!kind) throw new ValidationError({ photo: 'Format non accepté. Utilisez JPEG, PNG ou WebP.' });
  const file = randomUUID() + '.' + kind.ext;
  fs.writeFileSync(path.join(cfg.dataDir, 'uploads', file), buf, { mode: 0o600 });
  return { file, type: kind.type, taille: buf.length };
}

function savePhotoDataUrl(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ValidationError({ photo: 'Format de photo non accepté.' });
  return savePhotoBuffer(Buffer.from(m[1], 'base64'));
}

/* ───────────── Création ───────────── */

function validate(input, ctx) {
  const errors = {};
  const out = {};
  const wa = ctx.source === 'whatsapp';

  if (input.type_incident == null || input.type_incident === '') {
    if (wa) out.type_incident = null; // proposé ensuite par l'IA
    else errors.type_incident = 'Choisissez un type d\'incident.';
  } else if (!TYPES.includes(input.type_incident)) errors.type_incident = 'Type d\'incident inconnu.';
  else out.type_incident = input.type_incident;

  out.description = clip(input.description, 1500);
  if (out.description.length < 5) errors.description = 'Décrivez la situation en quelques mots (5 caractères minimum).';

  const hasCoords = input.lat != null && input.lat !== '' && input.lng != null && input.lng !== '';
  out.lat = null; out.lng = null;
  if (hasCoords) {
    if (!coordsValid(input.lat, input.lng)) errors.localisation = 'La position indiquée est en dehors du Togo.';
    else { out.lat = Number(input.lat); out.lng = Number(input.lng); }
  }
  out.lieu = clip(input.lieu_declare, 160) || null;
  if (!errors.localisation && out.lat == null && (!out.lieu || out.lieu.length < 3) && !wa) {
    errors.localisation = 'Indiquez votre position ou un lieu précis (quartier, repère connu).';
  }

  const now = Date.now();
  if (input.date_observation) {
    const d = new Date(input.date_observation);
    if (isNaN(d)) errors.date_observation = 'Date et heure invalides.';
    else if (d.getTime() > now + 5 * 60000) errors.date_observation = 'La date ne peut pas être dans le futur.';
    else if (d.getTime() < now - 30 * 86400000) errors.date_observation = 'La date est trop ancienne (30 jours maximum).';
    else out.date_observation = d.toISOString();
  } else if (wa) out.date_observation = new Date(now).toISOString();
  else errors.date_observation = 'Indiquez quand vous avez constaté la situation.';

  out.contact = clip(input.contact, 120) || null;
  if (out.contact && !wa && input.consentement !== true) errors.consentement = 'Cochez la case pour autoriser un éventuel recontact.';

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

function proposePriority(type, text, analyse) {
  const n = norm(text);
  if (type === 'batiment_menace' || /(blesse|noye|piege|enfant|bebe|vieillard|handicap|effondr|electrocut|secours|urgence)/.test(n)) return 'haute';
  if (analyse && analyse.est_inondation === false) return null;
  return 'normale';
}

/** Cherche des déclarations proches avec l'algorithme avancé (jamais de suppression, simple signalement : F07, RB-05). */
function findDuplicates(s) {
  return dup.findAdvancedDuplicates(s, store.db.signalements);
}

/** Vérifie les doublons potentiels avant création (pour prévenir l'utilisateur) */
function checkDuplicatesBeforeCreate(input) {
  const tempSignalement = {
    id: 'temp-' + Date.now(),
    type_incident: input.type_incident || 'autre',
    description_originale: input.description || '',
    latitude: input.lat ? Number(input.lat) : null,
    longitude: input.lng ? Number(input.lng) : null,
    lieu_declare: input.lieu_declare || null,
    date_observation: input.date_observation || new Date().toISOString(),
  };
  return findDuplicates(tempSignalement);
}

/**
 * Enregistre un signalement. Le signalement est TOUJOURS conservé, même si l'IA échoue (RB-04).
 * ctx : { source:'web'|'whatsapp', phone?, demo?, simule?, photo?:{file,type,taille} }
 */
async function create(input, ctx) {
  const v = validate(input, ctx);
  let photo = ctx.photo || null;
  if (!photo && input.photo) photo = savePhotoDataUrl(input.photo);

  const nowIso = new Date().toISOString();
  const s = {
    id: randomUUID(),
    reference: store.nextRef(),
    source: ctx.source,
    type_incident: v.type_incident || 'autre',
    description_originale: v.description,
    resume_ia: null,
    latitude: v.lat,
    longitude: v.lng,
    localisation_precision: v.lat != null ? 'gps' : 'aucune',
    lieu_declare: v.lieu,
    photo_file: photo ? photo.file : null,
    date_observation: v.date_observation,
    date_reception: nowIso,
    statut: 'a_verifier',
    priorite: null,
    confiance_extraction: null,
    contact: v.contact,
    telephone_wa: ctx.phone || null,
    note_interne: '',
    motif_rejet: null,
    doublons: [],
    demo: !!ctx.demo,
    simule: !!ctx.simule,
    cree_le: nowIso,
    mis_a_jour_le: nowIso,
  };
  store.db.signalements.push(s);
  store.db.historique.push({ id: randomUUID(), signalement_id: s.id, type: 'creation', ancien: null, nouveau: 'a_verifier', auteur: 'système (' + ctx.source + ')', motif: null, date: nowIso });
  if (photo) store.db.analyses.push({ id: randomUUID(), signalement_id: s.id, kind: 'piece_jointe', fichier: photo.file, type: photo.type, taille: photo.taille, date: nowIso });
  store.save(); // on sécurise d'abord le signalement

  await runAnalysis(s, !v.type_incident);
  s.doublons = findDuplicates(s);
  store.save();
  return s;
}

/** Lance (ou relance) l'analyse IA et applique les propositions sans écraser les champs saisis par l'humain. */
async function runAnalysis(s, adoptType) {
  let a;
  try { a = await ai.analyser(s.description_originale); }
  catch (e) { store.logError('analyse ' + s.reference, e); a = null; }
  const date = new Date().toISOString();
  if (!a) {
    store.db.analyses.push({ id: randomUUID(), signalement_id: s.id, kind: 'ia', traitement: 'echec', source: 'aucune', date });
    store.save();
    return null;
  }
  store.db.analyses = store.db.analyses.filter((x) => !(x.signalement_id === s.id && x.kind === 'ia' && x.remplace));
  for (const x of store.db.analyses) if (x.signalement_id === s.id && x.kind === 'ia') x.remplace = true;
  store.db.analyses.push({ id: randomUUID(), signalement_id: s.id, kind: 'ia', date, ...a });

  s.resume_ia = a.resume || s.resume_ia;
  s.confiance_extraction = a.confiance;
  if (adoptType && a.type_incident) s.type_incident = a.type_incident;
  if (!s.lieu_declare && a.lieu_mentionne) s.lieu_declare = a.lieu_mentionne;
  s.priorite = proposePriority(s.type_incident, s.description_originale, a);
  s.mis_a_jour_le = date;
  store.save();
  return a;
}

/* ───────────── Lecture ───────────── */

const latestAnalysis = (id) => store.db.analyses.filter((x) => x.signalement_id === id && x.kind === 'ia' && !x.remplace).pop() || null;

/** Vue publique : aucune donnée personnelle, position arrondie (~110 m), signalements rejetés exclus (RB-06, RB-09). */
function publicView(s) {
  const r = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    reference: s.reference,
    type_incident: s.type_incident,
    resume: clip(redact(s.resume_ia || s.description_originale), 220),
    lieu: s.lieu_declare ? redact(s.lieu_declare) : null,
    lat: r(s.latitude),
    lng: r(s.longitude),
    statut: s.statut,
    date_observation: s.date_observation,
    mis_a_jour_le: s.mis_a_jour_le,
    demo: s.demo,
    simule: s.simule,
  };
}

function adminView(s, detail) {
  const base = {
    id: s.id, reference: s.reference, source: s.source, type_incident: s.type_incident, statut: s.statut,
    priorite: s.priorite, resume_ia: s.resume_ia, lieu_declare: s.lieu_declare,
    latitude: s.latitude, longitude: s.longitude, localisation_precision: s.localisation_precision,
    date_observation: s.date_observation, date_reception: s.date_reception, mis_a_jour_le: s.mis_a_jour_le,
    doublons: (s.doublons || []).map((d) => ({ ...d, id: (getByRef(d.reference) || {}).id || null })),
    demo: s.demo, simule: s.simule, a_photo: !!s.photo_file,
    confiance_extraction: s.confiance_extraction,
    description_originale: s.description_originale,
  };
  if (!detail) return base;
  return {
    ...base,
    contact: s.contact, telephone: s.telephone_wa, note_interne: s.note_interne, motif_rejet: s.motif_rejet,
    photo_url: s.photo_file ? '/api/admin/photos/' + s.photo_file : null,
    analyse: latestAnalysis(s.id),
    historique: store.db.historique.filter((h) => h.signalement_id === s.id).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function applyFilters(list, q) {
  const from = q.from ? new Date(q.from).getTime() : null;
  const to = q.to ? new Date(q.to).getTime() + 86400000 : null;
  const needle = norm(q.q || '');
  return list.filter((s) => {
    if (q.statut && q.statut !== 'tous' && s.statut !== q.statut) return false;
    if (q.source && q.source !== 'tous' && s.source !== q.source) return false;
    if (q.type && q.type !== 'tous' && s.type_incident !== q.type) return false;
    if (q.demo === '1' && !s.demo) return false;
    if (q.demo === '0' && s.demo) return false;
    if (q.localise === '1' && s.latitude == null) return false;
    if (q.localise === '0' && s.latitude != null) return false;
    const t = new Date(s.date_reception).getTime();
    if (from && t < from) return false;
    if (to && t > to) return false;
    if (needle && !norm([s.reference, s.lieu_declare, s.description_originale, s.resume_ia].join(' ')).includes(needle)) return false;
    return true;
  });
}

/** Les statistiques sont toujours calculées sur les données enregistrées et filtrées (F05). */
function stats(list) {
  const count = (key, vals) => Object.fromEntries(vals.map((v) => [v, list.filter((s) => s[key] === v).length]));
  const jours = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    jours.push({ jour: d, n: list.filter((s) => s.date_reception.slice(0, 10) === d).length });
  }
  return {
    total: list.length,
    par_statut: count('statut', STATUTS),
    par_type: count('type_incident', TYPES),
    par_source: count('source', SOURCES),
    par_jour: jours,
    sans_localisation: list.filter((s) => s.latitude == null).length,
    doublons_potentiels: list.filter((s) => s.doublons && s.doublons.length && s.statut !== 'rejete').length,
    demo: list.filter((s) => s.demo).length,
  };
}

/* ───────────── Mise à jour par un administrateur ───────────── */

function update(id, body, admin) {
  const s = store.db.signalements.find((x) => x.id === id);
  if (!s) throw new ValidationError({ _: 'Signalement introuvable.' }, 404);
  const errors = {};
  const changes = {};
  const date = new Date().toISOString();
  const set = (field, value) => { if (JSON.stringify(s[field]) !== JSON.stringify(value)) { changes[field] = [s[field], value]; s[field] = value; } };

  if ('type_incident' in body) {
    if (!TYPES.includes(body.type_incident)) errors.type_incident = 'Type inconnu.';
    else set('type_incident', body.type_incident);
  }
  if ('lieu_declare' in body) set('lieu_declare', clip(body.lieu_declare, 160) || null);
  if ('resume_ia' in body) set('resume_ia', clip(body.resume_ia, 300) || null);
  if ('priorite' in body) {
    if (body.priorite && !PRIORITES.includes(body.priorite)) errors.priorite = 'Priorité inconnue.';
    else set('priorite', body.priorite || null);
  }
  if ('note_interne' in body) set('note_interne', clip(body.note_interne, 2000));
  if ('latitude' in body || 'longitude' in body) {
    const lat = body.latitude, lng = body.longitude;
    if ((lat === null || lat === '') && (lng === null || lng === '')) { set('latitude', null); set('longitude', null); set('localisation_precision', 'aucune'); }
    else if (!coordsValid(lat, lng)) errors.localisation = 'Coordonnées invalides ou hors du Togo.';
    else {
      const changed = Number(lat) !== s.latitude || Number(lng) !== s.longitude;
      set('latitude', Number(lat)); set('longitude', Number(lng));
      if (changed) set('localisation_precision', 'admin');
    }
  }

  let statutChange = null;
  if ('statut' in body && body.statut !== s.statut) {
    const to = body.statut;
    const motif = clip(body.motif, 500);
    if (!STATUTS.includes(to)) errors.statut = 'Statut inconnu.';
    else if (to === 'resolu' && s.statut !== 'confirme') errors.statut = 'Un incident doit être confirmé avant d\'être résolu.';
    else if (to === 'rejete' && motif.length < 3) errors.motif = 'Indiquez le motif du rejet.';
    else if (to === 'confirme' && s.latitude == null && !body.confirmer_sans_position) {
      // Un incident confirmé sans position ne peut pas figurer sur la carte : on prévient l'administrateur
      errors.statut = 'Cet incident n\'a pas de position : placez-le sur la carte avant de le confirmer, ou confirmez sans position.';
      errors.position_manquante = true;
    } else statutChange = { ancien: s.statut, nouveau: to, motif: motif || null };
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);

  if (statutChange) {
    s.statut = statutChange.nouveau;
    s.motif_rejet = statutChange.nouveau === 'rejete' ? statutChange.motif : null;
    store.db.historique.push({ id: randomUUID(), signalement_id: s.id, type: 'statut', ancien: statutChange.ancien, nouveau: statutChange.nouveau, auteur: admin.email, motif: statutChange.motif, date });
  }
  if (Object.keys(changes).length) {
    store.db.historique.push({ id: randomUUID(), signalement_id: s.id, type: 'correction', champs: changes, auteur: admin.email, date });
  }
  if (statutChange || Object.keys(changes).length) { s.mis_a_jour_le = date; store.save(); }
  return s;
}

function getById(id) { return store.db.signalements.find((x) => x.id === id) || null; }
function getByRef(ref) { return store.db.signalements.find((x) => x.reference === String(ref || '').toUpperCase()) || null; }

module.exports = {
  TYPES, STATUTS, SOURCES, ValidationError,
  create, runAnalysis, update, publicView, adminView, applyFilters, stats,
  getById, getByRef, savePhotoBuffer, coordsValid, findDuplicates, checkDuplicatesBeforeCreate,
};
