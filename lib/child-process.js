'use strict';
const goblinName = 'child-process';
const Goblin = require('xcraft-core-goblin');

const logicState = {};

const logicHandlers = {
  create: (state, action) => {
    return state.set('', {
      id: action.get('id'),
    });
  },
};

/******************************************************************************/

Goblin.registerQuest(goblinName, 'create', function (
  quest,
  executablePath,
  options
) {
  quest.goblin.setX('spawnParams', {
    executablePath,
    options,
  });
  quest.do();
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'spawn', function (
  quest,
  executableArguments,
  additionalOptions
) {
  let {executablePath, options} = quest.goblin.getX('spawnParams');
  const xProcess = require('xcraft-core-process')({
    logger: 'xlog',
    resp: quest.resp,
  });
  if (additionalOptions) {
    options = {...options, ...additionalOptions};
  }
  const spawned = xProcess.spawn(
    executablePath,
    executableArguments,
    options,
    (error) => {
      quest.evt('<child-process-exited>', {
        exitCode: spawned.exitCode,
        error,
      });
    }
  );
  if (spawned.pid) {
    quest.evt('<child-process-spawned>', {
      pid: spawned.pid,
    });
  }
  return spawned.pid;
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
