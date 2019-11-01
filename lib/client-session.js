'use strict';

const Goblin = require('xcraft-core-goblin');
const path = require('path');
const fs = require('fs');
const StateDb = require('statedb');
const goblinName = path.basename(module.parent.filename, '.js');

// Define initial logic values
const logicState = {
  zoom: 1,
  locale: null,
};

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
    const locale = action.get('locale').replace('-', '_');
    return state.set('locale', locale);
  },
};

Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  id,
  sessionStorage
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const app = clientConfig.mainGoblin;
  const sessionPath = path.join(sessionStorage, id);
  const globalSettings = new StateDb(sessionPath, 'global');
  const appSettings = new StateDb(sessionPath, app);

  quest.goblin.setX('globalSettings', globalSettings);
  quest.goblin.setX('appSettings', appSettings);

  const session = globalSettings.loadState('session');
  if (session) {
    quest.do({session});
  } else {
    quest.do();
    yield quest.me.save();
  }
});

Goblin.registerQuest(goblinName, 'set-locale', function*(quest, locale) {
  quest.do({locale});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'get-locale', function(quest) {
  return quest.goblin.getState().get('locale');
});

Goblin.registerQuest(goblinName, 'save', function(quest) {
  const globalSettings = quest.goblin.getX('globalSettings');
  globalSettings.saveState('session', quest.goblin.getState().toJS());
});

Goblin.registerQuest(goblinName, 'save-app-settings', function(
  quest,
  action,
  payload
) {
  const appSettings = quest.goblin.getX('appSettings');
  appSettings.saveState(action, payload);
});

Goblin.registerQuest(goblinName, 'load-app-settings', function(quest, action) {
  const appSettings = quest.goblin.getX('appSettings');
  return appSettings.loadState(action);
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
