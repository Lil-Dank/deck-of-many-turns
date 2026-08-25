import { app, BrowserWindow, screen, shell } from 'electron';
import * as path from 'path';
import { JsonValue } from './storage';
import { groundFor } from '../shared/brand';

interface PlayerWindowState {
  bounds: { x: number; y: number; width: number; height: number } | null;
  fullscreen: boolean;
}

let dmWindow: BrowserWindow | null = null;
let playerWindow: BrowserWindow | null = null;
let playerWindowState: JsonValue<PlayerWindowState>;

/**
 * Window icon. On Windows the multi-size .ico matters: the title-bar corner
 * is 16 px, and scaling the 256 px PNG down looks mushy - the .ico carries a
 * simplified d20 drawn for that size, and Windows picks it directly.
 */
function appIcon(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(app.getAppPath(), 'resources', file);
}

export function initWindowState(userDataDir: string): Promise<void> {
  playerWindowState = new JsonValue<PlayerWindowState>(
    path.join(userDataDir, 'data', 'player-window.json'),
    { bounds: null, fullscreen: false },
  );
  return playerWindowState.load();
}

function loadRenderer(win: BrowserWindow, hash: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash });
  }
}

/** `theme` only sets the pre-paint colour; the renderer takes over after. */
export function createDmWindow(theme?: string): BrowserWindow {
  dmWindow = new BrowserWindow({
    icon: appIcon(),
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Deck of Many Turns — DM',
    // Pre-paint colour: reading the stored theme keeps launch from
    // flashing one palette's ground before another one renders.
    backgroundColor: groundFor(theme),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dmWindow.on('ready-to-show', () => dmWindow?.show());
  dmWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  dmWindow.on('closed', () => {
    dmWindow = null;
    // The Player View is useless without the DM window; close it too.
    playerWindow?.close();
  });
  loadRenderer(dmWindow, 'dm');
  return dmWindow;
}

/** True if the saved bounds are visibly on some connected display. */
function boundsVisible(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      b.x + b.width > a.x + 40 &&
      b.x < a.x + a.width - 40 &&
      b.y + b.height > a.y + 40 &&
      b.y < a.y + a.height - 40
    );
  });
}

export function togglePlayerView(): void {
  if (playerWindow) {
    playerWindow.close();
    return;
  }
  const saved = playerWindowState.get();
  const useSaved = saved.bounds && boundsVisible(saved.bounds);

  playerWindow = new BrowserWindow({
    icon: appIcon(),
    width: useSaved ? saved.bounds!.width : 1024,
    height: useSaved ? saved.bounds!.height : 768,
    x: useSaved ? saved.bounds!.x : undefined,
    y: useSaved ? saved.bounds!.y : undefined,
    show: false,
    autoHideMenuBar: true,
    title: 'Deck of Many Turns — Player View',
    backgroundColor: '#1a1423',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Always open windowed — fullscreen is a per-session toggle, never restored.
  playerWindow.on('ready-to-show', () => playerWindow?.show());

  const saveState = () => {
    if (!playerWindow) return;
    // Don't record fullscreen bounds as the window's floating bounds.
    const bounds = playerWindow.isFullScreen()
      ? playerWindowState.get().bounds
      : playerWindow.getBounds();
    void playerWindowState.set({ bounds, fullscreen: false });
  };
  playerWindow.on('moved', saveState);
  playerWindow.on('resized', saveState);
  playerWindow.on('closed', () => {
    playerWindow = null;
    notifyPlayerViewChanged();
  });
  loadRenderer(playerWindow, 'player');
  notifyPlayerViewChanged();
}

export function togglePlayerFullscreen(): void {
  if (!playerWindow) return;
  playerWindow.setFullScreen(!playerWindow.isFullScreen());
}

export function isPlayerViewOpen(): boolean {
  return playerWindow !== null;
}

let playerViewChangedCb: (() => void) | null = null;
export function onPlayerViewChanged(cb: () => void): void {
  playerViewChangedCb = cb;
}
function notifyPlayerViewChanged(): void {
  playerViewChangedCb?.();
}

/**
 * Flash the DM window in the taskbar. Used when a saving throw is owed and the
 * app is not the focused window — a concentration check usually lands while the
 * DM is in OBS or a browser. Deliberately does NOT raise or focus the window:
 * stealing focus mid-scene is worse than a missed prompt.
 */
export function flashDmWindow(on: boolean): void {
  if (!dmWindow || dmWindow.isDestroyed()) return;
  if (on && dmWindow.isFocused()) return;
  dmWindow.flashFrame(on);
}

export function getAllWindows(): BrowserWindow[] {
  return [dmWindow, playerWindow].filter((w): w is BrowserWindow => w !== null);
}
