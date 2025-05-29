# 📘 Documentation du module goblin-client

## Aperçu

Le module `goblin-client` est un composant central du framework Xcraft qui gère le côté client des applications. Il fournit les fonctionnalités essentielles pour démarrer, configurer et gérer les sessions client, les fenêtres d'application, les laboratoires (environnements d'exécution) et les interactions avec le système d'exploitation.

Ce module sert de pont entre le framework Xcraft et l'environnement Electron, permettant de créer des applications de bureau riches et interactives.

## Sommaire

- [Aperçu](#aperçu)
- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

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

### Variables d'environnement

| Variable | Description | Exemple | Valeur par défaut |
|----------|-------------|---------|------------------|
| NODE_ENV | Détermine le mode d'exécution (development/production) | development | - |
| APPIMAGE | Chemin vers l'AppImage lors de l'exécution dans ce format | /path/to/app.AppImage | - |

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

| Option | Description | Type | Valeur par défaut |
|--------|-------------|------|------------------|
| mainGoblin | Le goblin principal à démarrer | String | "" |
| mainGoblinModule | Le nom du module du goblin principal | String | "" |
| contextId | Le contexte initial | String | "" |
| themeContexts | Les contextes de thème disponibles | Array | [] |
| useConfigurator | Utiliser le widget configurateur comme racine | Boolean | false |
| useLogin | Utiliser le processus de login passport | Boolean | false |
| appUserModelId | L'identifiant AppUserModelId pour Windows | String | null |
| fullscreenable | Activer ou désactiver le support du mode plein écran | Boolean | true |

## Détails des sources

### `client.js`

Ce fichier définit le service principal du client. Il gère le cycle de vie complet de l'application :

- Initialisation d'Electron
- Configuration du webpack pour le développement
- Gestion des sessions client
- Création et gestion des laboratoires (environnements UI)
- Gestion de l'authentification
- Démarrage de l'interface utilisateur

#### État et modèle de données

L'état du service client comprend :

```javascript
{
  booted: false,           // Indique si le client a démarré
  private: {
    desktopByLab: {},      // Mapping des laboratoires vers les bureaux
    labByDesktop: {},      // Mapping des bureaux vers les laboratoires
  }
}
```

#### Méthodes publiques

- **`boot()`** - Initialise l'environnement Electron, configure les outils de développement, et prépare l'URL pour le chargement de l'application.
- **`start()`** - Démarre le client, crée une session laboratoire et charge l'interface utilisateur.
- **`createSession(mainGoblin, labId, feed, parent)`** - Crée une nouvelle session client pour persister les préférences utilisateur.
- **`loadLaboratory()`** - Charge l'environnement laboratoire pour l'interface utilisateur.
- **`getLoginSessionId()`** - Récupère l'ID de la session de login.
- **`startUX()`** - Démarre l'interface utilisateur, gère le login si nécessaire et lance la configuration ou la session d'application.
- **`dataTransfer(labId, desktopId, filePaths)`** - Gère le transfert de fichiers vers l'application.
- **`logout()`** - Déconnecte l'utilisateur en supprimant les tokens d'authentification.
- **`login(desktopId, loginSessionId, clientConfig)`** - Gère le processus de login, vérifie les tokens existants ou demande une nouvelle authentification.
- **`configure(desktopId, userId, username, clientSessionId, clientConfig, oldDesktopId)`** - Configure l'interface utilisateur avec le configurateur.
- **`getConfig()`** - Récupère la configuration du client.
- **`closeWindow(labId)`** - Ferme une fenêtre d'application.
- **`openSession(session, username, userId, rootWidget, configuration, mainGoblin, mandate)`** - Ouvre une nouvelle session d'application.
- **`startDesktopAppSession(rootWidget, configuration, session, username, userId, labId, clientSessionId, desktopId, mainGoblin, useConfigurator)`** - Démarre une session d'application de bureau.
- **`closeSession(labId, sessionDesktopId)`** - Ferme une session d'application.
- **`openExternal(url)`** - Ouvre une URL ou un chemin dans le navigateur ou l'application par défaut du système.
- **`changeLocale(locale, mainGoblin, clientSessionId)`** - Change la langue de l'interface.
- **`getLocale(mainGoblin, clientSessionId)`** - Récupère la langue actuelle de l'interface.
- **`appRelaunch(reason)`** - Relance l'application en cas de problème avec la connexion au serveur.

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

#### État et modèle de données

L'état de la session client comprend :

```javascript
{
  zoom: 1,                   // Niveau de zoom de l'interface
  locale: null,              // Langue actuelle de l'interface
  userLocale: null,          // Préférence de langue de l'utilisateur
  theme: null,               // Thème visuel actuel
  views: {},                 // Configuration des vues (colonnes, tris)
  tips: {},                  // État des astuces (affichées/masquées)
  splitters: {},             // Position des séparateurs
  dialogs: {},               // État des boîtes de dialogue
  desktopClock: {},          // Configuration de l'horloge de bureau
  translatableTextField: {}, // Configuration des champs de texte traduisibles
  lastColorsPicker: [],      // Dernières couleurs utilisées
  accessToEggsThemes: false, // Accès aux thèmes spéciaux
  prototypeMode: false,      // Mode prototype activé/désactivé
  windows: [],               // État des fenêtres
  private: {                 // Données privées
    osLocale: null,          // Langue du système d'exploitation
    windowIndexes: {count: 0} // Compteur et index des fenêtres
  }
}
```

#### Méthodes publiques

- **`create(id, sessionStorage)`** - Crée une nouvelle session client ou restaure une session existante.
- **`setViewColumnsOrder(viewId, columnsIds)`** - Définit l'ordre des colonnes pour une vue.
- **`setViewColumnWidth(viewId, columnId, width)`** - Définit la largeur d'une colonne pour une vue.
- **`setViewColumnSorting(viewId, columnId, direction)`** - Définit le tri d'une colonne pour une vue.
- **`resetViewColumn(viewId)`** - Réinitialise la configuration d'une vue.
- **`setWindowState(winId, state)`** - Enregistre l'état d'une fenêtre.
- **`getWindowState(winId, defaultState)`** - Récupère l'état d'une fenêtre.
- **`closeWindow(winId)`** - Ferme une fenêtre.
- **`setLocale(locale)`** - Définit la langue de l'interface.
- **`changeLocale(locale)`** - Change la préférence de langue de l'utilisateur.
- **`getLocale()`** - Récupère la langue actuelle de l'interface.
- **`setTips(tipsId, state)`** - Enregistre l'état d'une astuce.
- **`setSplitters(splitterId, state)`** - Enregistre l'état d'un séparateur.
- **`setDialogs(dialogId, state)`** - Enregistre l'état d'une boîte de dialogue.
- **`setLastColorsPicker(state)`** - Enregistre les dernières couleurs utilisées.
- **`setDesktopClock(theme, state)`** - Enregistre la configuration de l'horloge de bureau.
- **`setTranslatableTextField(state)`** - Enregistre la configuration des champs de texte traduisibles.
- **`setZoom(zoom)`** - Définit le niveau de zoom de l'interface.
- **`getZoom()`** - Récupère le niveau de zoom actuel de l'interface.
- **`setTheme(theme)`** - Définit le thème visuel.
- **`getTheme()`** - Récupère le thème visuel actuel.
- **`setAccessToEggsThemes(show)`** - Active ou désactive l'accès aux thèmes spéciaux.
- **`togglePrototypeMode()`** - Active ou désactive le mode prototype.
- **`save()`** - Sauvegarde l'état de la session client.

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

#### État et modèle de données

L'état du service de processus enfant est minimal :

```javascript
{
  id: 'child-process@id'  // Identifiant du service
}
```

#### Méthodes publiques

- **`create(executablePath, options)`** - Crée un nouveau gestionnaire de processus enfant.
- **`spawn(executableArguments, additionalOptions)`** - Lance un processus externe avec les arguments spécifiés.

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

#### Méthodes publiques

- **`isBad(features)`** - Vérifie si les fonctionnalités GPU sont insuffisantes.
- **`isMinimal(features)`** - Vérifie si les fonctionnalités GPU minimales sont disponibles.
- **`getReport(features)`** - Génère un rapport détaillé des fonctionnalités GPU.

```javascript
// Exemple d'utilisation interne
const {isBad, isMinimal, getReport} = require('./GPUStatus.js');
const infos = app.getGPUFeatureStatus();
if (isBad(infos) || !isMinimal(infos)) {
  // Afficher un avertissement à l'utilisateur
}
console.log(getReport(infos));
```

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