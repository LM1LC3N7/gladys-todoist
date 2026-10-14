# Todoist

**Connecteur non officiel, sans lien avec Doist** (l'éditeur de Todoist). Il
amène vos tâches [Todoist](https://www.todoist.com/) dans Gladys : un widget
de tableau de bord avec les tâches du jour, des actions de scène pour
ajouter, terminer et lire des tâches, et des déclencheurs de scène quand une
tâche arrive à échéance, est ajoutée ou terminée. Il utilise l'API officielle
Todoist v1 avec votre jeton d'API personnel. Todoist est une marque de Doist.

## Ce que vous obtenez

| Surface               | Contenu                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget                | **Tâches Todoist** : les tâches du jour et en retard (ou d'un projet, ou de n'importe quel filtre Todoist), avec la couleur de priorité, l'heure d'échéance et la mention de retard, un bouton pour cocher chaque tâche et un formulaire **Ajouter** |
| Actions de scène      | **ajouter une tâche** (texte, échéance, projet, priorité, étiquettes, ou ajout rapide), **terminer une tâche** (nommée approximativement), **lire des tâches** (nombre, retards, la liste en texte, la prochaine tâche)                              |
| Déclencheurs de scène | **tâche à échéance** (à son heure, ou à l'heure choisie pour une date sans heure), **tâche ajoutée**, **tâche terminée** (récurrentes comprises), filtrés par projet et priorité                                                                     |

Aucun appareil n'est créé : les tâches ne sont pas des appareils.

## Installation

1. Dans Todoist, ouvrez **Paramètres → Intégrations → Développeur** et copiez
   votre **jeton d'API**.
2. Installez l'intégration, ouvrez sa configuration et collez le jeton. Il
   n'est envoyé qu'à Todoist (`api.todoist.com`), dans l'en-tête
   Authorization ; Gladys le stocke chiffré.
3. Cliquez sur **Tester le compte** : il affiche votre nombre de tâches et de
   projets, les tâches du jour et en retard, et le fuseau horaire de votre
   compte Todoist (celui dans lequel toutes les heures d'échéance sont lues).
4. Placez le widget **Tâches Todoist** sur un tableau de bord. Laissez ses
   réglages vides pour le jour et les retards, saisissez un filtre Todoist
   (`#Courses`, `@courses`, `p1 & today`) ou un nom de projet : le
   formulaire **Ajouter** place alors les nouvelles tâches dans ce projet.

### Le widget

Chaque tâche affiche la couleur de sa priorité (rouge p1, orange p2, bleu
p3, gris p4), son échéance (« 19:00 », « Demain », « mar. 20 oct. ») et,
quand elle est en retard, « En retard ». Une carte contient au plus quatre
boutons : jusqu'à trois tâches ont chacune leur bouton pour cocher (Gladys
demande d'abord une confirmation) ; au-delà, les deux premières gardent le
leur et **Cocher…** ouvre la liste de toutes. **Ajouter** ouvre un
formulaire (tâche, échéance facultative écrite comme dans Todoist). Les
formulaires nécessitent Gladys 5.2 ; les boutons pour cocher fonctionnent
avec la 5.1.

## Scènes

- **Tâche à échéance** : une tâche atteint son heure d'échéance. Une tâche
  due un jour sans heure se déclenche à l'heure réglée dans la configuration
  (**Heure du déclencheur « tâche à échéance »**, 9 par défaut). Il se
  déclenche une fois par échéance ; les échéances déjà passées au démarrage
  de Gladys ne se déclenchent jamais.
- **Tâche ajoutée** : une tâche a été ajoutée dans Todoist (les
  applications, un projet partagé, un e-mail vers votre boîte de réception).
- **Tâche terminée** : une tâche a été cochée dans Todoist. Une tâche
  récurrente compte aussi : Todoist la passe à sa date suivante, la variable
  `{{recurring}}` vaut alors vrai.

Chaque déclencheur peut être limité à un **projet** (saisi exactement comme
dans Todoist, majuscules comprises) et à certaines **priorités**. Variables :
`{{content}}`, `{{project}}`, `{{priority}}` (p1 à p4), `{{due}}`
(« 2026-10-14 19:00 »), `{{labels}}`, `{{url}}` (la tâche dans l'application
web Todoist), `{{all_day}}`. Les modifications faites depuis Gladys (une
action de scène, le widget) ne déclenchent ni « tâche ajoutée » ni « tâche
terminée » : une scène ne peut pas boucler à travers l'intégration.

Les actions renvoient des valeurs pour les étapes suivantes :

- **Ajouter une tâche** donne `{{id}}`, `{{url}}`, `{{project}}` et
  `{{due}}`. L'échéance s'écrit comme dans Todoist (« demain à 18h », « tous
  les lundis ») ; un projet vide est votre boîte de réception. Avec l'**ajout
  rapide**, le texte est lu comme dans les applications Todoist (« Appeler
  maman demain 18h #Maison p2 ») et les autres champs sont ignorés.
- **Terminer une tâche** ferme la tâche ouverte dont le texte correspond,
  sans tenir compte des majuscules ni des accents (sinon la première qui
  contient le texte, la plus urgente gagnant), éventuellement seulement dans
  un projet ou un filtre. `{{done}}` vaut faux si aucune tâche ne correspond.
- **Lire des tâches** prend un filtre Todoist (`today | overdue` par défaut)
  et donne `{{count}}`, `{{overdue_count}}`, `{{list}}` (une ligne par tâche,
  dans la langue de votre compte Todoist) et la prochaine tâche :
  `{{next_task}}`, `{{next_due}}`, `{{next_project}}`, `{{next_priority}}`,
  `{{next_url}}`.

Les filtres autres que celui par défaut sont évalués par Todoist : écrivez-les
dans la langue choisie dans **Langue de vos filtres** (anglais par défaut).

## Rythme

Todoist publie ses limites : par utilisateur et par 15 minutes, 1000
synchronisations incrémentales et 100 complètes. L'intégration fait une
synchronisation complète au démarrage, puis une synchronisation incrémentale
légère toutes les 2 minutes (option **Intervalle de synchronisation**, 1
minute au minimum) tant que les tâches sont surveillées, et une juste après
une modification faite depuis Gladys. « Tâche à échéance » est vérifié chaque
minute sur les tâches synchronisées, sans aucune requête. Un filtre évalué
par Todoist est gardé une minute. Chaque requête est comptée : l'intégration
n'utilise jamais plus de la moitié des limites publiées et se met en pause
quand Todoist demande de ralentir. Avec **Surveiller les tâches** désactivé,
rien ne tourne en arrière-plan : le widget et les actions se synchronisent
quand ils en ont besoin, et les déclencheurs ne se déclenchent jamais.

## Dépannage

- **« Todoist a refusé le jeton d'API »** : recopiez le jeton et enregistrez
  la configuration ; l'intégration ne réessaie pas d'elle-même.
- **« Todoist est injoignable »** : elle réessaie à la synchronisation
  suivante.
- **Un déclencheur ne se déclenche pas** : vérifiez que les tâches sont
  surveillées et que le projet est écrit exactement comme dans Todoist.
- **Les heures d'échéance sont décalées d'une ou deux heures** : c'est le
  fuseau horaire de votre compte Todoist (Todoist : Paramètres → Général) qui
  est utilisé ; **Tester le compte** l'affiche.
- Journaux : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL`.

## Confidentialité

Le jeton d'API n'est envoyé qu'à Todoist, jamais journalisé. De votre compte,
l'intégration garde en mémoire les tâches, les noms des projets, le fuseau
horaire et la langue ; l'e-mail et les autres réglages envoyés par Todoist
sont aussitôt écartés. Rien n'est écrit sur le disque.
