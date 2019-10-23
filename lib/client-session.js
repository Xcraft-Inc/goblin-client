'use strict';

const Goblin = require('xcraft-core-goblin');
const path = require('path');
const fs = require('fs');
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

Goblin.registerQuest(goblinName, 'create', function(quest, id, sessionStorage) {
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

Goblin.registerQuest(goblinName, 'delete', function(quest) {});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
