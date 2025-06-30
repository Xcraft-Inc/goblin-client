'use strict';

const watt = require('gigawatts');
const path = require('path');
const fse = require('fs-extra');
const cloneDeep = require('lodash/cloneDeep');
const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');
const xConfig = require('xcraft-core-etc')().load('xcraft');
const {locks} = require('xcraft-core-utils');
const {appArgs} = require('xcraft-core-host');
const {getWindowSession} = require('goblin-wm/lib/helpers.js');
const {isBad, isMinimal, getReport} = require('./GPUStatus.js');

// Define initial logic values
const logicState = {
  booted: false,
  private: {
    desktopByLab: {},
    labByDesktop: {},
  },
};

// Define logic handlers according rc.json
const logicHandlers = {
  'boot': (state) => {
    return state.set('booted', true);
  },
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
    //'activity-monitor-led', //FIXME: rework in progress
    'desktop-manager',
  ];
}

// Register quest's according rc.json
let BOOTING = false;
Goblin.registerQuest(goblinName, 'boot', function* (quest, $msg, next) {
  if (!BOOTING) {
    BOOTING = true;
  } else {
    yield quest.sub.localWait(`*::client.<booted>`);
    return;
  }
  const {app} = require('electron');

  function checkGPUInfos() {
    const infos = app.getGPUFeatureStatus();

    quest.log.dbg(`GPU Infos:\n${getReport(infos)}`);

    if (isBad(infos) || !isMinimal(infos)) {
      //TODO: warn user
    }
  }

  let gpuInfoTimeout = setTimeout(checkGPUInfos, 5000);

  app.on('gpu-info-update', () => {
    if (gpuInfoTimeout) {
      clearTimeout(gpuInfoTimeout);
      gpuInfoTimeout = null;
    }
    checkGPUInfos();
  });

  quest.evt.send('progressed', 'boot');
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  quest.goblin.setX('clientConfig', clientConfig);

  global.appUserModelId = null;
  if (clientConfig.appUserModelId) {
    global.appUserModelId = clientConfig.appUserModelId;
    app.setAppUserModelId(global.appUserModelId);
    quest.log.dbg(`${global.appUserModelId} set`);
  }

  /* FIXME: This code doesn't check that the restart comes from the server
   *        which load warehouse. We consider that the whole horde has
   *        restarted.
   */
  quest.goblin.defer(
    quest.resp.onTokenChanged(
      watt(function* (busConfig) {
        if (!busConfig?.passive) {
          yield quest.me.appRelaunch({reason: 'server-restart'});
        }
      })
    )
  );

  quest.goblin.defer(
    quest.resp.onOrcnameChanged(
      watt(function* (oldOrcName, newOrcName, busConfig) {
        if (!busConfig?.passive) {
          yield quest.me.appRelaunch({reason: 'client-connection'});
        }
      })
    )
  );

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

      const devtoolsToInstall = [
        {name: 'React', extension: REACT_DEVELOPER_TOOLS},
        {name: 'Redux', extension: REDUX_DEVTOOLS},
      ];

      const sessionToUse = getWindowSession();

      for (const {name, extension} of devtoolsToInstall) {
        try {
          yield installExtension(extension, {
            loadExtensionOptions: {
              allowFileAccess: true,
            },
            session: sessionToUse,
          });
        } catch (err) {
          quest.log.warn(
            `An error occurred installing ${name} devtools extension: `,
            err.stack || err.message || err
          );
        }
      }

      const devtoolsInstalled = sessionToUse.getAllExtensions();
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
    quest.evt.send('progressed', 'webpack');
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

  url = url || `http://127.0.0.1:${port}`;
  quest.goblin.setX('windowURL', url);
  quest.goblin.setX('setup', {useWS, target});

  const mainGoblin = clientConfig.mainGoblin;

  const config = {
    feeds: getBaseFeeds(mainGoblin),
    useWS,
    target,
    themeContexts: clientConfig.themeContexts,
    fullscreenable:
      clientConfig.fullscreenable !== undefined
        ? clientConfig.fullscreenable
        : true,
  };
  quest.goblin.setX('labConfig', config);

  quest.do();
  yield next.sync();
  quest.evt('<booted>');
});

Goblin.registerQuest(goblinName, 'start', function* (quest, $msg) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const goblinOrcId = `goblin-orc@${$msg.orcName}`;
  const labId = `laboratory@${quest.uuidV4()}`;
  quest.goblin.setX('labId', labId);
  yield quest.warehouse.feedSubscriptionAdd({
    feed: labId,
    branch: goblinOrcId,
    parents: 'goblin',
  });
  quest.evt.send('progressed', 'restore-session');
  const clientSessionId = yield quest.me.createSession({
    mainGoblin: clientConfig.mainGoblin,
    labId,
    feed: labId,
    parent: goblinOrcId,
  });
  quest.goblin.setX('goblinOrcId', goblinOrcId);
  quest.goblin.setX('clientSessionId', clientSessionId);
  quest.goblin.setX('loginSessionId', `login-session@${clientSessionId}`);
  quest.evt.send('progressed', 'start');
  const booted = quest.goblin.getState().get('booted');
  if (!booted) {
    yield quest.me.boot();
  }
  quest.do();
  yield quest.me.loadLaboratory();
  quest.goblin.defer(
    quest.sub(`*::*client-metrics-requested`, function* (_, {msg, resp}) {
      const {appId} = require('xcraft-core-host');
      const metrics = yield quest.cmd(`bus.${appId}.xcraftMetrics`, {
        from: quest.goblin.id,
      });
      yield resp.cmd('garona.logRemoteMetrics', {
        clientSessionId,
        pid: process.pid,
        metrics,
      });
    })
  );
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

  let args = process.argv.slice(1).filter((arg) => !/^--relaunch/.test(arg));

  for (const [arg, value] of Object.entries(_appArgs).filter(
    ([arg]) => !/^[$_]/.test(arg)
  )) {
    if (Array.isArray(value)) {
      value.forEach((value) => args.push(`--${arg}=${value}`));
    } else if (value === false) {
      args.push(`--no-${arg}`);
    } else if (value === true) {
      args.push(arg);
    } else if (value !== undefined) {
      if (arg.length === 1) {
        args.push(`-${arg}=${value}`);
      } else {
        args.push(`--${arg}=${value}`);
      }
    } else {
      args.push(`--${arg}`);
    }
  }

  args = [...new Set(args)];

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

Goblin.registerQuest(goblinName, 'createSession', async function (
  quest,
  mainGoblin,
  labId,
  feed,
  parent
) {
  ///CLIENT SESSION HANDLING
  const {appCompany, appData} = require('xcraft-core-host');
  const sessionStorage = path.join(appData, appCompany);
  await fse.ensureDir(sessionStorage);
  let files = await fse.readdir(sessionStorage);
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
    quest.sub(`*::*.<${labId}>.user-locale-changed`, async function (
      _,
      {msg, resp}
    ) {
      await resp.cmd(`${goblinName}.change-locale`, {
        clientSessionId,
        ...msg.data,
      });
    })
  );

  quest.goblin.defer(
    quest.sub(`*::*.<${labId}>.open-session-requested`, async function (
      _,
      {msg, resp}
    ) {
      await resp.cmd(`${goblinName}.open-session`, {...msg.data});
    })
  );

  quest.goblin.defer(
    quest.sub(`*::*.<${labId}>.run-client-quest-requested`, async function (
      _,
      {msg, resp}
    ) {
      const {desktopId, goblinName, goblinId, questName, questArgs} = msg.data;
      if (resp.hasCommand(`${goblinName}.${questName}`)) {
        await resp.cmd(`${goblinName}.${questName}`, {
          id: goblinId,
          desktopId,
          clientSessionId,
          ...questArgs,
        });
      }
    })
  );

  // CREATE SESSION SERVICE
  await quest.createFor('client-session', parent, clientSessionId, {
    id: clientSessionId,
    desktopId: feed,
    sessionStorage,
  });

  // CREATE A LOGIN SESSION
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  if (clientConfig.useLogin) {
    const loginSessionId = `login-session@${clientSessionId}`;
    await quest.createFor(clientSessionId, clientSessionId, loginSessionId, {
      id: loginSessionId,
      desktopId: feed,
    });
  }

  return clientSessionId;
});

Goblin.registerQuest(goblinName, 'load-laboratory', function* (quest) {
  // CREATE A LAB
  const labId = quest.goblin.getX('labId');
  const goblinOrcId = quest.goblin.getX('goblinOrcId');
  const clientSessionId = quest.goblin.getX('clientSessionId');
  const url = quest.goblin.getX('windowURL');
  const config = quest.goblin.getX('labConfig');
  yield quest.createFor('laboratory', goblinOrcId, labId, {
    id: labId,
    desktopId: labId,
    clientSessionId,
    url,
    config,
  });

  const args = appArgs();
  if (args.locale) {
    const clientSessionApi = quest.getAPI(clientSessionId);
    yield clientSessionApi.setLocale({locale: args.locale});
  }

  quest.evt.send('progressed', 'ready');
  yield quest.me.startUX();
});

Goblin.registerQuest(goblinName, 'getLoginSessionId', function (quest) {
  return quest.goblin.getX('loginSessionId');
});

Goblin.registerQuest(goblinName, 'startUX', function* (quest) {
  const labId = quest.goblin.getX('labId');
  const clientSessionId = quest.goblin.getX('clientSessionId');
  const loginSessionId = quest.goblin.getX('loginSessionId');
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');

  let username = require('os').userInfo().username;
  let userId = username;

  if (clientConfig.useLogin) {
    const {info, status} = yield quest.me.login({
      loginSessionId,
      clientConfig,
    });
    switch (status) {
      case 'failed': //TODO: access denied page
      case 'cancelled': {
        const labAPI = quest.getAPI(labId);
        yield labAPI.close();
        return;
      }
      default:
        username = info.login;
        userId = info.loginSubject;
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
      userId,
      clientSessionId,
      desktopId: labId,
      mainGoblin: clientConfig.mainGoblin,
      useConfigurator: clientConfig.useConfigurator,
    });
  }
});

Goblin.registerQuest(goblinName, 'data-transfer', async function (
  quest,
  labId,
  desktopId,
  filePaths
) {
  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  const mainGoblin = quest.getAPI(clientConfig.mainGoblin);
  if (mainGoblin.dataTransfer) {
    const result = await mainGoblin.dataTransfer({
      labId,
      desktopId,
      filePaths,
    });

    if (result && result.accepted) {
      const destAPI = quest.getAPI(result.goblin);
      const stream = fse.createReadStream;
      const filePath = filePaths[0];
      if (await fse.pathExists(filePath)) {
        let file = stream(filePath);
        await destAPI[result.quest]({
          desktopId,
          xcraftUpload: file,
          localFilePath: filePath,
        });
      }
    }
  }
});

Goblin.registerQuest(goblinName, 'logout', async function (quest) {
  const passportRootStorage = path.join(xConfig.xcraftRoot, 'var/passport');
  if (await fse.pathExists(passportRootStorage)) {
    const tokenFile = path.join(passportRootStorage, 'refresh.tkn');
    if (await fse.pathExists(tokenFile)) {
      await fse.remove(tokenFile);
    }
  }
  const loginSessionId = quest.goblin.getX('loginSessionId');
  const loginSessionAPI = quest.getAPI(loginSessionId);
  const tokenData = await loginSessionAPI.deleteTokens();
  if (tokenData) {
    Goblin.deroleUser(quest.goblin, tokenData.toJS());
  }
});

Goblin.registerQuest(goblinName, 'login', async function (
  quest,
  desktopId,
  loginSessionId,
  clientConfig
) {
  const labId = quest.goblin.getX('labId');
  if (!desktopId) {
    desktopId = labId;
  }
  const hubAPI = await quest.createNew('passport-provider', {
    loginSessionId,
    desktopId,
  });
  quest.goblin.setX('passport-provider', hubAPI.id);
  const passportRootStorage = path.join(xConfig.xcraftRoot, 'var/passport');
  await fse.ensureDir(passportRootStorage);
  const tokenFile = path.join(passportRootStorage, 'refresh.tkn');
  const refreshTokenExist = await fse.pathExists(tokenFile);

  let mustRenew = true;
  let token;
  if (refreshTokenExist) {
    const refreshToken = await fse.readFile(tokenFile);
    try {
      token = await hubAPI.refreshToken({
        refreshToken: refreshToken.toString(),
      });
      if (token.status === 'renewed') {
        mustRenew = false;
      }
    } catch (err) {
      quest.log.warn(`refresh token error: ${err.stack || err}`);
    }
  }

  if (mustRenew) {
    const frameId = `passport-frame@${labId}`;
    const lab = quest.getAPI(labId);

    const conf = await quest.createFor('passport-frame', labId, frameId, {
      id: frameId,
      desktopId,
      labId,
    });

    await lab.setRoot({
      widgetId: conf.id,
      themeContext: clientConfig.themeContexts[0],
    });

    const nonce = quest.uuidV4();
    token = await hubAPI.requestToken({
      nonce,
      loginQuest: {
        goblinName: 'passport-frame',
        goblinId: frameId,
        goblinQuest: 'start',
      },
    });
    switch (token.status) {
      case 'renewed': {
        await fse.writeFile(tokenFile, token.refreshToken);
      }
    }
  }
  const info = await hubAPI.getUserData();
  const accessToken = await hubAPI.getAccessTokenData();
  if (accessToken) {
    Goblin.enroleUser(quest.goblin.id, accessToken.data);
    await quest.kill(hubAPI.id);
    return {info, status: token.status};
  } else {
    return {info, status: 'failed'};
  }
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

  yield lab.listen({desktopId, userId});

  let configuratorId = quest.goblin.getX('configuratorId');
  if (!configuratorId) {
    configuratorId = `configurator@${quest.uuidV4()}`;
    const id = quest.goblin.id;

    quest.goblin.setX(
      'confUnsub',
      quest.sub(`${configuratorId}.configured`, function* (err, {msg, resp}) {
        const {username, session, configuration} = msg.data;
        const {_goblinUser} = msg.context;
        const userId = _goblinUser.split('@')[0];
        const {mainGoblin, embeddedElectronApp} = configuration;
        if (!embeddedElectronApp) {
          yield resp.cmd(`${goblinName}.open-session`, {
            id,
            _goblinUser,
            userId,
            session,
            username,
            configuration,
            mainGoblin: configuration.mainGoblin,
          });
        } else {
          yield resp.cmd(`${mainGoblin}.start`, {
            _goblinUser,
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
  } else {
    const configuratorAPI = quest.getAPI(configuratorId);
    yield configuratorAPI.updateCurrentUser({username});
  }

  const confConfig = require('xcraft-core-etc')().load('goblin-configurator');
  yield lab.setRoot({
    widgetId: configuratorId,
    widget: confConfig.mainWidget,
    themeContext: clientConfig.themeContexts[0],
  });

  const promises = [];
  const conf = quest.getAPI(configuratorId);
  const desktops = yield conf.getRelaunchDesktops();
  if (desktops) {
    for (const desktopId of desktops) {
      promises.push(conf.openSession({feed: desktopId}));
    }
    yield Promise.all(promises);
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
  userId,
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
  yield lab.listen({desktopId: desktopId, userId});
  yield lab.setFeed({desktopId: desktopId});

  quest.do({desktopId, labId});

  const clientConfig = require('xcraft-core-etc')().load('goblin-client');
  if (clientConfig.useLogin) {
    const loginSessionId = quest.goblin.getX('loginSessionId');
    const loginSessionAPI = quest.getAPI(loginSessionId);
    yield loginSessionAPI.notifyLoginState();
  }

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
  userId,
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
    let mandate = mainGoblin;
    if (appArgs().nabu) {
      mandate = 'nabu';
    }
    desktopId = `desktop@${mandate}@${session}`;
    yield lab.setFeed({desktopId});
  }

  yield lab.listen({desktopId, useConfigurator, userId});

  const configuredDesktop = yield mainGoblinAPI.configureDesktop({
    configuration,
    session,
    username,
    labId,
    clientSessionId,
    desktopId,
  });

  if (quest.hasAPI('desktop-manager.open')) {
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
  }

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
      /* Force system desktop in order to ensure that the unsubscribed feed
       * stays unsubscribed. Otherwise, now that the desktopId is automatically
       * injected with all commands, it was possible that the upsert re-insert
       * the 'just' unsubscribed feed.
       */
      yield resp.cmd('client-session.close-window', {
        desktopId: 'system',
        id: clientSessionId,
        winId: `wm@${labId}`,
      });
      yield resp.cmd('client.close-window', {
        desktopId: 'system',
        labId,
      });
      yield resp.cmd(`${goblinName}.close-session`, {
        id,
        desktopId: 'system',
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

Goblin.registerQuest(goblinName, 'open-external', async function (quest, url) {
  const {shell} = require('electron');

  /* Do not fordward XCRAFT, GOBLINS and NODE environement variables
   * to sub-processes otherwise it breaks the start of our other
   * Electron applications.
   */
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('XCRAFT_') ||
      key.startsWith('GOBLINS_') ||
      key.startsWith('NODE_')
    ) {
      env[key] = process.env[key];
      delete process.env[key];
    }
  }

  try {
    // const {URL} = require('url');
    // See URL RFC https://www.ietf.org/rfc/rfc1738.txt
    // <scheme>:<scheme-specific-part>
    const match = url.match(/[a-zA-Z0-9+.-]+:.+/g);
    if (match) {
      await shell.openExternal(url);
    } else {
      await shell.openPath(url);
    }
  } finally {
    for (const key of Object.keys(env)) {
      process[key] = env[key];
    }
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
  yield clientSessionApi.changeLocale({locale});
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
