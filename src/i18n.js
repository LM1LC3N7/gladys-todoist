// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, action results, widget).
// Every text is a { en, fr } object: Gladys picks the user's language.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => (n === 1 ? one : many);

export const T = {
  notConfigured: {
    en: 'Paste the API token of your Todoist account in the configuration (Todoist: Settings → Integrations → Developer).',
    fr: 'Collez le jeton d’API de votre compte Todoist dans la configuration (Todoist : Paramètres → Intégrations → Développeur).',
  },
  ok: (watching, minutes) => ({
    en: watching
      ? `Connected to Todoist. Tasks synced every ${minutes} min.`
      : 'Connected to Todoist. Tasks not watched: the scene triggers are off.',
    fr: watching
      ? `Connecté à Todoist. Tâches synchronisées toutes les ${minutes} min.`
      : 'Connecté à Todoist. Tâches non surveillées : les déclencheurs de scène sont inactifs.',
  }),
  badToken: {
    en: 'Todoist refused the API token: copy it again from Todoist (Settings → Integrations → Developer) and save the configuration.',
    fr: 'Todoist a refusé le jeton d’API : recopiez-le depuis Todoist (Paramètres → Intégrations → Développeur) et enregistrez la configuration.',
  },
  paused: (minutes) => ({
    en: `Todoist asked to slow down: paused for ${minutes} min.`,
    fr: `Todoist a demandé de ralentir : en pause pour ${minutes} min.`,
  }),
  budget: (minutes) => ({
    en: `Request budget of the 15-minute window used up: paused for ${minutes} min.`,
    fr: `Budget de requêtes des 15 minutes épuisé : en pause pour ${minutes} min.`,
  }),
  unreachable: (message) => ({
    en: `Todoist is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Todoist est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  testOk: ({ tasks, projects, today, overdue, timeZone, requests }) => ({
    en: `Todoist answers. ${tasks} active ${plural(tasks, 'task', 'tasks')} in ${projects} ${plural(projects, 'project', 'projects')}; ${today} due today, ${overdue} overdue. Time zone of the account: ${timeZone}. Requests in the last 15 minutes: ${requests}.`,
    fr: `Todoist répond. ${tasks} tâche${tasks > 1 ? 's' : ''} active${tasks > 1 ? 's' : ''} dans ${projects} projet${projects > 1 ? 's' : ''} ; ${today} pour aujourd’hui, ${overdue} en retard. Fuseau horaire du compte : ${timeZone}. Requêtes des 15 dernières minutes : ${requests}.`,
  }),
  testFailed: (code, message) => ({
    en: `The test failed (${code}): ${message}`,
    fr: `Le test a échoué (${code}) : ${message}`,
  }),
  unknownProject: (query, names) => ({
    en: `Unknown Todoist project "${query}". The projects are: ${names.join(', ') || 'none'}.`,
    fr: `Projet Todoist inconnu « ${query} ». Les projets sont : ${names.join(', ') || 'aucun'}.`,
  }),
  widget: {
    notConfigured: {
      en: 'Configure your Todoist API token in the integration first',
      fr: 'Configurez d’abord votre jeton d’API Todoist dans l’intégration',
    },
    today: { en: 'Today', fr: 'Aujourd’hui' },
    empty: { en: 'Nothing to do', fr: 'Rien à faire' },
    summary: (count, overdue) => ({
      en: `${count} ${plural(count, 'task', 'tasks')}${overdue ? ` · ${overdue} overdue` : ''}`,
      fr: `${count} tâche${count > 1 ? 's' : ''}${overdue ? ` · ${overdue} en retard` : ''}`,
    }),
    overdue: { en: 'Overdue', fr: 'En retard' },
    noDate: { en: 'No date', fr: 'Sans date' },
    more: (n) => ({ en: `+ ${n} more`, fr: `+ ${n} de plus` }),
    add: { en: 'Add', fr: 'Ajouter' },
    pick: { en: 'Check off…', fr: 'Cocher…' },
    task: { en: 'Task', fr: 'Tâche' },
    taskPlaceholder: { en: 'Buy bread', fr: 'Acheter du pain' },
    due: { en: 'Due (optional)', fr: 'Échéance (facultatif)' },
    duePlaceholder: { en: 'tomorrow at 6pm', fr: 'demain à 18h' },
    added: (content) => ({ en: `Added: ${content}`, fr: `Ajoutée : ${content}` }),
    done: (content) => ({ en: `Done: ${content}`, fr: `Terminée : ${content}` }),
    gone: { en: 'This task is no longer open', fr: 'Cette tâche n’est plus ouverte' },
    needsForm: {
      en: 'This form needs Gladys 5.2 or later',
      fr: 'Ce formulaire nécessite Gladys 5.2 ou plus récent',
    },
    failed: (message) => ({ en: `Todoist: ${message}`, fr: `Todoist : ${message}` }),
  },
};
