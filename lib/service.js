'use strict';

const watt = require('gigawatts');
const path = require('path');
const {mkdir} = require('xcraft-core-fs');
const fs = require('fs');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');
const xConfig = require('xcraft-core-etc')().load('xcraft');
const {locks} = require('xcraft-core-utils');

// Define initial logic values
const logicState = {
  private: {
    desktopByLab: {},
    labByDesktop: {},
  },
};

// Define logic handlers according rc.json
const logicHandlers = {
  'start': (state) => {
    return state;
  },
  'open-session': (state, action) => {
    const desktopId = action.get('desktopId');
    const labId = action.get('labId');
    return state
      .set(`private.desktopByLab.${labId}`, desktopId)
      .set(`private.labByDesktop.${desktopId}`, labId);
  },
  'close-window': (state, action) => {
    const labId = action.get('labId');
    const desktopId = state.get(`private.desktopByLab.${labId}`);
    return state
      .del(`private.desktopByLab.${labId}`)
      .del(`private.labByDesktop.${desktopId}`);
  },
};

const sessionOps = locks.getMutex;

function getBaseFeeds(labId, mainGoblin) {
  return [labId, mainGoblin, 'client', 'nabu', 'workshop'];
}

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'boot', function (quest) {});

Goblin.registerQuest(goblinName, 'start', function* (
  quest,
  clientConfig,
  next
) {
  quest.log.info(`Starting the secondary quest`);

  if (!clientConfig) {
    clientConfig = require('xcraft-core-etc')().load('goblin-client');
  }
  quest.goblin.setX('clientConfig', clientConfig);

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
    process.env.NODE_ENV === 'development'
      ? null
      : 'file://' + path.join(__dirname, '../../../dist/index.html');

  let port = 4000;
  const useWS = target !== 'electron-renderer';
  const usePack = false;

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

  yield quest.me.loadLaboratory({useWS, target});
  app.on('window-all-closed', () => {
    quest.log.dbg('Close app requested!');
    quest.evt('close-app-requested');
  });
  yield quest.sub.wait(`*::client.close-app-requested`);
  quest.log.dbg(`Exiting app ${clientConfig.mainGoblin}...`);
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

Goblin.registerQuest(goblinName, 'createSession', function* (
  quest,
  mainGoblin,
  labId
) {
  ///CLIENT SESSION HANDLING
  const {appCompany, appData} = require('xcraft-core-host');
  const sessionStorage = path.join(appData, appCompany);
  mkdir(sessionStorage);
  let files = fs.readdirSync(sessionStorage);
  let clientSessionId;
  const sessionVersion = 2;

  files = files.filter(
    (file) =>
      file.startsWith('client-session@') &&
      file.endsWith(`-v${sessionVersion}.db`)
  );
  if (files.length) {
    clientSessionId = files[0].replace(/\.db$/, `§${mainGoblin}`);
  }

  if (!clientSessionId) {
    //create new session for this machine (will be persisted on app dispose)
    clientSessionId = `client-session@${quest.uuidV4()}-v${sessionVersion}§${mainGoblin}`;
  }

  quest.goblin.setX('clientSessionNs', clientSessionId.replace(/§.+$/, ''));

  //client specific subs
  quest.goblin.defer(
    quest.sub(`*::*.${clientSessionId}.user-locale-changed`, function* (
      _,
      {msg, resp}
    ) {
      yield resp.cmd(`${goblinName}.change-locale`, {
        clientSessionId,
        ...msg.data,
      });
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

  quest.goblin.defer(
    quest.sub(`*::*.${clientSessionId}.run-client-quest-requested`, function* (
      _,
      {msg, resp}
    ) {
      const {desktopId, goblinName, goblinId, questName, questArgs} = msg.data;
      if (resp.hasCommand(`${goblinName}.${questName}`)) {
        yield resp.cmd(`${goblinName}.${questName}`, {
          id: goblinId,
          desktopId,
          clientSessionId,
          ...questArgs,
        });
      }
    })
  );

  // CREATE SESSION SERVICE
  yield quest.create('client-session', {
    id: clientSessionId,
    desktopId: labId,
    sessionStorage,
  });

  return clientSessionId;
});

Goblin.registerQuest(goblinName, 'load-laboratory', function* (
  quest,
  useWS,
  target
) {
  const url = quest.goblin.getX('windowURL');

  let username = require('os').userInfo().username;
  let userId = username;
  const clientConfig = quest.goblin.getX('clientConfig');

  const labId = `laboratory@${quest.uuidV4()}`;
  quest.goblin.setX('labId', labId);

  const mainGoblin = clientConfig.mainGoblin;

  const clientSessionId = yield quest.me.createSession({
    mainGoblin,
    labId,
  });

  const config = {
    feeds: getBaseFeeds(labId, mainGoblin),
    useWS,
    target,
    themeContexts: clientConfig.themeContexts,
  };
  quest.goblin.setX('labConfig', config);

  // CREATE A LAB
  yield quest.createFor('laboratory', labId, labId, {
    id: labId,
    desktopId: labId,
    clientSessionId,
    url,
    config,
  });

  if (process.versions.electron) {
    const {app} = require('electron');
    let locale = app.getLocale();
    if (locale.length === 2) {
      locale += '-CH';
    }
    yield quest.me.trySetLocale({locale, clientSessionId});
  }

  if (clientConfig.useLogin) {
    const {token, info} = yield quest.me.login({
      desktopId: labId,
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
      desktopId: labId,
      userId,
      username,
      clientSessionId,
      clientConfig,
    });
  } else {
    yield quest.me.startDesktopAppSession({
      session: `${username}-${quest.uuidV4()}`,
      username,
      labId,
      clientSessionId,
      desktopId: labId,
      mainGoblin: clientConfig.mainGoblin,
    });
  }
});

Goblin.registerQuest(goblinName, 'configureDesktop', function* (
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
      themeContext: clientConfig.themeContexts[0],
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
    yield lab.setFeed({desktopId: labId});
    desktopId = labId;
  }

  yield lab.listen({desktopId});

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
        yield resp.cmd(`${goblinName}.open-session`, {
          id,
          session,
          username,
          configuration,
          mainGoblin: configuration.mainGoblin,
        });
      })
    );
  }

  yield lab.setRoot({
    widgetId: configuratorId,
    themeContext: clientConfig.themeContexts[0],
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

Goblin.registerQuest(goblinName, 'close-window', function (quest, labId) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'open-session', function* (
  quest,
  session,
  username,
  rootWidget,
  configuration,
  mainGoblin,
  mandate
) {
  if (!mainGoblin) {
    throw new Error(
      `The 'mainGoblin' is mandatory in your configurator profile`
    );
  }

  if (!mandate) {
    mandate = mainGoblin;
  }

  const mainGoblinAPI = quest.getAPI(mainGoblin);
  if (mainGoblinAPI.getMandate) {
    mandate = yield mainGoblinAPI.getMandate();
    quest.log.dbg(`"${mainGoblin}" app provided "${mandate}" mandate`);
  } else {
    quest.log.dbg(
      `fallback to the main goblin "${mainGoblin}" for the mandate`
    );
  }

  const desktopId = `desktop@${mandate}@${session}`;

  const existingLabId = quest.goblin
    .getState()
    .get(`private.labByDesktop.${desktopId}`);

  if (existingLabId) {
    yield sessionOps.lock(existingLabId);
    quest.defer(() => sessionOps.unlock(existingLabId));

    const wmAPI = quest.getAPI(`wm@${existingLabId}`);
    yield wmAPI.moveToFront();
    return;
  }

  const labId = `laboratory@${quest.uuidV4()}`;
  const config = quest.goblin.getX('labConfig');

  yield sessionOps.lock(labId);
  quest.defer(() => sessionOps.unlock(labId));

  const clientSessionId = yield quest.me.createSession({
    mainGoblin,
    labId,
  });

  config.title = `${mainGoblin} - ${username}`;
  config.feeds = getBaseFeeds(labId, mainGoblin);

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

  quest.do({desktopId, labId});

  yield quest.me.startDesktopAppSession({
    rootWidget,
    configuration,
    session,
    username,
    labId,
    clientSessionId,
    desktopId,
    mainGoblin,
  });
});

Goblin.registerQuest(goblinName, 'startDesktopAppSession', function* (
  quest,
  rootWidget,
  configuration,
  session,
  username,
  labId,
  clientSessionId,
  desktopId,
  mainGoblin
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');

  let mainGoblinAPI;
  if (!mainGoblin) {
    mainGoblin = clientConfig.mainGoblin;
  }
  mainGoblinAPI = quest.getAPI(mainGoblin);

  const lab = quest.getAPI(labId);

  if (labId === desktopId) {
    desktopId = `desktop@${mainGoblin}@${session}`;
    yield lab.setFeed({desktopId});
  }

  yield lab.listen({desktopId});

  const configuredDesktop = yield mainGoblinAPI.configureDesktop({
    configuration,
    session,
    username,
    labId,
    clientSessionId,
    desktopId,
  });

  const deskManager = quest.getAPI('desktop-manager');
  yield deskManager.open({
    clientSessionId,
    labId,
    sessionDesktopId: desktopId,
    session,
    username,
    mainGoblin,
    configuration,
  });

  if (!rootWidget) {
    if (configuredDesktop.rootWidget) {
      rootWidget = configuredDesktop.rootWidget;
    } else {
      rootWidget = desktopId.split('@')[0];
    }
  }

  let themeContext =
    configuredDesktop.themeContext || clientConfig.themeContexts[0];
  const themeConfig = require('xcraft-core-etc')().load('goblin-theme');
  if (themeConfig.compositions[configuredDesktop.defaultTheme]) {
    themeContext =
      themeConfig.compositions[configuredDesktop.defaultTheme].themeContexts[0];
  }

  const rootWidgetId = configuredDesktop.rootWidgetId || desktopId;
  yield lab.setRoot({
    widget: rootWidget,
    widgetId: rootWidgetId,
    themeContext,
  });

  if (mainGoblinAPI.afterConfigureDesktop) {
    yield mainGoblinAPI.afterConfigureDesktop({
      labId,
      desktopId,
    });
  }

  yield quest.warehouse.resend({feed: desktopId});
  const id = quest.goblin.id;

  const unsub = quest.goblin.getX(`${desktopId}-closedUnsub`);
  if (unsub) {
    unsub();
  }
  quest.goblin.setX(
    `${desktopId}-closedUnsub`,
    quest.sub(`*::desktop-manager.${desktopId}.closed`, function* (
      err,
      {resp}
    ) {
      yield resp.cmd(`${goblinName}.close-session`, {
        id,
        sessionDesktopId: desktopId,
        labId,
      });
    })
  );
});

Goblin.registerQuest(goblinName, 'close-session', function* (
  quest,
  labId,
  sessionDesktopId
) {
  yield sessionOps.lock(labId);
  quest.defer(() => sessionOps.unlock(labId));

  const unSub = quest.goblin.getX(`${sessionDesktopId}-closedUnsub`);
  if (unSub) {
    unSub();
  }

  const labAPI = quest.getAPI(labId);
  const labExist = yield quest.warehouse.get({path: labId});
  if (labExist) {
    yield labAPI.closeWindow({winId: `wm@${labId}`});
  }
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

Goblin.registerQuest(goblinName, 'try-set-locale', function* (
  quest,
  locale,
  mainGoblin,
  clientSessionId
) {
  if (!clientSessionId) {
    clientSessionId = `${quest.goblin.getX('clientSessionNs')}§${mainGoblin}`;
  }
  const clientSessionApi = quest.getAPI(clientSessionId);
  const existingLocale = yield clientSessionApi.getLocale();
  if (!existingLocale) {
    yield clientSessionApi.setLocale({locale});
  }
});

Goblin.registerQuest(goblinName, 'change-locale', function* (
  quest,
  locale,
  mainGoblin,
  clientSessionId
) {
  if (!clientSessionId) {
    clientSessionId = `${quest.goblin.getX('clientSessionNs')}§${mainGoblin}`;
  }
  const clientSessionApi = quest.getAPI(clientSessionId);
  yield clientSessionApi.setLocale({locale});
});

Goblin.registerQuest(goblinName, 'get-locale', function* (
  quest,
  mainGoblin,
  clientSessionId
) {
  if (!clientSessionId) {
    clientSessionId = `${quest.goblin.getX('clientSessionNs')}§${mainGoblin}`;
  }
  const clientSessionApi = quest.getAPI(clientSessionId);
  return yield clientSessionApi.getLocale();
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
