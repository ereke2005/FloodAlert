'use strict';
// Dialogue WhatsApp guidé (F01). Le même moteur sert à l'API officielle (Meta Cloud API)
// et au simulateur de conversation, clairement identifié comme tel (RB-10).
const cfg = require('./config');
const store = require('./store');
const ai = require('./ai');
const sig = require('./signalements');
const { norm, clip } = require('./util');

const SESSION_TTL = 30 * 60 * 1000;
const configured = () => !!(cfg.wa.token && cfg.wa.phoneId);

const T = {
  aide: () =>
    'FloodAlert Togo\n\nPour signaler une inondation, écrivez-moi simplement ce que vous voyez (exemple : « Beaucoup d\'eau près du marché, les motos ne passent plus »), puis partagez votre position si possible (📎 > Position) et une photo.\n\nPour suivre un signalement : STATUT FA-0001\n\n' + cfg.urgence,
  horsSujet: () =>
    'FloodAlert Togo recueille des signalements d\'inondation. Pour en faire un, décrivez la situation (lieu, ce que vous observez) et, si possible, envoyez votre position et une photo.\n\n' + cfg.urgence,
  demanderLieu: () =>
    'Merci. Où cela se passe-t-il ? Partagez votre position (📎 > Position) ou indiquez le quartier et un repère connu.',
  demanderTexte: () =>
    'Merci. Décrivez en une phrase ce que vous observez (eau sur la route, maison touchée, etc.).',
  accuse: (ref, sansLieu) =>
    `FloodAlert Togo\n\nVotre signalement a bien été reçu sous la référence ${ref}. Il est en attente de vérification. Merci de contribuer à la remontée d'informations sur les inondations.` +
    (sansLieu ? '\n\nLa localisation reste à préciser : le signalement ne pourra pas apparaître sur la carte tant qu\'elle manque.' : '') +
    `\n\nCe message confirme la réception, pas la vérification de l'incident. FloodAlert n'est pas un service de secours. ${cfg.urgence}`,
  statut: (s) => {
    const lib = { a_verifier: 'en attente de vérification', confirme: 'confirmé par un vérificateur', resolu: 'résolu', rejete: 'non retenu' }[s.statut];
    return `Signalement ${s.reference} : ${lib}.`;
  },
  introuvable: () => 'Référence introuvable pour ce numéro. Vérifiez la référence (exemple : FA-0001).',
  erreur: () => 'Désolé, un problème technique est survenu. Votre message a été conservé pour examen. Réessayez dans quelques minutes.',
};

/** Envoi d'un message texte via l'API officielle. Sans configuration, rien n'est envoyé. */
async function sendText(to, body) {
  if (!configured()) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/${cfg.wa.version}/${cfg.wa.phoneId}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.wa.token },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: body.slice(0, 4000) } }),
    });
    if (!r.ok) throw new Error('Envoi WhatsApp HTTP ' + r.status);
    return true;
  } catch (e) { store.logError('whatsapp.sendText', e); return false; }
}

/** Télécharge un média reçu (photo) via l'API officielle. */
async function downloadMedia(mediaId) {
  const h = { authorization: 'Bearer ' + cfg.wa.token };
  const meta = await fetch(`https://graph.facebook.com/${cfg.wa.version}/${encodeURIComponent(mediaId)}`, { headers: h, signal: AbortSignal.timeout(10000) });
  if (!meta.ok) throw new Error('Média HTTP ' + meta.status);
  const { url } = await meta.json();
  const bin = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
  if (!bin.ok) throw new Error('Téléchargement HTTP ' + bin.status);
  return Buffer.from(await bin.arrayBuffer());
}

/**
 * Moteur de conversation. msg = { type:'text'|'location'|'image', text?, lat?, lng?, photo?:Buffer }.
 * Retourne la liste des réponses à envoyer. Ne lève jamais d'exception.
 */
async function handle(phone, msg, opts = {}) {
  try { return await handleInner(phone, msg, opts); }
  catch (e) {
    if (e instanceof sig.ValidationError) return ['Votre message n\'a pas pu être enregistré : ' + Object.values(e.errors).filter((x) => typeof x === 'string').join(' ')];
    store.logError('whatsapp.handle', e);
    return [T.erreur()];
  }
}

async function handleInner(phone, msg, opts) {
  const S = store.db.wa_sessions;
  const now = Date.now();
  let s = S[phone];
  if (s && s.exp < now) { delete S[phone]; s = null; }

  const text = clip(msg.text, 1500);
  const n = norm(text);

  // Commandes
  if (msg.type === 'text') {
    const st = n.match(/^(?:statut|suivi)\s+(fa-?\s?\d{1,6})/);
    if (st) {
      const ref = 'FA-' + st[1].replace(/\D/g, '').padStart(4, '0');
      const found = sig.getByRef(ref);
      // Confidentialité : seul le numéro qui a fait le signalement peut en connaître le statut
      return found && found.telephone_wa === phone ? [T.statut(found)] : [T.introuvable()];
    }
    if (/^(aide|help|menu|bonjour|bonsoir|salut|hello|hi)\b/.test(n) && !s) return [T.aide()];
  }

  // Début ou poursuite d'une conversation
  if (!s) {
    if (msg.type === 'text' && !ai.looksLikeFlood(text)) {
      // Un lieu seul ou un message court sans rapport : on explique la marche à suivre
      return [T.horsSujet()];
    }
    s = S[phone] = { texte: '', lat: null, lng: null, lieu: null, photo: null, demandes: 0, exp: now + SESSION_TTL, debut: now };
  }
  s.exp = now + SESSION_TTL;

  if (msg.type === 'location' && sig.coordsValid(msg.lat, msg.lng)) { s.lat = Number(msg.lat); s.lng = Number(msg.lng); }
  else if (msg.type === 'location') return ['Cette position semble hors du Togo. Pouvez-vous la partager à nouveau ?'];
  else if (msg.type === 'image') { s.photo = sig.savePhotoBuffer(msg.photo); }
  else if (msg.type === 'text') {
    if (s.attenteLieu) {
      // La réponse à « où cela se passe-t-il ? » est le lieu
      s.lieu = clip(text, 160);
      if (!s.texte) s.texte = text;
    } else {
      s.texte = clip((s.texte ? s.texte + ' ' : '') + text, 1500);
    }
  }

  const lieuTexte = s.lieu || ai.extractLieu(s.texte);
  const aLieu = s.lat != null || !!lieuTexte;

  if (!s.texte) { store.save(); return [T.demanderTexte()]; }
  if (!aLieu && s.demandes < 2) {
    s.demandes++; s.attenteLieu = true;
    store.save();
    return [T.demanderLieu()];
  }

  // Enregistrement
  const created = await sig.create(
    {
      type_incident: null,
      description: s.texte,
      lat: s.lat, lng: s.lng,
      lieu_declare: s.lieu || null,
    },
    { source: 'whatsapp', phone, photo: s.photo, demo: !!opts.simule, simule: !!opts.simule }
  );
  delete S[phone];
  store.save();
  return [T.accuse(created.reference, created.latitude == null)];
}

/** Traite le contenu d'un webhook Meta (déjà authentifié). */
async function processWebhook(payload) {
  const seen = store.db.wa_messages;
  for (const entry of payload.entry || []) {
    for (const ch of entry.changes || []) {
      for (const m of (ch.value && ch.value.messages) || []) {
        if (seen.includes(m.id)) continue; // Meta peut renvoyer un même message
        seen.push(m.id);
        if (seen.length > 300) seen.splice(0, seen.length - 300);
        store.save();
        let msg;
        try {
          if (m.type === 'text') msg = { type: 'text', text: m.text && m.text.body };
          else if (m.type === 'location') msg = { type: 'location', lat: m.location.latitude, lng: m.location.longitude };
          else if (m.type === 'image') msg = { type: 'image', photo: await downloadMedia(m.image.id), text: m.image.caption };
          else { await sendText(m.from, T.horsSujet()); continue; }
        } catch (e) {
          store.logError('whatsapp.reception', e);
          await sendText(m.from, T.erreur());
          continue;
        }
        const replies = await handle(m.from, msg);
        for (const r of replies) await sendText(m.from, r);
        // Légende d'image : on la traite comme un texte distinct
        if (msg.type === 'image' && msg.text) for (const r of await handle(m.from, { type: 'text', text: msg.text })) await sendText(m.from, r);
      }
    }
  }
}

module.exports = { handle, processWebhook, sendText, configured };
