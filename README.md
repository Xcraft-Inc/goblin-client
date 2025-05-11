# 📘 Documentation du module goblin-client

## Aperçu

Le module `goblin-client` est un composant central du framework Xcraft qui gère le côté client des applications. Il fournit les fonctionnalités essentielles pour démarrer, configurer et gérer les sessions client, les fenêtres d'application, les laboratoires (environnements d'exécution) et les interactions avec le système d'exploitation.

Ce module sert de pont entre le framework Xcraft et l'environnement Electron, permettant de créer des applications de bureau riches et interactives.

## Structure du module

- **Service principal** (`client.js`) : Gère le cycle de vie de l'application client
- **Session client** (`client-session.js`) : Gère la persistance des préférences utilisateur
- **Processus enfant** (`child-process.js`) : Permet de lancer des processus externes
- **Utilitaires GPU** (`GPUStatus.js`) : Analyse et rapporte les capacités GPU

## Fonctionnement global

1. **Démarrage** : Le service client démarre avec la méthode `boot` qui initialise l'environnement Electron
2. **Configuration** : Charge les configurations depuis `xcraft-core-etc`
3. **Session** : Crée ou restaure une session client pour persister les préférences
4. **Laboratoire** : Initialise un environnement "laboratory" qui sert de conteneur pour l'interface utilisateur
5. **Authentification** (optionnelle) : Gère le processus de login via passport si configuré
6. **Interface utilisateur** : Démarre l'interface principale, soit via un configurateur, soit directement via le goblin principal

Le module maintient l'état des fenêtres, des sessions et des préférences utilisateur, et fournit des mécanismes pour gérer les événements du système et les interactions entre les différents composants de l'application.

## Exemples d'utilisation

### Démarrage d'une application client

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  // Démarrage du client
  const client = this.quest.getAPI('client');
  await client.start();
}
```

### Ouverture d'une session

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  const client = this.quest.getAPI('client');
  // Ouvrir une nouvelle session
  await client.openSession({
    session: this.uuidV4(),
    username: 'user',
    userId: 'user-1',
    mainGoblin: 'my-app',
    configuration: {
      defaultTheme: 'default',
    },
  });
}
```

### Changement de locale

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  const client = this.quest.getAPI('client');
  // Changer la langue de l'interface
  await client.changeLocale({
    locale: 'fr-FR',
    mainGoblin: 'my-app',
  });
}
```

## Interactions avec d'autres modules

- **[goblin-laboratory]** : Fournit l'environnement d'exécution pour l'interface utilisateur
- **[goblin-configurator]** : Permet de configurer l'application via une interface utilisateur
- **[goblin-wm]** : Gère les fenêtres et leur disposition
- **[goblin-nabu]** : Gère l'internationalisation
- **[goblin-theme]** : Gère les thèmes visuels
- **[xcraft-core-goblin]** : Fournit l'infrastructure d'acteurs
- **[xcraft-core-etc]** : Gère la configuration
- **[xcraft-core-host]** : Fournit des informations sur l'environnement d'exécution

## Configuration avancée

Le module `goblin-client` peut être configuré via le fichier `config.js` avec les options suivantes :

- **mainGoblin** : Le goblin principal à démarrer
- **mainGoblinModule** : Le nom du module du goblin principal
- **contextId** : Le contexte initial
- **themeContexts** : Les contextes de thème disponibles
- **useConfigurator** : Utiliser le widget configurateur comme racine
- **useLogin** : Utiliser le processus de login passport
- **appUserModelId** : L'identifiant AppUserModelId pour Windows
- **fullscreenable** : Activer ou désactiver le support du mode plein écran

## Détails des sources

### `client.js`

Ce fichier définit le service principal du client. Il gère le cycle de vie complet de l'application :

- Initialisation d'Electron
- Configuration du webpack pour le développement
- Gestion des sessions client
- Création et gestion des laboratoires (environnements UI)
- Gestion de l'authentification
- Démarrage de l'interface utilisateur

Le service expose plusieurs quêtes importantes :

- `boot` : Initialise l'environnement Electron
- `start` : Démarre le client
- `openSession` : Ouvre une nouvelle session
- `startDesktopAppSession` : Démarre une session d'application de bureau
- `changeLocale` : Change la langue de l'interface
- `appRelaunch` : Relance l'application en cas de problème

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  const client = this.quest.getAPI('client');
  // Exemple d'utilisation
  await client.boot();
  await client.start();
}
```

### `client-session.js`

Ce fichier définit un service qui gère la persistance des préférences utilisateur entre les sessions. Il stocke :

- La langue de l'interface
- Le thème visuel
- Le niveau de zoom
- L'état des fenêtres
- Les préférences des vues (colonnes, tris, etc.)
- Les états des splitters et dialogues
- Les dernières couleurs utilisées

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  // Exemple d'utilisation
  const clientSession = await this.quest.create('client-session', {
    id: clientSessionId,
    sessionStorage: '/path'
  });
  await clientSession.setTheme({theme: 'dark'});
  await clientSession.setZoom({zoom: 1.2});
}
```

### `child-process.js`

Ce fichier définit un service qui permet de lancer des processus externes depuis l'application. Il utilise `xcraft-core-process` pour gérer les processus.

```javascript
// Dans une méthode d'un acteur Elf
async elfQuest() {
  // Exemple d'utilisation
  const childProcess = await this.quest.create('child-process', {
    id: childProcessId,
    executablePath: '/usr/bin/some-program',
    options: {cwd: '/tmp'},
  });
  await childProcess.spawn({
    executableArguments: ['--arg1', '--arg2'],
  });
}
```

### `GPUStatus.js`

Ce fichier contient des utilitaires pour analyser et rapporter les capacités GPU de l'ordinateur. Il catégorise les fonctionnalités GPU en trois niveaux :

- Rouge : fonctionnalités non disponibles ou désactivées
- Jaune : fonctionnalités partiellement disponibles
- Vert : fonctionnalités pleinement disponibles

Il est utilisé pour vérifier si l'ordinateur peut exécuter correctement l'application et pour afficher des avertissements si nécessaire.

```javascript
// Exemple d'utilisation interne
const {isBad, isMinimal, getReport} = require('./GPUStatus.js');
const infos = app.getGPUFeatureStatus();
if (isBad(infos) || !isMinimal(infos)) {
  // Afficher un avertissement à l'utilisateur
}
console.log(getReport(infos));
```

### `config.js`

Ce fichier définit la configuration du module, exposant les options configurables via `xcraft-core-etc`. Il permet de personnaliser le comportement du client, comme le goblin principal à démarrer, l'utilisation du login, etc.

### `eslint.config.js`

Ce fichier configure ESLint pour le module, définissant les règles de style de code et les plugins à utiliser. Il utilise la nouvelle configuration plate d'ESLint et configure plusieurs plugins comme React, JSDoc et Babel.

Ce module est au cœur du framework Xcraft côté client, fournissant l'infrastructure nécessaire pour créer des applications de bureau riches et interactives.

_Cette documentation a été mise à jour automatiquement._

[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
[goblin-configurator]: https://github.com/Xcraft-Inc/goblin-configurator
[goblin-wm]: https://github.com/Xcraft-Inc/goblin-wm
[goblin-nabu]: https://github.com/Xcraft-Inc/goblin-nabu
[goblin-theme]: https://github.com/Xcraft-Inc/goblin-theme
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host