import { app, BrowserWindow } from 'electron';
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { CampaignsFile } from '../shared/types';
import { store } from './state';
import { registerIpc, broadcastPlayerViewStatus } from './ipc';
import { createDmWindow, initWindowState, onPlayerViewChanged } from './windows';
import { startBridge } from './bridge';
import { startPlayerServer, stopPlayerServer } from './playerServer';
import { startConcentrationChecks } from './concentration';
import { loadGermanMonsterNames, loadGermanSpellL10n } from './srd';
import { handleCombatEvent, startKenkuStatusPolling } from './kenku';
import { setMonsterNameMap } from '../shared/i18n';

/**
 * One-time data migration for the Deck of Many Turns rebrand: the package
 * name changed, so userData moved from %APPDATA%/dnd-combat-tracker. Copy
 * (never move — the old folder stays as a backup) exactly once, only when
 * the new location has no data yet.
 */
function migrateLegacyUserData(userData: string): void {
  const newData = path.join(userData, 'data');
  const legacyData = path.join(app.getPath('appData'), 'dnd-combat-tracker', 'data');
  if (existsSync(newData) || !existsSync(legacyData)) return;
  try {
    cpSync(legacyData, newData, { recursive: true });
    console.log(`Migrated user data from ${legacyData} to ${newData}`);
  } catch (err) {
    console.error('User-data migration failed; starting fresh', err);
  }
}

/** The five stores that scope per campaign; everything else stays global. */
const CAMPAIGN_FILES = [
  'pcs.json',
  'encounter-templates.json',
  'combat.json',
  'combat-archive.json',
  'player-claims.json',
];

/**
 * One-time migration to the campaign layout: existing flat data/ files move
 * into data/campaigns/<id>/ as "Main Campaign". Fresh installs take the same
 * path (nothing to move) so the app always boots with one campaign and never
 * prompts. Move, not copy — stale root duplicates would shadow the layout.
 */
function migrateToCampaigns(userData: string): void {
  const dataDir = path.join(userData, 'data');
  const indexFile = path.join(dataDir, 'campaigns.json');
  if (existsSync(indexFile)) return;
  const id = randomUUID();
  const campaignDir = path.join(dataDir, 'campaigns', id);
  try {
    mkdirSync(campaignDir, { recursive: true });
    for (const file of CAMPAIGN_FILES) {
      const from = path.join(dataDir, file);
      if (!existsSync(from)) continue;
      const to = path.join(campaignDir, file);
      try {
        renameSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
    }
    const index: CampaignsFile = {
      campaigns: [{ id, name: 'Main Campaign', createdAt: Date.now() }],
      activeId: id,
    };
    writeFileSync(indexFile, JSON.stringify(index, null, 2));
    console.log(`Campaign layout ready at ${campaignDir}`);
  } catch (err) {
    console.error('Campaign migration failed', err);
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  migrateLegacyUserData(userData);
  migrateToCampaigns(userData);
  await store.init(userData);
  await initWindowState(userData);
  const l10nDe = await loadGermanMonsterNames();
  setMonsterNameMap(l10nDe);
  await store.backfillMonsterL10n(l10nDe);
  await store.backfillSpellL10n(await loadGermanSpellL10n());
  registerIpc();
  onPlayerViewChanged(() => broadcastPlayerViewStatus());
  startBridge();
  startPlayerServer();
  startConcentrationChecks();
  store.onCombatEvent(handleCombatEvent);
  startKenkuStatusPolling();
  createDmWindow(store.getState().settings.theme);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDmWindow(store.getState().settings.theme);
  });
});

app.on('window-all-closed', () => {
  stopPlayerServer();
  app.quit();
});
