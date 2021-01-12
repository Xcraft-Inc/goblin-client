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
  const id = quest.goblin.id;
  quest.sub.local(`*::${quest.goblin.id}.<child-process-spawned>`, function* (
    _,
    {msg, resp}
  ) {
    yield resp.cmd(`${goblinName}._spawn`, {
      id,
      ...msg.data,
    });
  });
});

Goblin.registerQuest(goblinName, 'spawn', function (
  quest,
  executableArguments
) {
  quest.evt('<child-process-spawned>', {
    ...quest.goblin.getX('spawnParams'),
    executableArguments,
  });
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
  let error = null;
  try {
    exitCode = yield xProcess.spawn(
      executablePath,
      executableArguments,
      options,
      next
    );
  } catch (ex) {
    error = ex;
  } finally {
    quest.evt('<child-process-exited>', {exitCode, error});
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

/******************************************************************************/

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
