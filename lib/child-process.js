'use strict';
const goblinName = 'child-process';
const Goblin = require('xcraft-core-goblin');

const logicState = {
  executablePath: null,
  executableArguments: {},
};

const logicHandlers = {
  create: (state, action) => {
    return state.set('', {
      id: action.get('id'),
      executablePath: action.get('executablePath'),
      executableArguments: action.get('executableArguments'),
    });
  },
};

/******************************************************************************/

Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  executablePath,
  executableArguments,
  options,
  next
) {
  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    resp: quest.resp,
  });
  quest.do({executablePath, executableArguments});
  try {
    yield xProcess.spawn(executablePath, executableArguments, options, next);
    return true;
  } catch (ex) {
    return false;
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
