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
  executableArguments,
  options
) {
  quest.goblin.setX('spawnParams', {
    executablePath,
    executableArguments,
    options,
  });
  quest.do();
  const id = quest.goblin.id;
  quest.sub(`${quest.goblin.id}.<child-process-spawned>`, function* (
    _,
    {msg, resp}
  ) {
    yield resp.cmd(`${goblinName}._spawn`, {
      id,
      ...msg.data,
    });
  });
});

Goblin.registerQuest(goblinName, 'spawn', function (quest) {
  quest.evt('<child-process-spawned>', {...quest.goblin.getX('spawnParams')});
});

Goblin.registerQuest(goblinName, '_spawn', function* (
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
  let exitCode;
  let errorOccured = false;
  try {
    exitCode = yield xProcess.spawn(
      executablePath,
      executableArguments,
      options,
      next
    );
  } catch (ex) {
    quest.evt('<child-process-failed>', {ex});
    errorOccured = true;
  } finally {
    if (!errorOccured) {
      quest.evt('<child-process-exited>', {exitCode});
    }
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
