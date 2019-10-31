'use strict';

const Goblin = require('xcraft-core-goblin');
const path = require('path');
const fs = require('fs');
const goblinName = path.basename(module.parent.filename, '.js');

//const appConfig = require('electron-settings');

// Define initial logic values
const logicState = {
  zoom: 1,
  locale: null,
  bounds: {},
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
  'set-bounds': (state, action) => {
    return state.set('bounds', action.get('bounds'));
  },
};

Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  id,
  desktopId,
  sessionStorage,
  next
) {
  const sessionPath = path.join(sessionStorage, id);
  quest.goblin.setX('sessionPath', sessionPath);
  const sessionExist = fs.existsSync(sessionPath);
  if (sessionExist) {
    let session = fs.readFileSync(sessionPath);
    session = JSON.parse(session);
    quest.do({session});
  } else {
    quest.do();
  }

  yield quest.me.initializeBounds({labId: desktopId});
});

Goblin.registerQuest(goblinName, 'set-locale', function*(quest, locale) {
  quest.do({locale});
  yield quest.me.save();
});

Goblin.registerQuest(goblinName, 'get-locale', function(quest) {
  return quest.goblin.getState().get('locale');
});

Goblin.registerQuest(goblinName, 'save', function(quest) {
  fs.writeFileSync(
    quest.goblin.getX('sessionPath'),
    JSON.stringify(quest.goblin.getState().toJS())
  );
});

Goblin.registerQuest(goblinName, 'set-bounds', function*(quest, bounds) {
  quest.do({bounds});
  yield quest.me.save();

  //appConfig.deleteAll();

  /*const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const mainGoblin = clientConfig.mainGoblin;

  appConfig.set(`goblinState.${mainGoblin}.wm`, bounds);*/
});

Goblin.registerQuest(goblinName, 'initialize-bounds', function*(quest, labId) {
  //appConfig.deleteAll();

  /*const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const mainGoblin = clientConfig.mainGoblin;

  if (appConfig.has(`goblinState.${mainGoblin}.wm`)) {
    const bounds = appConfig.get(`goblinState.${mainGoblin}.wm`);

    const wmAPI = quest.getAPI(`wm@${labId}`);
    yield wmAPI.setBounds({bounds});
  }*/

  const bounds = quest.goblin.getState().get('bounds');
  if (bounds) {
    const wmAPI = quest.getAPI(`wm@${labId}`);
    yield wmAPI.setBounds({bounds});
  }
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
