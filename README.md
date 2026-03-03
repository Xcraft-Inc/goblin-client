# 📘 goblin-client

## Aperçu

Le module `goblin-client` est un composant central du framework Xcraft qui gère le côté client des applications Electron. Il orchestre le démarrage de l'application, la gestion des sessions utilisateur, l'authentification, les fenêtres et les laboratoires (environnements d'exécution UI). Il sert de pont entre le framework Xcraft et l'environnement Electron, permettant de créer des applications de bureau riches et interactives.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module est composé de quatre fichiers principaux :

- **`lib/service.js`** (exposé via `client.js`) : Service singleton principal qui orchestre le cycle de vie complet de l'application client.
- **`lib/client-session.js`** (exposé via `client-session.js`) : Service de persistance des préférences utilisateur entre les sessions.
- **`lib/child-process.js`** (exposé via `child-process.js`) : Service instanciable pour lancer des processus externes.
- **`lib/GPUStatus.js`** : Module utilitaire pour analyser les capacités GPU de la machine.

## Fonctionnement global

Le démarrage de l'application suit une séquence bien définie :

1. **`boot`** : Initialise l'environnement Electron, vérifie les capacités GPU, installe les devtools React/Redux en développement, démarre le serveur webpack si nécessaire et prépare l'URL de l'application.
2. **`start`** : Crée un laboratoire, restaure ou crée une session client (`client-session`), puis appelle `loadLaboratory`.
3. **`loadLaboratory`** : Instancie le laboratoire (`goblin-laboratory`) avec l'URL et la configuration, puis appelle `startUX`.
4. **`startUX`** : Gère l'authentification (si `useLogin` est activé), puis délègue au configurateur (`useConfigurator`) ou lance directement `startDesktopAppSession`.
5. **`startDesktopAppSession`** : Demande au goblin principal de configurer le bureau (`configureDesktop`), ouvre le gestionnaire de bureau si disponible, puis définit le widget racine dans le laboratoire.

En parallèle, le module surveille les changements de token de connexion et le nom de l'orchestrateur pour relancer automatiquement l'application en cas de reconnexion.

### Gestion des sessions multiples

Chaque session de bureau possède son propre `desktopId` (format `desktop@mandate@session`) et son propre laboratoire (`laboratory@uuid`). Le service maintient une table de correspondance bidirectionnelle `labId ↔ desktopId` dans son état, permettant de gérer plusieurs fenêtres/sessions simultanées.

```
boot()
  └─> start()
        ├─> createSession()       → crée client-session (persistance)
        └─> loadLaboratory()
              └─> startUX()
                    ├─> [login()]       si useLogin
                    ├─> [configure()]   si useConfigurator
                    └─> startDesktopAppSession()
                          └─> mainGoblin.configureDesktop()
```

## Exemples d'utilisation

### Démarrage du client

```javascript
// Appelé automatiquement par le framework lors du lancement de l'application
// Dans un acteur Goblin orchestrateur :
await quest.cmd('client.boot');
await quest.cmd('client.start');
```

### Ouverture d'une session supplémentaire (multi-fenêtre)

```javascript
// Dans un acteur Goblin
await quest.cmd('client.open-session', {
  id: 'client',
  session: quest.uuidV4(),
  username: 'alice',
  userId: 'alice@corp',
  mainGoblin: 'my-app',
  configuration: {defaultTheme: 'dark'},
});
```

### Changement de langue

```javascript
// Dans un acteur Goblin
await quest.cmd('client.change-locale', {
  id: 'client',
  locale: 'fr-CH',
  mainGoblin: 'my-app',
});
```

### Transfert de fichiers vers l'application

```javascript
// Dans un acteur Goblin (typiquement déclenché par un drag-and-drop Electron)
await quest.cmd('client.data-transfer', {
  id: 'client',
  labId: 'laboratory@xxx',
  desktopId: 'desktop@my-app@yyy',
  filePaths: ['/home/user/document.pdf'],
});
```

### Lancement d'un processus enfant

```javascript
// Dans un acteur Goblin
await quest.create('child-process', {
  id: 'child-process@my-tool',
  executablePath: '/usr/bin/my-tool',
  options: {cwd: '/tmp'},
});
await quest.cmd('child-process.spawn', {
  id: 'child-process@my-tool',
  executableArguments: ['--input', 'file.txt'],
});
```

## Interactions avec d'autres modules

- **[goblin-laboratory]** : Fournit l'environnement d'exécution (fenêtre Electron + rendu React) pour l'interface utilisateur.
- **[goblin-configurator]** : Interface de sélection de profil et de configuration d'application, utilisée quand `useConfigurator` est activé.
- **[goblin-wm]** : Gère les fenêtres Electron et leur disposition (window manager).
- **[goblin-nabu]** : Gère l'internationalisation et la résolution des locales.
- **[goblin-theme]** : Gère les thèmes visuels et les compositions de thèmes.
- **[xcraft-core-goblin]** : Fournit l'infrastructure d'acteurs Goblin (quêtes, état, bus).
- **[xcraft-core-etc]** : Charge la configuration du module.
- **[xcraft-core-host]** : Fournit les informations sur l'environnement d'exécution (`appArgs`, `appData`, `appCompany`, `appId`).
- **[xcraft-core-utils]** : Fournit des utilitaires (mutex `locks` pour la synchronisation des opérations de fenêtre).
- **`statedb`** : Bibliothèque de persistance d'état utilisée par `client-session` (fichiers `.db` SQLite).
- **`passport-provider` / `passport-frame`** : Acteurs gérant le flux d'authentification OAuth/passport (créés dynamiquement si `useLogin` est activé).
- **`desktop-manager`** : Gère l'ouverture et la fermeture des sessions de bureau.

## Configuration avancée

Le module se configure via `config.js`, exploité par [`xcraft-core-etc`][xcraft-core-etc] :

| Option             | Description                                                 | Type      | Valeur par défaut |
| ------------------ | ----------------------------------------------------------- | --------- | ----------------- |
| `mainGoblin`       | Nom du goblin principal de l'application                    | `String`  | `""`              |
| `mainGoblinModule` | Nom du module npm contenant le goblin principal             | `String`  | `""`              |
| `contextId`        | Identifiant du contexte initial                             | `String`  | `""`              |
| `themeContexts`    | Liste des contextes de thème disponibles                    | `Array`   | `[]`              |
| `useConfigurator`  | Afficher le widget configurateur au démarrage               | `Boolean` | `false`           |
| `useLogin`         | Activer le processus d'authentification passport            | `Boolean` | `false`           |
| `appUserModelId`   | Identifiant AppUserModelId pour la barre des tâches Windows | `String`  | `null`            |
| `fullscreenable`   | Activer le support du mode plein écran                      | `Boolean` | `true`            |

### Variables d'environnement

| Variable   | Description                                                                                                          | Exemple               | Valeur par défaut |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------- |
| `NODE_ENV` | Mode d'exécution ; en `development`, l'URL webpack locale est utilisée à la place du bundle                          | `development`         | —                 |
| `APPIMAGE` | Chemin vers l'AppImage Linux ; utilisé lors du relancement de l'application pour passer `--appimage-extract-and-run` | `/opt/myapp.AppImage` | —                 |

## Détails des sources

### `lib/service.js`

Service **singleton** qui orchestre l'intégralité du cycle de vie de l'application client. Il est enregistré comme singleton via `Goblin.createSingle`.

#### État et modèle de données

```javascript
{
  booted: false,           // true après l'exécution de boot()
  private: {
    desktopByLab: {},      // { [labId]: desktopId } — mapping lab → bureau
    labByDesktop: {},      // { [desktopId]: labId } — mapping bureau → lab
  }
}
```

#### Méthodes publiques

- **`boot()`** — Initialise l'environnement Electron : vérifie les informations GPU, installe les extensions de développement (React DevTools, Redux DevTools), démarre le serveur webpack en mode développement ou utilise le bundle de production. Émet l'événement `<booted>` à la fin. N'exécute la logique qu'une seule fois (garde `BOOTING`).

- **`start()`** — Crée un nouveau laboratoire, souscrit aux événements de métriques, crée la session client via `createSession`, puis appelle `loadLaboratory`. Si `boot` n'a pas encore été appelé, il l'appelle.

- **`createSession(mainGoblin, labId, feed, parent)`** — Recherche un fichier de session existant dans le répertoire de données de l'application (`appData/appCompany`). Crée ou restaure le `client-session` correspondant. Crée également la `login-session` si `useLogin` est activé. Retourne le `clientSessionId`.

- **`loadLaboratory()`** — Instancie le laboratoire (`goblin-laboratory`) avec l'URL, la configuration et les feeds, puis appelle `startUX`. Applique la locale depuis les arguments de ligne de commande si présente.

- **`getLoginSessionId()`** — Retourne l'identifiant de la session de login courante.

- **`startUX()`** — Point d'entrée de l'interface utilisateur. Gère l'authentification (appelle `login` si `useLogin`), puis délègue à `configure` (si `useConfigurator`) ou à `startDesktopAppSession`.

- **`login(desktopId, loginSessionId, clientConfig)`** — Gère le flux d'authentification : vérifie la présence d'un token de renouvellement, tente un rafraîchissement silencieux, ou affiche la page de login via `passport-frame`. Stocke le token de renouvellement sur disque. Retourne `{info, status}`.

- **`logout()`** — Supprime le fichier de token de renouvellement et invalide les tokens de l'utilisateur courant.

- **`configure(desktopId, userId, username, clientSessionId, clientConfig, oldDesktopId)`** — Crée (ou réutilise) un acteur `configurator` et l'affiche comme widget racine du laboratoire. Souscrit à l'événement `configured` pour ouvrir la session demandée.

- **`openSession(session, username, userId, rootWidget, configuration, mainGoblin, mandate)`** — Ouvre une nouvelle session de bureau dans une nouvelle fenêtre. Si la session existe déjà (même `desktopId`), met la fenêtre existante au premier plan. Crée un nouveau laboratoire, une nouvelle `client-session` et appelle `startDesktopAppSession`.

- **`startDesktopAppSession(rootWidget, configuration, session, username, userId, labId, clientSessionId, desktopId, mainGoblin, useConfigurator)`** — Appelle `mainGoblin.configureDesktop`, ouvre le `desktop-manager` si disponible, puis définit le widget racine dans le laboratoire. Souscrit à `desktop-manager.<desktopId>.closed` pour fermer proprement la session.

- **`closeSession(labId, sessionDesktopId)`** — Ferme une session de bureau (nettoie la souscription à l'événement de fermeture).

- **`closeWindow(labId)`** — Met à jour l'état en supprimant la correspondance `labId ↔ desktopId`.

- **`dataTransfer(labId, desktopId, filePaths)`** — Délègue la gestion du drag-and-drop de fichiers au goblin principal via sa méthode `dataTransfer`, puis transmet le fichier à l'acteur cible.

- **`openExternal(url)`** — Ouvre une URL dans le navigateur par défaut (`shell.openExternal`) ou un chemin dans l'explorateur de fichiers (`shell.openPath`). Protège les variables d'environnement Xcraft/Node pendant l'appel.

- **`changeLocale(locale, mainGoblin, clientSessionId)`** — Délègue le changement de langue à la `client-session` correspondante.

- **`getLocale(mainGoblin, clientSessionId)`** — Récupère la langue courante depuis la `client-session` correspondante.

- **`appRelaunch(reason)`** — Relance l'application Electron en conservant les arguments de ligne de commande, en ajoutant `--relaunch-reason` et `--relaunch-desktops`. Gère les AppImages Linux.

- **`getConfig()`** — Retourne la configuration courante du module (contenu de `goblin-client` dans `xcraft-core-etc`).

---

### `lib/client-session.js`

Service **instanciable** qui gère la persistance des préférences utilisateur. Chaque session est identifiée par un fichier `.db` dans le répertoire de données de l'application. L'état est sauvegardé automatiquement après chaque mutation (appel à `quest.me.save()`). La section `private` n'est jamais persistée.

#### État et modèle de données

```javascript
{
  zoom: 1,                    // Facteur de zoom de l'interface
  locale: null,               // Locale active (ex: "fr-CH")
  userLocale: null,           // Préférence explicite de l'utilisateur
  theme: null,                // Identifiant du thème visuel actif
  views: {},                  // { [viewId]: { widths, order, sorting } }
  tips: {},                   // { [tipsId]: state }
  splitters: {},              // { [splitterId]: state }
  dialogs: {},                // { [dialogId]: state }
  desktopClock: {},           // { [theme]: state }
  translatableTextField: {},  // Configuration des champs traduisibles
  lastColorsPicker: [],       // Historique des couleurs récentes
  accessToEggsThemes: false,  // Accès aux thèmes cachés ("easter eggs")
  prototypeMode: false,       // Mode prototypage activé
  windows: [],                // Tableau des états de fenêtres persistés
  private: {
    osLocale: null,                // Locale détectée du système d'exploitation
    windowIndexes: { count: 0 }    // Index des fenêtres (non persisté)
  }
}
```

La **résolution de locale** suit cette logique dans `init-locale` : si l'utilisateur a défini une locale différente de celle du système, elle est conservée ; sinon, la locale système est utilisée et `userLocale` est réinitialisé à `null`.

#### Méthodes publiques

- **`create(id, sessionStorage)`** — Initialise la session : charge le fichier `.db` existant via `statedb`, restaure l'état si présent, résout la locale système via `nabu.findBestLocale` (Electron uniquement).

- **`setViewColumnsOrder(viewId, columnsIds)`** — Définit l'ordre des colonnes d'une vue.

- **`setViewColumnWidth(viewId, columnId, width)`** — Définit la largeur d'une colonne.

- **`setViewColumnSorting(viewId, columnId, direction)`** — Définit le tri actif d'une vue (`{columnId, direction}`).

- **`resetViewColumn(viewId)`** — Supprime toute la configuration d'une vue.

- **`setWindowState(winId, state)`** — Enregistre l'état d'une fenêtre (position, taille, etc.). Utilise un mutex par `winId` pour éviter les accès concurrents. À la première utilisation, assigne un index permanent à la fenêtre.

- **`getWindowState(winId, defaultState)`** — Récupère l'état persisté d'une fenêtre, ou initialise avec `defaultState` si la fenêtre n'est pas encore connue.

- **`closeWindow(winId)`** — Désinscrit la fenêtre de l'index.

- **`setLocale(locale)`** — Définit la locale active (sans modifier `userLocale`).

- **`changeLocale(locale)`** — Change la locale active **et** mémorise la préférence utilisateur (`userLocale`).

- **`getLocale()`** — Retourne la locale active courante.

- **`setTips(tipsId, state)`** — Persiste l'état d'une astuce UI.

- **`setSplitters(splitterId, state)`** — Persiste la position d'un séparateur.

- **`setDialogs(dialogId, state)`** — Persiste l'état d'une boîte de dialogue.

- **`setLastColorsPicker(state)`** — Persiste l'historique des couleurs du sélecteur.

- **`setDesktopClock(theme, state)`** — Persiste la configuration de l'horloge pour un thème donné.

- **`setTranslatableTextField(state)`** — Persiste la configuration des champs de texte traduisibles.

- **`setZoom(zoom)`** — Définit le facteur de zoom.

- **`getZoom()`** — Retourne le facteur de zoom actuel.

- **`setTheme(theme)`** — Définit le thème visuel actif.

- **`getTheme()`** — Retourne le thème visuel actif.

- **`setAccessToEggsThemes(show)`** — Active ou désactive l'accès aux thèmes cachés.

- **`togglePrototypeMode()`** — Bascule le mode prototypage.

- **`save()`** — Sérialise l'état courant (sans la section `private`) et l'écrit dans le fichier `.db` via `statedb`.

---

### `lib/child-process.js`

Service **instanciable** permettant de lancer et surveiller des processus systèmes externes depuis l'application. Il utilise `xcraft-core-process` pour la gestion de bas niveau.

#### État et modèle de données

```javascript
{
  id: 'child-process@<id>'; // Identifiant du service
}
```

Les paramètres du processus (`executablePath`, `options`) sont stockés en données volatiles (non persistées) via `quest.goblin.setX`.

#### Méthodes publiques

- **`create(executablePath, options)`** — Initialise le gestionnaire en mémorisant le chemin de l'exécutable et les options de lancement. Retourne l'identifiant du goblin.

- **`spawn(executableArguments, additionalOptions)`** — Lance le processus avec les arguments fournis. Les `additionalOptions` sont fusionnées avec les options initiales. Émet les événements suivants :
  - **`<child-process-spawned>`** avec `{pid}` si le processus démarre correctement.
  - **`<child-process-exited>`** avec `{exitCode, error}` à la fin du processus.
    Retourne le PID du processus lancé.

---

### `lib/GPUStatus.js`

Module utilitaire (non exposé sur le bus) pour analyser les capacités GPU de la machine hôte à partir de l'API Electron `app.getGPUFeatureStatus()`.

Chaque fonctionnalité GPU est classée en trois niveaux :

| Couleur  | Signification               | Exemples de statuts                     |
| -------- | --------------------------- | --------------------------------------- |
| 🚨 Rouge | Non disponible ou désactivé | `unavailable_off`, `disabled_off`       |
| 🚧 Jaune | Partiellement disponible    | `disabled_software`, `enabled_readback` |
| ⭐ Vert  | Pleinement disponible       | `enabled`, `enabled_force`              |

#### Méthodes exportées

- **`isBad(features)`** — Retourne `true` si **toutes** les fonctionnalités sont jaunes ou rouges (GPU globalement inutilisable).

- **`isMinimal(features)`** — Retourne `true` si au minimum `gpu_compositing` est vert (rendu de base disponible).

- **`getReport(features)`** — Génère un rapport textuel trié par criticité (rouge en premier), avec symboles et valeurs détaillées. Utilisé pour les logs de diagnostic au démarrage.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

---

[goblin-laboratory]: https://github.com/Xcraft-Inc/goblin-laboratory
[goblin-configurator]: https://github.com/Xcraft-Inc/goblin-configurator
[goblin-wm]: https://github.com/Xcraft-Inc/goblin-wm
[goblin-nabu]: https://github.com/Xcraft-Inc/goblin-nabu
[goblin-theme]: https://github.com/Xcraft-Inc/goblin-theme
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils

_Ce contenu a été généré par IA_
