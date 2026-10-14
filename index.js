// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the TodoistApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TodoistApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new TodoistApp({ gladys });

// --- Scene actions --------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.ADD, (fields) => app.addTask(fields));
gladys.onSceneAction(SCENE_ACTIONS.COMPLETE, (fields) => app.completeTask(fields));
gladys.onSceneAction(SCENE_ACTIONS.GET, (fields) => app.getTasks(fields));

// --- Dashboard widget ----------------------------------------------------------
gladys.onWidgetGet(WIDGETS.TASKS, (request) => app.getWidget(request));
gladys.onWidgetAction(WIDGETS.TASKS, (actionKey, params, context) =>
  app.widgetAction(actionKey, params, context),
);

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user -----------------------------------------
gladys.onConfigUpdated((config) => app.configUpdated(config));

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Todoist integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
