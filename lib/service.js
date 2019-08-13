'use strict';

const watt = require('gigawatts');
const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

// Define initial logic values
const logicState = {
  zoom: 1,
};

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
  quest.do();

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
    feeds: [labId, 'workshop', 'nabu', 'client'],
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

  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  quest.goblin.defer(
    quest.sub(`${clientConfig.mainGoblin}.desktop.closed`, function*(
      _,
      {msg, resp}
    ) {
      const {data} = msg;
      if (clientConfig.useConfigurator) {
        yield resp.cmd(`${goblinName}.configure`, {
          clientConfig,
          oldDesktopId: data.desktopId,
        });
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
        yield quest.me.reloadLaboratory();
      })
    )
  );

  yield quest.me.loadLaboratory();
  yield quest.sub.wait('*.win.closed');
});

Goblin.registerQuest(goblinName, 'reload-laboratory', function*(quest) {
  const labId = quest.goblin.getX('labId');
  const lab = quest.getAPI(labId);
  const labConfig = quest.goblin.getX('labConfig');
  const {wid, feed} = yield lab.getWinFeed();

  /* Insert the laboratory in the warehouse otherwise the
   * laboratory.create thinks that a laboratory is already creating
   * because the instance already exists. Of course here, the instance
   * exists with the client, but the warehouse is empty.
   */
  yield quest.warehouse.upsert({
    data: {},
    branch: labId,
    parents: labId,
    feeds: feed,
  });
  /* Subscribe to the branches for our laboratory. */
  yield quest.warehouse.subscribe({
    feed,
    branches: [...labConfig.feeds, wid],
  });
  yield quest.me.loadLaboratory();
});

Goblin.registerQuest(goblinName, 'change-server', function*(quest, topology) {
  if (topology && !(yield quest.cmd(`horde.use-topology`, {topology}))) {
    quest.log.warn(
      `we can't change of server because the topology "${topology}" is not available`
    );
    return false;
  }

  const labId = quest.goblin.getX('labId');
  quest.release(labId);

  const reloaded = yield quest.cmd(`horde.reload`, {topology});
  yield quest.me.reloadLaboratory();
  return reloaded;
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
    yield quest.me.configure({clientConfig});
  } else {
    const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
    if (mainGoblin.configureDesktop) {
      yield quest.me.configureDesktop({
        clientConfig,
        labId,
        data: {username: require('os').userInfo().username},
      });
    } else {
      yield mainGoblin.openDesktop({labId});
    }
  }
});

Goblin.registerQuest(goblinName, 'configure-desktop', function*(
  quest,
  clientConfig,
  labId,
  data
) {
  const configuration = data.configuration || {};
  const mandate = configuration.mandate;

  let currentMandate = quest.goblin.getX('mandate');
  if (mandate && !currentMandate && !configuration.topology) {
    currentMandate = mandate;
  }

  if (mandate !== currentMandate || configuration.reset) {
    /* Handle switching of topology, then it will connect to the new server. */
    const topology = quest.goblin.getX('topology');
    if (configuration.topology !== topology) {
      if (yield quest.me.changeServer({topology: configuration.topology})) {
        quest.goblin.setX('topology', configuration.topology);
      } else {
        yield quest.me.configure({clientConfig});
        return;
      }
    } else {
      /* Special case where an other mandate is used with the same server
       * or when a reset must occured.
       * It makes sens only with standalone versions (*-dev for example).
       * In the case of production server, it's forbidden because some entities
       * used the same ID in warehouse (clash) like mandate@main.
       */
      quest.log.warn(`goblin-cache clearing`);
      quest.resp.events.send(`goblin-cache.clear`);
    }
  }

  const lab = quest.getAPI(labId);
  const feed = yield lab.getFeed();
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);

  const _data = yield mainGoblin.configureDesktop(
    Object.assign(data, {labId, feed})
  );

  const prevConfId = quest.goblin.getX('configuratorId');
  if (prevConfId) {
    yield quest.kill(prevConfId, labId);
    const confUnsub = quest.goblin.getX('confUnsub');
    if (confUnsub) {
      confUnsub();
    }
  }

  quest.goblin.setX('mandate', mandate);

  yield lab.listen({desktopId: _data.desktopId});

  const rootWidget = _data.rootWidget;
  const rootWidgetId = _data.rootWidgetId || _data.desktopId;
  yield lab.setRoot({
    widget: rootWidget,
    widgetId: rootWidgetId,
    themeContext: clientConfig.themeContext,
  });
  const contextId = _data.contextId || clientConfig.contextId;
  if (contextId) {
    const desktopAPI = quest.getAPI(_data.desktopId);
    yield desktopAPI.navToContext({contextId});
  }

  if (mainGoblin.afterConfigureDesktop) {
    yield mainGoblin.afterConfigureDesktop({labId, desktopId: _data.desktopId});
  }
});

Goblin.registerQuest(goblinName, 'data-transfer', function*(
  quest,
  labId,
  filePaths
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
  if (mainGoblin.dataTransfer) {
    yield mainGoblin.dataTransfer({
      labId,
      filePaths,
    });
  }
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
    yield lab.unlisten({desktopId: oldDesktopId});
  }

  // CREATE A CONFIGURATOR
  const conf = yield quest.createFor('configurator', labId, confId, {
    id: confId,
    labId,
  });
  const configuratorId = conf.id;
  quest.goblin.setX('configuratorId', configuratorId);

  const id = quest.goblin.id;
  quest.goblin.setX(
    'confUnsub',
    quest.sub(`${conf.id}.configured`, function*(err, {msg, resp}) {
      yield resp.cmd(`${goblinName}.configure-desktop`, {
        id,
        clientConfig,
        labId,
        data: msg.data,
      });
    })
  );

  yield lab.setRoot({
    widgetId: conf.id,
    themeContext: clientConfig.themeContext,
  });
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {
  const confUnsub = quest.goblin.getX('confUnsub');
  if (confUnsub) {
    confUnsub();
  }
});

Goblin.registerQuest(goblinName, 'open-external', function(quest, url) {
  const {shell} = require('electron');
  // Open a URL in the default way
  shell.openExternal(url);
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
