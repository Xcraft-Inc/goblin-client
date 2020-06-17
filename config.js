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
    type: 'checkbox',
    name: 'themeContexts',
    message: 'available theme contexts',
    default: [],
  },
  {
    type: 'confirm',
    name: 'useConfigurator',
    message: 'Use the configurator root widget',
    default: false,
  },
  {
    type: 'confirm',
    name: 'useLogin',
    message: 'Use passport login process',
    default: false,
  },
];
