'use strict';

const watt = require('gigawatts');
const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  start: state => {
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'boot', function(quest) {
  quest.log.info(`Starting the main quest`);
});

Goblin.registerQuest(goblinName, 'start', function*(quest) {
  quest.log.info(`Starting the secondary quest`);

  const clientConfig = require('xcraft-core-etc')().load('goblin-client');

  if (process.env.XCRAFT_APPENV !== 'release') {
    try {
      const installExtension = require('electron-devtools-installer').default;
      const {
        REACT_DEVELOPER_TOOLS,
        REACT_PERF,
        REDUX_DEVTOOLS,
      } = require('electron-devtools-installer');

      installExtension(REACT_DEVELOPER_TOOLS)
        .then(name => quest.log.verb(`added Extension: ${name}`))
        .catch(err => quest.log.err('an error occurred: %s', err));
      installExtension(REACT_PERF)
        .then(name => quest.log.verb(`added Extension: ${name}`))
        .catch(err => quest.log.err('an error occurred: %s', err));
      installExtension(REDUX_DEVTOOLS)
        .then(name => quest.log.verb(`added Extension: ${name}`))
        .catch(err => quest.log.err('an error occurred: %s', err));

      require('devtron').install();
    } catch (ex) {
      quest.log.warn(ex.stack || ex);
    }
  }

  //SETUP
  const target = process.versions.electron ? 'electron-renderer' : 'node';
  let url =
    process.env.NODE_ENV === 'production'
      ? 'file://' + path.join(__dirname, '../../../dist/index.html')
      : null;

  const labId = `laboratory@${quest.uuidV4()}`;
  quest.goblin.setX('labId', labId);

  let port = 4000;
  const useWS = target !== 'electron-renderer';
  const usePack = false;

  const config = {
    feeds: [labId, 'workshop', 'nabu', 'tx'],
    useWS,
    target,
  };
  quest.goblin.setX('labConfig', config);

  if (!url) {
    port = yield quest.cmd('webpack.server.start', {
      goblin: 'laboratory',
      jobId: quest.goblin.id,
      port,
      options: {
        indexFile: useWS ? 'index-browsers.js' : 'index-electron.js',
        target,
        autoinc: true,
      },
    });
  }

  if (usePack && url) {
    yield quest.cmd('webpack.pack', {
      goblin: 'laboratory',
      jobId: quest.goblin.id,
      outputPath: path.join(__dirname, '../../../../dist'),
      options: {
        sourceMap: true,
        indexFile: useWS ? 'index-browsers.js' : 'index-electron.js',
        target,
      },
    });
  }

  if (usePack || !url) {
    quest.log.info(`Waiting for webpack goblin`);
    yield quest.sub.wait(`webpack.${quest.goblin.id}.done`);
  }

  url = url || `http://localhost:${port}`;
  quest.goblin.setX('windowURL', url);

  quest.goblin.defer(
    quest.sub(`${clientConfig.mainGoblin}.desktop.closed`, (_, {data}) => {
      for (const wk in data.workitems) {
        quest.release(wk);
      }
      if (clientConfig.useConfigurator) {
        quest.me.configure({clientConfig, oldDesktopId: data.desktopId});
      }
    })
  );

  /* Add laboratory "reload" handling when the remote server has a new token.
   * It means that a restart has occured.
   * FIXME: This code doesn't check that the restart comes from the server
   *        which load warehouse. We consider that the whole horde has
   *        restarted.
   */
  quest.goblin.defer(
    quest.resp.onTokenChanged(
      watt(function*() {
        const lab = quest.getAPI(labId);
        const winFeed = yield lab.getWinFeed();

        /* Insert the laboratory in the warehouse otherwise the
         * laboratory.create thinks that a laboratory is already creating
         * because the instance already exists. Of course here, the instance
         * exists with the client, but the warehouse is empty.
         */
        yield quest.warehouse.upsert({
          data: {},
          branch: labId,
          createdBy: labId,
        });
        /* Subscribe to the branches for our laboratory. */
        yield quest.warehouse.subscribe({
          feed: winFeed.feed,
          branches: [...config.feeds, winFeed.wid],
        });
        yield quest.me.loadLaboratory();
      })
    )
  );

  yield quest.me.loadLaboratory();
  yield quest.sub.wait('*.win.closed');
});

Goblin.registerQuest(goblinName, 'load-laboratory', function*(quest) {
  const labId = quest.goblin.getX('labId');
  const config = quest.goblin.getX('labConfig');
  const url = quest.goblin.getX('windowURL');

  // CREATE A LAB
  yield quest.createFor('laboratory', labId, labId, {
    id: labId,
    url,
    config,
  });

  const clientConfig = require('xcraft-core-etc')().load('goblin-client');

  if (clientConfig.useConfigurator) {
    quest.me.configure({clientConfig});
  } else {
    const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
    if (mainGoblin.configureDesktop) {
      quest.me.configureDesktop({
        clientConfig,
        labId,
        data: {username: require('os').userInfo().username},
      });
    } else {
      mainGoblin.openDesktop({labId});
    }
  }
});

Goblin.registerQuest(goblinName, 'configure-desktop', function*(
  quest,
  clientConfig,
  labId,
  data
) {
  const lab = quest.getAPI(labId);
  const feed = yield lab.getFeed();
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
  const _data = yield mainGoblin.configureDesktop(
    Object.assign(data, {labId, feed})
  );

  const prevConfId = quest.goblin.getX('configuratorId');
  if (prevConfId) {
    quest.kill(prevConfId, labId);
    const confUnsub = quest.goblin.getX('confUnsub');
    if (confUnsub) {
      confUnsub();
    }
  }

  lab.listen(_data);
  lab.setRoot({widgetId: _data.desktopId}, () => {
    quest.cmd(`desktop.nav-to-context`, {
      id: _data.desktopId,
      contextId: clientConfig.contextId,
    });
  });
});

Goblin.registerQuest(goblinName, 'configure', function*(
  quest,
  clientConfig,
  oldDesktopId
) {
  const labId = quest.goblin.getX('labId');
  const confId = `configurator@${quest.uuidV4()}`;

  const lab = quest.getAPI(labId);
  if (oldDesktopId) {
    lab.unlisten({desktopId: oldDesktopId});
  }

  // CREATE A CONFIGURATOR
  const conf = yield quest.createFor('configurator', labId, confId, {
    id: confId,
    labId,
  });
  const configuratorId = conf.id;
  quest.goblin.setX('configuratorId', configuratorId);

  quest.goblin.setX(
    'confUnsub',
    quest.sub(`${conf.id}.configured`, (err, msg) => {
      quest.me.configureDesktop({clientConfig, labId, data: msg.data});
    })
  );

  yield lab.setRoot({widgetId: conf.id});
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {
  const confUnsub = quest.goblin.getX('confUnsub');
  if (confUnsub) {
    confUnsub();
  }
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
