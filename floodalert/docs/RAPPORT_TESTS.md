# Rapport de tests FloodAlert Togo

Exécuté le 2026-10-14 16:00 UTC avec Node v22.22.2.

**Résultat : 25/25 tests réussis.**

| ID | Scénario | Résultat |
| --- | --- | --- |
| T01 | Signalement WhatsApp complet : enregistré, référence et accusé de réception retournés | Réussi |
| T02 | Message sans lieu : le bot demande une localisation, puis enregistre avec la position partagée | Réussi |
| T03 | Formulaire web : signalement enregistré et référence affichée | Réussi |
| T03b | Formulaire web : champs obligatoires contrôlés côté serveur | Réussi |
| T04 | Photo : stockée de façon sécurisée, visible des administrateurs seulement | Réussi |
| T04b | Photo : un faux fichier image est refusé (signature contrôlée) | Réussi |
| T05 | Coordonnées valides : marqueur disponible, position publique arrondie | Réussi |
| T06 | Description ambiguë : incertitudes signalées, validation humaine possible | Réussi |
| T07 | L'administrateur confirme un incident : statut mis à jour en base et sur la carte | Réussi |
| T08 | Rejet : motif obligatoire, conservé, incident exclu des incidents actifs | Réussi |
| T09 | Utilisateur non autorisé : accès refusé au tableau de bord | Réussi |
| T10 | Service IA indisponible : signalement conservé, repli sur l'analyse locale, traitement manuel possible | Réussi |
| T11 | Données simulées : explicitement identifiées comme démonstration | Réussi |
| S01 | Protection CSRF : une écriture sans l'en-tête du site est refusée | Réussi |
| S02 | Coordonnées hors du Togo et date future refusées | Réussi |
| S03 | Confidentialité : l'API publique n'expose ni contact, ni téléphone, ni description brute | Réussi |
| S04 | Doublons : des déclarations proches sont signalées, aucune n'est supprimée | Réussi |
| S05 | Un incident doit être confirmé avant d'être résolu ; réouverture possible | Réussi |
| S06 | Statistiques cohérentes avec la liste filtrée | Réussi |
| S07 | Export CSV : cellules neutralisées contre l'injection de formules | Réussi |
| S08 | Fichiers statiques : traversée de dossiers et fichiers cachés refusés | Réussi |
| S09 | Webhook WhatsApp : vérification du jeton et de la signature Meta | Réussi |
| S10 | WhatsApp : message hors sujet = explication ; statut visible seulement par l'auteur | Réussi |
| S11 | Anti-robots : le champ piège ne crée aucun signalement | Réussi |
| S12 | Erreurs techniques journalisées et consultables par un administrateur | Réussi |

## Ce que ces tests ne couvrent pas

- Le fonctionnement réel avec les fournisseurs d'IA (Gemini, Groq, Ollama) : les tests exécutent le repli par règles locales, car aucune clé n'est fournie.
- L'envoi réel de messages par l'API WhatsApp Business de Meta (le moteur de conversation et la sécurité du webhook sont testés, pas l'envoi).
- L'affichage dans les navigateurs (carte Leaflet, mise en page mobile) : à vérifier manuellement avant la démonstration.
- La charge : le stockage JSON convient à un prototype, pas à un fort trafic.
