'use strict';

const Goblin = require('xcraft-core-goblin');
const path = require('path');
const StateDb = require('statedb');
const goblinName = path.basename(module.parent.filename, '.js');
const locks = require('xcraft-core-utils/lib/locks');

/******************************************************************************/

// Define initial logic values
const logicState = {
  zoom: 1,
  locale: null,
  theme: null,
  views: {},
  tips: {},
  splitters: {},
  dialogs: {},
  desktopClock: {},
  windows: [],
  private: {windowIndexes: {count: 0}},
};

/******************************************************************************/

// Define logic handlers according rc.json
const logicHandlers = {
  'create': (state, action) => {
    if (action.get('session')) {
      return state.set('', {...logicState, ...action.get('session')});
    } else {
      return state.set('', {id: action.get('id'), ...logicState});
    }
  },

  'set-window-state': (state, action) => {
    const winId = action.get('winId');
    let winIndex = state.get(`private.windowIndexes.${winId}`, null);
    if (winIndex === null) {
      const count = state.get(`private.windowIndexes.count`);
      winIndex = count;
      const windowsCount = state.get('windows').size;
      if (count <= windowsCount) {
        console.log(`window ${winId} get state ${count}`);
        state = state.set(`private.windowIndexes.${winId}`, count);
      } else {
        console.log(`new window ${winId} get state ${winIndex}`);
        state = state.set(`private.windowIndexes.${winId}`, count);
        state = state.set(`windows[${winIndex}]`, action.get('state'));
      }
      //inc number of windows
      state = state.set(`private.windowIndexes.count`, count + 1);
    } else {
      console.log(`window ${winIndex} updated`);
      state = state.set(`windows[${winIndex}]`, action.get('state'));
    }
    return state;
  },

  'close-window': (state, action) => {
    const winId = action.get('winId');
    const count = state.get(`private.windowIndexes.count`);
    //dec number of windows
    state = state.set(`private.windowIndexes.count`, count - 1);
    state = state.del(`private.windowIndexes.${winId}`);
    return state;
  },

  'set-locale': (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale);
  },

  'set-tips': (state, action) => {
    const tipsId = action.get('tipsId');
    const tipsState = action.get('state');
    return state.set(`tips.${tipsId}`, tipsState);
  },

  'set-splitters': (state, action) => {
    const splitterId = action.get('splitterId');
    const splitterState = action.get('state');
    return state.set(`splitters.${splitterId}`, splitterState);
  },

  'set-dialogs': (state, action) => {
    const dialogId = action.get('dialogId');
    const dialogState = action.get('state');
    return state.set(`dialogs.${dialogId}`, dialogState);
  },

  'set-desktop-clock': (state, action) => {
    const theme = action.get('theme');
    const clockState = action.get('state');
    return state.set(`desktopClock.${theme}`, clockState);
  },

  'set-theme': (state, action) => {
    const theme = action.get('theme');
    return state.set('theme', theme);
  },

  'set-zoom': (state, action) => {
    const zoom = action.get('zoom');
    return state.set('zoom', zoom);
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

const winLock = locks.getMutex;
Goblin.registerQuest(goblinName, 'set-window-state', function* (quest, winId) {
  yield winLock.lock(winId);
  quest.do();
  yield quest.me.save();
  winLock.unlock(winId);
});

Goblin.registerQuest(goblinName, 'get-window-state', function* (
  quest,
  winId,
  defaultState
) {
  let state = quest.goblin.getState();
  let winIndex = state.get(`private.windowIndexes.${winId}`, null);
  if (winIndex !== null) {
    return state.get(`windows[${winIndex}]`);
  } else {
    yield quest.me.setWindowState({winId, state: defaultState});
    state = quest.goblin.getState();
    winIndex = state.get(`private.windowIndexes.${winId}`);
    return state.get(`windows[${winIndex}]`);
  }
});

Goblin.registerQuest(goblinName, 'close-window', function (quest) {
  quest.do();
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

Goblin.registerQuest(goblinName, 'set-tips', function* (quest, tipsId, state) {
  quest.do({tipsId, state});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-splitters', function* (
  quest,
  splitterId,
  state
) {
  quest.do({splitterId, state});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-dialogs', function* (
  quest,
  dialogId,
  state
) {
  quest.do({dialogId, state});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-desktop-clock', function* (
  quest,
  theme,
  state
) {
  quest.do({theme, state});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-zoom', function* (quest, zoom) {
  quest.do({zoom});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'get-zoom', function (quest) {
  return quest.goblin.getState().get('zoom');
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'set-theme', function* (quest, theme) {
  quest.do({theme});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'get-theme', function (quest) {
  return quest.goblin.getState().get('theme');
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'save', function (quest) {
  const globalSettings = quest.goblin.getX('globalSettings');
  const state = quest.goblin.getState().toJS();
  delete state.private;
  globalSettings.saveState('session', state);
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
