'use strict';

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

  // CREATE A LAB
  yield quest.createFor('laboratory', labId, labId, {
    id: labId,
    url,
    config,
  });

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
  yield quest.sub.wait('*.win.closed');
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
  yield mainGoblin.configureDesktop(
    Object.assign(data, {labId, feed}),
    (err, data) => {
      lab.listen(data);
      lab.setRoot(
        {
          widgetId: data.desktopId,
        },
        () => {
          quest.cmd(`desktop.nav-to-context`, {
            id: data.desktopId,
            contextId: clientConfig.contextId,
          });
        }
      );
    }
  );
});

Goblin.registerQuest(goblinName, 'configure', function*(
  quest,
  clientConfig,
  oldDesktopId
) {
  const confUnsub = quest.goblin.getX('confUnsub');
  if (confUnsub) {
    confUnsub();
  }
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
