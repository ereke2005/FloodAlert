# FloodAlert Togo : documentation

## 1. Correspondance avec le cahier des charges

| ID | Fonctionnalité | État | Où |
| --- | --- | --- | --- |
| F01 | Signalement WhatsApp | Fait. Moteur de dialogue, webhook signé, accusé de réception, simulateur. L'envoi réel dépend de la configuration Meta. | `lib/whatsapp.js`, `/simulateur.html` |
| F02 | Formulaire web | Fait | `public/signaler.html`, `POST /api/signalements` |
| F03 | Carte interactive | Fait. Marqueurs, filtres, statuts distincts, fiche détaillée. | `public/index.html`, `public/js/carte.js` |
| F04 | Analyse IA | Fait. Gemini, Groq ou Ollama (gratuits), repli par règles locales. | `lib/ai.js` |
| F05 | Tableau de bord | Fait. Statistiques calculées sur les données réelles et filtrées. | `public/admin.html` |
| F06 | Validation des incidents | Fait. Statuts, motifs de rejet, notes, historique. | `lib/signalements.js` (`update`) |
| F07 | Doublons | Fait en version simple (proximité GPS, lieu, temps, texte). Rien n'est supprimé. | `findDuplicates` |
| F08 | Prédiction | Hors périmètre, comme prévu. | |

Règles métier RB-01 à RB-12 : voir la section 5.

## 2. Architecture

```
Citoyen ──WhatsApp──► Webhook Meta ─┐
Citoyen ──Formulaire web───────────┼─► Serveur Node.js ─► Stockage JSON (data/db.json)
Simulateur (démo) ─────────────────┘        │                 + photos (data/uploads/)
                                            ├─► Module IA (Gemini / Groq / Ollama / règles locales)
Vérificateur ──Tableau de bord──────────────┘
Public ──Carte──► API publique (sans données personnelles)
```

Choix techniques :

- **Node.js sans dépendance** : rien à installer, aucun risque de paquet compromis, démarrage immédiat.
- **Stockage JSON atomique** : suffisant pour un prototype. Pour passer à l'échelle, migrer vers PostgreSQL (Supabase et Neon proposent des offres gratuites). Tout l'accès aux données passe par `lib/store.js` et `lib/signalements.js`.
- **Leaflet + OpenStreetMap** pour la carte : gratuit, sans clé.
- **Pages en HTML/JS simple** : pas de compilation, modifiables directement.

## 3. Modèle de données

Entité `Signalement` (champs principaux) : `id`, `reference` (FA-0001), `source` (web ou whatsapp), `type_incident`, `description_originale`, `resume_ia`, `latitude`, `longitude` (nuls si inconnus), `localisation_precision` (`gps`, `admin` ou `aucune`), `lieu_declare`, `photo_file`, `date_observation`, `date_reception`, `statut`, `priorite`, `confiance_extraction`, `contact`, `telephone_wa`, `note_interne`, `motif_rejet`, `doublons`, `demo`, `simule`, `cree_le`, `mis_a_jour_le`.

Entités complémentaires dans la même base : `historique` (changements de statut et corrections, avec auteur et date), `analyses` (résultat IA, modèle utilisé, pièces jointes), `admins`, `wa_sessions` (conversations WhatsApp en cours, 30 minutes), `erreurs` (journal technique).

La date d'observation (déclarée) et la date de réception (serveur) sont toujours séparées.

## 4. API

Publique :

| Méthode et route | Rôle |
| --- | --- |
| `GET /api/config` | Zone pilote, types, texte d'urgence |
| `GET /api/public/signalements` | Signalements non rejetés, sans donnée personnelle, position arrondie à ~110 m |
| `POST /api/signalements` | Créer un signalement (formulaire web) |
| `GET /api/suivi/:reference` | Statut d'un signalement |
| `GET/POST /webhook/whatsapp` | Webhook Meta (vérification et réception) |
| `POST /api/simulateur/whatsapp` | Simulateur (désactivable avec `SIMULATOR=0`) |

Administration (cookie de session requis) : `POST /api/admin/login`, `logout`, `GET /api/admin/me`, `GET /api/admin/signalements` (filtres : `q`, `statut`, `source`, `type`, `demo`, `localise`, `from`, `to`), `GET/PATCH /api/admin/signalements/:id`, `POST /api/admin/signalements/:id/analyser`, `GET /api/admin/photos/:fichier`, `GET /api/admin/export.csv`, `GET /api/admin/erreurs`.

## 5. Règles métier implémentées

| Règle | Mise en œuvre |
| --- | --- |
| RB-01 Référence unique | Compteur FA-0001, FA-0002, etc. |
| RB-02 Traçabilité | Source, dates et historique de chaque changement (auteur et date) |
| RB-03 Déclaration ≠ confirmation | Tout signalement naît « À vérifier » ; l'accusé le précise |
| RB-04 Échec IA | Repli sur les règles locales ; le signalement est enregistré avant l'analyse |
| RB-05 Doublons | Marqués « doublon potentiel », jamais supprimés |
| RB-06 Protection des données | Contact, téléphone et photo visibles des seuls administrateurs |
| RB-07 Minimisation | Seuls les champs utiles sont collectés ; contact facultatif avec consentement |
| RB-08 Accès sécurisé | Connexion, session signée, limitation des tentatives |
| RB-09 Publication prudente | Statut affiché partout, rejetés exclus, aucun contact exposé |
| RB-10 Données de démo | Drapeaux `demo` et `simule`, badge « Démo », filtre « terrain uniquement » |
| RB-11 Urgence | Chaque accusé WhatsApp et la page de succès rappellent que ce n'est pas un service de secours |
| RB-12 Conservation | **À définir avant le lancement public** (voir section 7) |

Règles supplémentaires : un incident doit être confirmé avant d'être résolu ; un rejet exige un motif ; un incident confirmé sans position demande une confirmation explicite ; la localisation placée par un vérificateur est marquée comme telle ; une position imprécise n'est jamais transformée en coordonnées supposées.

## 6. Guide d'utilisation

**Citoyen (web)** : ouvrir « Signaler », choisir le type, décrire, indiquer la position (bouton, carte ou repère écrit), la date, éventuellement une photo, puis envoyer. Noter la référence et la saisir dans « Suivre un signalement ».

**Citoyen (WhatsApp)** : écrire ce que l'on observe, partager sa position (📎 > Position) et une photo si possible. Le bot demande ce qui manque, puis donne la référence. `STATUT FA-0001` donne le statut (réservé au numéro qui a fait le signalement). `AIDE` affiche l'aide.

**Vérificateur** :

1. Se connecter sur `/admin.html`.
2. Parcourir la liste, filtrer (statut, canal, catégorie, position, période, terrain ou démo, texte).
3. Ouvrir un signalement : lire le message original et la photo, consulter l'analyse automatique (les champs « à vérifier » sont signalés).
4. Corriger la catégorie, le lieu, le résumé, et placer l'incident sur la carte si la position manque.
5. Décider : confirmer, rejeter (avec motif), résoudre (après confirmation) ou rouvrir.
6. Exporter en CSV pour un rapport.

## 7. Limites connues et prochaines étapes

- **Zone pilote** : Grand Lomé par défaut. Modifier `ZONE_*` dans `.env` quand la zone est choisie.
- **Numéros d'urgence** : le texte par défaut (pompiers 118, police 117) doit être **vérifié et confirmé** auprès des autorités avant le lancement (`URGENCE_TEXTE`).
- **Conservation des données (RB-12)** : aucune purge automatique n'existe. À définir avec les obligations légales du Togo, notamment en matière de protection des données personnelles.
- **Positions des données de démo** : approximatives, sans lien avec des événements réels.
- **Géocodage** : volontairement absent. Un lieu écrit (« marché d'Adidogomé ») n'est jamais converti en coordonnées ; un vérificateur place le point.
- **Stockage JSON** : un seul processus, pas fait pour un fort volume ni pour plusieurs serveurs.
- **WhatsApp** : l'envoi réel n'a pas pu être testé sans compte Meta ; le moteur de dialogue et la signature du webhook sont testés.
- **IA** : la qualité varie selon le modèle ; l'analyse est toujours une proposition. À évaluer sur de vrais messages (français, éwé, mina, messages vocaux non pris en charge).
- **Fonds de carte** : serveurs publics OpenStreetMap, usage léger uniquement.
- **Interface testée sans navigateur** : les scripts et les identifiants de page sont vérifiés automatiquement, mais l'affichage visuel doit être contrôlé sur téléphone et ordinateur avant la démonstration.
- **Étapes suivantes** : PostgreSQL, vérification communautaire, analyse des photos, données météo, capteurs, puis seulement après collecte de données fiables, la prédiction (F08).
