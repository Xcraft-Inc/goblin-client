'use strict';

const Goblin = require('xcraft-core-goblin');
const path = require('path');
const StateDb = require('statedb');
const goblinName = path.basename(module.parent.filename, '.js');

/******************************************************************************/

// Define initial logic values
const logicState = {
  zoom: 1,
  locale: null,
  views: {},
};

/******************************************************************************/

// Define logic handlers according rc.json
const logicHandlers = {
  'create': (state, action) => {
    if (action.get('session')) {
      return state.set('', action.get('session'));
    } else {
      return state.set('', {id: action.get('id'), ...logicState});
    }
  },

  'set-locale': (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale);
  },

  'set-view-columns-order': (state, action) => {
    const viewId = action.get('viewId');
    const columnIds = action.get('columnIds');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.order`, columnIds);
    return state;
  },

  'set-view-column-width': (state, action) => {
    const viewId = action.get('viewId');
    const columnId = action.get('columnId');
    const width = action.get('width');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.widths.${columnId}`, width);
    return state;
  },

  'set-view-column-sorting': (state, action) => {
    const viewId = action.get('viewId');
    const columnId = action.get('columnId');
    const direction = action.get('direction');
    const viewSettings = state.get(`views.${viewId}`);
    if (!viewSettings) {
      state = state.set(`views.${viewId}`, {
        widths: {},
        order: [],
        sorting: {},
      });
    }
    state = state.set(`views.${viewId}.sorting`, {columnId, direction});
    return state;
  },
};

/******************************************************************************/

Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  id,
  sessionStorage
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const app = clientConfig.mainGoblin;
  const globalSessionPath = path.join(sessionStorage, id);

  const globalSettings = new StateDb(globalSessionPath, 'global');
  const appSettings = new StateDb(globalSessionPath, app);

  quest.goblin.setX('globalSettings', globalSettings);
  quest.goblin.setX('appSettings', appSettings);

  const session = globalSettings.loadState('session');
  if (session) {
    if (!session.views) {
      session.views = {};
    }
    quest.do({session});
  } else {
    quest.do();
    yield quest.me.save();
  }
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-view-columns-order', function* (
  quest,
  viewId,
  columnsIds
) {
  quest.do({viewId, columnsIds});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'set-view-column-width', function* (
  quest,
  viewId,
  columnId,
  width
) {
  quest.do({viewId, columnId, width});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'set-view-column-sorting', function* (
  quest,
  viewId,
  columnId,
  direction
) {
  quest.do({viewId, columnId, direction});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-locale', function* (quest, locale) {
  const nabuAPI = quest.getAPI('nabu');
  locale = yield nabuAPI.findBestLocale({locale});
  quest.do({locale});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'get-locale', function (quest) {
  return quest.goblin.getState().get('locale');
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'save', function (quest) {
  const globalSettings = quest.goblin.getX('globalSettings');
  globalSettings.saveState('session', quest.goblin.getState().toJS());
});

Goblin.registerQuest(goblinName, 'save-app-settings', function (
  quest,
  action,
  payload
) {
  const appSettings = quest.goblin.getX('appSettings');
  appSettings.saveState(action, payload);
});

Goblin.registerQuest(goblinName, 'load-app-settings', function (quest, action) {
  const appSettings = quest.goblin.getX('appSettings');
  return appSettings.loadState(action);
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
