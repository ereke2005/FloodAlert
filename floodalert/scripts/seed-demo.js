'use strict';
// Crée des signalements de DÉMONSTRATION, clairement marqués "demo" (RB-10).
// Les positions sont approximatives et ne correspondent à aucun événement réel.
const sig = require('../lib/signalements');
const store = require('../lib/store');

const H = 3600000;
const ago = (h) => new Date(Date.now() - h * H).toISOString();
const DEMO = [
  { t: 'inondation', d: "Beaucoup d'eau près du marché d'Adidogomé, les motos ne passent plus.", lat: 6.1953, lng: 1.1744, l: "Marché d'Adidogomé", h: 3, s: 'confirme' },
  { t: 'route_bloquee', d: 'La route est coupée devant le carrefour de Totsi, les voitures ne passent pas.', lat: 6.1580, lng: 1.1900, l: 'Carrefour de Totsi', h: 5, s: 'a_verifier' },
  { t: 'debordement', d: 'Le caniveau déborde à Agoè et l\'eau envahit la chaussée.', lat: 6.2330, lng: 1.2230, l: 'Agoè', h: 8, s: 'a_verifier' },
  { t: 'inondation', d: 'Eau jusqu\'au genou dans plusieurs cours à Bè, depuis ce matin.', lat: 6.1370, lng: 1.2400, l: 'Bè', h: 20, s: 'confirme' },
  { t: 'batiment_menace', d: 'Un mur de clôture menace de tomber après la pluie, des enfants passent devant.', lat: 6.1550, lng: 1.2150, l: 'Tokoin', h: 26, s: 'a_verifier' },
  { t: 'inondation', d: 'Grosse inondation devant l\'école, les élèves ne peuvent pas entrer.', lat: 6.1850, lng: 1.2000, l: 'Djidjolé', h: 50, s: 'resolu' },
  { t: 'route_bloquee', d: 'Route impraticable à cause de la boue et de l\'eau, les taxis font demi-tour.', lat: 6.2000, lng: 1.2450, l: 'Kégué', h: 30, s: 'confirme' },
  { t: 'debordement', d: 'La lagune déborde près de la rive, des maisons sont touchées.', lat: 6.1330, lng: 1.2250, l: 'Akodésséwa', h: 12, s: 'a_verifier' },
  { t: 'inondation', d: 'De l\'eau stagne sur la route principale, difficile de passer à moto.', lat: 6.1720, lng: 1.2480, l: 'Hédzranawoé', h: 70, s: 'rejete', motif: 'Informations contradictoires avec les autres déclarations' },
  { t: 'inondation', d: 'Il y a de l\'eau partout dans le quartier, on ne sait pas où aller.', lat: null, lng: null, l: null, h: 2, s: 'a_verifier', src: 'whatsapp' },
];

(async () => {
  const fake = { email: 'demo@floodalert.tg' };
  for (const x of DEMO) {
    const s = await sig.create({
      type_incident: x.t, description: x.d, lat: x.lat, lng: x.lng, lieu_declare: x.l,
      date_observation: ago(x.h), contact: null,
    }, { source: x.src || 'web', demo: true, simule: false });
    if (x.s === 'confirme' || x.s === 'resolu') sig.update(s.id, { statut: 'confirme' }, fake);
    if (x.s === 'resolu') sig.update(s.id, { statut: 'resolu' }, fake);
    if (x.s === 'rejete') sig.update(s.id, { statut: 'rejete', motif: x.motif }, fake);
  }
  console.log(DEMO.length + ' signalements de démonstration créés (marqués « Démo »).');
  store.save();
})();
