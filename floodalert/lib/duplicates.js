'use strict';
/**
 * Module de détection avancée des doublons
 * Améliore la détection avec des algorithmes sophistiqués et des seuils configurables
 */
const { norm, haversine, jaccard } = require('./util');

/* ───────────── Configuration ───────────── */

const CONFIG = {
  // Seuils de similarité
  distanceThreshold: 300,      // mètres
  timeThreshold: 24 * 3600000, // 24 heures en ms
  shortTimeThreshold: 6 * 3600000, // 6 heures pour score bonus
  descriptionSimilarity: 0.4, // Jaccard
  cosineSimilarity: 0.6,       // Similarité cosinus (avancé)
  
  // Pondérations des critères (type d'incident = critère bloquant, pas de poids)
  // Les poids sont normalisés pour totaliser 1.0
  weights: {
    distance: 0.35,
    locationText: 0.25,
    timeProximity: 0.05,
    descriptionJaccard: 0.15,
    descriptionCosine: 0.20,
  },
  
  // Seuil global pour considérer comme doublon (ajusté car type est bloquant)
  globalThreshold: 0.45,
  
  // Nombre maximum de doublons à retourner
  maxDuplicates: 5,
};

/* ───────────── Algorithmes de similarité ───────────── */

/**
 * Calcule la similarité cosinus entre deux textes
 * Utilise la fréquence des termes (TF)
 */
function cosineSimilarity(text1, text2) {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  // Créer le vocabulaire combiné
  const vocab = new Set([...tokens1, ...tokens2]);
  
  // Calculer les vecteurs TF
  const vec1 = tfVector(tokens1, vocab);
  const vec2 = tfVector(tokens2, vocab);
  
  // Produit scalaire
  let dotProduct = 0;
  for (const term of vocab) {
    dotProduct += vec1[term] * vec2[term];
  }
  
  // Normes
  const norm1 = Math.sqrt(Object.values(vec1).reduce((sum, v) => sum + v * v, 0));
  const norm2 = Math.sqrt(Object.values(vec2).reduce((sum, v) => sum + v * v, 0));
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (norm1 * norm2);
}

/**
 * Tokenise un texte en mots normalisés
 */
function tokenize(text) {
  const n = norm(text);
  return n.split(/\s+/).filter(w => w.length > 2); // Ignorer les mots très courts
}

/**
 * Calcule le vecteur TF (Term Frequency) pour un texte
 */
function tfVector(tokens, vocab) {
  const vec = {};
  const freq = {};
  
  // Compter les fréquences
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  
  // Normaliser par la longueur
  const len = tokens.length;
  for (const term of vocab) {
    vec[term] = (freq[term] || 0) / len;
  }
  
  return vec;
}

/**
 * Similarité de Levenshtein (distance d'édition normalisée)
 */
function levenshteinSimilarity(text1, text2) {
  const s1 = norm(text1);
  const s2 = norm(text2);
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const m = s1.length;
  const n = s2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],    // suppression
          dp[i][j - 1],    // insertion
          dp[i - 1][j - 1] // substitution
        );
      }
    }
  }
  
  const maxLen = Math.max(m, n);
  return 1 - (dp[m][n] / maxLen);
}

/* ───────────── Clustering spatio-temporel ───────────── */

/**
 * Groupe les signalements par clusters spatio-temporels
 * Utile pour identifier des événements massifs (ex: tempête)
 */
function clusterIncidents(signalements, options = {}) {
  const distanceThreshold = options.distanceThreshold || CONFIG.distanceThreshold;
  const timeThreshold = options.timeThreshold || CONFIG.timeThreshold;
  
  const clusters = [];
  const visited = new Set();
  
  for (const s of signalements) {
    if (visited.has(s.id)) continue;
    
    const cluster = [s];
    visited.add(s.id);
    
    // Recherche récursive de voisins
    const queue = [s];
    
    while (queue.length > 0) {
      const current = queue.shift();
      
      for (const other of signalements) {
        if (visited.has(other.id)) continue;
        if (other.statut === 'rejete') continue;
        
        const dt = Math.abs(new Date(other.date_observation) - new Date(current.date_observation));
        if (dt > timeThreshold) continue;
        
        if (current.latitude != null && other.latitude != null) {
          const d = haversine(current.latitude, current.longitude, other.latitude, other.longitude);
          if (d <= distanceThreshold) {
            visited.add(other.id);
            cluster.push(other);
            queue.push(other);
          }
        }
      }
    }
    
    if (cluster.length > 1) {
      clusters.push({
        incidents: cluster,
        count: cluster.length,
        timeRange: {
          start: Math.min(...cluster.map(s => new Date(s.date_observation).getTime())),
          end: Math.max(...cluster.map(s => new Date(s.date_observation).getTime())),
        },
        center: calculateCentroid(cluster),
      });
    }
  }
  
  return clusters.sort((a, b) => b.count - a.count);
}

/**
 * Calcule le centroïde d'un cluster de points
 */
function calculateCentroid(signalements) {
  const withCoords = signalements.filter(s => s.latitude != null);
  if (withCoords.length === 0) return null;
  
  const sumLat = withCoords.reduce((sum, s) => sum + s.latitude, 0);
  const sumLng = withCoords.reduce((sum, s) => sum + s.longitude, 0);
  
  return {
    latitude: sumLat / withCoords.length,
    longitude: sumLng / withCoords.length,
  };
}

/* ───────────── Détection avancée des doublons ───────────── */

/**
 * Version améliorée de findDuplicates avec algorithmes multiples
 * IMPORTANT : Le type d'incident différent = PAS de doublon (critère bloquant)
 */
function findAdvancedDuplicates(s, allSignalements, options = {}) {
  const config = { ...CONFIG, ...options };
  const out = [];
  
  for (const o of allSignalements) {
    if (o.id === s.id || o.statut === 'rejete') continue;
    
    // CRITÈRE BLOQUANT : Si le type d'incident est différent, ce n'est pas un doublon
    if (o.type_incident && s.type_incident && o.type_incident !== s.type_incident) {
      continue; // Types différents = pas de doublon
    }
    
    const dt = Math.abs(new Date(o.date_observation) - new Date(s.date_observation));
    if (dt > config.timeThreshold) continue;
    
    let score = 0;
    const raisons = [];
    
    // Critère 1: Distance géographique
    if (o.latitude != null && s.latitude != null) {
      const d = haversine(o.latitude, o.longitude, s.latitude, s.longitude);
      if (d <= config.distanceThreshold) {
        const distanceScore = 1 - (d / config.distanceThreshold); // Plus c'est proche, plus c'est élevé
        score += distanceScore * config.weights.distance;
        raisons.push('à ' + Math.round(d) + ' m');
      }
    }
    
    // Critère 2: Lieu déclaré (textuel)
    if (o.lieu_declare && s.lieu_declare) {
      const locSim = levenshteinSimilarity(o.lieu_declare, s.lieu_declare);
      if (locSim >= 0.7) {
        score += locSim * config.weights.locationText;
        raisons.push('lieu déclaré similaire');
      } else if (norm(o.lieu_declare) === norm(s.lieu_declare)) {
        score += config.weights.locationText;
        raisons.push('même lieu déclaré');
      }
    }
    
    // Critère 3: Type d'incident (maintenant implicite car bloquant)
    // Le type est déjà vérifié au début comme critère bloquant
    
    // Critère 4: Proximité temporelle
    if (dt <= config.shortTimeThreshold) {
      score += config.weights.timeProximity;
      raisons.push('même plage horaire');
    }
    
    // Critère 5: Similarité Jaccard des descriptions
    const j = jaccard(o.description_originale, s.description_originale);
    if (j >= config.descriptionSimilarity) {
      score += j * config.weights.descriptionJaccard;
      raisons.push('description proche (Jaccard)');
    }
    
    // Critère 6: Similarité cosinus (avancé)
    const cosSim = cosineSimilarity(o.description_originale, s.description_originale);
    if (cosSim >= config.cosineSimilarity) {
      score += cosSim * config.weights.descriptionCosine;
      raisons.push('description similaire (cosinus)');
    }
    
    if (score >= config.globalThreshold) {
      out.push({
        reference: o.reference,
        score: Math.round(score * 100) / 100,
        raisons,
        details: {
          distance: o.latitude != null && s.latitude != null ? Math.round(haversine(o.latitude, o.longitude, s.latitude, s.longitude)) : null,
          timeDiff: Math.round(dt / 60000), // en minutes
          jaccard: Math.round(j * 100) / 100,
          cosine: Math.round(cosSim * 100) / 100,
        },
      });
    }
  }
  
  return out.sort((a, b) => b.score - a.score).slice(0, config.maxDuplicates);
}

/**
 * Détecte les doublons potentiels en masse pour tous les signalements
 * Retourne une liste de groupes de doublons suggérés
 */
function detectAllDuplicates(allSignalements, options = {}) {
  const groups = [];
  const processed = new Set();
  
  for (const s of allSignalements) {
    if (processed.has(s.id) || s.statut === 'rejete') continue;
    
    const duplicates = findAdvancedDuplicates(s, allSignalements, options);
    
    if (duplicates.length > 0) {
      const group = {
        primary: s.reference,
        duplicates: duplicates.map(d => d.reference),
        scores: duplicates,
        count: duplicates.length + 1,
      };
      groups.push(group);
      
      processed.add(s.id);
      duplicates.forEach(d => {
        const other = allSignalements.find(x => x.reference === d.reference);
        if (other) processed.add(other.id);
      });
    }
  }
  
  return groups.sort((a, b) => b.count - a.count);
}

/**
 * Suggère une action pour un groupe de doublons
 * Basé sur la confiance et la qualité des données
 */
function suggestAction(primary, duplicates, allSignalements) {
  const primarySig = allSignalements.find(s => s.reference === primary);
  if (!primarySig) return { action: 'manual', reason: 'Signalement principal introuvable' };
  
  // Préférer le signalement avec photo
  const withPhoto = [primary, ...duplicates].find(ref => {
    const s = allSignalements.find(x => x.reference === ref);
    return s && s.photo_file;
  });
  
  if (withPhoto && withPhoto !== primary) {
    return { action: 'merge', target: withPhoto, reason: 'Préférer le signalement avec photo' };
  }
  
  // Préférer le signalement avec localisation GPS
  const withGPS = [primary, ...duplicates].find(ref => {
    const s = allSignalements.find(x => x.reference === ref);
    return s && s.latitude != null;
  });
  
  if (withGPS && withGPS !== primary) {
    return { action: 'merge', target: withGPS, reason: 'Préférer le signalement avec localisation GPS' };
  }
  
  // Préférer le signalement avec la plus haute confiance IA
  const bestConfidence = [primary, ...duplicates].reduce((best, ref) => {
    const s = allSignalements.find(x => x.reference === ref);
    if (!s) return best;
    const conf = s.confiance_extraction || 0;
    return conf > (best.conf || 0) ? { ref, conf } : best;
  }, { ref: primary, conf: 0 });
  
  if (bestConfidence.ref !== primary) {
    return { action: 'merge', target: bestConfidence.ref, reason: 'Préférer le signalement avec la meilleure confiance IA' };
  }
  
  return { action: 'manual', reason: 'Révision manuelle recommandée' };
}

/* ───────────── Statistiques et rapports ───────────── */

/**
 * Génère des statistiques sur les doublons
 */
function duplicateStats(allSignalements) {
  const withDuplicates = allSignalements.filter(s => s.doublons && s.doublons.length > 0);
  const groups = detectAllDuplicates(allSignalements);
  const clusters = clusterIncidents(allSignalements);
  
  return {
    totalSignalements: allSignalements.length,
    withPotentialDuplicates: withDuplicates.length,
    duplicateGroups: groups.length,
    largestGroupSize: groups.length > 0 ? groups[0].count : 0,
    spatioTemporalClusters: clusters.length,
    largestClusterSize: clusters.length > 0 ? clusters[0].count : 0,
    duplicateRate: allSignalements.length > 0 ? (withDuplicates.length / allSignalements.length * 100).toFixed(1) : 0,
  };
}

module.exports = {
  findAdvancedDuplicates,
  detectAllDuplicates,
  clusterIncidents,
  suggestAction,
  duplicateStats,
  CONFIG,
};
