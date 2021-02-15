'use strict';

const watt = require('gigawatts');
const path = require('path');
const {mkdir} = require('xcraft-core-fs');
const fs = require('fs');
const cloneDeep = require('lodash/cloneDeep');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');
const xConfig = require('xcraft-core-etc')().load('xcraft');
const {locks} = require('xcraft-core-utils');
const {appArgs} = require('xcraft-core-host');

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

function getBaseFeeds(mainGoblin) {
  return [
    mainGoblin,
    'client',
    'goblin',
    'nabu',
    'workshop',
    'activity-monitor-led',
    'desktop-manager',
  ];
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

  const {app, session} = require('electron');

  //Windows10: AppUserModelId
  global.appUserModelId = null;
  const os = require('os');
  if (os.type() === 'Windows_NT' && clientConfig.appUserModelId) {
    global.appUserModelId = clientConfig.appUserModelId;
    app.setAppUserModelId(global.appUserModelId);
    quest.log.dbg(`${global.appUserModelId} set`);
  }

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
      const {
        default: installExtension,
        REACT_DEVELOPER_TOOLS,
        REDUX_DEVTOOLS,
      } = require('electron-devtools-installer');

      yield installExtension(REACT_DEVELOPER_TOOLS, true);
      yield installExtension(REDUX_DEVTOOLS, true);
      const devtoolsInstalled = session.defaultSession.getAllExtensions();
      console.log(
        'Devtools installed:',
        devtoolsInstalled.map((item) => {
          const {manifest, ...displayedProps} = item;
          return displayedProps;
        })
      );
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
          indexFile: useWS ? 'index-electron-ws.js' : 'index-electron.js',
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

  /* FIXME: This code doesn't check that the restart comes from the server
   *        which load warehouse. We consider that the whole horde has
   *        restarted.
   */
  quest.goblin.defer(
    quest.resp.onTokenChanged(
      watt(function* () {
        yield quest.me.appRelaunch({reason: 'server-restart'});
      })
    )
  );

  quest.goblin.defer(
    quest.resp.onOrcnameChanged(
      watt(function* () {
        yield quest.me.appRelaunch({reason: 'client-connection'});
      })
    )
  );

  quest.goblin.defer(
    quest.resp.onReconnect((status) => {
      switch (status) {
        case 'attempt':
          quest.log.warn(
            'Connection lost with the server, attempt a reconnection'
          );
          break;
        case 'done':
          quest.log.dbg('New connection done');
          break;
      }
    })
  );

  yield quest.me.loadLaboratory({useWS, target});
  app.on('window-all-closed', () => {
    quest.log.dbg('Close app requested!');
    quest.evt('<close-app-requested>');
  });
  yield quest.sub.localWait(`*::client.<close-app-requested>`);
  quest.log.dbg(`Exiting app ${clientConfig.mainGoblin}...`);
});

Goblin.registerQuest(goblinName, 'appRelaunch', function (quest, reason) {
  quest.log.warn('Relaunch app because the socket was lost...');

  const desktopIds = quest.goblin
    .getState()
    .get('private.labByDesktop')
    .keySeq()
    .toArray();

  /* No yield here because we want to exit the app and shutdown never returns */
  // quest.cmd('shutdown'); // it doesn't work correctly ... wi should relaunch only at the end

  const _appArgs = cloneDeep(appArgs());

  _appArgs['relaunch-reason'] = reason;
  if (desktopIds.length > 0) {
    _appArgs['relaunch-desktops'] = desktopIds;
  } else {
    delete _appArgs['relaunch-desktops'];
  }

  const args = process.argv.slice(1).filter((arg) => !/^--relaunch/.test(arg));

  for (const [arg, value] of Object.entries(_appArgs).filter(
    ([arg]) => !/^[$_]/.test(arg)
  )) {
    if (Array.isArray(value)) {
      value.forEach((value) => args.push(`--${arg}=${value}`));
    } else if (value !== undefined) {
      args.push(`--${arg}=${value}`);
    } else {
      args.push(`--${arg}`);
    }
  }

  const {app} = require('electron');
  const options = {args};
  if (process.env.APPIMAGE) {
    options.execPath = process.env.APPIMAGE;
    options.args.unshift('--appimage-extract-and-run');
  }

  quest.log.warn(`... execPath: ${options.execPath || process.execPath}`);
  quest.log.warn(`... args: ${options.args.join(' ')}`);

  app.relaunch(options);
  app.exit(0);
});

Goblin.registerQuest(goblinName, 'createSession', function* (
  quest,
  mainGoblin,
  labId,
  feed,
  parent
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
    quest.sub(`*::*.<${labId}>.user-locale-changed`, function* (
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
    quest.sub(`*::*.<${labId}>.open-session-requested`, function* (
      _,
      {msg, resp}
    ) {
      yield resp.cmd(`${goblinName}.open-session`, {...msg.data});
    })
  );

  quest.goblin.defer(
    quest.sub(`*::*.<${labId}>.run-client-quest-requested`, function* (
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
  yield quest.createFor('client-session', parent, clientSessionId, {
    id: clientSessionId,
    desktopId: feed,
    sessionStorage,
  });

  // CREATE A LOGIN SESSION
  const loginSessionId = `login-session@${clientSessionId}`;
  yield quest.createFor(clientSessionId, clientSessionId, loginSessionId, {
    id: loginSessionId,
    desktopId: feed,
  });

  return clientSessionId;
});

Goblin.registerQuest(goblinName, 'load-laboratory', function* (
  quest,
  useWS,
  target,
  $msg
) {
  const url = quest.goblin.getX('windowURL');
  const clientConfig = quest.goblin.getX('clientConfig');

  const labId = `laboratory@${quest.uuidV4()}`;
  quest.goblin.setX('labId', labId);

  const mainGoblin = clientConfig.mainGoblin;

  const config = {
    feeds: getBaseFeeds(mainGoblin),
    useWS,
    target,
    themeContexts: clientConfig.themeContexts,
  };
  quest.goblin.setX('labConfig', config);

  const goblinOrcId = `goblin-orc@${$msg.orcName}`;

  yield quest.warehouse.feedSubscriptionAdd({
    feed: labId,
    branch: goblinOrcId,
    parents: 'goblin',
  });

  const clientSessionId = yield quest.me.createSession({
    mainGoblin,
    labId,
    feed: labId,
    parent: goblinOrcId,
  });
  quest.goblin.setX('clientSessionId', clientSessionId);
  quest.goblin.setX('loginSessionId', `login-session@${clientSessionId}`);

  // CREATE A LAB
  yield quest.createFor('laboratory', goblinOrcId, labId, {
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

  yield quest.me.startUX();
});

Goblin.registerQuest(goblinName, 'startUX', function* (quest) {
  const labId = quest.goblin.getX('labId');
  const clientSessionId = quest.goblin.getX('clientSessionId');
  const loginSessionId = quest.goblin.getX('loginSessionId');
  const clientConfig = quest.goblin.getX('clientConfig');

  let username = require('os').userInfo().username;
  let userId = username;

  if (clientConfig.useLogin) {
    const {token, info} = yield quest.me.login({
      loginSessionId,
      clientConfig,
    });
    if (token.status === 'cancelled') {
      const labAPI = quest.getAPI(labId);
      yield labAPI.close();
      return;
    } else {
      username = info.login;
      userId = info.loginSubject.replace('uid.', '');
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
      session: quest.uuidV4(),
      username,
      labId,
      clientSessionId,
      desktopId: labId,
      mainGoblin: clientConfig.mainGoblin,
      useConfigurator: clientConfig.useConfigurator,
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

Goblin.registerQuest(goblinName, 'logout', function () {
  const passportRootStorage = path.join(xConfig.xcraftRoot, 'var/passport');
  if (fs.existsSync(passportRootStorage)) {
    const tokenFile = path.join(passportRootStorage, 'refresh.tkn');
    if (fs.existsSync(tokenFile)) {
      fs.unlinkSync(tokenFile);
    }
  }
});

Goblin.registerQuest(goblinName, 'login', function* (
  quest,
  desktopId,
  loginSessionId,
  clientConfig
) {
  const labId = quest.goblin.getX('labId');
  if (!desktopId) {
    desktopId = labId;
  }
  const hubName = 'dispatch-central-hub';
  const hubUrl = 'https://partout.cresus.ch/passport/v1/' + hubName;
  const hubAPI = yield quest.createNew('passport-provider', {
    loginSessionId,
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
    const frameId = `passport-frame@${labId}`;
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
  const info = yield hubAPI.getUserData();
  yield quest.kill(hubAPI.id);
  return {info, token};
});

Goblin.registerQuest(goblinName, 'configure', function* (
  quest,
  desktopId,
  userId,
  username,
  clientSessionId,
  clientConfig,
  oldDesktopId,
  next
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
    configuratorId = `configurator@${quest.uuidV4()}`;
    const id = quest.goblin.id;

    quest.goblin.setX(
      'confUnsub',
      quest.sub(`${configuratorId}.configured`, function* (err, {msg, resp}) {
        const {username, session, configuration} = msg.data;
        const {mainGoblin, embeddedElectronApp} = configuration;
        if (!embeddedElectronApp) {
          yield resp.cmd(`${goblinName}.open-session`, {
            id,
            session,
            username,
            configuration,
            mainGoblin: configuration.mainGoblin,
          });
        } else {
          yield resp.cmd(`${mainGoblin}.start`, {
            id: mainGoblin,
            fromShell: true,
          });
        }
      })
    );

    // CREATE A NEW CONFIGURATOR
    const conf = yield quest.createFor('configurator', labId, configuratorId, {
      id: configuratorId,
      clientSessionId,
      desktopId,
      labId,
      userId,
      username,
      useLogin: clientConfig.useLogin,
      appArgs: appArgs(),
    });
    configuratorId = conf.id;
    quest.goblin.setX('configuratorId', configuratorId);
  }

  const confConfig = require('xcraft-core-etc')().load('goblin-configurator');
  yield lab.setRoot({
    widgetId: configuratorId,
    widget: confConfig.mainWidget,
    themeContext: clientConfig.themeContexts[0],
  });

  const conf = quest.getAPI(configuratorId);
  const desktops = yield conf.getRelaunchDesktops();
  if (desktops) {
    for (const desktopId of desktops) {
      conf.openSession({feed: `feed-${desktopId}`}, next.parallel());
    }
    yield next.sync();
    yield conf.resetRelaunchDesktops();
  }
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
  mandate,
  $msg
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

  config.title = `${mainGoblin} - ${username}`;
  config.feeds = getBaseFeeds(mainGoblin);

  const url = quest.goblin.getX('windowURL');

  const goblinOrcId = `goblin-orc@${$msg.orcName}`;

  yield quest.warehouse.feedSubscriptionAdd({
    feed: desktopId,
    branch: goblinOrcId,
    parents: 'goblin',
  });

  const clientSessionId = yield quest.me.createSession({
    mainGoblin,
    labId,
    feed: desktopId,
    parent: goblinOrcId,
  });

  const lab = yield quest.createFor('laboratory', goblinOrcId, labId, {
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
  mainGoblin,
  useConfigurator
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

  yield lab.listen({desktopId, useConfigurator});

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
      yield resp.cmd('client-session.close-window', {
        id: clientSessionId,
        winId: `wm@${labId}`,
      });
      yield resp.cmd('client.close-window', {labId});
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
});

Goblin.registerQuest(goblinName, 'open-external', function (quest, url) {
  const {shell} = require('electron');
  // Open a URL in the default way
  if (require('url').parse(url).protocol) {
    shell.openExternal(url);
  } else {
    shell.openPath(url);
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
