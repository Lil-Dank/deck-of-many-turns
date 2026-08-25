import { ipcMain } from 'electron';
import * as QRCode from 'qrcode';
import { store } from './state';
import * as kenku from './kenku';
import { logAttackEvent, type AttackRollDetails } from './combatLog';
import {
  dismissPendingSave,
  getPlayerWebUrls,
  handleCampaignSwitch,
  kickPlayer,
  onPlayerSavePending,
  resolvePendingSave,
} from './playerServer';
import { importSrdMonsters, importSrdSpells } from './srd';
import { closeSavePrompt, pushSavePrompt } from './bridge';
import { reopenDeferredThrow } from './concentration';
import {
  closeRequest,
  deferRequest,
  getSaveRequest,
  onSaveRequestChanged,
  onSaveRequestClosed,
  openSaveRequest,
  resolveThrow,
  type SaveRequest,
} from './saveRequests';
import { onBridgeCommand } from './bridge';
import {
  flashDmWindow,
  getAllWindows,
  isPlayerViewOpen,
  togglePlayerFullscreen,
  togglePlayerView,
} from './windows';

export function registerIpc(): void {
  ipcMain.handle('getState', () => store.getState());
  ipcMain.handle('getPlayerViewOpen', () => isPlayerViewOpen());

  ipcMain.handle('pc:save', (_e, pc) => store.savePc(pc));
  ipcMain.handle('pc:delete', (_e, id) => store.deletePc(id));
  ipcMain.handle('pc:saveAttack', (_e, { pcId, action }) => store.savePcAttack(pcId, action));
  ipcMain.handle('pc:deleteAttack', (_e, { pcId, actionId }) =>
    store.deletePcAttack(pcId, actionId),
  );

  ipcMain.handle('monster:save', (_e, m) => store.saveMonster(m));
  ipcMain.handle('monster:delete', (_e, id) => store.deleteMonster(id));
  ipcMain.handle('monster:importSrd', () => importSrdMonsters());

  ipcMain.handle('spell:save', (_e, s) => store.saveSpell(s));
  ipcMain.handle('spell:delete', (_e, id) => store.deleteSpell(id));
  ipcMain.handle('spell:importSrd', () => importSrdSpells());
  ipcMain.handle('pc:castSpell', (_e, { pcId, spellName, slotLevel, concentration }) =>
    store.castSpell(pcId, spellName, slotLevel, undefined, concentration ?? null),
  );
  ipcMain.handle('pc:longRest', (_e, pcId) => store.longRest(pcId));
  ipcMain.handle('combat:setConcentration', (_e, { combatantId, value }) =>
    store.setConcentration(combatantId, value ?? null),
  );

  ipcMain.handle('template:save', (_e, t) => store.saveTemplate(t));
  ipcMain.handle('template:delete', (_e, id) => store.deleteTemplate(id));
  ipcMain.handle('template:duplicate', (_e, id) => store.duplicateTemplate(id));

  ipcMain.handle('combat:startSetup', (_e, { templateId, pcIds, rollMode }) =>
    store.startCombatSetup(templateId, pcIds, rollMode),
  );
  ipcMain.handle('combat:setInitiative', (_e, { combatantId, value }) =>
    store.setInitiative(combatantId, value),
  );
  ipcMain.handle('combat:reroll', (_e, id) => store.rerollInitiative(id));
  ipcMain.handle('combat:reorder', (_e, { fromIndex, toIndex }) =>
    store.reorderCombatant(fromIndex, toIndex),
  );
  ipcMain.handle('combat:begin', () => store.beginCombat());
  ipcMain.handle('combat:end', () => store.endCombat());
  ipcMain.handle('combat:nextTurn', () => store.nextTurn());
  ipcMain.handle('combat:prevTurn', () => store.prevTurn());
  ipcMain.handle('combat:damage', (_e, { combatantId, amount, ctx }) =>
    store.applyDamage(combatantId, amount, { source: 'dm', ...(ctx ?? {}) }),
  );
  ipcMain.handle('combat:heal', (_e, { combatantId, amount }) =>
    store.applyHeal(combatantId, amount),
  );
  ipcMain.handle('combat:toggleCondition', (_e, { combatantId, condition }) =>
    store.toggleCondition(combatantId, condition),
  );
  ipcMain.handle('combat:removeCombatant', (_e, id) => store.removeCombatant(id));
  ipcMain.handle('log:edit', (_e, { id, patch }) => store.editLogEntry(id, patch));
  ipcMain.handle('log:delete', (_e, id) => store.deleteLogEntry(id));

  // ---- Saving throws owed ----
  ipcMain.handle('saveRequest:open', (_e, input) => openSaveRequest(input));
  ipcMain.handle('saveRequest:get', (_e, id) => getSaveRequest(id) ?? null);
  ipcMain.handle('saveRequest:resolve', (_e, { id, combatantId, result }) =>
    resolveThrow(id, combatantId, result),
  );
  ipcMain.handle('saveRequest:close', (_e, id) => closeRequest(id));
  ipcMain.handle('saveRequest:defer', (_e, id) => deferRequest(id));
  ipcMain.handle('saveRequest:reopen', (_e, entry) =>
    reopenDeferredThrow(entry, { surface: 'dm' }),
  );
  ipcMain.handle('log:save', (_e, p) =>
    store.appendLog({
      kind: 'save',
      actorName: p.actorName,
      actorType: p.actorType,
      targetName: p.targetName,
      targetType: p.targetType,
      attackName: p.attackName,
      ability: p.ability,
      die: p.die,
      total: p.total,
      dc: p.dc,
      outcome: p.saved ? 'saved' : 'failed',
      source: 'dm',
    }),
  );
  ipcMain.handle('combat:addMonster', (_e, { monsterTemplateId, quantity }) =>
    store.addMonsterToCombat(monsterTemplateId, quantity),
  );

  ipcMain.handle('settings:update', (_e, patch) => store.updateSettings(patch));

  // ---- Player web ----
  ipcMain.handle('playerWeb:getQr', async () => {
    const { urls, port, error } = getPlayerWebUrls();
    const dataUrls = await Promise.all(
      urls.map((u) => QRCode.toDataURL(u, { margin: 1, width: 320 })),
    );
    return { urls, port, error, dataUrls };
  });
  ipcMain.handle('playerWeb:kick', (_e, pcId: string) => kickPlayer(pcId));
  ipcMain.handle('playerWeb:resolveSave', (_e, { id, results }) => resolvePendingSave(id, results));
  ipcMain.handle('playerWeb:dismissSave', (_e, id: string) => dismissPendingSave(id));

  // ---- Combat archive ----
  ipcMain.handle('archive:list', () => store.listArchive());
  ipcMain.handle('archive:delete', (_e, id: string) => store.deleteArchivedCombat(id));

  ipcMain.handle('campaign:create', (_e, { name }) => store.createCampaign(name));
  ipcMain.handle('campaign:switch', (_e, { id }) => handleCampaignSwitch(id));
  ipcMain.handle('campaign:rename', (_e, { id, name }) => store.renameCampaign(id, name));
  ipcMain.handle('campaign:delete', (_e, { id }) => store.deleteCampaign(id));

  ipcMain.handle('playerView:toggle', () => togglePlayerView());
  ipcMain.handle('playerView:fullscreen', () => togglePlayerFullscreen());

  // ---- Kenku FM ----
  ipcMain.handle('kenku:getLibrary', () => kenku.getLibrary());
  ipcMain.handle('kenku:playSound', (_e, id: string) => kenku.playSound(id));
  ipcMain.handle('kenku:stopSound', (_e, id: string) => kenku.stopSound(id));
  ipcMain.handle('kenku:stopAll', () => kenku.stopAllSounds());
  ipcMain.handle('kenku:soundPlayback', () => kenku.getSoundboardPlayback());
  ipcMain.handle('kenku:checkConnection', async () => {
    const ok = await kenku.checkConnection();
    store.setKenkuConnected(store.getState().settings.kenku.enabled && ok);
    return ok;
  });
  ipcMain.handle(
    'kenku:attackEvent',
    (_e, payload: kenku.AttackEventPayload & { roll?: AttackRollDetails }) => {
      kenku.handleAttackEvent(payload);
      logAttackEvent(payload.phase, payload.roll, 'dm');
    },
  );

  // Push every state change to all open windows.
  store.onChange((state) => {
    for (const win of getAllWindows()) {
      win.webContents.send('state', state);
    }
  });

  // A Stream Deck press means the DM is running combat — switch the DM
  // window to the Combat screen if it's showing something else.
  onBridgeCommand(() => {
    for (const win of getAllWindows()) {
      win.webContents.send('focusCombat');
    }
  });

  // A phone launched a save-based action: the DM window opens the
  // adjudication modal (rolled or manually entered saves per target).
  onPlayerSavePending((pending) => {
    for (const win of getAllWindows()) {
      win.webContents.send('playerSavePending', pending);
    }
  });

  // A saving throw is owed. The DM window always hears about it — whether or
  // not a phone was also asked — and the taskbar flashes when the app is not
  // the focused window.
  onSaveRequestChanged((req: SaveRequest) => {
    for (const win of getAllWindows()) win.webContents.send('saveRequest', req);
    if (req.targets.some((t) => !t.result)) flashDmWindow(true);
    // The decks get it too, so a throw can be answered on hardware. They only
    // take it when idle (see picker.beginSavePrompt), and never for a pickup:
    // reaching for a deferred card claims the throw for whoever reached.
    if (!req.pickedUpBy) pushSavePrompt(req);
  });
  onSaveRequestClosed((id) => {
    for (const win of getAllWindows()) win.webContents.send('saveRequestClosed', id);
    flashDmWindow(false);
    closeSavePrompt(id);
  });
}

/** Let windows know when the Player View opens/closes (button label state). */
export function broadcastPlayerViewStatus(): void {
  for (const win of getAllWindows()) {
    win.webContents.send('playerViewOpen', isPlayerViewOpen());
  }
}
