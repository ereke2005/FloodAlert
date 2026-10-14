'use strict';
/**
 * Module de prévision des risques d'inondation
 * Analyse les données historiques pour identifier les patterns et prédire les risques
 */
const store = require('./store');

/* ───────────── Configuration ───────────── */

const CONFIG = {
  // Périodes d'analyse
  analysisDays: 30,          // Jours d'historique à analyser
  forecastDays: 7,           // Jours de prévision
  
  // Seuils de risque
  riskThresholds: {
    low: 0.3,
    medium: 0.5,
    high: 0.7,
    critical: 0.85,
  },
  
  // Facteurs de pondération
  weights: {
    frequency: 0.4,          // Fréquence des incidents
    severity: 0.3,           // Gravité des incidents
    recency: 0.2,            // Récence des incidents
    clustering: 0.1,         // Concentration spatiale
  },
};

/* ───────────── Analyse des données historiques ───────────── */

/**
 * Analyse les tendances des incidents sur une période
 */
function analyzeTrends(signalements, days = CONFIG.analysisDays) {
  const cutoff = Date.now() - days * 86400000;
  const recent = signalements.filter(s => 
    new Date(s.date_reception).getTime() >= cutoff && s.statut !== 'rejete'
  );
  
  // Tendances par jour
  const dailyCounts = {};
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dailyCounts[date] = 0;
  }
  
  for (const s of recent) {
    const date = s.date_reception.slice(0, 10);
    if (dailyCounts.hasOwnProperty(date)) {
      dailyCounts[date]++;
    }
  }
  
  // Calculer la tendance (croissance/décroissance)
  const daysArray = Object.keys(dailyCounts).sort();
  const counts = daysArray.map(d => dailyCounts[d]);
  const recentAvg = counts.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
  const olderAvg = counts.slice(7, 14).reduce((a, b) => a + b, 0) / 7;
  const trend = recentAvg - olderAvg;
  
  return {
    dailyCounts,
    totalRecent: recent.length,
    averageDaily: recent.length / days,
    trend: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
    trendValue: trend,
    growthRate: olderAvg > 0 ? (trend / olderAvg * 100).toFixed(1) : 0,
  };
}

/**
 * Analyse la distribution spatiale des incidents
 */
function analyzeSpatialDistribution(signalements) {
  const withCoords = signalements.filter(s => s.latitude != null && s.statut !== 'rejete');
  
  if (withCoords.length === 0) {
    return { hotspots: [], coverage: 0 };
  }
  
  // Grille simple pour identifier les zones à risque
  const gridSize = 0.01; // ~1km
  const grid = {};
  
  for (const s of withCoords) {
    const latKey = Math.floor(s.latitude / gridSize) * gridSize;
    const lngKey = Math.floor(s.longitude / gridSize) * gridSize;
    const key = `${latKey},${lngKey}`;
    
    if (!grid[key]) {
      grid[key] = { count: 0, incidents: [], center: { lat: latKey, lng: lngKey } };
    }
    grid[key].count++;
    grid[key].incidents.push(s);
  }
  
  // Identifier les hotspots (zones avec > 2 incidents)
  const hotspots = Object.values(grid)
    .filter(cell => cell.count >= 2)
    .map(cell => ({
      center: cell.center,
      count: cell.count,
      riskLevel: cell.count >= 5 ? 'critical' : cell.count >= 3 ? 'high' : 'medium',
      references: cell.incidents.map(s => s.reference),
    }))
    .sort((a, b) => b.count - a.count);
  
  // Estimer la couverture géographique
  const lats = withCoords.map(s => s.latitude);
  const lngs = withCoords.map(s => s.longitude);
  const coverage = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
  
  return { hotspots, coverage, totalWithCoords: withCoords.length };
}

/**
 * Analyse la gravité des incidents
 */
function analyzeSeverity(signalements) {
  const valid = signalements.filter(s => s.statut !== 'rejete');
  
  const byPriority = {
    haute: valid.filter(s => s.priorite === 'haute').length,
    normale: valid.filter(s => s.priorite === 'normale').length,
    null: valid.filter(s => s.priorite == null).length,
  };
  
  const byType = {};
  for (const s of valid) {
    byType[s.type_incident] = (byType[s.type_incident] || 0) + 1;
  }
  
  // Score de gravité global
  const severityScore = valid.length > 0 
    ? (byPriority.haute * 2 + byPriority.normale) / valid.length 
    : 0;
  
  return {
    byPriority,
    byType,
    severityScore: Math.min(1, severityScore),
    highPriorityRate: valid.length > 0 ? (byPriority.haute / valid.length * 100).toFixed(1) : 0,
  };
}

/**
 * Analyse les patterns temporels (heures, jours de la semaine)
 */
function analyzeTemporalPatterns(signalements) {
  const valid = signalements.filter(s => s.statut !== 'rejete');
  
  const byHour = Array(24).fill(0);
  const byDayOfWeek = Array(7).fill(0);
  
  for (const s of valid) {
    const date = new Date(s.date_reception);
    byHour[date.getHours()]++;
    byDayOfWeek[date.getDay()]++;
  }
  
  // Identifier les pics d'activité
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakDay = byDayOfWeek.indexOf(Math.max(...byDayOfWeek));
  
  return {
    byHour,
    byDayOfWeek,
    peakHour,
    peakDay,
    peakHourCount: byHour[peakHour],
    peakDayCount: byDayOfWeek[peakDay],
  };
}

/* ───────────── Calcul du risque ───────────── */

/**
 * Calcule un score de risque global (0-1)
 */
function calculateRiskScore(signalements) {
  const trends = analyzeTrends(signalements);
  const spatial = analyzeSpatialDistribution(signalements);
  const severity = analyzeSeverity(signalements);
  
  // Score de fréquence (basé sur la tendance)
  const freqScore = Math.min(1, (trends.averageDaily / 5)); // Normalisé: 5 incidents/jour = max
  
  // Score de gravité
  const severityScore = severity.severityScore;
  
  // Score de récence (poids plus élevé pour les incidents récents)
  const recent = signalements.filter(s => 
    new Date(s.date_reception).getTime() >= Date.now() - 3 * 86400000 && s.statut !== 'rejete'
  );
  const recencyScore = Math.min(1, recent.length / 10);
  
  // Score de clustering (concentration spatiale)
  const clusteringScore = spatial.hotspots.length > 0 
    ? Math.min(1, spatial.hotspots[0].count / 5) 
    : 0;
  
  // Score composite pondéré
  const compositeScore = 
    freqScore * CONFIG.weights.frequency +
    severityScore * CONFIG.weights.severity +
    recencyScore * CONFIG.weights.recency +
    clusteringScore * CONFIG.weights.clustering;
  
  return {
    score: Math.min(1, compositeScore),
    level: getRiskLevel(Math.min(1, compositeScore)),
    components: {
      frequency: freqScore,
      severity: severityScore,
      recency: recencyScore,
      clustering: clusteringScore,
    },
  };
}

/**
 * Détermine le niveau de risque à partir du score
 */
function getRiskLevel(score) {
  if (score >= CONFIG.riskThresholds.critical) return 'critique';
  if (score >= CONFIG.riskThresholds.high) return 'élevé';
  if (score >= CONFIG.riskThresholds.medium) return 'moyen';
  if (score >= CONFIG.riskThresholds.low) return 'faible';
  return 'négligeable';
}

/* ───────────── Prévision ───────────── */

/**
 * Génère une prévision de risque pour les prochains jours
 */
function generateForecast(signalements, days = CONFIG.forecastDays) {
  const currentRisk = calculateRiskScore(signalements);
  const trends = analyzeTrends(signalements);
  
  const forecast = [];
  let projectedScore = currentRisk.score;
  
  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() + i * 86400000);
    const dateStr = date.toISOString().slice(0, 10);
    
    // Ajustement basé sur la tendance
    const trendAdjustment = trends.trend === 'increasing' ? 0.05 : 
                           trends.trend === 'decreasing' ? -0.03 : 0;
    
    // Ajustement basé sur les patterns temporels (simplifié)
    const dayOfWeek = date.getDay();
    const temporal = analyzeTemporalPatterns(signalements);
    const dayFactor = temporal.byDayOfWeek[dayOfWeek] / (signalements.length / 7 || 1);
    
    projectedScore = Math.max(0, Math.min(1, projectedScore + trendAdjustment + (dayFactor - 1) * 0.1));
    
    forecast.push({
      date: dateStr,
      score: Math.round(projectedScore * 100) / 100,
      level: getRiskLevel(projectedScore),
      confidence: Math.max(0.3, 1 - (i * 0.1)), // La confiance diminue avec le temps
    });
  }
  
  return {
    currentRisk,
    forecast,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Génère des recommandations basées sur le risque actuel
 */
function generateRecommendations(riskAnalysis) {
  const recommendations = [];
  const { score, level } = riskAnalysis;
  
  if (level === 'critique' || level === 'élevé') {
    recommendations.push({
      priority: 'urgent',
      action: 'Renforcer la surveillance dans les zones identifiées comme hotspots',
      type: 'monitoring',
    });
    recommendations.push({
      priority: 'urgent',
      action: 'Préparer les équipes d intervention pour déploiement rapide',
      type: 'response',
    });
    recommendations.push({
      priority: 'high',
      action: 'Informer les populations des zones à risque',
      type: 'communication',
    });
  }
  
  if (level === 'moyen' || level === 'élevé' || level === 'critique') {
    recommendations.push({
      priority: 'medium',
      action: 'Vérifier les systèmes de drainage dans les zones sensibles',
      type: 'prevention',
    });
  }
  
  if (score > 0.3) {
    recommendations.push({
      priority: 'low',
      action: 'Continuer à collecter les signalements citoyens',
      type: 'data_collection',
    });
  }
  
  return recommendations;
}

/* ───────────── Rapport complet ───────────── */

/**
 * Génère un rapport complet d'analyse de risque
 */
function generateRiskReport(signalements) {
  const trends = analyzeTrends(signalements);
  const spatial = analyzeSpatialDistribution(signalements);
  const severity = analyzeSeverity(signalements);
  const temporal = analyzeTemporalPatterns(signalements);
  const riskScore = calculateRiskScore(signalements);
  const forecast = generateForecast(signalements);
  const recommendations = generateRecommendations(riskScore);
  
  return {
    summary: {
      totalSignalements: signalements.length,
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      trend: trends.trend,
      growthRate: trends.growthRate,
    },
    trends,
    spatial,
    severity,
    temporal,
    riskScore,
    forecast,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeTrends,
  analyzeSpatialDistribution,
  analyzeSeverity,
  analyzeTemporalPatterns,
  calculateRiskScore,
  generateForecast,
  generateRecommendations,
  generateRiskReport,
  CONFIG,
};
