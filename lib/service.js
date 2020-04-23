'use strict';

const watt = require('gigawatts');
const path = require('path');
const {mkdir} = require('xcraft-core-fs');
const fs = require('fs');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');
const xConfig = require('xcraft-core-etc')().load('xcraft');
// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  start: (state) => {
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'boot', function (quest) {});

Goblin.registerQuest(goblinName, 'start', function* (quest, next) {
  quest.log.info(`Starting the secondary quest`);

  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const {app, BrowserWindow} = require('electron');
  quest.do();

  let useDevTools = true;
  try {
    require.resolve('electron-devtools-installer');
  } catch (e) {
    useDevTools = false;
    quest.log.info(`electron devtools not available`);
  }

  if (useDevTools) {
    try {
      const installExtension = require('electron-devtools-installer').default;
      const {
        REACT_DEVELOPER_TOOLS,
        REDUX_DEVTOOLS,
      } = require('electron-devtools-installer');

      yield installExtension(REACT_DEVELOPER_TOOLS, true);
      yield installExtension(REDUX_DEVTOOLS, true);
      console.log('Devtools installed:', BrowserWindow.getDevToolsExtensions());
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

  const feedList = [
    labId,
    clientConfig.mainGoblin,
    'client',
    'nabu',
    'workshop',
    'activity-monitor',
  ];

  const config = {
    feeds: feedList,
    useWS,
    target,
  };
  quest.goblin.setX('labConfig', config);

  if (!url) {
    yield quest.sub.callAndWait(function* () {
      port = yield quest.cmd('webpack.server.start', {
        goblin: 'laboratory',
        mainGoblinModule: clientConfig.mainGoblinModule,
        jobId: quest.goblin.id,
        port,
        options: {
          indexFile: useWS ? 'index-browsers.js' : 'index-electron.js',
          target,
          autoinc: true,
        },
      });
    }, `webpack.${quest.goblin.id}.done`);
  }

  if (usePack && url) {
    yield quest.cmd('webpack.pack', {
      goblin: 'laboratory',
      mainGoblinModule: clientConfig.mainGoblinModule,
      jobId: quest.goblin.id,
      outputPath: path.join(__dirname, '../../../../dist'),
      options: {
        sourceMap: true,
        indexFile: useWS ? 'index-browsers.js' : 'index-electron.js',
        target,
      },
    });
  }

  url = url || `http://localhost:${port}`;
  quest.goblin.setX('windowURL', url);

  quest.goblin.defer(
    quest.sub(`*::${clientConfig.mainGoblin}.desktop.leaved`, function* (
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
      watt(function* () {
        yield quest.me.reloadLaboratory();
      })
    )
  );

  yield quest.me.loadLaboratory();
  app.on('window-all-closed', () => {
    console.log('Close app requested!');
    quest.log.info('Close app requested!');
    quest.evt('close-app-requested');
  });
  yield quest.sub.wait(`*::client.close-app-requested`);
  console.log(`Exiting app ${clientConfig.mainGoblin}...`);
  quest.log.info(`Exiting app ${clientConfig.mainGoblin}...`);
});

Goblin.registerQuest(goblinName, 'reload-laboratory', function* (quest) {
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

Goblin.registerQuest(goblinName, 'change-server', function* (quest, topology) {
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

Goblin.registerQuest(goblinName, 'load-laboratory', function* (quest) {
  const labId = quest.goblin.getX('labId');
  const config = quest.goblin.getX('labConfig');
  const url = quest.goblin.getX('windowURL');

  let username = require('os').userInfo().username;
  let userId = username;
  const desktopId = labId;
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');

  ///CLIENT SESSION HANDLING
  const {getAppData} = require('xcraft-core-utils').os;
  const sessionStorage = path.join(getAppData(), 'epsitec');
  mkdir(sessionStorage);
  const files = fs.readdirSync(sessionStorage);
  let clientSessionId;
  for (const file of files) {
    if (file.startsWith('client-session@')) {
      //filename is the identifier
      clientSessionId = file.replace('.db', '');
      break;
    }
  }
  if (!clientSessionId) {
    //create new session for this machine (will be persisted on app dispose)
    clientSessionId = `client-session@${quest.uuidV4()}`;
  }

  //client specific subs
  quest.goblin.defer(
    quest.sub(`*::*.${clientSessionId}.user-locale-changed`, function* (
      _,
      {msg, resp}
    ) {
      yield resp.cmd(`${goblinName}.change-locale`, {...msg.data});
    })
  );

  quest.goblin.defer(
    quest.sub(`*::*.${clientSessionId}.open-session-requested`, function* (
      _,
      {msg, resp}
    ) {
      yield resp.cmd(`${goblinName}.open-session`, {...msg.data});
    })
  );

  // CREATE A LAB
  yield quest.createFor('laboratory', labId, labId, {
    id: labId,
    desktopId,
    clientSessionId,
    url,
    config,
  });

  yield quest.create('client-session', {
    id: clientSessionId,
    desktopId: labId,
    sessionStorage,
  });
  quest.goblin.setX('clientSessionId', clientSessionId);

  if (process.versions.electron) {
    const {app} = require('electron');
    let locale = app.getLocale();
    if (locale.length === 2) {
      locale += '-CH';
    }
    yield quest.me.trySetLocale({locale});
  }

  if (clientConfig.useLogin) {
    const {token, info} = yield quest.me.login({
      desktopId,
      clientSessionId,
      clientConfig,
    });
    if (token.status === 'cancelled') {
      const labAPI = quest.getAPI(labId);
      yield labAPI.close();
      return;
    } else {
      console.dir(info.toJS());
      username = info.get('login');
      userId = info.get('sub').replace('uid.', '');
    }
  }

  if (clientConfig.useConfigurator) {
    yield quest.me.configure({
      desktopId,
      userId,
      username,
      clientSessionId,
      clientConfig,
    });
  } else {
    const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
    if (mainGoblin.configureDesktop) {
      yield quest.me.configureDesktop({
        clientConfig,
        labId,
        desktopId,
        clientSessionId,
        data: {username, userId},
      });
    } else {
      yield mainGoblin.openDesktop({labId, desktopId, clientSessionId});
    }
  }
});

Goblin.registerQuest(goblinName, 'configure-desktop', function* (
  quest,
  clientConfig,
  labId,
  desktopId,
  clientSessionId,
  data
) {
  const configuration = data.configuration || {};
  const mandate = configuration.mandate;

  let currentMandate = quest.goblin.getX('mandate');
  if (mandate && !currentMandate && !configuration.topology) {
    currentMandate = mandate;
  }

  if (mandate !== currentMandate || configuration.action === 'reset') {
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
  yield lab.setFeed({desktopId});
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);

  const configuredDesktop = yield mainGoblin.configureDesktop(
    Object.assign(data, {labId, desktopId, clientSessionId})
  );

  if (configuredDesktop.localeName) {
    const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
    yield clientSessionApi.setLocale({locale: configuredDesktop.localeName});
  }

  if (configuredDesktop.desktopId !== desktopId) {
    yield lab.setFeed({desktopId: configuredDesktop.desktopId});
  }

  const prevConfId = quest.goblin.getX('configuratorId');
  if (prevConfId) {
    //yield quest.kill(prevConfId, labId);
    //const confUnsub = quest.goblin.getX('confUnsub');
    //if (confUnsub) {
    //  confUnsub();
    //}
  }

  quest.goblin.setX('mandate', mandate);

  yield lab.listen({desktopId: configuredDesktop.desktopId});

  const rootWidget = configuredDesktop.rootWidget;
  const rootWidgetId =
    configuredDesktop.rootWidgetId || configuredDesktop.desktopId;
  yield lab.setRoot({
    widget: rootWidget,
    widgetId: rootWidgetId,
    themeContext: clientConfig.themeContext,
  });
  const contextId = configuredDesktop.contextId || clientConfig.contextId;
  if (contextId) {
    const desktopAPI = quest.getAPI(configuredDesktop.desktopId);
    yield desktopAPI.navToContext({contextId});
  }

  if (mainGoblin.afterConfigureDesktop) {
    yield mainGoblin.afterConfigureDesktop({
      labId,
      desktopId: configuredDesktop.desktopId,
    });
  }
});

Goblin.registerQuest(goblinName, 'data-transfer', function* (
  quest,
  labId,
  desktopId,
  filePaths
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
  if (mainGoblin.dataTransfer) {
    const result = yield mainGoblin.dataTransfer({
      labId,
      desktopId,
      filePaths,
    });

    if (result.accepted) {
      const destAPI = quest.getAPI(result.goblin);
      const stream = require('fs').createReadStream;
      const filePath = filePaths[0];
      if (fs.existsSync(filePath)) {
        let file = stream(filePath);
        yield destAPI[result.quest]({
          desktopId,
          xcraftUpload: file,
          localFilePath: filePath,
        });
      }
    }
  }
});

Goblin.registerQuest(goblinName, 'login', function* (
  quest,
  desktopId,
  clientSessionId,
  clientConfig
) {
  const hubName = 'dispatch-central-hub';
  const hubUrl = 'https://partout.cresus.ch/passport/v1/' + hubName;
  const hubAPI = yield quest.createNew('passport-provider', {
    desktopId,
    provideId: hubName,
    authorizationUrl: hubUrl,
  });
  quest.goblin.setX('passport-provider', hubAPI.id);
  const passportRootStorage = path.join(xConfig.xcraftRoot, 'var/passport');
  require('xcraft-core-fs').mkdir(passportRootStorage);
  const tokenFile = path.join(passportRootStorage, 'refresh.tkn');
  const refreshTokenExist = fs.existsSync(tokenFile);

  let mustRenew = true;
  let token;
  if (refreshTokenExist) {
    const refreshToken = fs.readFileSync(tokenFile);
    token = yield hubAPI.refreshToken({
      refreshToken: refreshToken.toString(),
    });
    if (token.status === 'renewed') {
      mustRenew = false;
    }
  }

  if (mustRenew) {
    const labId = quest.goblin.getX('labId');
    const frameId = `passport-frame@${quest.uuidV4()}`;
    const lab = quest.getAPI(labId);

    const conf = yield quest.createFor('passport-frame', labId, frameId, {
      id: frameId,
      desktopId,
      labId,
    });

    yield lab.setRoot({
      widgetId: conf.id,
      themeContext: clientConfig.themeContext,
    });

    const nonce = quest.uuidV4();
    token = yield hubAPI.requestToken({
      nonce,
      loginQuest: {
        goblinName: 'passport-frame',
        goblinId: frameId,
        goblinQuest: 'start',
      },
    });
    switch (token.status) {
      case 'renewed': {
        fs.writeFileSync(tokenFile, token.refreshToken);
      }
    }
  }
  const info = yield hubAPI.getTokenInfo();
  return {info, token};
});

Goblin.registerQuest(goblinName, 'configure', function* (
  quest,
  desktopId,
  userId,
  username,
  clientSessionId,
  clientConfig,
  oldDesktopId
) {
  const labId = quest.goblin.getX('labId');

  const lab = quest.getAPI(labId);
  if (oldDesktopId) {
    yield lab.unlisten({desktopId: oldDesktopId});
    yield lab.setFeed({desktopId: labId});
    desktopId = labId;
  }

  let configuratorId = quest.goblin.getX('configuratorId');
  if (!configuratorId) {
    // CREATE A NEW CONFIGURATOR
    configuratorId = `configurator@${quest.uuidV4()}`;
    const conf = yield quest.createFor('configurator', labId, configuratorId, {
      id: configuratorId,
      clientSessionId,
      desktopId,
      labId,
      userId,
      username,
    });
    configuratorId = conf.id;
    quest.goblin.setX('configuratorId', configuratorId);
    const id = quest.goblin.id;
    quest.goblin.setX(
      'confUnsub',
      quest.sub(`${conf.id}.configured`, function* (err, {msg, resp}) {
        const {username, session, configuration} = msg.data;
        const mandate = configuration.mandate;
        const desktopId = `desktop@${mandate}@${session}`;
        yield resp.cmd(`${goblinName}.open-session`, {
          id,
          desktopId,
          mandate,
          username,
          configuration: msg.data.configuration,
        });
      })
    );
  }

  yield lab.setRoot({
    widgetId: configuratorId,
    themeContext: clientConfig.themeContext,
  });
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {
  const confUnsub = quest.goblin.getX('confUnsub');
  if (confUnsub) {
    confUnsub();
  }
});

Goblin.registerQuest(goblinName, 'get-config', function (quest) {
  return require('xcraft-core-etc')().load('goblin-client');
});

Goblin.registerQuest(goblinName, 'open-session', function* (
  quest,
  desktopId,
  mandate,
  session,
  username,
  rootWidget,
  configuration,
  mainGoblin
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const clientSessionId = quest.goblin.getX('clientSessionId');
  const labId = `laboratory@${quest.uuidV4()}`;
  const config = quest.goblin.getX('labConfig');
  const url = quest.goblin.getX('windowURL');
  const lab = yield quest.createFor('laboratory', labId, labId, {
    id: labId,
    desktopId,
    clientSessionId,
    url,
    config,
  });
  yield lab.listen({desktopId: desktopId});
  yield lab.setFeed({desktopId: desktopId});

  if (!mainGoblin) {
    //use clientConfig for resolving API
    mainGoblin = quest.getAPI(clientConfig.mainGoblin);
  } else {
    //resolve to API
    mainGoblin = quest.getAPI(mainGoblin);
  }

  const data = {configuration, session, username};
  const configuredDesktop = yield mainGoblin.configureDesktop(
    Object.assign(data, {labId, clientSessionId, desktopId})
  );

  if (configuredDesktop.desktopId !== desktopId) {
    yield lab.setFeed({desktopId: configuredDesktop.desktopId});
  }

  if (!rootWidget) {
    rootWidget = desktopId.split('@')[0];
  }

  const rootWidgetId = desktopId;
  yield lab.setRoot({
    widget: rootWidget,
    widgetId: rootWidgetId,
    themeContext: clientConfig.themeContext,
  });
  yield quest.warehouse.resend({feed: desktopId});
  const id = quest.goblin.id;
  quest.goblin.setX(
    `${desktopId}-closedUnsub`,
    quest.sub(`*::*.${desktopId}.closed`, function* (err, {resp}) {
      yield resp.cmd(`${goblinName}.close-session`, {
        id,
        session: desktopId,
        labId,
      });
    })
  );
});

Goblin.registerQuest(goblinName, 'close-session', function* (
  quest,
  labId,
  session
) {
  const unSub = quest.goblin.getX(`${session}-closedUnsub`);
  if (unSub) {
    unSub();
  }

  const labAPI = quest.getAPI(labId);
  const labExist = yield quest.warehouse.get({path: labId});
  if (labExist) {
    yield labAPI.closeWindow({winId: `wm@${labId}`});
  }

  yield quest.me.killSession({session});
});

Goblin.registerQuest(goblinName, 'kill-session', function* (quest, session) {
  yield quest.warehouse.feedSubscriptionDel({
    feed: session,
    branch: session,
    parents: session,
  });
  yield quest.warehouse.unsubscribe({feed: session});
});

Goblin.registerQuest(goblinName, 'open-external', function (quest, url) {
  const {shell} = require('electron');
  // Open a URL in the default way
  if (require('url').parse(url).protocol) {
    shell.openExternal(url);
  } else {
    shell.openItem(url);
  }
});

Goblin.registerQuest(goblinName, 'try-set-locale', function* (quest, locale) {
  const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
  const existingLocale = yield clientSessionApi.getLocale();
  if (!existingLocale) {
    yield clientSessionApi.setLocale({locale});
  }
});

Goblin.registerQuest(goblinName, 'change-locale', function* (quest, locale) {
  const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
  yield clientSessionApi.setLocale({locale});
});

Goblin.registerQuest(goblinName, 'get-locale', function* (quest) {
  const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
  return yield clientSessionApi.getLocale();
});

Goblin.registerQuest(goblinName, 'save-app-settings', function* (
  quest,
  action,
  payload
) {
  const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
  yield clientSessionApi.saveAppSettings({action, payload});
});

Goblin.registerQuest(goblinName, 'load-app-settings', function* (
  quest,
  action
) {
  const clientSessionApi = quest.getAPI(quest.goblin.getX('clientSessionId'));
  return yield clientSessionApi.loadAppSettings({action});
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
