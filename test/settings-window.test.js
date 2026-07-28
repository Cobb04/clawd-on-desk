const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const createSettingsWindowRuntime = require("../src/settings-window");

class FakeBrowserWindow {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.minimized = false;
    this.maximized = false;
    this.fullScreen = false;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.normalBounds = { ...this.bounds };
    this.calls = [];
    this.events = new Map();
    this.onceEvents = new Map();
    // Minimal webContents so the production-critical did-finish-load title
    // reapply callback (settings-window.js) is exercisable. insertCSS is
    // intentionally absent — applyZoomToWindow bails safely without it.
    this.webContents = {
      isDestroyed: () => false,
      onceCallbacks: new Map(),
      once: (event, cb) => this.webContents.onceCallbacks.set(event, cb),
      send: () => {},
    };
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  isMaximized() {
    return this.maximized;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  getBounds() {
    return { ...this.bounds };
  }

  getNormalBounds() {
    return { ...this.normalBounds };
  }

  restore() {
    this.calls.push("restore");
    this.minimized = false;
  }

  show() {
    this.calls.push("show");
  }

  moveTop() {
    this.calls.push("moveTop");
  }

  focus() {
    this.calls.push("focus");
  }

  setAlwaysOnTop(value, level) {
    this.calls.push(["setAlwaysOnTop", value, level]);
    this.alwaysOnTop = value;
    this.alwaysOnTopLevel = level;
  }

  setAppDetails(details) {
    this.calls.push("setAppDetails");
    this.appDetails = details;
  }

  setMenuBarVisibility(value) {
    this.calls.push(["setMenuBarVisibility", value]);
    this.menuBarVisible = value;
  }

  setTitle(value) {
    this.calls.push(["setTitle", value]);
    this.title = value;
  }

  loadFile(filePath) {
    this.calls.push(["loadFile", filePath]);
    this.loadedFile = filePath;
  }

  once(eventName, listener) {
    this.onceEvents.set(eventName, listener);
  }

  on(eventName, listener) {
    this.events.set(eventName, listener);
  }

  emit(eventName) {
    const onceListener = this.onceEvents.get(eventName);
    if (onceListener) {
      this.onceEvents.delete(eventName);
      onceListener();
    }
    const listener = this.events.get(eventName);
    if (listener) listener();
  }

  emitWebContents(eventName) {
    const cb = this.webContents.onceCallbacks.get(eventName);
    if (cb) {
      this.webContents.onceCallbacks.delete(eventName);
      cb();
    }
  }
}

function createFakeApp({ ready = true, packaged = false } = {}) {
  const listeners = new Map();
  return {
    app: {
      isPackaged: packaged,
      isReady: () => ready,
      getAppPath: () => "C:\\app",
      once(eventName, listener) {
        listeners.set(eventName, listener);
      },
    },
    listeners,
  };
}

function createFakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
}

function findPendingTimer(timers, delay) {
  return timers.find((timer) => timer.delay === delay && !timer.cleared);
}

function createRuntime(options = {}) {
  FakeBrowserWindow.instances = [];
  const { app, listeners } = createFakeApp(options.app);
  const fakeTimers = createFakeTimers();
  const fs = {
    existsSync(filePath) {
      return /assets[\\/](icons[\\/]256x256\.png|icon\.ico)$/.test(filePath);
    },
  };
  const runtime = createSettingsWindowRuntime({
    app,
    BrowserWindow: FakeBrowserWindow,
    fs,
    isWin: true,
    nativeTheme: { shouldUseDarkColors: !!options.dark },
    path: path.win32,
    platform: "win32",
    resourcesPath: "C:\\resources",
    execPath: "C:\\electron\\electron.exe",
    appDir: "C:\\app",
    settingsHtmlPath: "C:\\app\\src\\settings.html",
    preloadPath: "C:\\app\\src\\preload-settings.js",
    setTimeout: fakeTimers.setTimeout,
    clearTimeout: fakeTimers.clearTimeout,
    ...options.runtime,
  });
  return { runtime, listeners, timers: fakeTimers.timers };
}

test("settings window runtime creates the Settings BrowserWindow with taskbar identity", () => {
  const events = [];
  let runtime;
  let timers;
  ({ runtime, timers } = createRuntime({
    dark: true,
    runtime: {
      onBeforeCreate: () => events.push("before-create"),
      onBeforeClosed: () => events.push("before-closed"),
      onAfterClosed: () => events.push(runtime.getWindow() === null ? "after-closed-null" : "after-closed-live"),
    },
  }));

  runtime.open();
  assert.strictEqual(FakeBrowserWindow.instances.length, 1);
  const win = FakeBrowserWindow.instances[0];

  assert.strictEqual(runtime.getWindow(), win);
  assert.strictEqual(win.options.title, "Clawd Settings");
  assert.strictEqual(win.options.x, 240);
  assert.strictEqual(win.options.y, 120);
  assert.strictEqual(win.options.width, 800);
  assert.strictEqual(win.options.height, 560);
  assert.strictEqual(win.options.backgroundColor, "#1c1c1f");
  assert.strictEqual(win.options.webPreferences.preload, "C:\\app\\src\\preload-settings.js");
  assert.strictEqual(win.options.webPreferences.nodeIntegration, false);
  assert.strictEqual(win.options.webPreferences.contextIsolation, true);
  assert.deepStrictEqual(win.options.webPreferences.additionalArguments, [
    "--discord-default-app-id-present=0",
  ]);
  assert.match(win.options.icon, /assets[\\/]icons[\\/]256x256\.png$/);
  assert.strictEqual(win.menuBarVisible, false);
  assert.strictEqual(win.loadedFile, "C:\\app\\src\\settings.html");
  assert.match(win.appDetails.appIconPath, /assets[\\/]icon\.ico$/);
  assert.ok(win.appDetails.relaunchCommand.includes("--open-settings-window"));
  assert.deepStrictEqual(events, ["before-create"]);

  win.emit("ready-to-show");
  assert.deepStrictEqual(win.calls.slice(-4), [
    "show",
    ["setAlwaysOnTop", true, undefined],
    "moveTop",
    "focus",
  ]);
  assert.strictEqual(findPendingTimer(timers, 2000), undefined);

  const lowerTimer = findPendingTimer(timers, 200);
  assert.ok(lowerTimer);
  lowerTimer.callback();
  assert.deepStrictEqual(win.calls.at(-1), ["setAlwaysOnTop", false, undefined]);

  win.emit("closed");
  assert.deepStrictEqual(events, ["before-create", "before-closed", "after-closed-null"]);
  assert.strictEqual(runtime.getWindow(), null);
});

test("settings window uses and refreshes the localized title", () => {
  let title = "Clawd 设置";
  const { runtime } = createRuntime({ runtime: { getTitle: () => title } });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  assert.strictEqual(win.options.title, "Clawd 设置");

  title = "Clawd 設定";
  runtime.applyTitleToWindow();
  assert.strictEqual(win.title, "Clawd 設定");
});

test("did-finish-load reapplies the localized title after the HTML <title> loads", () => {
  // The HTML page ships a fixed English <title>, which Electron applies once
  // the document loads. The did-finish-load callback must reapply the localized
  // native title so the title bar never reverts to English mid-session.
  let title = "Clawd 设置";
  const { runtime } = createRuntime({ runtime: { getTitle: () => title } });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  assert.strictEqual(win.options.title, "Clawd 设置");

  // Simulate the page finishing load with a new localized title in effect.
  win.calls = [];
  title = "Clawd 設定";
  win.emitWebContents("did-finish-load");

  assert.deepStrictEqual(
    win.calls.at(-1),
    ["setTitle", "Clawd 設定"],
    "localized title reapplied after did-finish-load",
  );
});

test("settings window injects the Discord default-App-ID flag into the sandboxed preload", () => {
  // The flag can't be require()'d in a sandboxed preload, so it must ride
  // additionalArguments. A missing/drifted injection here blanked the entire
  // Settings window once — this guards both the presence and the "1"/"0" value.
  const present = createRuntime({ runtime: { discordDefaultAppIdPresent: true } });
  present.runtime.open();
  assert.deepStrictEqual(
    FakeBrowserWindow.instances[0].options.webPreferences.additionalArguments,
    ["--discord-default-app-id-present=1"],
  );

  const absent = createRuntime({ runtime: { discordDefaultAppIdPresent: false } });
  absent.runtime.open();
  assert.deepStrictEqual(
    FakeBrowserWindow.instances[0].options.webPreferences.additionalArguments,
    ["--discord-default-app-id-present=0"],
  );
});

test("settings window runtime reuses an existing non-destroyed Settings window", () => {
  const { runtime, timers } = createRuntime();
  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  win.emit("ready-to-show");
  findPendingTimer(timers, 200).callback();
  win.calls = [];
  win.minimized = true;

  runtime.open();

  assert.strictEqual(FakeBrowserWindow.instances.length, 1);
  assert.deepStrictEqual(win.calls, [
    "restore",
    "show",
    ["setAlwaysOnTop", true, undefined],
    "moveTop",
    "focus",
  ]);
});

test("settings window runtime defers opening until Electron is ready", () => {
  const { runtime, listeners } = createRuntime({ app: { ready: false } });

  runtime.openWhenReady();

  assert.strictEqual(FakeBrowserWindow.instances.length, 0);
  assert.strictEqual(typeof listeners.get("ready"), "function");

  listeners.get("ready")();

  assert.strictEqual(FakeBrowserWindow.instances.length, 1);
});

test("settings window runtime places the first Settings window on the pet display", () => {
  let nearestArgs = null;
  const { runtime } = createRuntime({
    runtime: {
      getPetWindowBounds: () => ({ x: 1700, y: 100, width: 280, height: 280 }),
      getNearestWorkArea: (cx, cy) => {
        nearestArgs = { cx, cy };
        return { x: 1280, y: 40, width: 1600, height: 900 };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];

  assert.deepStrictEqual(nearestArgs, { cx: 1840, cy: 240 });
  assert.strictEqual(win.options.x, 1680);
  assert.strictEqual(win.options.y, 210);
  assert.strictEqual(win.options.width, 800);
  assert.strictEqual(win.options.height, 560);
});

test("settings window restores the last bounds after close and reopen", () => {
  let savedBounds = null;
  const { runtime } = createRuntime({
    runtime: {
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      getSavedBounds: () => savedBounds,
      onSaveBounds: (bounds) => {
        savedBounds = bounds;
        return { status: "ok" };
      },
    },
  });

  runtime.open();
  const first = FakeBrowserWindow.instances[0];
  first.bounds = { x: 73, y: 91, width: 1040, height: 720 };
  first.normalBounds = { ...first.bounds };
  first.emit("close");
  first.emit("closed");
  runtime.open();

  const second = FakeBrowserWindow.instances[1];
  assert.deepStrictEqual(
    {
      x: second.options.x,
      y: second.options.y,
      width: second.options.width,
      height: second.options.height,
    },
    { x: 73, y: 91, width: 1040, height: 720 },
  );
});

test("settings window clamps saved bounds to the nearest surviving work area", () => {
  let nearestArgs = null;
  const { runtime } = createRuntime({
    runtime: {
      getSavedBounds: () => ({ x: 2000, y: 100, width: 1600, height: 1000 }),
      getNearestWorkArea: (cx, cy) => {
        nearestArgs = { cx, cy };
        return { x: 0, y: 0, width: 1280, height: 800 };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];

  assert.deepStrictEqual(nearestArgs, { cx: 2800, cy: 600 });
  assert.deepStrictEqual(
    {
      x: win.options.x,
      y: win.options.y,
      width: win.options.width,
      height: win.options.height,
    },
    { x: 0, y: 0, width: 1280, height: 800 },
  );
});

test("settings window ignores malformed saved bounds and keeps the pet-display fallback", () => {
  let nearestArgs = null;
  const { runtime } = createRuntime({
    runtime: {
      getSavedBounds: () => ({ x: 900, y: 100, width: 0.4, height: 720 }),
      getPetWindowBounds: () => ({ x: 1700, y: 100, width: 280, height: 280 }),
      getNearestWorkArea: (cx, cy) => {
        nearestArgs = { cx, cy };
        return { x: 1280, y: 40, width: 1600, height: 900 };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];

  assert.deepStrictEqual(nearestArgs, { cx: 1840, cy: 240 });
  assert.deepStrictEqual(
    {
      x: win.options.x,
      y: win.options.y,
      width: win.options.width,
      height: win.options.height,
    },
    { x: 1680, y: 210, width: 800, height: 560 },
  );
});

test("settings window debounces move and resize bounds saves", () => {
  const saved = [];
  const { runtime, timers } = createRuntime({
    runtime: {
      onSaveBounds: (bounds) => {
        saved.push(bounds);
        return { status: "ok" };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  win.bounds = { x: 100, y: 120, width: 900, height: 620 };
  win.normalBounds = { ...win.bounds };
  win.emit("move");
  win.bounds = { x: 140, y: 150, width: 960, height: 680 };
  win.normalBounds = { ...win.bounds };
  win.emit("move");
  win.bounds = { x: 140, y: 150, width: 1020, height: 700 };
  win.normalBounds = { ...win.bounds };
  win.emit("resize");

  const saveTimers = timers.filter((timer) => timer.delay === 500);
  assert.strictEqual(saveTimers.length, 3);
  assert.strictEqual(saveTimers[0].cleared, true);
  assert.strictEqual(saveTimers[1].cleared, true);
  assert.strictEqual(saveTimers[2].cleared, false);
  assert.deepStrictEqual(saved, []);

  saveTimers[2].callback();
  assert.deepStrictEqual(saved, [
    { x: 140, y: 150, width: 1020, height: 700 },
  ]);
});

test("settings window close flushes the latest bounds and clears the debounce", () => {
  const saved = [];
  const { runtime, timers } = createRuntime({
    runtime: {
      onSaveBounds: (bounds) => {
        saved.push(bounds);
        return { status: "ok" };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  win.bounds = { x: 80, y: 90, width: 980, height: 660 };
  win.normalBounds = { ...win.bounds };
  win.emit("move");
  const pending = findPendingTimer(timers, 500);
  assert.ok(pending);

  win.bounds = { x: 90, y: 110, width: 1000, height: 700 };
  win.normalBounds = { ...win.bounds };
  win.emit("close");

  assert.strictEqual(pending.cleared, true);
  assert.deepStrictEqual(saved, [
    { x: 90, y: 110, width: 1000, height: 700 },
  ]);
});

test("settings window saves normal bounds while maximized", () => {
  const saved = [];
  const { runtime } = createRuntime({
    runtime: {
      onSaveBounds: (bounds) => {
        saved.push(bounds);
        return { status: "ok" };
      },
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  win.maximized = true;
  win.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  win.normalBounds = { x: 120, y: 80, width: 960, height: 680 };
  win.emit("close");

  assert.deepStrictEqual(saved, [
    { x: 120, y: 80, width: 960, height: 680 },
  ]);
});

test("settings window close flushes normal bounds while minimized or full screen", () => {
  for (const stateKey of ["minimized", "fullScreen"]) {
    const saved = [];
    const { runtime, timers } = createRuntime({
      runtime: {
        onSaveBounds: (bounds) => {
          saved.push(bounds);
          return { status: "ok" };
        },
      },
    });

    runtime.open();
    const win = FakeBrowserWindow.instances[0];
    win.bounds = { x: 130, y: 90, width: 980, height: 690 };
    win.normalBounds = { ...win.bounds };
    win.emit("move");
    const pending = findPendingTimer(timers, 500);
    assert.ok(pending, `${stateKey}: expected a pending bounds save`);

    win[stateKey] = true;
    win.emit("close");

    assert.strictEqual(pending.cleared, true, `${stateKey}: pending save should be cleared`);
    assert.deepStrictEqual(
      saved,
      [{ x: 130, y: 90, width: 980, height: 690 }],
      `${stateKey}: close should flush normal bounds`,
    );
  }
});

test("settings window runtime shows from timeout if ready-to-show never fires", () => {
  const { runtime, timers } = createRuntime();

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  const readyFallbackTimer = findPendingTimer(timers, 2000);
  assert.ok(readyFallbackTimer);

  readyFallbackTimer.callback();
  assert.deepStrictEqual(win.calls.slice(-4), [
    "show",
    ["setAlwaysOnTop", true, undefined],
    "moveTop",
    "focus",
  ]);

  win.calls = [];
  win.emit("ready-to-show");
  assert.deepStrictEqual(win.calls, []);
});

test("settings window runtime does not show twice if reopened before ready", () => {
  const { runtime, timers } = createRuntime();

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  runtime.open();

  assert.deepStrictEqual(win.calls.slice(-4), [
    "show",
    ["setAlwaysOnTop", true, undefined],
    "moveTop",
    "focus",
  ]);
  assert.strictEqual(findPendingTimer(timers, 2000), undefined);

  win.calls = [];
  win.emit("ready-to-show");
  assert.deepStrictEqual(win.calls, []);
});

test("settings window runtime skips temporary front lift outside Windows", () => {
  const { runtime } = createRuntime({
    runtime: {
      isWin: false,
      platform: "linux",
    },
  });

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  win.emit("ready-to-show");

  assert.deepStrictEqual(win.calls.slice(-3), ["show", "moveTop", "focus"]);
  assert.strictEqual(win.calls.some((call) => Array.isArray(call) && call[0] === "setAlwaysOnTop"), false);
});

test("settings window move re-applies text scale and pokes the slider context (debounced)", () => {
  const { runtime, timers } = createRuntime();

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  const sends = [];
  win.webContents = {
    isDestroyed: () => false,
    send: (channel) => sends.push(channel),
  };

  // Two quick moves: the first debounce timer is superseded, nothing fires
  // until the surviving timer runs.
  win.emit("move");
  win.emit("move");
  const moveTimers = timers.filter((timer) => timer.delay === 350);
  assert.strictEqual(moveTimers.length, 2);
  assert.strictEqual(moveTimers[0].cleared, true);
  assert.strictEqual(moveTimers[1].cleared, false);
  assert.deepStrictEqual(sends, []);

  moveTimers[1].callback();
  assert.deepStrictEqual(sends, ["settings:text-scale-context-changed"]);
});

test("applyTextScaleToWindow pokes the slider context even when zoom injection is unavailable", () => {
  const { runtime } = createRuntime();

  runtime.open();
  const win = FakeBrowserWindow.instances[0];
  const sends = [];
  // No insertCSS: applyZoomToWindow bails, but the context poke (which the
  // cross-display slider sync depends on) must still go out.
  win.webContents = { send: (channel) => sends.push(channel) };

  runtime.applyTextScaleToWindow();
  assert.deepStrictEqual(sends, ["settings:text-scale-context-changed"]);
});
