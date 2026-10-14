# FloodAlert Togo

Plateforme de signalement et de suivi des inondations : WhatsApp et formulaire web, carte interactive, analyse par IA, validation humaine.

Prototype fonctionnel du cahier des charges « FloodAlert Togo v1.0 ». Aucune dépendance à installer, aucun abonnement, aucun paiement.

## Nouveautés v1.1

- **Détection avancée des doublons** : Algorithmes sophistiqués (similarité cosinus, Levenshtein, clustering spatio-temporel) pour identifier les signalements en double avec précision
- **Prévision des risques** : Analyse des données historiques pour prédire les risques d'inondation sur 7 jours et générer des recommandations
- **Interface d'analyse avancée** : Nouveau panneau dans l'espace administrateur pour visualiser les doublons et les prévisions de risque

## Démarrage en 2 minutes

Il faut seulement [Node.js](https://nodejs.org) version 20 ou plus récente.

```bash
cd floodalert
cp .env.example .env        # puis modifiez .env si besoin
node server.js              # ou : npm start
```

Ouvrez ensuite http://localhost:3000.

- Au premier lancement, un compte administrateur est créé. Si `ADMIN_PASSWORD` est vide dans `.env`, **le mot de passe généré s'affiche dans la console, une seule fois**. Notez-le.
- Pour remplir la carte avec des données de démonstration (marquées « Démo ») : `npm run seed`
- Pour lancer les tests : `npm test`

## Les pages

| Page | Rôle |
| --- | --- |
| `/index.html` | Carte publique, filtres, liste, fiche d'un incident |
| `/signaler.html` | Formulaire de signalement (position GPS ou carte, photo facultative) |
| `/suivi.html` | Suivi d'un signalement avec sa référence |
| `/simulateur.html` | Simulateur de conversation WhatsApp (clairement identifié) |
| `/admin.html` | Espace vérificateur : tableau de bord, validation, corrections, export CSV |

## IA gratuite (facultative)

L'analyse des messages fonctionne **sans aucune clé**, grâce à des règles locales. Pour une analyse bien meilleure, ajoutez une clé gratuite dans `.env` (une seule suffit) :

| Fournisseur | Où obtenir la clé | Variable |
| --- | --- | --- |
| Google Gemini | https://aistudio.google.com/apikey | `GEMINI_API_KEY` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` |
| Ollama (sur votre ordinateur, hors ligne) | https://ollama.com | `OLLAMA_MODEL` (ex. `llama3.2`) |

Les offres gratuites ont des quotas et leurs conditions peuvent changer : vérifiez-les sur le site du fournisseur. Les noms de modèles se règlent dans `.env` (`GEMINI_MODEL`, `GROQ_MODEL`) si l'un d'eux est retiré. Si le fournisseur tombe en panne ou si le quota est atteint, FloodAlert bascule seul sur les règles locales : **aucun signalement n'est perdu**.

Ce que l'IA ne fait jamais : confirmer un incident, inventer des coordonnées, une hauteur d'eau ou une gravité. Les numéros de téléphone et e-mails sont retirés du texte avant l'envoi au modèle.

## WhatsApp officiel (Meta Cloud API)

Sans configuration, utilisez le simulateur (`/simulateur.html`) pour vos démonstrations. Pour brancher un vrai numéro :

1. Créez une application sur https://developers.facebook.com et ajoutez le produit **WhatsApp**.
2. Dans `.env`, renseignez `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET` et choisissez un `WHATSAPP_VERIFY_TOKEN`.
3. Rendez le serveur accessible en HTTPS (voir plus bas, ou `ngrok http 3000` pour tester).
4. Dans la console Meta, configurez le webhook sur `https://VOTRE-DOMAINE/webhook/whatsapp` avec votre jeton de vérification, et abonnez-vous au champ `messages`.

Le webhook vérifie la signature de Meta dès que `WHATSAPP_APP_SECRET` est défini. Les tarifs et règles de Meta évoluent (fenêtre de 24 h, numéros de test, vérification de l'entreprise) : consultez leur documentation avant le lancement. Mettez `SIMULATOR=0` en production.

## Mise en ligne

Le serveur est un simple programme Node.js : il tourne sur un VPS, sur une machine de l'équipe, ou chez un hébergeur d'applications Node. Points d'attention :

- **HTTPS obligatoire** en production : placez le serveur derrière Caddy, Nginx ou le proxy de l'hébergeur, puis mettez `COOKIE_SECURE=1` et `TRUST_PROXY=1`.
- **Stockage persistant** : les données sont dans `data/` (`db.json` et `uploads/`). Sur un hébergeur gratuit au disque éphémère, elles seraient effacées à chaque redémarrage. Utilisez un disque persistant ou sauvegardez `data/` régulièrement.
- Les fonds de carte viennent d'OpenStreetMap (https://operations.osmfoundation.org/policies/tiles/) : convient à un prototype, pas à un fort trafic.
- Si la carte ne s'affiche pas, vérifiez l'accès à `unpkg.com` (bibliothèque Leaflet) et `tile.openstreetmap.org`.

## Sécurité en bref

Mots de passe hachés (scrypt), session en cookie signé `HttpOnly` et `SameSite=Strict`, en-tête anti-CSRF sur toutes les écritures, limitation de débit, contrôle de la signature réelle des photos, CSP stricte, requêtes de webhook signées, export CSV protégé contre l'injection de formules, coordonnées publiques arrondies, aucun contact ni téléphone dans l'API publique.

## Structure

```
server.js            serveur HTTP et routes
lib/                 config, stockage, authentification, IA, signalements, WhatsApp
                     duplicates.js (détection avancée des doublons)
                     forecasting.js (prévision des risques)
public/              pages, styles, scripts du navigateur
scripts/             création d'admin, données de démo, tests
docs/                documentation complète et rapport de tests
data/                base et photos (créé automatiquement, à sauvegarder)
```

## Fonctionnalités avancées

### Détection des doublons

Le système utilise plusieurs algorithmes pour identifier les signalements en double :
- **Similarité cosinus** : Analyse vectorielle des descriptions textuelles
- **Distance de Levenshtein** : Mesure de similarité entre les lieux déclarés
- **Clustering spatio-temporel** : Regroupement des incidents proches dans le temps et l'espace
- **Score composite** : Combinaison pondérée de tous les critères (distance, type, temps, description)

Les doublons détectés sont affichés dans l'onglet "Détection des doublons" de l'espace administrateur, avec des suggestions de fusion automatique basées sur la qualité des données (photo, GPS, confiance IA).

### Prévision des risques

Le module de prévision analyse les données historiques pour :
- Calculer un score de risque actuel (0-100%) basé sur la fréquence, la gravité, la récence et le clustering
- Générer des prévisions sur 7 jours avec un niveau de confiance
- Identifier les hotspots géographiques (zones à forte concentration d'incidents)
- Analyser les tendances temporelles (heures, jours de la semaine)
- Générer des recommandations d'action basées sur le niveau de risque

Les prévisions sont accessibles dans l'onglet "Prévision des risques" de l'espace administrateur.

## API d'analyse avancée

### Doublons
- `GET /api/admin/doublons/stats` - Statistiques globales sur les doublons
- `GET /api/admin/doublons/groupes` - Liste des groupes de doublons détectés
- `GET /api/admin/doublons/clusters` - Clusters spatio-temporels
- `GET /api/admin/doublons/:ref/suggestion` - Suggestion de fusion pour un signalement

### Risques
- `GET /api/admin/risques/rapport` - Rapport complet d'analyse de risque
- `GET /api/admin/risques/actuel` - Score de risque actuel
- `GET /api/admin/risques/previsions?days=7` - Prévisions sur N jours
- `GET /api/admin/risques/tendances?days=30` - Analyse des tendances
- `GET /api/admin/risques/spatial` - Distribution spatiale des incidents
- `GET /api/admin/risques/recommandations` - Recommandations basées sur le risque

Voir `docs/DOCUMENTATION.md` pour la documentation technique, le guide d'utilisation et les limites connues.
