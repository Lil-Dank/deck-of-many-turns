import * as path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { JsonCollection, JsonValue } from './storage';
import type {
  KenkuEventId,
  AppState,
  ArchivedCombat,
  CampaignInfo,
  CampaignsFile,
  Combat,
  Combatant,
  Condition,
  EncounterTemplate,
  LogEntry,
  LogEntryPatch,
  LogSource,
  MonsterAction,
  MonsterTemplate,
  PC,
  PlayerClaimInfo,
  Settings,
  Spell,
  SpellSlots,
} from '../shared/types';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/types';
import { monsterName } from '../shared/i18n';
import { applyLogEntryDelete, applyLogEntryEdit } from '../shared/logEdit';
import { migrateActions } from './migrate';

export type ChangeListener = (state: AppState) => void;

/** Who performed a mutation, for the combat log. Defaults to the DM window. */
export interface ActionContext {
  source: LogSource;
  /** Acting combatant's display name (player web actions carry their PC). */
  actorName?: string;
  actorType?: 'pc' | 'monster';
  /** Rolled-damage composition for the log ("2d6 [3+5] +4 = 12"). */
  math?: string;
  /** Damage type per bracket group of `math` (null = unknown). */
  mathTypes?: (string | null)[];
  /** Player-sourced actions: the claim's player name or a device label. */
  sourceName?: string;
}

const DM_CTX: ActionContext = { source: 'dm' };

const d20 = () => Math.floor(Math.random() * 20) + 1;

/**
 * Clamps spell slots into shape: 9 non-negative integer levels, current never
 * above max. Undefined/null (PC has no slots configured) stays null.
 */
function normalizeSlots(slots: SpellSlots | null | undefined): SpellSlots | null {
  if (!slots || !Array.isArray(slots.max)) return null;
  const clean = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const max = Array.from({ length: 9 }, (_, i) => clean(slots.max[i]));
  const current = Array.from({ length: 9 }, (_, i) =>
    Math.min(clean((slots.current ?? [])[i] ?? max[i]), max[i]),
  );
  if (max.every((v) => v === 0)) return null;
  return { max, current };
}

/**
 * Canonical application state. All mutations flow through this store in the
 * main process; every change persists to disk and notifies listeners
 * (renderer windows + the Stream Deck bridge).
 */
export class AppStore {
  private pcs!: JsonCollection<PC>;
  private monsters!: JsonCollection<MonsterTemplate>;
  private spells!: JsonCollection<Spell>;
  private templates!: JsonCollection<EncounterTemplate>;
  private settings!: JsonValue<Settings>;
  private combat!: JsonValue<Combat | null>;
  private archive!: JsonCollection<ArchivedCombat>;
  private campaignsIndex!: JsonValue<CampaignsFile>;
  private dataDir = '';
  activeCampaignId = '';
  private listeners = new Set<ChangeListener>();
  bridgeClientCount = 0;
  kenkuConnected = false;
  playerClients: PlayerClaimInfo[] = [];
  /** Combat happenings for side-effect listeners (Kenku sounds); see index.ts. */
  private combatEventListener: ((event: KenkuEventId) => void) | null = null;
  /** Damage hit a concentrating PC → the player web prompts a CON save. */
  private concentrationCheckListener:
    | ((check: {
        pcId: string;
        combatantId: string;
        spellName: string;
        deName: string | null;
        dc: number;
        damage: number;
      }) => void)
    | null = null;

  /**
   * Global boot: settings, monster library and the campaign index (all
   * campaign-independent), then mounts the active campaign. Campaign switches
   * later go straight to mountCampaign.
   */
  async init(userDataDir: string): Promise<void> {
    this.dataDir = path.join(userDataDir, 'data');
    this.monsters = new JsonCollection<MonsterTemplate>(path.join(this.dataDir, 'monsters.json'));
    this.spells = new JsonCollection<Spell>(path.join(this.dataDir, 'spells.json'));
    this.settings = new JsonValue<Settings>(path.join(this.dataDir, 'settings.json'), DEFAULT_SETTINGS);
    this.campaignsIndex = new JsonValue<CampaignsFile>(path.join(this.dataDir, 'campaigns.json'), {
      campaigns: [],
      activeId: '',
    });
    await Promise.all([
      this.monsters.load(),
      this.spells.load(),
      this.settings.load(),
      this.campaignsIndex.load(),
    ]);
    // Fill in any settings keys added after the file was first written.
    // Nested sections (kenku, playerWeb) merge sub-keys explicitly - a stored
    // file from before a new sub-key was added must still pick up its default.
    await this.settings.set(normalizeSettings(this.settings.get()));
    // Legacy attack schema in the (global) monster library.
    for (const m of this.monsters.list()) {
      const migrated = migrateActions(m.attacks as unknown[]);
      if (migrated) await this.monsters.put({ ...m, attacks: migrated });
    }
    // Repair a missing or hand-broken index so the app always has a campaign.
    let index = this.campaignsIndex.get();
    if (index.campaigns.length === 0) {
      index = {
        campaigns: [{ id: randomUUID(), name: 'Main Campaign', createdAt: Date.now() }],
        activeId: '',
      };
    }
    if (!index.campaigns.some((c) => c.id === index.activeId)) {
      index = { ...index, activeId: index.campaigns[0].id };
    }
    if (index !== this.campaignsIndex.get()) await this.campaignsIndex.set(index);
    await this.mountCampaign(index.activeId);
  }

  /**
   * The hot-swap: constructs and loads the per-campaign stores. Store paths
   * are fixed at construction, so a swap is always a fresh set of instances.
   * Every mutation persists immediately, so the outgoing campaign needs no
   * save step - an in-progress combat is simply left on disk and picked up
   * again by the next mount.
   */
  async mountCampaign(id: string): Promise<void> {
    const dir = this.campaignDir(id);
    this.pcs = new JsonCollection<PC>(path.join(dir, 'pcs.json'));
    this.templates = new JsonCollection<EncounterTemplate>(path.join(dir, 'encounter-templates.json'));
    this.combat = new JsonValue<Combat | null>(path.join(dir, 'combat.json'), null);
    this.archive = new JsonCollection<ArchivedCombat>(path.join(dir, 'combat-archive.json'));
    await Promise.all([this.pcs.load(), this.templates.load(), this.combat.load(), this.archive.load()]);
    // Per-campaign backfills: PCs stored before the attacks field, combats
    // before the log field, and legacy attack schemas inside a saved combat.
    for (const pc of this.pcs.list()) {
      if (!Array.isArray(pc.attacks)) await this.pcs.put({ ...pc, attacks: [] });
    }
    const combat = this.combat.get();
    if (combat) {
      let changed = false;
      if (!Array.isArray(combat.log)) {
        combat.log = [];
        changed = true;
      }
      for (const c of combat.combatants) {
        const migrated = migrateActions(c.attacks as unknown[]);
        if (migrated) {
          c.attacks = migrated;
          changed = true;
        }
      }
      if (changed) await this.combat.set(combat);
    }
    this.activeCampaignId = id;
    const index = this.campaignsIndex.get();
    if (index.activeId !== id) await this.campaignsIndex.set({ ...index, activeId: id });
    this.notify();
  }

  private campaignDir(id: string): string {
    return path.join(this.dataDir, 'campaigns', id);
  }

  /** Absolute path of a per-campaign file (playerServer needs the claims). */
  campaignFilePath(id: string, file: string): string {
    return path.join(this.campaignDir(id), file);
  }

  // ---- Campaign CRUD ----

  hasCampaign(id: string): boolean {
    return this.campaignsIndex.get().campaigns.some((c) => c.id === id);
  }

  /** Creates without switching - the renderer chains a switch when wanted. */
  async createCampaign(name: string): Promise<string> {
    const trimmed = name.trim().slice(0, 60) || 'New Campaign';
    const info: CampaignInfo = { id: randomUUID(), name: trimmed, createdAt: Date.now() };
    const index = this.campaignsIndex.get();
    await this.campaignsIndex.set({ ...index, campaigns: [...index.campaigns, info] });
    this.notify();
    return info.id;
  }

  async renameCampaign(id: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const index = this.campaignsIndex.get();
    await this.campaignsIndex.set({
      ...index,
      campaigns: index.campaigns.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
    });
    this.notify();
  }

  /** Deletes a campaign and ALL its data. Refuses the active or last one. */
  async deleteCampaign(id: string): Promise<boolean> {
    const index = this.campaignsIndex.get();
    if (id === this.activeCampaignId || index.campaigns.length <= 1) return false;
    if (!index.campaigns.some((c) => c.id === id)) return false;
    await this.campaignsIndex.set({
      ...index,
      campaigns: index.campaigns.filter((c) => c.id !== id),
    });
    try {
      await fs.rm(this.campaignDir(id), { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to remove campaign dir', err);
    }
    this.notify();
    return true;
  }

  getState(): AppState {
    return {
      pcs: this.pcs.list().sort((a, b) => a.name.localeCompare(b.name)),
      monsters: this.monsters.list().sort((a, b) => a.name.localeCompare(b.name)),
      spells: this.spells.list().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      encounterTemplates: this.templates.list().sort((a, b) => a.name.localeCompare(b.name)),
      combat: this.combat.get(),
      settings: this.settings.get(),
      campaigns: this.campaignsIndex.get().campaigns,
      activeCampaignId: this.activeCampaignId,
      bridgeClientCount: this.bridgeClientCount,
      kenkuConnected: this.kenkuConnected,
      playerClients: this.playerClients,
    };
  }

  setPlayerClients(list: PlayerClaimInfo[]): void {
    this.playerClients = list;
    this.notify();
  }

  // ---- Combat log ----

  /**
   * Append a structured entry to the running combat's log. id/ts/round are
   * filled in here; rendering to text happens per-surface via i18n keys.
   * No-op without a combat (log lines never outlive their fight).
   */
  async appendLog(entry: Omit<LogEntry, 'id' | 'ts' | 'round'>): Promise<void> {
    const combat = this.combat.get();
    if (!combat) return;
    this.pushLog(combat, entry);
    await this.setCombat(combat);
  }

  /** In-mutator variant: fills fields and pushes, without its own persist. */
  private pushLog(combat: Combat, entry: Omit<LogEntry, 'id' | 'ts' | 'round'>): void {
    combat.log.push({ ...entry, id: randomUUID(), ts: Date.now(), round: combat.round });
  }

  /** Log snapshots carry names in the language active when the entry was made. */
  private locName(name: string): string {
    return monsterName(this.settings.get().language, name);
  }

  listArchive(): ArchivedCombat[] {
    return this.archive.list().sort((a, b) => b.endedAt - a.endedAt);
  }

  async deleteArchivedCombat(id: string): Promise<void> {
    await this.archive.delete(id);
    this.notify();
  }

  setKenkuConnected(connected: boolean): void {
    if (this.kenkuConnected === connected) return;
    this.kenkuConnected = connected;
    this.notify();
  }

  onCombatEvent(listener: (event: KenkuEventId) => void): void {
    this.combatEventListener = listener;
  }

  private emitCombatEvent(event: KenkuEventId): void {
    this.combatEventListener?.(event);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  // ---- PCs ----

  async savePc(pc: Omit<PC, 'id'> & { id?: string }): Promise<void> {
    // Defensive: IPC callers predating the attacks field may omit it.
    await this.pcs.put({
      ...pc,
      attacks: pc.attacks ?? [],
      spellSlots: normalizeSlots(pc.spellSlots),
      id: pc.id ?? randomUUID(),
    });
    this.notify();
  }

  async deletePc(id: string): Promise<void> {
    await this.pcs.delete(id);
    this.notify();
  }

  /**
   * Create or update one attack on a PC. Also patches the PC's live combatant
   * (matched by sourceId) so the deck and phones see the change immediately.
   * Used by the Party screen editor and the player web app.
   */
  async savePcAttack(pcId: string, action: MonsterAction): Promise<void> {
    const pc = this.pcs.get(pcId);
    if (!pc) return;
    const attacks = [...pc.attacks];
    const idx = attacks.findIndex((a) => a.id === action.id);
    if (idx === -1) attacks.push(action);
    else attacks[idx] = action;
    await this.pcs.put({ ...pc, attacks });
    await this.syncPcCombatantAttacks(pcId, attacks);
    this.notify();
  }

  async deletePcAttack(pcId: string, actionId: string): Promise<void> {
    const pc = this.pcs.get(pcId);
    if (!pc) return;
    const attacks = pc.attacks.filter((a) => a.id !== actionId);
    await this.pcs.put({ ...pc, attacks });
    await this.syncPcCombatantAttacks(pcId, attacks);
    this.notify();
  }

  private async syncPcCombatantAttacks(pcId: string, attacks: MonsterAction[]): Promise<void> {
    const combat = this.combat.get();
    if (!combat) return;
    const c = combat.combatants.find((x) => x.type === 'pc' && x.sourceId === pcId);
    if (!c) return;
    c.attacks = attacks.map((a) => ({ ...a }));
    await this.combat.set(combat);
  }

  // ---- Spell slots ----

  /**
   * Spend one slot and log the cast. slotLevel null = cantrip / slotless cast:
   * nothing is spent, only logged. Returns false (and changes nothing) when
   * the PC has no slot of that level left — callers surface that as an error.
   * The cast is logged immediately, before any roll reveal delay: the slot
   * spend is announced at the table the moment the words are spoken.
   */
  async castSpell(
    pcId: string,
    spellName: string,
    slotLevel: number | null,
    ctx: ActionContext = DM_CTX,
    concentration?: { name: string; deName?: string | null } | null,
  ): Promise<boolean> {
    const pc = this.pcs.get(pcId);
    if (!pc) return false;
    if (slotLevel !== null) {
      const idx = slotLevel - 1;
      const slots = normalizeSlots(pc.spellSlots);
      if (!slots || idx < 0 || idx > 8 || slots.current[idx] <= 0) return false;
      const current = [...slots.current];
      current[idx] -= 1;
      await this.pcs.put({ ...pc, spellSlots: { ...slots, current } });
    }
    // A concentration spell tags the caster's combatant; casting another one
    // replaces the previous (you can only concentrate on one spell).
    if (concentration) {
      const combat = this.getActiveCombat();
      const c = combat?.combatants.find((x) => x.type === 'pc' && x.sourceId === pcId);
      if (c) c.concentration = { ...concentration };
    }
    await this.appendLog({
      kind: 'cast',
      actorName: pc.name,
      actorType: 'pc',
      attackName: spellName,
      ...(slotLevel !== null ? { slotLevel } : {}),
      ...(concentration ? { conc: true } : {}),
      source: ctx.source,
      sourceName: ctx.sourceName,
    });
    this.notify();
    return true;
  }

  /** Set or clear a combatant's Concentration tag (DM chip / failed check). */
  async setConcentration(
    combatantId: string,
    value: { name: string; deName?: string | null } | null,
  ): Promise<void> {
    const combat = this.combat.get();
    const c = combat?.combatants.find((x) => x.id === combatantId);
    if (!combat || !c) return;
    c.concentration = value;
    await this.setCombat(combat);
  }

  /** Long Rest: every expended slot returns, and every resource refills. */
  async longRest(pcId: string): Promise<void> {
    const pc = this.pcs.get(pcId);
    if (!pc) return;
    const slots = normalizeSlots(pc.spellSlots);
    const resources = (pc.resources ?? []).map((r) => ({ ...r, current: r.max }));
    if (!slots && resources.length === 0) return;
    await this.pcs.put({
      ...pc,
      ...(slots ? { spellSlots: { ...slots, current: [...slots.max] } } : {}),
      resources,
    });
    this.notify();
  }

  /**
   * Spend or restore one custom resource, clamped to [0, max]. One method for
   * every surface — phone, DM prompt, Party screen steppers — so the count
   * has a single authority.
   */
  async adjustResource(pcId: string, resourceId: string, delta: number): Promise<void> {
    const pc = this.pcs.get(pcId);
    const res = pc?.resources?.find((r) => r.id === resourceId);
    if (!pc || !res) return;
    const current = Math.max(0, Math.min(res.max, res.current + delta));
    if (current === res.current) return;
    await this.pcs.put({
      ...pc,
      resources: pc.resources!.map((r) => (r.id === resourceId ? { ...r, current } : r)),
    });
    this.notify();
  }

  // ---- Monsters ----

  /**
   * Attaches German SRD localization to imported monsters that predate the
   * l10n field, so existing libraries pick the feature up without a re-import.
   * Manual monsters are never touched.
   */
  async backfillMonsterL10n(map: Record<string, import('../shared/i18n').MonsterL10n>): Promise<void> {
    for (const m of this.monsters.list()) {
      if (m.source !== 'srd' || m.l10n?.de) continue;
      const entry = map[m.name];
      if (entry) await this.monsters.put({ ...m, l10n: { de: entry } });
    }
  }

  async saveMonster(m: Omit<MonsterTemplate, 'id'> & { id?: string }): Promise<void> {
    await this.monsters.put({ ...m, id: m.id ?? randomUUID() });
    this.notify();
  }

  async deleteMonster(id: string): Promise<void> {
    await this.monsters.delete(id);
    // Remove the monster from any template entries that reference it.
    for (const t of this.templates.list()) {
      if (t.entries.some((e) => e.monsterTemplateId === id)) {
        await this.templates.put({
          ...t,
          entries: t.entries.filter((e) => e.monsterTemplateId !== id),
        });
      }
    }
    this.notify();
  }

  async importMonsters(list: Omit<MonsterTemplate, 'id'>[]): Promise<number> {
    // Match by name (case-insensitive): re-importing updates existing SRD
    // entries instead of duplicating them.
    const existingByName = new Map(
      this.monsters
        .list()
        .filter((m) => m.source === 'srd')
        .map((m) => [m.name.toLowerCase(), m.id]),
    );
    const toPut = list.map((m) => ({
      ...m,
      id: existingByName.get(m.name.toLowerCase()) ?? randomUUID(),
    }));
    await this.monsters.putMany(toPut);
    this.notify();
    return toPut.length;
  }

  // ---- Spells (global library, like monsters) ----

  /**
   * Attaches German localization to imported spells that predate the l10n
   * field. Manual spells are never touched.
   */
  async backfillSpellL10n(map: Record<string, { name: string; text: string }>): Promise<void> {
    for (const s of this.spells.list()) {
      if (s.source !== 'srd' || s.l10n?.de) continue;
      const entry = map[s.name];
      if (entry) await this.spells.put({ ...s, l10n: { de: entry } });
    }
  }

  async saveSpell(s: Omit<Spell, 'id'> & { id?: string }): Promise<void> {
    await this.spells.put({ ...s, id: s.id ?? randomUUID() });
    this.notify();
  }

  async deleteSpell(id: string): Promise<void> {
    await this.spells.delete(id);
    this.notify();
  }

  async importSpells(list: Omit<Spell, 'id'>[]): Promise<number> {
    const existingByName = new Map(
      this.spells
        .list()
        .filter((s) => s.source === 'srd')
        .map((s) => [s.name.toLowerCase(), s.id]),
    );
    const toPut = list.map((s) => ({
      ...s,
      id: existingByName.get(s.name.toLowerCase()) ?? randomUUID(),
    }));
    await this.spells.putMany(toPut);
    this.notify();
    return toPut.length;
  }

  // ---- Encounter templates ----

  async saveTemplate(t: Omit<EncounterTemplate, 'id'> & { id?: string }): Promise<void> {
    await this.templates.put({ ...t, id: t.id ?? randomUUID() });
    this.notify();
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templates.delete(id);
    this.notify();
  }

  async duplicateTemplate(id: string): Promise<void> {
    const t = this.templates.get(id);
    if (!t) return;
    await this.templates.put({
      ...t,
      id: randomUUID(),
      name: `${t.name} (copy)`,
      entries: t.entries.map((e) => ({ ...e })),
    });
    this.notify();
  }

  // ---- Combat lifecycle ----

  private async setCombat(combat: Combat | null): Promise<void> {
    await this.combat.set(combat);
    this.notify();
  }

  private getActiveCombat(): Combat | null {
    return this.combat.get();
  }

  /**
   * Instantiate a combat from a template + chosen PCs. Monsters are rolled
   * immediately; PCs are rolled too unless rollMode is 'monstersOnly'.
   */
  async startCombatSetup(
    templateId: string,
    pcIds: string[],
    rollMode: 'all' | 'monstersOnly',
  ): Promise<void> {
    const template = this.templates.get(templateId);
    if (!template) throw new Error('Template not found');

    const combatants: Combatant[] = [];

    for (const entry of template.entries) {
      const monster = this.monsters.get(entry.monsterTemplateId);
      if (!monster) continue;
      for (let i = 1; i <= entry.quantity; i++) {
        combatants.push({
          id: randomUUID(),
          displayName: entry.quantity > 1 ? `${monster.name} ${i}` : monster.name,
          type: 'monster',
          sourceId: monster.id,
          maxHp: monster.maxHp,
          currentHp: monster.maxHp,
          ac: monster.ac,
          initMod: monster.initMod,
          abilities: monster.abilities ?? null,
          attacks: monster.attacks.map((a) => ({ ...a })),
          conditions: [],
          initiative: d20() + monster.initMod,
          isDowned: false,
        });
      }
    }

    for (const pcId of pcIds) {
      const pc = this.pcs.get(pcId);
      if (!pc) continue;
      combatants.push({
        id: randomUUID(),
        displayName: pc.name,
        type: 'pc',
        sourceId: pc.id,
        maxHp: pc.maxHp,
        currentHp: pc.maxHp,
        ac: pc.ac,
        initMod: pc.initMod,
        abilities: pc.abilities ?? null,
        attacks: pc.attacks.map((a) => ({ ...a })),
        conditions: [],
        initiative: rollMode === 'all' ? d20() + pc.initMod : null,
        isDowned: false,
      });
    }

    const combat: Combat = {
      id: randomUUID(),
      sourceTemplateId: templateId,
      phase: 'setup',
      combatants,
      currentIndex: 0,
      round: 0,
      log: [],
    };
    this.sortCombatants(combat);
    await this.setCombat(combat);
  }

  /** Sort descending by initiative (nulls last), tie-break by initMod. */
  private sortCombatants(combat: Combat): void {
    combat.combatants.sort((a, b) => {
      if (a.initiative === null && b.initiative === null) return 0;
      if (a.initiative === null) return 1;
      if (b.initiative === null) return -1;
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return b.initMod - a.initMod;
    });
  }

  async setInitiative(combatantId: string, value: number | null): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'setup') return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    c.initiative = value;
    this.sortCombatants(combat);
    await this.setCombat(combat);
  }

  async rerollInitiative(combatantId: string): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'setup') return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    c.initiative = d20() + c.initMod;
    this.sortCombatants(combat);
    await this.setCombat(combat);
  }

  /** Manual drag-reorder during setup (for breaking remaining ties). */
  async reorderCombatant(fromIndex: number, toIndex: number): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'setup') return;
    const list = combat.combatants;
    if (
      fromIndex < 0 || fromIndex >= list.length ||
      toIndex < 0 || toIndex >= list.length
    ) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    await this.setCombat(combat);
  }

  async beginCombat(): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'setup') return;
    if (combat.combatants.some((c) => c.initiative === null)) {
      throw new Error('All combatants need an initiative value first');
    }
    combat.phase = 'active';
    combat.currentIndex = 0;
    combat.round = 1;
    this.pushLog(combat, { kind: 'combatStart', source: 'dm' });
    const first = combat.combatants[0];
    if (first) {
      this.pushLog(combat, {
        kind: 'turn',
        actorName: this.locName(first.displayName),
        actorType: first.type,
        source: 'dm',
      });
    }
    await this.setCombat(combat);
    this.emitCombatEvent('combatStart');
  }

  async endCombat(ctx: ActionContext = DM_CTX): Promise<void> {
    // Emit while the combat still exists, so the listener can read its
    // template (the Kenku handler pauses the playlist it started).
    const combat = this.combat.get();
    if (combat) {
      this.emitCombatEvent('combatEnd');
      // Archive the log (active combats only - an abandoned setup logs nothing).
      if (combat.phase === 'active') {
        this.pushLog(combat, { kind: 'combatEnd', source: ctx.source });
        const template = this.templates.get(combat.sourceTemplateId);
        await this.archive.put({
          id: combat.id,
          templateName: template?.name ?? '?',
          endedAt: Date.now(),
          rounds: combat.round,
          log: combat.log,
        });
      }
    }
    await this.setCombat(null);
  }

  // ---- Live combat control ----

  async nextTurn(ctx: ActionContext = DM_CTX): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'active' || combat.combatants.length === 0) return;
    combat.currentIndex += 1;
    if (combat.currentIndex >= combat.combatants.length) {
      combat.currentIndex = 0;
      combat.round += 1;
    }
    this.logTurn(combat, ctx);
    await this.setCombat(combat);
    this.emitCombatEvent('turnChange');
  }

  async prevTurn(ctx: ActionContext = DM_CTX): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || combat.phase !== 'active' || combat.combatants.length === 0) return;
    if (combat.currentIndex === 0) {
      if (combat.round <= 1) return; // can't go before the start of combat
      combat.currentIndex = combat.combatants.length - 1;
      combat.round -= 1;
    } else {
      combat.currentIndex -= 1;
    }
    this.logTurn(combat, ctx);
    await this.setCombat(combat);
    this.emitCombatEvent('turnChange');
  }

  private logTurn(combat: Combat, ctx: ActionContext): void {
    const current = combat.combatants[combat.currentIndex];
    if (!current) return;
    this.pushLog(combat, {
      kind: 'turn',
      actorName: this.locName(current.displayName),
      actorType: current.type,
      source: ctx.source,
    });
  }

  async applyDamage(combatantId: string, amount: number, ctx: ActionContext = DM_CTX): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || amount <= 0) return;
    const idx = combat.combatants.findIndex((c) => c.id === combatantId);
    if (idx === -1) return;
    const c = combat.combatants[idx];
    c.currentHp = Math.max(0, c.currentHp - amount);
    this.pushLog(combat, {
      kind: 'damage',
      actorName: ctx.actorName,
      actorType: ctx.actorType,
      targetName: this.locName(c.displayName),
      targetType: c.type,
      amount,
      math: ctx.math,
      mathTypes: ctx.mathTypes,
      source: ctx.source,
      sourceName: ctx.sourceName,
    });
    let killedOrDowned: KenkuEventId | null = null;
    if (c.currentHp === 0) {
      killedOrDowned = c.type === 'monster' ? 'monsterKilled' : 'pcDowned';
      this.pushLog(combat, {
        kind: c.type === 'monster' ? 'kill' : 'down',
        targetName: this.locName(c.displayName),
        targetType: c.type,
        source: ctx.source,
        sourceName: ctx.sourceName,
      });
      if (c.type === 'monster') {
        // Remove dead monsters from the order entirely.
        combat.combatants.splice(idx, 1);
        if (combat.combatants.length === 0) {
          combat.currentIndex = 0;
        } else if (idx < combat.currentIndex) {
          combat.currentIndex -= 1;
        } else if (idx === combat.currentIndex && combat.currentIndex >= combat.combatants.length) {
          // The dying monster was the current turn and last in order: wrap.
          combat.currentIndex = 0;
          if (combat.phase === 'active') combat.round += 1;
        }
      } else {
        c.isDowned = true;
        // Going down breaks concentration outright (incapacitated) — no check.
        if (c.concentration) c.concentration = null;
      }
    }
    // Damage to a concentrating PC forces a Constitution save:
    // DC = max(10, half the damage). The claiming phone gets the prompt.
    let concCheck: {
      pcId: string;
      combatantId: string;
      spellName: string;
      deName: string | null;
      dc: number;
      damage: number;
    } | null = null;
    if (c.type === 'pc' && !c.isDowned && c.concentration) {
      concCheck = {
        pcId: c.sourceId,
        combatantId: c.id,
        spellName: c.concentration.name,
        deName: c.concentration.deName ?? null,
        dc: Math.max(10, Math.floor(amount / 2)),
        damage: amount,
      };
    }
    await this.setCombat(combat);
    this.emitCombatEvent('damageApplied');
    if (killedOrDowned) this.emitCombatEvent(killedOrDowned);
    if (concCheck) this.concentrationCheckListener?.(concCheck);
  }

  /** playerServer registers here to prompt the claiming phone. */
  onConcentrationCheck(cb: typeof this.concentrationCheckListener): void {
    this.concentrationCheckListener = cb;
  }

  async applyHeal(combatantId: string, amount: number, ctx: ActionContext = DM_CTX): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat || amount <= 0) return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    c.currentHp = Math.min(c.maxHp, c.currentHp + amount);
    if (c.currentHp > 0) c.isDowned = false;
    this.pushLog(combat, {
      kind: 'heal',
      actorName: ctx.actorName,
      actorType: ctx.actorType,
      targetName: this.locName(c.displayName),
      targetType: c.type,
      amount,
      source: ctx.source,
      sourceName: ctx.sourceName,
    });
    await this.setCombat(combat);
    this.emitCombatEvent('healApplied');
  }

  /** DM corrects a log entry; damage/heal edits shift the target's HP too. */
  async editLogEntry(id: string, patch: LogEntryPatch): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat) return;
    if (applyLogEntryEdit(combat, id, patch)) await this.setCombat(combat);
  }

  /** DM removes a log entry; a deleted damage/heal un-happens (HP refunded). */
  async deleteLogEntry(id: string): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat) return;
    if (applyLogEntryDelete(combat, id)) await this.setCombat(combat);
  }

  async toggleCondition(
    combatantId: string,
    condition: Condition,
    ctx: ActionContext = DM_CTX,
  ): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat) return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    const removing = c.conditions.includes(condition);
    if (removing) {
      c.conditions = c.conditions.filter((x) => x !== condition);
    } else {
      c.conditions = [...c.conditions, condition];
    }
    this.pushLog(combat, {
      kind: removing ? 'conditionRemoved' : 'conditionAdded',
      targetName: this.locName(c.displayName),
      targetType: c.type,
      condition,
      source: ctx.source,
    });
    await this.setCombat(combat);
  }

  /** Add monsters to an ongoing (or setup-phase) combat, rolling initiative. */
  async addMonsterToCombat(monsterTemplateId: string, quantity: number): Promise<void> {
    const combat = this.getActiveCombat();
    const monster = this.monsters.get(monsterTemplateId);
    if (!combat || !monster || quantity < 1) return;

    // Continue instance numbering after any existing same-named monsters.
    const baseName = monster.name;
    const existing = combat.combatants.filter(
      (c) => c.type === 'monster' && c.displayName.replace(/\s+\d+$/, '') === baseName,
    );
    let nextIndex = existing.length + 1;
    if (existing.length === 1 && existing[0].displayName === baseName) {
      existing[0].displayName = `${baseName} 1`;
    }
    const needsNumbers = existing.length > 0 || quantity > 1;

    for (let i = 0; i < quantity; i++) {
      const combatant: Combatant = {
        id: randomUUID(),
        displayName: needsNumbers ? `${baseName} ${nextIndex++}` : baseName,
        type: 'monster',
        sourceId: monster.id,
        maxHp: monster.maxHp,
        currentHp: monster.maxHp,
        ac: monster.ac,
        initMod: monster.initMod,
        abilities: monster.abilities ?? null,
        attacks: monster.attacks.map((a) => ({ ...a })),
        conditions: [],
        initiative: d20() + monster.initMod,
        isDowned: false,
      };
      if (combat.phase === 'setup') {
        combat.combatants.push(combatant);
      } else {
        // Insert by initiative (after equal rolls), keeping the current
        // actor's turn: bump the pointer when inserting above it.
        let idx = combat.combatants.findIndex(
          (c) => c.initiative !== null && c.initiative < combatant.initiative!,
        );
        if (idx === -1) idx = combat.combatants.length;
        combat.combatants.splice(idx, 0, combatant);
        if (idx <= combat.currentIndex) combat.currentIndex += 1;
      }
    }
    if (combat.phase === 'setup') this.sortCombatants(combat);
    await this.setCombat(combat);
  }

  async removeCombatant(combatantId: string): Promise<void> {
    const combat = this.getActiveCombat();
    if (!combat) return;
    const idx = combat.combatants.findIndex((c) => c.id === combatantId);
    if (idx === -1) return;
    combat.combatants.splice(idx, 1);
    if (combat.combatants.length === 0) {
      combat.currentIndex = 0;
    } else if (idx < combat.currentIndex) {
      combat.currentIndex -= 1;
    } else if (combat.currentIndex >= combat.combatants.length) {
      combat.currentIndex = 0;
    }
    await this.setCombat(combat);
  }

  // ---- Settings ----

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    await this.settings.set({ ...this.settings.get(), ...patch });
    this.notify();
  }

  setBridgeClientCount(n: number): void {
    this.bridgeClientCount = n;
    this.notify();
  }
}

export const store = new AppStore();
