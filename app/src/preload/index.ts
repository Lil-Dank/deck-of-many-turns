import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppState,
  ArchivedCombat,
  Condition,
  EncounterTemplate,
  LogEntryPatch,
  MonsterAction,
  MonsterTemplate,
  PC,
  Settings,
  Spell,
} from '../shared/types';

/** A phone-initiated save-based attack awaiting DM adjudication. */
export interface PlayerSavePendingInfo {
  id: string;
  actorName: string;
  attackName: string;
  ability: string;
  dc: number;
  damage: number;
  /** Damage on a successful save (half = legacy default, none = e.g. Acid Splash). */
  onSuccess: 'half' | 'none';
  targetIds: string[];
}

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('getState'),
  getPlayerViewOpen: (): Promise<boolean> => ipcRenderer.invoke('getPlayerViewOpen'),
  onState: (cb: (state: AppState) => void): (() => void) => {
    const handler = (_e: unknown, state: AppState) => cb(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  onPlayerViewOpen: (cb: (open: boolean) => void): (() => void) => {
    const handler = (_e: unknown, open: boolean) => cb(open);
    ipcRenderer.on('playerViewOpen', handler);
    return () => ipcRenderer.removeListener('playerViewOpen', handler);
  },
  /** Fired when the Stream Deck sends a command; used to show the Combat tab. */
  onFocusCombat: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('focusCombat', handler);
    return () => ipcRenderer.removeListener('focusCombat', handler);
  },

  savePc: (pc: Omit<PC, 'id'> & { id?: string }) => ipcRenderer.invoke('pc:save', pc),
  deletePc: (id: string) => ipcRenderer.invoke('pc:delete', id),
  savePcAttack: (pcId: string, action: MonsterAction) =>
    ipcRenderer.invoke('pc:saveAttack', { pcId, action }),
  deletePcAttack: (pcId: string, actionId: string) =>
    ipcRenderer.invoke('pc:deleteAttack', { pcId, actionId }),

  saveMonster: (m: Omit<MonsterTemplate, 'id'> & { id?: string }) =>
    ipcRenderer.invoke('monster:save', m),
  deleteMonster: (id: string) => ipcRenderer.invoke('monster:delete', id),
  importSrd: (): Promise<{ imported: number }> => ipcRenderer.invoke('monster:importSrd'),

  saveSpell: (s: Omit<Spell, 'id'> & { id?: string }) => ipcRenderer.invoke('spell:save', s),
  deleteSpell: (id: string) => ipcRenderer.invoke('spell:delete', id),
  importSrdSpells: (): Promise<{ imported: number }> => ipcRenderer.invoke('spell:importSrd'),
  /** Spend a slot (null = cantrip, log only). False when no slot is left. */
  castSpell: (
    pcId: string,
    spellName: string,
    slotLevel: number | null,
    concentration?: { name: string; deName?: string | null } | null,
  ): Promise<boolean> =>
    ipcRenderer.invoke('pc:castSpell', { pcId, spellName, slotLevel, concentration }),
  longRest: (pcId: string) => ipcRenderer.invoke('pc:longRest', pcId),
  /** Set or clear a combatant's Concentration tag. */
  setConcentration: (
    combatantId: string,
    value: { name: string; deName?: string | null } | null,
  ) => ipcRenderer.invoke('combat:setConcentration', { combatantId, value }),

  saveTemplate: (t: Omit<EncounterTemplate, 'id'> & { id?: string }) =>
    ipcRenderer.invoke('template:save', t),
  deleteTemplate: (id: string) => ipcRenderer.invoke('template:delete', id),
  duplicateTemplate: (id: string) => ipcRenderer.invoke('template:duplicate', id),

  startCombatSetup: (templateId: string, pcIds: string[], rollMode: 'all' | 'monstersOnly') =>
    ipcRenderer.invoke('combat:startSetup', { templateId, pcIds, rollMode }),
  setInitiative: (combatantId: string, value: number | null) =>
    ipcRenderer.invoke('combat:setInitiative', { combatantId, value }),
  rerollInitiative: (id: string) => ipcRenderer.invoke('combat:reroll', id),
  reorderCombatant: (fromIndex: number, toIndex: number) =>
    ipcRenderer.invoke('combat:reorder', { fromIndex, toIndex }),
  beginCombat: () => ipcRenderer.invoke('combat:begin'),
  endCombat: () => ipcRenderer.invoke('combat:end'),
  nextTurn: () => ipcRenderer.invoke('combat:nextTurn'),
  prevTurn: () => ipcRenderer.invoke('combat:prevTurn'),
  applyDamage: (
    combatantId: string,
    amount: number,
    ctx?: {
      actorName?: string;
      actorType?: 'pc' | 'monster';
      math?: string;
      mathTypes?: (string | null)[];
    },
  ) => ipcRenderer.invoke('combat:damage', { combatantId, amount, ctx }),
  applyHeal: (combatantId: string, amount: number) =>
    ipcRenderer.invoke('combat:heal', { combatantId, amount }),
  toggleCondition: (combatantId: string, condition: Condition) =>
    ipcRenderer.invoke('combat:toggleCondition', { combatantId, condition }),
  removeCombatant: (id: string) => ipcRenderer.invoke('combat:removeCombatant', id),
  editLogEntry: (id: string, patch: LogEntryPatch) =>
    ipcRenderer.invoke('log:edit', { id, patch }),
  deleteLogEntry: (id: string) => ipcRenderer.invoke('log:delete', id),
  /**
   * One saving throw the DM adjudicated in the attack modal. The player-web
   * flow logs its own via resolvePlayerSave; this is the DM-side twin, so both
   * routes leave the same card in the log.
   */
  logSaveRoll: (payload: {
    actorName: string;
    actorType: import('../shared/types').CombatantType;
    targetName?: string;
    targetType?: import('../shared/types').CombatantType;
    attackName: string;
    ability: string;
    dc: number;
    /** Absent when the DM typed a total instead of rolling. */
    die?: number;
    total: number;
    saved: boolean;
  }): Promise<void> => ipcRenderer.invoke('log:save', payload),
  addMonsterToCombat: (monsterTemplateId: string, quantity: number) =>
    ipcRenderer.invoke('combat:addMonster', { monsterTemplateId, quantity }),

  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),

  // ---- Kenku FM (audio plays through Kenku; these only talk to its remote) ----
  kenkuGetLibrary: (): Promise<import('../main/kenku').KenkuLibrary | null> =>
    ipcRenderer.invoke('kenku:getLibrary'),
  kenkuPlaySound: (id: string): Promise<boolean> => ipcRenderer.invoke('kenku:playSound', id),
  kenkuStopSound: (id: string): Promise<boolean> => ipcRenderer.invoke('kenku:stopSound', id),
  kenkuStopAll: (): Promise<void> => ipcRenderer.invoke('kenku:stopAll'),
  kenkuSoundPlayback: (): Promise<{ sounds: Array<{ id: string }> } | null> =>
    ipcRenderer.invoke('kenku:soundPlayback'),
  kenkuCheckConnection: (): Promise<boolean> => ipcRenderer.invoke('kenku:checkConnection'),
  kenkuAttackEvent: (
    payload: import('../main/kenku').AttackEventPayload & {
      /** Optional attack-roll details for the combat log (verdict phases). */
      roll?: import('../main/combatLog').AttackRollDetails;
    },
  ): Promise<void> => ipcRenderer.invoke('kenku:attackEvent', payload),
  togglePlayerView: () => ipcRenderer.invoke('playerView:toggle'),
  togglePlayerFullscreen: () => ipcRenderer.invoke('playerView:fullscreen'),

  // ---- Player web companion ----
  getPlayerWebQr: (): Promise<{
    urls: string[];
    port: number;
    error: string | null;
    dataUrls: string[];
  }> => ipcRenderer.invoke('playerWeb:getQr'),
  kickPlayer: (pcId: string): Promise<void> => ipcRenderer.invoke('playerWeb:kick', pcId),
  resolvePlayerSave: (
    id: string,
    results: Array<{ targetId: string; saved: boolean; total?: number; die?: number }>,
  ): Promise<void> => ipcRenderer.invoke('playerWeb:resolveSave', { id, results }),
  dismissPlayerSave: (id: string): Promise<void> => ipcRenderer.invoke('playerWeb:dismissSave', id),
  // ---- Saving throws owed (concentration checks, saves aimed at a PC) ----
  // The DM window hears about every one, whether or not a phone was also asked.
  openSaveRequest: (
    input: import('../main/saveRequests').SaveRequestInput,
  ): Promise<import('../main/saveRequests').SaveRequest | null> =>
    ipcRenderer.invoke('saveRequest:open', input),
  getSaveRequest: (
    id: string,
  ): Promise<import('../main/saveRequests').SaveRequest | null> =>
    ipcRenderer.invoke('saveRequest:get', id),
  resolveSaveThrow: (
    id: string,
    combatantId: string,
    result: import('../main/saveRequests').ThrowResult,
  ): Promise<boolean> => ipcRenderer.invoke('saveRequest:resolve', { id, combatantId, result }),
  closeSaveRequest: (id: string): Promise<void> => ipcRenderer.invoke('saveRequest:close', id),
  /** Dismiss: files the throw as a card in the log rather than losing it. */
  deferSaveRequest: (id: string): Promise<void> => ipcRenderer.invoke('saveRequest:defer', id),
  /** That card's "throw it": rebuild the request it was filed from. */
  reopenDeferredThrow: (entry: import('../shared/types').LogEntry): Promise<boolean> =>
    ipcRenderer.invoke('saveRequest:reopen', entry),
  onSaveRequest: (
    cb: (req: import('../main/saveRequests').SaveRequest) => void,
  ): (() => void) => {
    const handler = (_e: unknown, req: import('../main/saveRequests').SaveRequest) => cb(req);
    ipcRenderer.on('saveRequest', handler);
    return () => ipcRenderer.removeListener('saveRequest', handler);
  },
  onSaveRequestClosed: (cb: (id: string) => void): (() => void) => {
    const handler = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('saveRequestClosed', handler);
    return () => ipcRenderer.removeListener('saveRequestClosed', handler);
  },

  onPlayerSavePending: (cb: (pending: PlayerSavePendingInfo) => void): (() => void) => {
    const handler = (_e: unknown, pending: PlayerSavePendingInfo) => cb(pending);
    ipcRenderer.on('playerSavePending', handler);
    return () => ipcRenderer.removeListener('playerSavePending', handler);
  },

  // ---- Combat archive ----
  listArchive: (): Promise<ArchivedCombat[]> => ipcRenderer.invoke('archive:list'),
  deleteArchivedCombat: (id: string): Promise<void> => ipcRenderer.invoke('archive:delete', id),

  // ---- Campaigns ----
  createCampaign: (name: string): Promise<string> => ipcRenderer.invoke('campaign:create', { name }),
  switchCampaign: (id: string): Promise<void> => ipcRenderer.invoke('campaign:switch', { id }),
  renameCampaign: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('campaign:rename', { id, name }),
  deleteCampaign: (id: string): Promise<boolean> => ipcRenderer.invoke('campaign:delete', { id }),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
