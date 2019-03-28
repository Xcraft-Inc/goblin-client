'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'input',
    name: 'mainGoblin',
    message: 'Main goblin',
    default: '',
  },
  {
    type: 'input',
    name: 'mainGoblinModule',
    message: 'Main goblin module name',
    default: '',
  },
  {
    type: 'input',
    name: 'contextId',
    message: 'Initial context',
    default: '',
  },
  {
    type: 'confirm',
    name: 'useConfigurator',
    message: 'Use the configurator root widget',
    default: false,
  },
  {
    type: 'input',
    name: 'defaultZoom',
    message: 'Set default zoom for Electron frontend',
    default: false,
  },
];
