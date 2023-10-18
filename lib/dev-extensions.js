'use strict';

const watt = require('gigawatts');
const path = require('path');
const fse = require('fs-extra');
const {app, BrowserWindow, session} = require('electron');

function _downloadLegacyReactDevToolsExtension(
  customExtensionFolder,
  downloadUrl,
  callback
) {
  try {
    const got = require('got');
    const {createWriteStream} = require('fs');
    let callbackCalled = false;

    const downloadStream = got.stream(downloadUrl);
    const fileWriterStream = createWriteStream(`${customExtensionFolder}.zip`);

    downloadStream.on('error', (error) => {
      callback(error);
    });

    fileWriterStream
      .on('error', (error) => {
        if (!callbackCalled) {
          callbackCalled = true;
          callback(error);
        }
      })
      .on('finish', () => {
        if (!callbackCalled) {
          callbackCalled = true;
          callback();
        }
      });

    downloadStream.pipe(fileWriterStream);
  } catch (err) {
    setImmediate(() => callback(err));
  }
}

function _unzipReactDevToolsArchive(customExtensionFolder, callback) {
  const unzipper = require('unzipper');
  let callbackCalled = false;

  fse
    .createReadStream(`${customExtensionFolder}.zip`)
    .pipe(unzipper.Extract({path: customExtensionFolder}))
    .on('error', (err) => {
      if (!callbackCalled) {
        callbackCalled = true;
        callback(err);
      }
    })
    .on('finish', () => {
      if (!callbackCalled) {
        callbackCalled = true;
        callback();
      }
    });
}

function _tryRemoveExtension(extensionName) {
  if (session.defaultSession.removeExtension) {
    const extensionId = session.defaultSession
      .getAllExtensions()
      .find((e) => e.name === extensionName)?.id;
    if (extensionId) {
      session.defaultSession.removeExtension(extensionId);
    }
  } else {
    BrowserWindow.removeDevToolsExtension(extensionName);
  }
}

const _addExtension = watt(function* (
  extensionFolder,
  loadExtensionOptions,
  next
) {
  if (session.defaultSession.loadExtension) {
    return yield session.defaultSession.loadExtension(
      extensionFolder,
      loadExtensionOptions,
      next
    );
  }

  return BrowserWindow.addDevToolsExtension(extensionFolder); // eslint-disable-line
});

function getExtensionsPath() {
  const savePath = app.getPath('userData');
  return path.resolve(`${savePath}/extensions`);
}

const installCustomExtensionVersion = watt(function* (
  extensionReference,
  downloadUrl,
  loadExtensionOptions,
  next
) {
  const extensionFolder = path.resolve(
    getExtensionsPath(),
    extensionReference.id
  );
  const customExtensionFolder = `${extensionFolder}_custom`;

  if (fse.existsSync(extensionFolder)) {
    _tryRemoveExtension(extensionReference.id);
    yield fse.rm(
      extensionFolder,
      {
        recursive: true,
      },
      next
    );
  }

  if (!fse.existsSync(customExtensionFolder)) {
    yield _downloadLegacyReactDevToolsExtension(
      customExtensionFolder,
      downloadUrl,
      next
    );
    yield _unzipReactDevToolsArchive(customExtensionFolder, next);
  }

  yield _addExtension(customExtensionFolder, loadExtensionOptions, next);
});

module.exports = {
  getExtensionsPath,
  installCustomExtensionVersion,
};
