'use strict';

/** Minuscules sans accents, pour comparer des textes. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Nettoie un texte : retire les caractères de contrôle, coupe à n caractères. */
const clip = (s, n) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);

/** Distance en mètres entre deux points GPS. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Similarité de Jaccard entre deux textes (0 à 1). */
function jaccard(a, b) {
  const tok = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Masque numéros de téléphone et e-mails (minimisation avant envoi à l'IA ou publication). */
function redact(s) {
  return String(s || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail masqué]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[numéro masqué]');
}

// Limiteur de débit en mémoire
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (n > b.reset) buckets.delete(k); }, 60000).unref();

module.exports = { norm, clip, haversine, jaccard, redact, rateLimit };
