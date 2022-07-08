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
  userLocale: null,
  theme: null,
  views: {},
  tips: {},
  splitters: {},
  dialogs: {},
  desktopClock: {},
  translatableTextField: {},
  lastColorsPicker: [],
  accessToEggsThemes: false,
  prototypeMode: false,
  windows: [],
  private: {
    osLocale: null,
    windowIndexes: {count: 0},
  },
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
        state.log.dbg(`window ${winId} get state ${count}`);
        state = state.set(`private.windowIndexes.${winId}`, count);
      } else {
        state.log.dbg(`new window ${winId} get state ${winIndex}`);
        state = state.set(`private.windowIndexes.${winId}`, count);
        state = state.set(`windows[${winIndex}]`, action.get('state'));
      }
      //inc number of windows
      state = state.set(`private.windowIndexes.count`, count + 1);
    } else {
      state.log.dbg(`window ${winIndex} updated`);
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

  'init-locale': (state, action) => {
    const osLocale = action.get('osLocale');
    const userLocale = state.get('userLocale');
    /* Prefer the user locale only if set and different of the OS */
    const locale =
      osLocale !== userLocale && userLocale ? userLocale : osLocale;
    /* When the user uses the same locale that the OS, then fallback on the OS */
    if (userLocale === osLocale) {
      state = state.set('userLocale', null);
    }
    return state.set('locale', locale).set('private.osLocale', osLocale);
  },

  'set-locale': (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale);
  },

  'change-locale': (state, action) => {
    const locale = action.get('locale');
    return state.set('locale', locale).set('userLocale', locale);
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

  'set-last-colors-picker': (state, action) => {
    const lastColors = action.get('state');
    return state.set('lastColorsPicker', lastColors);
  },

  'set-desktop-clock': (state, action) => {
    const theme = action.get('theme');
    const clockState = action.get('state');
    return state.set(`desktopClock.${theme}`, clockState);
  },

  'set-translatable-text-field': (state, action) => {
    const translatableState = action.get('state');
    return state.set('translatableTextField', translatableState);
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

  'reset-view-column': (state, action) => {
    const viewId = action.get('viewId');
    return state.del(`views.${viewId}`);
  },

  'set-access-to-eggs-themes': (state, action) => {
    const show = action.get('show');
    return state.set('accessToEggsThemes', show);
  },

  'toggle-prototype-mode': (state) => {
    const mode = state.get('prototypeMode');
    return state.set('prototypeMode', !mode);
  },
};

/******************************************************************************/

Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  id,
  sessionStorage
) {
  const splitId = id.split('§');
  const fileId = splitId[0];
  const mainGoblin = splitId[1];

  const sessionPath = path.join(sessionStorage, fileId);
  const settings = new StateDb(sessionPath, mainGoblin);
  try {
    yield settings.init();
  } catch (ex) {
    quest.log.warn(ex.stack || ex.message || ex);
    yield settings.initEmpty();
  }

  quest.goblin.setX('settings', settings);

  const session = settings.loadState('session');
  if (session) {
    if (!session.views) {
      session.views = {};
    }
    quest.do({session});
  } else {
    quest.do();
  }

  /* We should do the same with pure nodejs app */
  if (process.versions.electron) {
    const {app} = require('electron');
    const nabuAPI = quest.getAPI('nabu');
    const osLocale = yield nabuAPI.findBestLocale({locale: app.getLocale()});
    quest.dispatch('init-locale', {osLocale});
  }

  yield quest.me.save();
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

Goblin.registerQuest(goblinName, 'reset-view-column', function* (
  quest,
  viewId
) {
  quest.do();
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

Goblin.registerQuest(goblinName, 'change-locale', function* (quest, locale) {
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

Goblin.registerQuest(goblinName, 'set-last-colors-picker', function* (
  quest,
  state
) {
  quest.do({state});
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

Goblin.registerQuest(goblinName, 'set-translatable-text-field', function* (
  quest,
  state
) {
  quest.do({state});
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

Goblin.registerQuest(goblinName, 'set-access-to-eggs-themes', function* (
  quest,
  show
) {
  quest.do({show});
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'toggle-prototype-mode', function* (quest) {
  quest.do();
  yield quest.me.save();
});

/******************************************************************************/

Goblin.registerQuest(goblinName, 'save', function (quest) {
  const settings = quest.goblin.getX('settings');
  const state = quest.goblin.getState().toJS();
  delete state.private;
  settings.saveState('session', state);
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
