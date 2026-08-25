/**
 * Browser stand-in for the Electron main process, powering the GitHub Pages
 * demo. Activated only when `window.api` is absent (i.e. not running inside
 * Electron): implements the full preload Api against in-memory state that is
 * persisted to localStorage and synced across tabs with a BroadcastChannel,
 * so the Player View works as a second browser tab.
 *
 * The combat rules mirror app/src/main/state.ts exactly — sort order, monster
 * removal at 0 HP, round wrapping, instance numbering. If those semantics
 * change there, change them here too.
 *
 * It also exposes `window.__demo` for the simulated Stream Deck: the same
 * state message the real bridge would push over the WebSocket, and a command
 * sink accepting the same command set.
 */
import type {
  AppState,
  Combat,
  Combatant,
  Condition,
  ArchivedCombat,
  CampaignInfo,
  EncounterTemplate,
  KenkuEventId,
  LogEntry,
  LogSource,
  MonsterAction,
  MonsterTemplate,
  PC,
  Settings,
  Spell,
  SpellSlots,
} from '../../../shared/types';
import { ABILITY_KEYS, DEFAULT_SETTINGS, abilityMod, normalizeSettings } from '../../../shared/types';
import { translate } from '../../../shared/i18n';
import { rollD20, stripDiceResults, type RollMode } from '../../../shared/dice';
import { spellToAction, spellActionName } from '../../../shared/spellAction';
import { applyLogEntryDelete, applyLogEntryEdit } from '../../../shared/logEdit';
import {
  abilityCodeLabel,
  monsterName,
  type MonsterL10n,
} from '../../../shared/i18n';
import type { Api } from '../../../preload/index';
import monstersDe from '../../../../resources/srd/monsters.de.json';
import {
  demoKenkuLibrary,
  demoKenkuPausePlayback,
  demoKenkuPlayback,
  demoKenkuPlayPlaylist,
  demoKenkuPlaySound,
  demoKenkuStopAll,
  demoKenkuStopSound,
} from './demo-kenku';

// Key bump reseeds returning visitors — this one brings the Spellbook
// (seeded casters with slots and attached spells).
const LS_KEY = 'deck-of-many-turns-demo-v3';
const uuid = () => crypto.randomUUID();
const d20 = () => 1 + Math.floor(Math.random() * 20);

/** The per-campaign slice, mirroring main's data/campaigns/<id>/ files. */
interface CampaignData {
  pcs: PC[];
  templates: EncounterTemplate[];
  combat: Combat | null;
  archive: ArchivedCombat[];
}

interface DemoData {
  campaigns: CampaignInfo[];
  activeId: string;
  byCampaign: Record<string, CampaignData>;
  monsters: MonsterTemplate[];
  /** Global spell library, like monsters (mirrors main's data/spells.json). */
  spells: Spell[];
  settings: Settings;
  seeded: boolean;
}

const emptyCampaignData = (): CampaignData => ({
  pcs: [],
  templates: [],
  combat: null,
  archive: [],
});

/** Who performed a mutation, for the demo combat log. */
interface ActionCtx {
  source: LogSource;
  actorName?: string;
  actorType?: 'pc' | 'monster';
  math?: string;
  mathTypes?: (string | null)[];
  sourceName?: string;
}

const DM_CTX: ActionCtx = { source: 'dm' };
const DECK_CTX: ActionCtx = { source: 'deck' };

const deckCtx = (cmd: BridgeCommand): ActionCtx => ({
    source: 'deck',
    actorName: cmd.actorName,
    actorType: cmd.actorType === 'pc' || cmd.actorType === 'monster' ? cmd.actorType : undefined,
    math: cmd.math,
    mathTypes: cmd.mathTypes,
  });

interface BridgeCommand {
  type: string;
  actorId?: string;
  amount?: number;
  condition?: string;
  phase?: string;
  actorName?: string;
  actorType?: string;
  math?: string;
  mathTypes?: (string | null)[];
  roll?: {
    actorName?: string;
    actorType?: string;
    targetName?: string;
    targetType?: string;
    attackName?: string;
    die?: number;
    dice?: number[];
    total?: number;
  };
  /** Save-based applyDamage: the throw this target made (mirror of bridge.ts). */
  save?: {
    ability: string;
    dc: number;
    die?: number;
    total?: number;
    saved: boolean;
    attackName?: string;
    attackerName?: string;
  };
}

export function createDemoApi(): Api {
  const freshData = (): DemoData => {
    const id = uuid();
    return {
      campaigns: [{ id, name: 'Main Campaign', createdAt: Date.now() }],
      activeId: id,
      byCampaign: { [id]: emptyCampaignData() },
      monsters: [],
      spells: [],
      settings: { ...DEFAULT_SETTINGS },
      seeded: false,
    };
  };
  let data: DemoData = load() ?? freshData();
  /** The active campaign's slice — the demo's analogue of the mounted stores. */
  const cur = (): CampaignData => data.byCampaign[data.activeId];

  const stateListeners = new Set<(s: AppState) => void>();
  const pvListeners = new Set<(open: boolean) => void>();
  const focusListeners = new Set<() => void>();
  const channel = new BroadcastChannel('dnd-demo');
  let pvWindow: Window | null = null;

  function load(): DemoData | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as DemoData;
      // Unknown shape (pre-campaign blob under a reused key) → reseed.
      if (!stored.byCampaign || !Array.isArray(stored.campaigns) || stored.campaigns.length === 0) {
        return null;
      }
      if (!stored.campaigns.some((c) => c.id === stored.activeId)) {
        stored.activeId = stored.campaigns[0].id;
      }
      for (const c of stored.campaigns) {
        const slice = stored.byCampaign[c.id] ?? (stored.byCampaign[c.id] = emptyCampaignData());
        if (!Array.isArray(slice.archive)) slice.archive = [];
        if (slice.combat && !Array.isArray(slice.combat.log)) slice.combat.log = [];
      }
      if (!Array.isArray(stored.spells)) stored.spells = [];
      // Same normalisation as main/state.ts — a returning demo visitor can be
      // carrying a pre-rebrand theme id in localStorage.
      stored.settings = normalizeSettings(stored.settings);
      return stored;
    } catch {
      return null;
    }
  }

  function appState(): AppState {
    return {
      pcs: [...cur().pcs].sort((a, b) => a.name.localeCompare(b.name)),
      monsters: [...data.monsters].sort((a, b) => a.name.localeCompare(b.name)),
      spells: [...data.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      encounterTemplates: [...cur().templates].sort((a, b) => a.name.localeCompare(b.name)),
      combat: cur().combat,
      settings: data.settings,
      campaigns: data.campaigns,
      activeCampaignId: data.activeId,
      // The simulated deck on this page counts as a connected client.
      bridgeClientCount: 1,
      kenkuConnected,
      playerClients: [...playerClaims().entries()].map(([pcId, claim]) => ({
        pcId,
        playerName: claim.playerName,
        connected: [...playerSessions].some((s) => s.pcId === pcId),
      })),
    };
  }

  function notify(): void {
    const s = appState();
    for (const cb of stateListeners) cb(s);
  }

  function save(broadcast = true): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: the demo keeps working in-memory.
    }
    notify();
    if (broadcast) channel.postMessage('sync');
  }

  channel.addEventListener('message', (ev) => {
    if (ev.data === 'sync') {
      const fresh = load();
      if (fresh) {
        data = fresh;
        notify();
      }
    } else if (ev.data === 'pv-fullscreen') {
      if (location.hash.replace('#', '') === 'player') {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  });

  // ---- Kenku (demo): trigger engine mirroring main/kenku.ts -------------------
  // The demo simulates a connected Kenku: the full configuration UI works and
  // "playing" states light up, but everything is silent by design.

  const kenkuConnected = true;
  const kenkuPending = new Set<ReturnType<typeof setTimeout>>();

  const kenkuSettings = () => data.settings.kenku;

  function kenkuFire(ref: { soundId: string; delayMs?: number }): void {
    const delay = ref.delayMs ?? 0;
    if (delay <= 0) {
      void demoKenkuPlaySound(ref.soundId);
      return;
    }
    const timer = setTimeout(() => {
      kenkuPending.delete(timer);
      void demoKenkuPlaySound(ref.soundId);
    }, delay);
    kenkuPending.add(timer);
  }

  function kenkuEvent(event: KenkuEventId): void {
    const k = kenkuSettings();
    if (!k.enabled) return;
    const ref = k.eventSounds[event];
    if (ref) kenkuFire(ref);
  }

  function kenkuCombatEvent(event: KenkuEventId): void {
    const k = kenkuSettings();
    if (event === 'combatStart') {
      kenkuEvent(event);
      if (!k.enabled) return;
      const tpl = cur().templates.find((t) => t.id === cur().combat?.sourceTemplateId);
      if (tpl?.kenkuPlaylistId) void demoKenkuPlayPlaylist(tpl.kenkuPlaylistId);
      return;
    }
    if (event === 'combatEnd') {
      for (const t of kenkuPending) clearTimeout(t);
      kenkuPending.clear();
      kenkuEvent(event);
      if (!k.enabled) return;
      const tpl = cur().templates.find((t) => t.id === cur().combat?.sourceTemplateId);
      if (tpl?.kenkuPlaylistId) void demoKenkuPausePlayback();
      return;
    }
    kenkuEvent(event);
  }

  const KENKU_PHASE_TRIGGER: Record<string, string | null> = {
    attackRoll: 'attackRoll',
    attackHit: 'attackHit',
    attackCrit: 'attackHit',
    attackMiss: null,
    damageRoll: 'damageRoll',
    damageApplied: 'damageApplied',
  };
  const KENKU_PHASE_EVENT: Record<string, KenkuEventId | undefined> = {
    attackHit: 'attackHit',
    attackCrit: 'attackCrit',
    attackMiss: 'attackMiss',
  };

  function kenkuAttackEvent(payload: { sourceId?: string; attackId: string; phase: string }): void {
    const k = kenkuSettings();
    if (!k.enabled) return;
    const trigger = KENKU_PHASE_TRIGGER[payload.phase];
    if (trigger) {
      const monster =
        data.monsters.find((m) => m.id === payload.sourceId) ??
        data.monsters.find((m) => m.attacks.some((a) => a.id === payload.attackId));
      const action = monster?.attacks.find((a) => a.id === payload.attackId);
      if (action?.kenkuSound && action.kenkuSound.trigger === trigger) {
        kenkuFire(action.kenkuSound);
      }
    }
    const event = KENKU_PHASE_EVENT[payload.phase];
    if (event) kenkuEvent(event);
  }

  // ---- combat helpers, mirroring main/state.ts --------------------------------

  function sortCombatants(combat: Combat): void {
    combat.combatants.sort((a, b) => {
      if (a.initiative === null && b.initiative === null) return 0;
      if (a.initiative === null) return 1;
      if (b.initiative === null) return -1;
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return b.initMod - a.initMod;
    });
  }

  /** Mirror of main/state.ts pushLog: structured entries, rendered via i18n. */
  function pushLog(combat: Combat, entry: Omit<LogEntry, 'id' | 'ts' | 'round'>): void {
    // A fresh array, not a push: unlike the real app (whose state crosses IPC
    // as new objects) the demo hands React these very objects, and the log
    // view memoises on the array identity. Mutating in place renders nothing.
    combat.log = [...combat.log, { ...entry, id: uuid(), ts: Date.now(), round: combat.round }];
  }

  function logTurn(combat: Combat, ctx: ActionCtx): void {
    const current = combat.combatants[combat.currentIndex];
    if (!current) return;
    pushLog(combat, {
      kind: 'turn',
      actorName: current.displayName,
      actorType: current.type,
      source: ctx.source,
    });
  }

  function combatantFrom(m: MonsterTemplate, displayName: string): Combatant {
    return {
      id: uuid(),
      displayName,
      type: 'monster',
      sourceId: m.id,
      maxHp: m.maxHp,
      currentHp: m.maxHp,
      ac: m.ac,
      initMod: m.initMod,
      abilities: m.abilities ?? null,
      attacks: m.attacks.map((a) => ({ ...a })),
      conditions: [],
      initiative: d20() + m.initMod,
      isDowned: false,
    };
  }

  function applyDamage(combatantId: string, amount: number, ctx: ActionCtx = DM_CTX): void {
    const combat = cur().combat;
    if (!combat || amount <= 0) return;
    const idx = combat.combatants.findIndex((c) => c.id === combatantId);
    if (idx === -1) return;
    const c = combat.combatants[idx];
    c.currentHp = Math.max(0, c.currentHp - amount);
    pushLog(combat, {
      kind: 'damage',
      actorName: ctx.actorName,
      actorType: ctx.actorType,
      targetName: c.displayName,
      targetType: c.type,
      amount,
      math: ctx.math,
      mathTypes: ctx.mathTypes,
      source: ctx.source,
      sourceName: ctx.sourceName,
    });
    let downedOrKilled: KenkuEventId | null = null;
    if (c.currentHp === 0) {
      downedOrKilled = c.type === 'monster' ? 'monsterKilled' : 'pcDowned';
      pushLog(combat, {
        kind: c.type === 'monster' ? 'kill' : 'down',
        targetName: c.displayName,
        targetType: c.type,
        source: ctx.source,
        sourceName: ctx.sourceName,
      });
      if (c.type === 'monster') {
        combat.combatants.splice(idx, 1);
        if (combat.combatants.length === 0) {
          combat.currentIndex = 0;
        } else if (idx < combat.currentIndex) {
          combat.currentIndex -= 1;
        } else if (idx === combat.currentIndex && combat.currentIndex >= combat.combatants.length) {
          combat.currentIndex = 0;
          if (combat.phase === 'active') combat.round += 1;
        }
      } else {
        c.isDowned = true;
        // Going down breaks concentration outright (incapacitated) — no check.
        if (c.concentration) c.concentration = null;
      }
    }
    // Damage to a concentrating PC forces a CON save. Mirror of state.ts +
    // concentration.ts: the request exists whether or not a phone can see it.
    if (c.type === 'pc' && !c.isDowned && c.concentration) {
      const spell = c.concentration;
      const combatantId = c.id;
      openSaveRequest({
        kind: 'concentration',
        ability: 'CON',
        dc: Math.max(10, Math.floor(amount / 2)),
        // The bare spell everywhere; the "Concentration (…)" label is built at
        // write time, so reopening a deferred card cannot double it up.
        attackName: data.settings.language === 'de' && spell.deName ? spell.deName : spell.name,
        spellName: data.settings.language === 'de' && spell.deName ? spell.deName : spell.name,
        damage: amount,
        combatantIds: [combatantId],
        onResolved: (req) => applyConcentration(req, combatantId),
      });
    }
    save();
    kenkuCombatEvent('damageApplied');
    if (downedOrKilled) kenkuCombatEvent(downedOrKilled);
  }

  function applyHeal(combatantId: string, amount: number, ctx: ActionCtx = DM_CTX): void {
    const combat = cur().combat;
    if (!combat || amount <= 0) return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    c.currentHp = Math.min(c.maxHp, c.currentHp + amount);
    if (c.currentHp > 0) c.isDowned = false;
    pushLog(combat, {
      kind: 'heal',
      actorName: ctx.actorName,
      actorType: ctx.actorType,
      targetName: c.displayName,
      targetType: c.type,
      amount,
      source: ctx.source,
      sourceName: ctx.sourceName,
    });
    save();
    kenkuCombatEvent('healApplied');
  }

  function toggleCondition(
    combatantId: string,
    condition: Condition,
    ctx: ActionCtx = DM_CTX,
  ): void {
    const combat = cur().combat;
    if (!combat) return;
    const c = combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    const removing = c.conditions.includes(condition);
    c.conditions = removing
      ? c.conditions.filter((x) => x !== condition)
      : [...c.conditions, condition];
    pushLog(combat, {
      kind: removing ? 'conditionRemoved' : 'conditionAdded',
      targetName: c.displayName,
      targetType: c.type,
      condition,
      source: ctx.source,
    });
    save();
  }

  function nextTurn(ctx: ActionCtx = DM_CTX): void {
    const combat = cur().combat;
    if (!combat || combat.phase !== 'active' || combat.combatants.length === 0) return;
    combat.currentIndex += 1;
    if (combat.currentIndex >= combat.combatants.length) {
      combat.currentIndex = 0;
      combat.round += 1;
    }
    logTurn(combat, ctx);
    save();
    kenkuCombatEvent('turnChange');
  }

  function prevTurn(ctx: ActionCtx = DM_CTX): void {
    const combat = cur().combat;
    if (!combat || combat.phase !== 'active' || combat.combatants.length === 0) return;
    if (combat.currentIndex === 0) {
      if (combat.round <= 1) return;
      combat.currentIndex = combat.combatants.length - 1;
      combat.round -= 1;
    } else {
      combat.currentIndex -= 1;
    }
    logTurn(combat, ctx);
    save();
    kenkuCombatEvent('turnChange');
  }

  /** End combat, archiving the log like main/state.ts does. */
  function endCombatShared(ctx: ActionCtx = DM_CTX): void {
    const combat = cur().combat;
    if (combat) {
      kenkuCombatEvent('combatEnd');
      if (combat.phase === 'active') {
        pushLog(combat, { kind: 'combatEnd', source: ctx.source });
        const template = cur().templates.find((t) => t.id === combat.sourceTemplateId);
        cur().archive.unshift({
          id: combat.id,
          templateName: template?.name ?? '?',
          endedAt: Date.now(),
          rounds: combat.round,
          log: combat.log,
        });
      }
    }
    cur().combat = null;
    save();
  }

  /** Mirror of bridge.ts logDeckSave: one saving throw the deck adjudicated. */
  function logDeckSave(targetId: string, info: NonNullable<BridgeCommand['save']>): void {
    const combat = cur().combat;
    const target = combat?.combatants.find((c) => c.id === targetId);
    if (!combat || !target) return;
    pushLog(combat, {
      kind: 'save',
      actorName: target.displayName,
      actorType: target.type,
      targetName: info.attackerName,
      attackName: info.attackName,
      ability: info.ability,
      die: info.die,
      total: info.total,
      dc: info.dc,
      outcome: info.saved ? 'saved' : 'failed',
      source: 'deck',
    });
    save();
  }

  /**
   * Log an attack roll from any surface (verdict phases only) — the demo's
   * stand-in for main/combatLog.ts, which the deck bridge and the DM's attack
   * modal both reach through in the real app.
   */
  function logAttackRoll(
    cmd: { phase?: string; roll?: BridgeCommand['roll'] },
    source: LogSource,
  ): void {
    const combat = cur().combat;
    const roll = cmd.roll;
    const outcome =
      cmd.phase === 'attackCrit' ? 'crit' : cmd.phase === 'attackHit' ? 'hit' : cmd.phase === 'attackMiss' ? 'miss' : null;
    if (!combat || !roll || !outcome) return;
    pushLog(combat, {
      kind: 'attackRoll',
      actorName: roll.actorName,
      actorType: roll.actorType as 'pc' | 'monster' | undefined,
      targetName: roll.targetName,
      targetType: roll.targetType as 'pc' | 'monster' | undefined,
      attackName: roll.attackName,
      die: roll.die,
      dice: roll.dice && roll.dice.length > 1 ? roll.dice : undefined,
      total: roll.total,
      outcome,
      source,
    });
    save();
  }

  // ---- SRD import -------------------------------------------------------------

  async function importSrd(): Promise<{ imported: number }> {
    const res = await fetch('srd/monsters.json');
    const bundled = (await res.json()) as Array<
      Omit<MonsterTemplate, 'id' | 'source' | 'l10n'>
    >;
    const l10nDe = monstersDe as unknown as Record<string, MonsterL10n>;
    const existingByName = new Map(
      data.monsters.filter((m) => m.source === 'srd').map((m) => [m.name.toLowerCase(), m.id]),
    );
    const imported: MonsterTemplate[] = bundled.map((m) => ({
      ...m,
      id: existingByName.get(m.name.toLowerCase()) ?? uuid(),
      source: 'srd',
      l10n: l10nDe[m.name] ? { de: l10nDe[m.name] } : null,
    }));
    const manual = data.monsters.filter((m) => m.source !== 'srd');
    data.monsters = [...manual, ...imported];
    save();
    return { imported: imported.length };
  }

  async function importSrdSpells(): Promise<{ imported: number }> {
    const res = await fetch('srd/spells.json');
    const bundled = (await res.json()) as Array<Omit<Spell, 'id' | 'source' | 'l10n'>>;
    // German spell l10n ships as a separate file; absent (or pre-DE builds)
    // everything simply stays English — same failure mode as the real app.
    let l10nDe: Record<string, { name: string; text: string }> = {};
    try {
      l10nDe = await (await fetch('srd/spells.de.json')).json();
    } catch {
      /* stays English */
    }
    const existingByName = new Map(
      data.spells.filter((s) => s.source === 'srd').map((s) => [s.name.toLowerCase(), s.id]),
    );
    const imported: Spell[] = bundled.map((s) => ({
      ...s,
      id: existingByName.get(s.name.toLowerCase()) ?? uuid(),
      source: 'srd',
      l10n: l10nDe[s.name] ? { de: l10nDe[s.name] } : null,
    }));
    const manual = data.spells.filter((s) => s.source !== 'srd');
    data.spells = [...manual, ...imported];
    save();
    return { imported: imported.length };
  }

  // ---- Spell slots ------------------------------------------------------------

  /** Mirror of state.ts normalizeSlots: 9 levels, current clamped to max. */
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

  /** Spend a slot (null = cantrip, log only) and log the cast. Mirror of state.ts. */
  function castSpellInner(
    pcId: string,
    spellName: string,
    slotLevel: number | null,
    ctx: ActionCtx = DM_CTX,
    concentration?: { name: string; deName?: string | null } | null,
  ): boolean {
    const pc = cur().pcs.find((p) => p.id === pcId);
    if (!pc) return false;
    if (slotLevel !== null) {
      const idx = slotLevel - 1;
      const slots = normalizeSlots(pc.spellSlots);
      if (!slots || idx < 0 || idx > 8 || slots.current[idx] <= 0) return false;
      slots.current[idx] -= 1;
      pc.spellSlots = slots;
    }
    const combat = cur().combat;
    // Only one spell can be concentrated on — a new one replaces the tag.
    if (concentration && combat && combat.phase === 'active') {
      const c = combat.combatants.find((x) => x.type === 'pc' && x.sourceId === pcId);
      if (c) c.concentration = { ...concentration };
    }
    if (combat) {
      pushLog(combat, {
        kind: 'cast',
        actorName: pc.name,
        actorType: 'pc',
        attackName: spellName,
        ...(slotLevel !== null ? { slotLevel } : {}),
        ...(concentration ? { conc: true } : {}),
        source: ctx.source,
        sourceName: ctx.sourceName,
      });
    }
    save();
    return true;
  }

  function longRestInner(pcId: string): void {
    const pc = cur().pcs.find((p) => p.id === pcId);
    const slots = normalizeSlots(pc?.spellSlots);
    if (!pc || !slots) return;
    pc.spellSlots = { ...slots, current: [...slots.max] };
    save();
  }

  // ---- demo seed --------------------------------------------------------------

  async function seed(): Promise<void> {
    if (data.seeded) return;
    await importSrd();

    // A compact MonsterAction factory for seeded PC attacks (same record
    // shape the Party screen / phone editor produce via formToAction).
    const pcAttack = (
      name: string,
      toHit: number | null,
      save: { ability: string; dc: number } | null,
      dice: string,
      count: number,
      die: number,
      bonus: number,
      average: number,
      dmgType: string,
    ): MonsterAction => ({
      id: `manual.${uuid()}`,
      name,
      section: 'action',
      type: toHit !== null ? 'attack' : 'save',
      order: 0,
      attack:
        toHit !== null
          ? { kind: 'melee', toHit, toHitNote: null, reach: 5, range: null, usage: null }
          : null,
      save,
      onHit: {
        damage: [{ average, dice, count, die, bonus, type: dmgType, condition: null }],
        alternateDamage: null,
        effects: [],
      },
      onHitOrMiss: null,
      kenkuSound: null,
      display: {
        toHit: toHit !== null ? `+${toHit}` : null,
        range: toHit !== null ? 'reach 5 ft.' : null,
        damage: `${average} (${dice}) ${dmgType.charAt(0).toUpperCase()}${dmgType.slice(1)}`,
        text: '',
      },
    });

    for (const p of [
      {
        name: 'Aria Windwhisper', maxHp: 38, ac: 15, initMod: 3,
        abilities: { str: 10, dex: 17, con: 12, int: 13, wis: 14, cha: 11 },
        notes: 'Elf rogue 5 · passive Perception 14 · speed 35 ft',
        attacks: [
          pcAttack('Rapier', 5, null, '1d8+3', 1, 8, 3, 7, 'piercing'),
          pcAttack('Shortbow', 5, null, '1d6+3', 1, 6, 3, 6, 'piercing'),
        ],
      },
      {
        name: 'Thorin Oakenshield', maxHp: 52, ac: 18, initMod: 0,
        abilities: { str: 18, dex: 10, con: 16, int: 9, wis: 12, cha: 10 },
        notes: 'Dwarf fighter 5 · speed 25 ft',
        attacks: [pcAttack('Warhammer', 6, null, '1d10+4', 1, 10, 4, 9, 'bludgeoning')],
      },
      {
        name: 'Bartholomew Quill', maxHp: 31, ac: 13, initMod: 2,
        abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 },
        notes: 'Human wizard 5 · Arcane Recovery · speed 30 ft',
        attacks: [],
      },
      {
        name: 'Seraphina Dawnbringer', maxHp: 45, ac: 17, initMod: 1,
        abilities: { str: 12, dex: 12, con: 14, int: 10, wis: 17, cha: 13 },
        notes: 'Human cleric 5 · Channel Divinity · speed 30 ft',
        attacks: [pcAttack('Sacred Flame', null, { ability: 'DEX', dc: 13 }, '1d8', 1, 8, 0, 4, 'radiant')],
      },
    ]) {
      cur().pcs.push({ id: uuid(), ...p });
    }

    // The casters carry spellbook snapshots + slots, so the demo shows the
    // whole cast flow (slot prompt, upcast, healing) out of the box.
    await importSrdSpells();
    const spellByName = (n: string) => data.spells.find((s) => s.name === n);
    const attachSpell = (pcName: string, spellName: string, opts: { toHit?: number; dc?: number }) => {
      const pc = cur().pcs.find((p) => p.name === pcName);
      const spell = spellByName(spellName);
      if (!pc || !spell) return;
      pc.attacks.push(spellToAction(spell, opts, `spell.${uuid()}`, pc.attacks.length));
    };
    attachSpell('Bartholomew Quill', 'Fire Bolt', { toHit: 5 });
    attachSpell('Bartholomew Quill', 'Fireball', { dc: 14 });
    attachSpell('Bartholomew Quill', 'Misty Step', {});
    attachSpell('Seraphina Dawnbringer', 'Cure Wounds', {});
    attachSpell('Seraphina Dawnbringer', 'Bless', {});
    const slots = (pcName: string, current: number[]) => {
      const pc = cur().pcs.find((p) => p.name === pcName);
      if (pc) pc.spellSlots = { max: [4, 3, 2, 0, 0, 0, 0, 0, 0], current: [...current, 0, 0, 0, 0, 0, 0] };
    };
    slots('Bartholomew Quill', [4, 3, 2]);
    slots('Seraphina Dawnbringer', [4, 2, 2]);

    const byName = (n: string) => data.monsters.find((m) => m.name === n);
    const tpl = (name: string, entries: Array<[string, number]>): void => {
      const resolved = entries
        .map(([n, q]) => ({ monsterTemplateId: byName(n)?.id ?? '', quantity: q }))
        .filter((e) => e.monsterTemplateId !== '');
      cur().templates.push({ id: uuid(), name, entries: resolved });
    };
    tpl('Ambush on the Old Road', [
      ['Goblin Warrior', 4],
      ['Worg', 2],
      ['Bugbear Warrior', 1],
    ]);
    tpl("Dragon's Lair", [
      ['Adult Black Dragon', 1],
      ['Kobold Warrior', 4],
    ]);
    tpl('Owlbear Den', [['Owlbear', 2]]);

    // Kenku demo config: enabled, with sample event sounds, per-attack sounds
    // and a battle playlist on the first template - all synthesized locally.
    data.settings.kenku = {
      enabled: true,
      host: '127.0.0.1',
      port: 3333,
      eventSounds: {
        combatStart: { soundId: 'demo-horn', title: 'Battle Horn' },
        monsterKilled: { soundId: 'demo-screech', title: 'Goblin Screech' },
        attackCrit: { soundId: 'demo-thunder', title: 'Thunder Crack' },
        healApplied: { soundId: 'demo-chime', title: 'Healing Chime' },
      },
    };
    cur().templates[0].kenkuPlaylistId = 'demo-pl-battle';
    cur().templates[0].kenkuPlaylistTitle = 'Battle Drums';
    const attachSound = (
      monsterName: string,
      attackName: string,
      soundId: string,
      title: string,
      trigger: 'attackRoll' | 'attackHit' | 'damageRoll' | 'damageApplied',
    ) => {
      const m = byName(monsterName);
      const a = m?.attacks.find((x) => x.name === attackName);
      if (a) a.kenkuSound = { soundId, title, trigger };
    };
    attachSound('Goblin Warrior', 'Scimitar', 'demo-sword', 'Sword Clash', 'attackHit');
    attachSound('Owlbear', 'Rend', 'demo-roar', 'Dragon Roar', 'attackHit');
    attachSound('Adult Black Dragon', 'Acid Breath', 'demo-fire', 'Fire Whoosh', 'damageRoll');

    // A combat already in progress, so the first thing a visitor sees is the
    // tracker doing its job rather than an empty screen.
    const ambush = cur().templates[0];
    const combatants: Combatant[] = [];
    for (const entry of ambush.entries) {
      const m = data.monsters.find((x) => x.id === entry.monsterTemplateId);
      if (!m) continue;
      for (let i = 1; i <= entry.quantity; i++) {
        combatants.push(combatantFrom(m, entry.quantity > 1 ? `${m.name} ${i}` : m.name));
      }
    }
    for (const pc of cur().pcs) {
      combatants.push({
        id: uuid(),
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
        initiative: d20() + pc.initMod,
        isDowned: false,
      });
    }
    const combat: Combat = {
      id: uuid(),
      sourceTemplateId: ambush.id,
      phase: 'setup',
      combatants,
      currentIndex: 0,
      round: 0,
      log: [],
    };
    sortCombatants(combat);
    combat.phase = 'active';
    combat.round = 2;
    cur().combat = combat;

    // Mid-fight state: a bloodied monster, a hurt PC, a couple of conditions.
    const monsters = combat.combatants.filter((c) => c.type === 'monster');
    const pcs = combat.combatants.filter((c) => c.type === 'pc');
    if (monsters[0]) monsters[0].currentHp = Math.max(1, Math.ceil(monsters[0].maxHp * 0.35));
    if (monsters[1]) monsters[1].conditions = ['Prone'];
    if (pcs[0]) pcs[0].currentHp = Math.max(1, pcs[0].maxHp - 19);
    if (pcs[1]) pcs[1].conditions = ['Poisoned'];
    // Land the pointer on a monster so the quick reference is open on arrival.
    const monsterIdx = combat.combatants.findIndex((c) => c.type === 'monster');
    if (monsterIdx >= 0) combat.currentIndex = monsterIdx;

    // A short round-1 backstory so the log rail and the phone's log/ticker
    // have something to tell from the first second.
    const mName = (i: number) => monsters[i]?.displayName ?? 'Goblin Warrior 1';
    const pName = (i: number) => pcs[i]?.displayName ?? 'Aria Windwhisper';
    const entry = (e: Omit<LogEntry, 'id' | 'ts'>): LogEntry => ({
      ...e,
      id: uuid(),
      ts: Date.now() - (10 - combat.log.length) * 45000,
    });
    combat.log.push(
      entry({ kind: 'combatStart', source: 'dm', round: 1 }),
      entry({ kind: 'turn', actorName: pName(0), actorType: 'pc', source: 'dm', round: 1 }),
      entry({
        kind: 'attackRoll', actorName: pName(0), actorType: 'pc', targetName: mName(0),
        targetType: 'monster',
        attackName: 'Rapier', die: 14, total: 19, outcome: 'hit', source: 'player', round: 1,
      }),
      entry({
        kind: 'damage', actorName: pName(0), actorType: 'pc', targetName: mName(0),
        targetType: 'monster', amount: 7, math: '1d8 [4] +3 = 7', mathTypes: ['piercing'],
        source: 'player', round: 1,
      }),
      entry({ kind: 'turn', actorName: mName(0), actorType: 'monster', source: 'deck', round: 1 }),
      entry({
        kind: 'attackRoll', actorName: mName(0), actorType: 'monster', targetName: pName(0),
        targetType: 'pc',
        attackName: 'Scimitar', die: 17, total: 21, outcome: 'hit', source: 'deck', round: 1,
      }),
      entry({
        kind: 'damage', actorName: mName(0), actorType: 'monster', targetName: pName(0),
        targetType: 'pc', amount: 6, math: '1d6 [4] +2 = 6', mathTypes: ['slashing'],
        source: 'deck', round: 1,
      }),
      entry({
        kind: 'conditionAdded', targetName: mName(1), targetType: 'monster',
        condition: 'Prone', source: 'dm', round: 1,
      }),
      entry({ kind: 'turn', actorName: pName(1), actorType: 'pc', source: 'dm', round: 1 }),
      // A save-based hit, so the log shows a saving-throw card on arrival —
      // DC 14 matches the Fireball attached to this PC further up.
      entry({
        kind: 'save', actorName: mName(0), actorType: 'monster', targetName: pName(1),
        targetType: 'pc', attackName: 'Fireball', ability: 'DEX',
        die: 9, total: 12, dc: 14, outcome: 'failed', source: 'dm', round: 1,
      }),
      entry({
        kind: 'damage', actorName: pName(1), actorType: 'pc', targetName: mName(0),
        targetType: 'monster', amount: 24,
        math: '8d6 [5+4+2+6+1+3+2+1] = 24', mathTypes: ['fire'], source: 'player', round: 1,
      }),
      entry({ kind: 'turn', actorName: mName(0), actorType: 'monster', source: 'dm', round: 2 }),
    );

    // One archived fight so the Archive tab and the phone's history browser
    // aren't empty on first visit.
    const archivedLog: LogEntry[] = [
      { kind: 'combatStart', source: 'dm', round: 1 },
      { kind: 'turn', actorName: 'Owlbear 1', actorType: 'monster', source: 'dm', round: 1 },
      {
        kind: 'attackRoll', actorName: 'Owlbear 1', actorType: 'monster',
        targetName: 'Thorin Oakenshield', targetType: 'pc', attackName: 'Rend',
        die: 18, total: 25, outcome: 'hit', source: 'deck', round: 1,
      },
      {
        kind: 'damage', actorName: 'Owlbear 1', actorType: 'monster',
        targetName: 'Thorin Oakenshield', targetType: 'pc', amount: 14,
        math: '2d8 [5+4] +5 = 14', mathTypes: ['slashing'], source: 'deck', round: 1,
      },
      {
        kind: 'attackRoll', actorName: 'Thorin Oakenshield', actorType: 'pc',
        targetName: 'Owlbear 1', targetType: 'monster', attackName: 'Warhammer',
        die: 20, total: 26, outcome: 'crit', source: 'player', round: 1,
      },
      {
        kind: 'damage', actorName: 'Thorin Oakenshield', actorType: 'pc',
        targetName: 'Owlbear 1', targetType: 'monster', amount: 18,
        math: '4d8 [6+2+5+1] +4 = 18', mathTypes: ['bludgeoning'], source: 'player', round: 2,
      },
      { kind: 'kill', targetName: 'Owlbear 1', targetType: 'monster', source: 'player', round: 2 },
      { kind: 'combatEnd', source: 'dm', round: 2 },
    ].map((e, i) => ({ ...e, id: uuid(), ts: Date.now() - 86400000 + i * 60000 }) as LogEntry);
    cur().archive.push({
      id: uuid(),
      templateName: 'Owlbear Den',
      endedAt: Date.now() - 86400000 + archivedLog.length * 60000,
      rounds: 2,
      log: archivedLog,
    });

    // A second small campaign so the selector has something to switch to.
    const westmarchId = uuid();
    data.campaigns.push({ id: westmarchId, name: 'Westmarch Wednesdays', createdAt: Date.now() });
    const westmarch = emptyCampaignData();
    const wm1: PC = {
      id: uuid(),
      name: 'Brynn Ashvale',
      maxHp: 31,
      ac: 16,
      initMod: 2,
      attacks: [],
      abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
      notes: 'Human fighter 4. Shield-bearer of the Westmarch.',
    };
    const wm2: PC = {
      id: uuid(),
      name: 'Nix',
      maxHp: 22,
      ac: 13,
      initMod: 3,
      attacks: [],
      abilities: { str: 8, dex: 16, con: 12, int: 15, wis: 10, cha: 14 },
      notes: 'Gnome wizard 4. Owns exactly one spellbook and three backups.',
    };
    westmarch.pcs.push(wm1, wm2);
    const wolf = data.monsters.find((m) => m.name === 'Wolf');
    const bandit = data.monsters.find((m) => m.name === 'Bandit');
    westmarch.templates.push({
      id: uuid(),
      name: 'Roadside Ambush',
      entries: [
        ...(bandit ? [{ monsterTemplateId: bandit.id, quantity: 3 }] : []),
        ...(wolf ? [{ monsterTemplateId: wolf.id, quantity: 2 }] : []),
      ],
    });
    data.byCampaign[westmarchId] = westmarch;

    data.seeded = true;
    save();
  }

  const ready: Promise<void> = data.seeded ? Promise.resolve() : seed().catch(() => {});

  // ---- Player View window handling -------------------------------------------

  function pvOpen(): boolean {
    return pvWindow !== null && !pvWindow.closed;
  }
  setInterval(() => {
    if (pvWindow && pvWindow.closed) {
      pvWindow = null;
      for (const cb of pvListeners) cb(false);
    }
  }, 1000);

  // ---- the simulated Stream Deck hooks ----------------------------------------

  function bridgeState(): object {
    const combat = cur().combat;
    const active = combat !== null && combat.phase === 'active';
    const lang = data.settings.language;
    const templates = new Map(data.monsters.map((m) => [m.id, m]));
    return {
      type: 'state',
      language: lang,
      combatants: active
        ? combat.combatants.map((c, i) => ({
            id: c.id,
            sourceId: c.sourceId,
            type: c.type,
            displayName: monsterName(lang, c.displayName),
            currentHp: c.currentHp,
            maxHp: c.maxHp,
            ac: c.ac,
            isCurrentTurn: i === combat.currentIndex,
            isDowned: c.isDowned,
            conditions: c.conditions,
            // Mirror of bridge.ts: ability modifiers so the deck can roll a
            // target's saving throw itself.
            saveMods: c.abilities
              ? Object.fromEntries(ABILITY_KEYS.map((k) => [k, abilityMod(c.abilities![k])]))
              : undefined,
            // Mirror of bridge.ts: pre-localized concentration label.
            concentration: c.concentration
              ? (lang === 'de' && c.concentration.deName) || c.concentration.name
              : null,
            attacks: c.attacks
              // Mirror of bridge.ts: spell snapshots stay off the deck.
              .filter(
                (a) =>
                  !a.spell &&
                  (a.type === 'attack' || (a.type === 'save' && a.onHit.damage.length > 0)),
              )
              .map((a) => ({
                id: a.id,
                name:
                  (lang === 'de' &&
                    templates.get(c.sourceId)?.l10n?.de?.actions[a.name]?.name) ||
                  a.name,
                toHit: a.attack?.toHit ?? null,
                save: a.save
                  ? `${abilityCodeLabel(lang, a.save.ability)} ${a.save.dc}`
                  : null,
                damage: a.onHit.damage.map((d) => ({
                  dice: d.dice,
                  average: d.average,
                  type: d.type,
                  condition: d.condition,
                })),
              })),
          }))
        : [],
      currentIndex: active ? combat.currentIndex : 0,
      round: active ? combat.round : 0,
    };
  }

  function command(cmd: BridgeCommand): void {
    switch (cmd.type) {
      case 'nextTurn':
        nextTurn(DECK_CTX);
        break;
      case 'prevTurn':
        prevTurn(DECK_CTX);
        break;
      case 'endCombat':
        endCombatShared(DECK_CTX);
        break;
      case 'attackEvent':
        kenkuAttackEvent(cmd as unknown as { sourceId?: string; attackId: string; phase: string });
        logAttackRoll(cmd, 'deck');
        break;
      case 'applyDamage':
        if (cmd.actorId && typeof cmd.amount === 'number') {
          // Mirror of bridge.ts: a save-based action logs the throw first.
          if (cmd.save) logDeckSave(cmd.actorId, cmd.save);
          applyDamage(cmd.actorId, cmd.amount, deckCtx(cmd));
        }
        break;
      case 'applyHeal':
        if (cmd.actorId && typeof cmd.amount === 'number') applyHeal(cmd.actorId, cmd.amount, deckCtx(cmd));
        break;
      case 'toggleCondition':
        if (cmd.actorId && cmd.condition) toggleCondition(cmd.actorId, cmd.condition as Condition, DECK_CTX);
        break;
      case 'clearConcentration': {
        const c = cur().combat?.combatants.find((x) => x.id === cmd.actorId);
        if (c) {
          c.concentration = null;
          save();
        }
        break;
      }
    }
    // A real deck press pulls the DM window to the Combat screen.
    for (const cb of focusListeners) cb();
  }

  // ---- fake player server (demo) ---------------------------------------------
  // Speaks the playerServer.ts protocol to the phone-sim iframe: same
  // disclosure rules (monster HP/AC never sent, monster roll numbers stripped
  // from the log), same commands, strict turn gating.

  interface PlayerSession {
    token: string | null;
    pcId: string | null;
    onMessage: (json: string) => void;
  }

  const playerSessions = new Set<PlayerSession>();
  // Claims scope per campaign (mirror of per-campaign player-claims.json);
  // in the demo they are session-only, never persisted.
  const claimsByCampaign = new Map<string, Map<string, { token: string; playerName: string | null }>>();
  const playerClaims = (): Map<string, { token: string; playerName: string | null }> => {
    let m = claimsByCampaign.get(data.activeId);
    if (!m) {
      m = new Map();
      claimsByCampaign.set(data.activeId, m);
    }
    return m;
  };
  const savePendingListeners = new Set<(pending: object) => void>();
  interface PendingSave {
    id: string;
    pcId: string;
    actorName: string;
    attackId: string;
    attackName: string;
    damage: number;
    dc: number | undefined;
    /** Ability code thrown against the DC, for the log's heading. */
    ability: string;
    /** The roll behind the damage, so the log can show the composition. */
    math: string | undefined;
    mathTypes: (string | null)[] | undefined;
    /** Damage on a successful save (mirror of playerServer.ts). */
    onSuccess: 'half' | 'none';
    targetIds: string[];
    session: PlayerSession;
  }
  const pendingSaves = new Map<string, PendingSave>();

  /** Pending Concentration checks (mirror of playerServer.ts). */
  // ---- saving throws owed (mirror of main/saveRequests.ts) -------------------

  interface DemoThrowResult {
    die: number | null;
    total: number;
    by: string;
  }
  interface DemoThrowTarget {
    combatantId: string;
    name: string;
    type: 'pc' | 'monster';
    pcId: string | null;
    mod: number | null;
    awaiting: string | null;
    result: DemoThrowResult | null;
  }
  interface DemoSaveRequest {
    id: string;
    kind: 'concentration' | 'save';
    ability: string;
    dc: number;
    attackName: string;
    attackerName?: string;
    spellName?: string;
    damage?: number;
    /** A pickup off a deferred card stays with whoever reached for it. */
    pickedUpBy?: 'dm' | 'phone';
    targets: DemoThrowTarget[];
  }
  interface DemoSaveRequestInput {
    kind: 'concentration' | 'save';
    ability: string;
    dc: number;
    attackName: string;
    attackerName?: string;
    spellName?: string;
    damage?: number;
    pickedUpBy?: 'dm' | 'phone';
    combatantIds: string[];
    onResolved?: (req: DemoSaveRequest) => void;
  }

  const saveRequests = new Map<string, DemoSaveRequest>();
  const saveFinishers = new Map<string, (req: DemoSaveRequest) => void>();
  /** Deferred requests: they keep their finisher, and with it the damage. */
  const parkedRequests = new Map<string, DemoSaveRequest>();
  const saveReqListeners = new Set<(req: DemoSaveRequest) => void>();
  const saveReqClosedListeners = new Set<(id: string) => void>();
  /** Prompts sitting on a phone-sim, keyed by prompt id. */
  const phonePrompts = new Map<
    string,
    { id: string; requestId: string; combatantId: string; session: PlayerSession }
  >();

  /** The DM hears about it unless a player picked it up for themselves. */
  function announceRequest(req: DemoSaveRequest): void {
    if (req.pickedUpBy === 'phone') return;
    for (const cb of saveReqListeners) cb(req);
  }

  function openSaveRequest(input: DemoSaveRequestInput): DemoSaveRequest | null {
    const combat = cur().combat;
    if (!combat) return null;
    const lang = data.settings.language;
    const key = input.ability.toLowerCase().slice(0, 3);
    const targets: DemoThrowTarget[] = [];
    for (const id of input.combatantIds) {
      const c = combat.combatants.find((x) => x.id === id);
      if (!c) continue;
      // Prefer the PC's own record: a combatant added mid-fight snapshots
      // abilities as null, and the modifier is the whole point of the hint.
      const pc = c.type === 'pc' ? cur().pcs.find((x) => x.id === c.sourceId) : undefined;
      const scores = (pc?.abilities ?? c.abilities) as unknown as
        | Record<string, number>
        | null
        | undefined;
      const score = scores ? scores[key] : undefined;
      targets.push({
        combatantId: c.id,
        name: monsterName(lang, c.displayName),
        type: c.type,
        pcId: c.type === 'pc' ? c.sourceId : null,
        mod: typeof score === 'number' ? abilityMod(score) : null,
        awaiting: null,
        result: null,
      });
    }
    if (targets.length === 0) return null;
    const req: DemoSaveRequest = { id: uuid(), ...input, targets };
    saveRequests.set(req.id, req);
    if (input.onResolved) saveFinishers.set(req.id, input.onResolved);
    // A DM pickup is answered by the DM; do not light up a phone for it.
    if (req.pickedUpBy !== 'dm') {
      for (const t of req.targets) {
        if (t.pcId) t.awaiting = promptPhoneForThrow(req, t);
      }
    }
    announceRequest(req);
    return req;
  }

  function promptPhoneForThrow(req: DemoSaveRequest, target: DemoThrowTarget): string | null {
    const session = [...playerSessions].find((x) => x.pcId === target.pcId);
    if (!session) return null;
    const prompt = { id: uuid(), requestId: req.id, combatantId: target.combatantId, session };
    phonePrompts.set(prompt.id, prompt);
    session.onMessage(
      JSON.stringify({
        type: 'throwPrompt',
        id: prompt.id,
        kind: req.kind,
        attackName: req.attackName,
        attackerName: req.attackerName,
        spellName: req.spellName,
        ability: req.ability,
        dc: req.dc,
        damage: req.damage,
        mod: target.mod,
      }),
    );
    return sourceNameFor(target.pcId ?? '') ?? 'phone';
  }

  function cancelPhonePrompt(requestId: string, combatantId: string | null): void {
    for (const [id, prompt] of [...phonePrompts]) {
      if (prompt.requestId !== requestId) continue;
      if (combatantId !== null && prompt.combatantId !== combatantId) continue;
      phonePrompts.delete(id);
      prompt.session.onMessage(JSON.stringify({ type: 'throwResult', id, cancelled: true }));
    }
  }

  function resolveThrow(
    requestId: string,
    combatantId: string,
    result: DemoThrowResult,
    revealMs = 0,
  ): boolean {
    const req = saveRequests.get(requestId);
    if (!req) return false;
    const target = req.targets.find((t) => t.combatantId === combatantId);
    if (!target || target.result) return false;
    target.result = result;
    target.awaiting = null;
    cancelPhonePrompt(requestId, combatantId);
    clearDeferredCards(requestId, combatantId);
    announceRequest(req);
    if (req.targets.every((t) => t.result)) {
      const done = saveFinishers.get(requestId);
      closeSaveRequest(requestId);
      if (done) {
        if (revealMs > 0) setTimeout(() => done(req), revealMs);
        else done(req);
      }
    }
    return true;
  }

  function closeSaveRequest(requestId: string): void {
    if (!saveRequests.has(requestId)) return;
    saveRequests.delete(requestId);
    saveFinishers.delete(requestId);
    parkedRequests.delete(requestId);
    cancelPhonePrompt(requestId, null);
    for (const cb of saveReqClosedListeners) cb(requestId);
  }

  /** Drop deferred cards for a request — all, or just one target's. */
  function clearDeferredCards(requestId: string, combatantId: string | null): void {
    const combat = cur().combat;
    if (!combat) return;
    let removed = false;
    for (const e of [...combat.log]) {
      if (e.kind !== 'saveDeferred' || e.requestId !== requestId) continue;
      if (combatantId !== null && e.combatantId !== combatantId) continue;
      if (applyLogEntryDelete(combat, e.id)) removed = true;
    }
    if (removed) {
      combat.log = [...combat.log];
      save();
    }
  }

  /**
   * Mirror of saveRequests.ts: a deferred throw comes back for whoever picked
   * it up, and only them. The DM taking a card gets every row still owed; a
   * player taking their own leaves everyone else's screen alone.
   */
  function resumeSaveRequest(
    requestId: string,
    by: { surface: 'dm' } | { surface: 'phone'; pcId: string },
  ): DemoSaveRequest | null {
    const req = parkedRequests.get(requestId) ?? saveRequests.get(requestId);
    if (!req) return null;
    parkedRequests.delete(requestId);
    saveRequests.set(requestId, req);
    req.pickedUpBy = by.surface;
    if (by.surface === 'dm') {
      clearDeferredCards(requestId, null);
      announceRequest(req);
      return req;
    }
    const own = req.targets.find((t) => t.pcId === by.pcId && !t.result);
    if (!own) return null;
    clearDeferredCards(requestId, own.combatantId);
    own.awaiting = promptPhoneForThrow(req, own);
    return req;
  }

  /** Dismiss: file each unanswered row as a card that can still be thrown. */
  function deferSaveRequest(requestId: string): void {
    const req = saveRequests.get(requestId);
    if (!req) return;
    const owed = req.targets.filter((t) => !t.result);
    // Park rather than close: closing drops the finisher, and with it the
    // damage or the spell this throw was going to decide.
    saveRequests.delete(requestId);
    parkedRequests.set(requestId, req);
    cancelPhonePrompt(requestId, null);
    for (const cb of saveReqClosedListeners) cb(requestId);
    const combat = cur().combat;
    if (!combat) return;
    for (const t of owed) fileDeferredCard(req, t, requestId);
    save();
  }

  function fileDeferredCard(
    req: DemoSaveRequest,
    t: DemoThrowTarget,
    requestId: string,
  ): void {
    const combat = cur().combat;
    if (!combat) return;
    pushLog(combat, {
      kind: 'saveDeferred',
      actorName: t.name,
      actorType: t.type,
      attackName: req.attackName,
      ability: req.ability,
      dc: req.dc,
      amount: req.damage,
      combatantId: t.combatantId,
      requestId,
      conc: req.kind === 'concentration',
      source: 'dm',
    });
  }

  /**
   * Mirror of saveRequests.ts: one player stepped away from their own row.
   * Everyone else's throw stays exactly where it was.
   */
  function deferTarget(requestId: string, combatantId: string): void {
    const req = saveRequests.get(requestId);
    if (!req) return;
    const target = req.targets.find((t) => t.combatantId === combatantId && !t.result);
    if (!target) return;
    target.awaiting = null;
    cancelPhonePrompt(requestId, combatantId);
    fileDeferredCard(req, target, requestId);
    save();
    if (req.pickedUpBy === 'phone') {
      saveRequests.delete(requestId);
      parkedRequests.set(requestId, req);
      for (const cb of saveReqClosedListeners) cb(requestId);
      return;
    }
    announceRequest(req);
  }

  function reopenDeferredThrow(
    entry: LogEntry,
    by: { surface: 'dm' } | { surface: 'phone'; pcId: string },
  ): boolean {
    // The parked original first: it still carries what the throw decides.
    if (entry.requestId && resumeSaveRequest(entry.requestId, by)) return true;
    if (!entry.combatantId || !entry.ability || entry.dc === undefined) return false;
    const combatantId = entry.combatantId;
    const isConc = entry.conc === true;
    return (
      openSaveRequest({
        // Rebuilt rather than resumed, but still a pickup.
        pickedUpBy: by.surface,
        kind: isConc ? 'concentration' : 'save',
        ability: entry.ability,
        dc: entry.dc,
        attackName: entry.attackName ?? '',
        spellName: isConc ? entry.attackName : undefined,
        damage: entry.amount,
        combatantIds: [combatantId],
        onResolved: isConc ? (r) => applyConcentration(r, combatantId) : undefined,
      }) !== null
    );
  }

  /** Concentration's consequence: log the throw, drop the spell on a failure. */
  function applyConcentration(req: DemoSaveRequest, combatantId: string): void {
    const target = req.targets[0];
    const combat = cur().combat;
    if (!target?.result || !combat) return;
    const saved = target.result.total >= req.dc;
    pushLog(combat, {
      kind: 'save',
      actorName: target.name,
      actorType: 'pc',
      attackName: `${translate(data.settings.language, 'spellbook.concentration')} (${
        req.spellName ?? req.attackName
      })`,
      die: target.result.die ?? undefined,
      total: target.result.total,
      dc: req.dc,
      ability: 'CON',
      outcome: saved ? 'saved' : 'failed',
      source: target.result.by === 'dm' ? 'dm' : 'player',
      sourceName: target.result.by === 'dm' ? undefined : target.result.by,
    });
    if (!saved) {
      const c = combat.combatants.find((x) => x.id === combatantId);
      if (c) c.concentration = null;
    }
    save();
  }

  function tokenPcId(token: string | null): string | null {
    if (!token) return null;
    for (const [pcId, claim] of playerClaims()) if (claim.token === token) return pcId;
    return null;
  }

  function filterLogForPlayers(log: LogEntry[], viewerCombatantId: string | null): LogEntry[] {
    // Mirror of playerServer.ts: no breakdown, always the composition.
    return log.flatMap<LogEntry>((e) => {
      // A deferred throw is addressed to one character: its owner sees it, the
      // rest of the table does not.
      if (e.kind === 'saveDeferred') {
        return e.combatantId && e.combatantId === viewerCombatantId ? [e] : [];
      }
      if (e.kind === 'attackRoll') {
        return [{ ...e, die: undefined, dice: undefined, total: undefined, math: attackComposition(e) }];
      }
      if (e.kind === 'save') return [{ ...e, die: undefined, dice: undefined }];
      if (e.math === undefined) return [e];
      return [{ ...e, die: undefined, dice: undefined, math: stripDiceResults(e.math) }];
    });
  }

  /** "d20 + 5" — the throw, without what it came up or what it totalled. */
  function attackComposition(e: LogEntry): string | undefined {
    if (e.die === undefined || e.total === undefined) return undefined;
    const mod = e.total - e.die;
    if (mod === 0) return 'd20';
    return `d20 ${mod > 0 ? '+' : '−'} ${Math.abs(mod)}`;
  }

  function playerStateMessage(session: PlayerSession): string {
    const lang = data.settings.language;
    const combat = cur().combat;
    const active = combat !== null && combat.phase === 'active';
    const ownPc = session.pcId ? cur().pcs.find((p) => p.id === session.pcId) ?? null : null;
    const ownCombatant = active
      ? combat.combatants.find((c) => c.type === 'pc' && c.sourceId === session.pcId) ?? null
      : null;

    const combatants = active
      ? combat.combatants.map((c, i) => {
          const base = {
            id: c.id,
            name: monsterName(lang, c.displayName),
            type: c.type,
            isCurrentTurn: i === combat.currentIndex,
            isDowned: c.isDowned,
            conditions: c.conditions,
            concentration: c.concentration ?? null,
            isBloodied: c.type === 'monster' ? c.currentHp < c.maxHp * 0.5 : undefined,
          };
          if (c.type !== 'pc') return base;
          const pcExtra = { currentHp: c.currentHp, maxHp: c.maxHp };
          if (c.sourceId !== session.pcId) return { ...base, ...pcExtra };
          return { ...base, ...pcExtra, ac: c.ac, initiative: c.initiative };
        })
      : [];

    return JSON.stringify({
      type: 'state',
      language: lang,
      gating: data.settings.playerWeb.gating,
      combatActive: active,
      round: active ? combat.round : 0,
      currentIndex: active ? combat.currentIndex : 0,
      myTurn: ownCombatant
        ? combat!.combatants.indexOf(ownCombatant) === combat!.currentIndex
        : false,
      claims: cur().pcs.map((p) => ({
        pcId: p.id,
        name: p.name,
        taken: playerClaims().has(p.id),
        mine: p.id === session.pcId,
        playerName: playerClaims().get(p.id)?.playerName ?? null,
      })),
      you: ownPc
        ? {
            pcId: ownPc.id,
            name: ownPc.name,
            maxHp: ownPc.maxHp,
            ac: ownPc.ac,
            initMod: ownPc.initMod,
            abilities: ownPc.abilities ?? null,
            notes: ownPc.notes ?? '',
            attacks: ownPc.attacks,
            spellSlots: ownPc.spellSlots ?? null,
            combatantId: ownCombatant?.id ?? null,
          }
        : null,
      combatants,
      log: active ? filterLogForPlayers(combat.log, ownCombatant?.id ?? null).slice(-200) : [],
      archive: cur().archive.map((a) => ({
        id: a.id,
        templateName: a.templateName,
        endedAt: a.endedAt,
        rounds: a.rounds,
      })),
    });
  }

  function playerBroadcast(): void {
    for (const s of playerSessions) s.onMessage(playerStateMessage(s));
  }
  stateListeners.add(() => playerBroadcast());

  function publishPlayerClients(): void {
    notify();
  }

  function playerIsMyTurn(pcId: string): boolean {
    const combat = cur().combat;
    if (!combat || combat.phase !== 'active') return false;
    const own = combat.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
    return own !== undefined && combat.combatants.indexOf(own) === combat.currentIndex;
  }

  function playerGateAllows(pcId: string, targets: string[], kind: 'hpChange' | 'attack'): boolean {
    if (playerIsMyTurn(pcId)) return true;
    if (data.settings.playerWeb.gating !== 'relaxed' || kind !== 'hpChange') return false;
    const own = cur().combat?.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
    return own !== undefined && targets.length === 1 && targets[0] === own.id;
  }

  function rollActionDamage(
    action: MonsterAction,
    extra?: { count: number; die: number } | null,
  ): {
    total: number;
    math: string;
    mathTypes: (string | null)[];
    rolls: number[];
  } {
    let total = 0;
    const mathParts: string[] = [];
    const mathTypes: (string | null)[] = [];
    const allRolls: number[] = [];
    for (const d of action.onHit.damage) {
      if (d.condition) continue;
      if (d.count && d.die) {
        const rolls: number[] = [];
        for (let i = 0; i < d.count; i++) rolls.push(1 + Math.floor(Math.random() * d.die));
        allRolls.push(...rolls);
        const bonus = d.bonus ?? 0;
        total += rolls.reduce((a, b) => a + b, 0) + bonus;
        const bonusStr = bonus === 0 ? '' : bonus > 0 ? ` +${bonus}` : ` ${bonus}`;
        // Canonical "1d4", not d.dice — the raw string may already contain
        // the bonus ("1d4+2"), which bonusStr would then repeat.
        mathParts.push(`${d.count}d${d.die} [${rolls.join('+')}]${bonusStr}`);
        mathTypes.push(d.type ?? null);
      } else {
        const value = d.average ?? 0;
        total += value;
        mathParts.push(`${value}`);
      }
    }
    // Upcast dice as their own math bracket (mirror of playerServer.ts).
    if (extra && extra.count > 0) {
      const rolls: number[] = [];
      for (let i = 0; i < extra.count; i++) rolls.push(1 + Math.floor(Math.random() * extra.die));
      allRolls.push(...rolls);
      total += rolls.reduce((a, b) => a + b, 0);
      mathParts.push(`${extra.count}d${extra.die} [${rolls.join('+')}]`);
      mathTypes.push(action.onHit.damage[0]?.type ?? null);
    }
    total = Math.max(0, total);
    return { total, math: `${mathParts.join(' + ')} = ${total}`, mathTypes, rolls: allRolls };
  }

  /** The upcast dice a chosen slot level adds (mirror of playerServer.ts). */
  function upcastExtraOf(
    action: MonsterAction,
    slotLevel: unknown,
  ): { count: number; die: number } | null {
    const meta = action.spell;
    if (!meta?.upcast || typeof slotLevel !== 'number' || slotLevel <= meta.level) return null;
    return { count: meta.upcast.count * (slotLevel - meta.level), die: meta.upcast.die };
  }

  /**
   * Spends the slot for a spell cast + logs it (mirror of spendSlotForCast).
   * Non-spell actions pass; cantrips log free; false = noSlot.
   */
  function playerSpendSlot(pcId: string, action: MonsterAction, slotLevelRaw: unknown): boolean {
    const meta = action.spell;
    if (!meta) return true;
    const ctx = playerCtx(pcId);
    // Log snapshots carry names in the language active when the entry was made.
    const spellName = spellActionName(data.settings.language, action);
    const conc = meta.concentration ? { name: action.name, deName: meta.deName ?? null } : null;
    if (meta.level === 0) return castSpellInner(pcId, spellName, null, ctx, conc);
    const lvl = typeof slotLevelRaw === 'number' && Number.isInteger(slotLevelRaw) ? slotLevelRaw : -1;
    if (lvl < meta.level || lvl > 9) return false;
    return castSpellInner(pcId, spellName, lvl, ctx, conc);
  }

  function sourceNameFor(pcId: string): string | undefined {
    return playerClaims().get(pcId)?.playerName ?? undefined;
  }

  function playerCtx(pcId: string): ActionCtx {
    const pc = cur().pcs.find((p) => p.id === pcId);
    return { source: 'player', actorName: pc?.name, actorType: 'pc', sourceName: sourceNameFor(pcId) };
  }

  function handlePlayerCommand(session: PlayerSession, cmd: Record<string, unknown>): void {
    const sendTo = (msg: object) => session.onMessage(JSON.stringify(msg));
    const type = cmd.type as string;

    if (type === 'hello') {
      session.token = typeof cmd.token === 'string' ? cmd.token : null;
      session.pcId = tokenPcId(session.token);
      sendTo(JSON.parse(playerStateMessage(session)));
      return;
    }

    if (type === 'claim') {
      const pcId = cmd.pcId as string;
      const token = cmd.token as string;
      if (!cur().pcs.some((p) => p.id === pcId)) {
        sendTo({ type: 'claimResult', ok: false, reason: 'unknownPc' });
        return;
      }
      const existing = playerClaims().get(pcId);
      if (existing && existing.token !== token) {
        sendTo({ type: 'claimResult', ok: false, reason: 'taken' });
        return;
      }
      for (const [otherId, claim] of playerClaims()) {
        if (otherId !== pcId && claim.token === token) playerClaims().delete(otherId);
      }
      const name = typeof cmd.playerName === 'string' ? cmd.playerName.trim().slice(0, 40) : '';
      playerClaims().set(pcId, { token, playerName: name || null });
      session.token = token;
      session.pcId = pcId;
      sendTo({ type: 'claimResult', ok: true });
      publishPlayerClients();
      return;
    }

    if (type === 'release') {
      if (session.pcId) playerClaims().delete(session.pcId);
      session.pcId = null;
      session.token = null;
      publishPlayerClients();
      return;
    }

    if (!session.pcId) return;
    const pcId = session.pcId;

    if (type === 'applyDamage' || type === 'applyHeal') {
      const targets = (cmd.targets as string[]) ?? [];
      const amount = cmd.amount as number;
      if (!Number.isInteger(amount) || amount < 1 || amount > 999) return;
      if (!playerGateAllows(pcId, targets, 'hpChange')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      const ctx = playerCtx(pcId);
      for (const id of targets) {
        if (type === 'applyDamage') applyDamage(id, amount, ctx);
        else applyHeal(id, amount, ctx);
      }
      return;
    }

    if (type === 'attackRollDigital') {
      // Mirror of the real server's split flow, stage 1: d20 only.
      const pc = cur().pcs.find((p) => p.id === pcId);
      const action = pc?.attacks.find((a) => a.id === cmd.attackId);
      const targetIds = (cmd.targetIds as string[]) ?? [];
      if (!pc || !action || action.type === 'save' || action.save) {
        sendTo({ type: 'error', code: 'badAttack' });
        return;
      }
      if (!playerGateAllows(pcId, targetIds, 'attack')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      const combat = cur().combat;
      const target = combat?.combatants.find((c) => c.id === targetIds[0]);
      if (!combat || !target) {
        sendTo({ type: 'error', code: 'badTarget' });
        return;
      }
      if (!playerSpendSlot(pcId, action, cmd.slotLevel)) {
        sendTo({ type: 'error', code: 'noSlot' });
        return;
      }
      const mode = cmd.advantage === 'adv' || cmd.advantage === 'dis' ? cmd.advantage : 'normal';
      const { die, dice } = rollD20(mode as RollMode);
      const total = die + (action.attack?.toHit ?? 0);
      const outcome =
        die === 20 ? 'crit' : die === 1 ? 'miss' : total >= target.ac ? 'hit' : 'miss';
      // The log waits for the roller's reveal, like the real server.
      setTimeout(() => {
        const c = cur().combat;
        if (!c) return;
        pushLog(c, {
          kind: 'attackRoll',
          actorName: pc.name,
          actorType: 'pc',
          targetName: target.displayName,
          targetType: target.type,
          attackName: action.name,
          die,
          dice: dice.length > 1 ? dice : undefined,
          total,
          outcome,
          source: 'player',
          sourceName: sourceNameFor(pcId),
        });
        kenkuAttackEvent({
          sourceId: pcId,
          attackId: action.id,
          phase: outcome === 'crit' ? 'attackCrit' : outcome === 'hit' ? 'attackHit' : 'attackMiss',
        });
        save();
      }, 3600);
      sendTo({
        type: 'attackRollResult',
        targetId: target.id,
        targetName: target.displayName,
        die,
        dice,
        total,
        outcome,
      });
      return;
    }

    if (type === 'damageRollDigital') {
      // Stage 2: roll and apply the damage.
      const pc = cur().pcs.find((p) => p.id === pcId);
      const action = pc?.attacks.find((a) => a.id === cmd.attackId);
      const targetIds = (cmd.targetIds as string[]) ?? [];
      if (!pc || !action) {
        sendTo({ type: 'error', code: 'badAttack' });
        return;
      }
      if (!playerGateAllows(pcId, targetIds, 'attack')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      const combat = cur().combat;
      const target = combat?.combatants.find((c) => c.id === targetIds[0]);
      if (!combat || !target) {
        sendTo({ type: 'error', code: 'badTarget' });
        return;
      }
      const rolled = rollActionDamage(action, upcastExtraOf(action, cmd.slotLevel));
      // Damage lands after the roller's reveal, like the real server.
      setTimeout(() => {
        applyDamage(target.id, rolled.total, {
          ...playerCtx(pcId),
          math: rolled.math,
          mathTypes: rolled.mathTypes,
        });
        kenkuAttackEvent({ sourceId: pcId, attackId: action.id, phase: 'damageApplied' });
      }, 2900);
      sendTo({
        type: 'damageResult',
        targetId: target.id,
        targetName: target.displayName,
        damage: rolled.total,
        rolls: rolled.rolls,
        math: rolled.math,
        mathTypes: rolled.mathTypes,
      });
      return;
    }

    if (type === 'attackDigital' || type === 'attackManual') {
      const pc = cur().pcs.find((p) => p.id === pcId);
      const action = pc?.attacks.find((a) => a.id === cmd.attackId);
      const targetIds = (cmd.targetIds as string[]) ?? [];
      if (!pc || !action) {
        sendTo({ type: 'error', code: 'badAttack' });
        return;
      }
      if (!playerGateAllows(pcId, targetIds, 'attack')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      if (!playerSpendSlot(pcId, action, cmd.slotLevel)) {
        sendTo({ type: 'error', code: 'noSlot' });
        return;
      }
      if (action.type === 'save' || action.save) {
        const rolledSave = rollActionDamage(action, upcastExtraOf(action, cmd.slotLevel));
        // A typed-in total has no dice behind it, so nothing to show or reveal.
        const savedManual =
          type === 'attackManual' && Number.isInteger(cmd.damage) && (cmd.damage as number) > 0;
        const damage = savedManual ? (cmd.damage as number) : rolledSave.total;
        const pending: PendingSave = {
          id: uuid(),
          pcId,
          actorName: pc.name,
          attackId: action.id,
          attackName: action.name,
          damage,
          dc: action.save?.dc,
          ability: action.save?.ability ?? 'DEX',
          math: savedManual ? undefined : rolledSave.math,
          mathTypes: savedManual ? undefined : rolledSave.mathTypes,
          onSuccess: action.save?.onSuccess ?? 'half',
          targetIds,
          session,
        };
        pendingSaves.set(pending.id, pending);
        sendTo({
          type: 'savePending',
          id: pending.id,
          damage,
          rolls: savedManual ? undefined : rolledSave.rolls,
          math: savedManual ? undefined : rolledSave.math,
          mathTypes: savedManual ? undefined : rolledSave.mathTypes,
        });
        // Mirror of playerServer.ts: the DM adjudicates through the same
        // request every other throw uses, so phones roll their own and putting
        // it off leaves a card in the log.
        const dc = action.save?.dc ?? 10;
        openSaveRequest({
          kind: 'save',
          ability: pending.ability,
          dc,
          attackName: pending.attackName,
          attackerName: pending.actorName,
          combatantIds: pending.targetIds,
          onResolved: (req) =>
            resolvePlayerSave(
              pending.id,
              req.targets.map((t) => ({
                targetId: t.combatantId,
                saved: (t.result?.total ?? 0) >= req.dc,
                total: t.result?.total,
                die: t.result?.die ?? undefined,
              })),
            ),
        });
        return;
      }
      const combat = cur().combat;
      const target = combat?.combatants.find((c) => c.id === targetIds[0]);
      if (!combat || !target) {
        sendTo({ type: 'error', code: 'badTarget' });
        return;
      }
      let die: number | null = null;
      let total: number;
      let outcome: 'crit' | 'hit' | 'miss';
      if (type === 'attackDigital') {
        die = 1 + Math.floor(Math.random() * 20);
        total = die + (action.attack?.toHit ?? 0);
        outcome = die === 20 ? 'crit' : die === 1 ? 'miss' : total >= target.ac ? 'hit' : 'miss';
      } else {
        total = (cmd.d20Total as number) ?? 0;
        const natural = cmd.natural as number | undefined;
        die = natural === 20 ? 20 : natural === 1 ? 1 : null;
        outcome = natural === 20 ? 'crit' : natural === 1 ? 'miss' : total >= target.ac ? 'hit' : 'miss';
      }
      const combatForLog = cur().combat;
      if (combatForLog) {
        pushLog(combatForLog, {
          kind: 'attackRoll',
          actorName: pc.name,
          actorType: 'pc',
          targetName: target.displayName,
          targetType: target.type,
          attackName: action.name,
          die: die ?? undefined,
          total,
          outcome,
          source: 'player',
          sourceName: sourceNameFor(pcId),
        });
      }
      kenkuAttackEvent({
        sourceId: pcId,
        attackId: action.id,
        phase: outcome === 'crit' ? 'attackCrit' : outcome === 'hit' ? 'attackHit' : 'attackMiss',
      });
      let damage: number | null = null;
      if (outcome !== 'miss') {
        const manualDmg =
          type === 'attackManual' && Number.isInteger(cmd.damage) && (cmd.damage as number) > 0;
        const rolledDmg = rollActionDamage(action);
        damage = manualDmg ? (cmd.damage as number) : rolledDmg.total;
        applyDamage(target.id, damage, {
          ...playerCtx(pcId),
          math: manualDmg ? undefined : rolledDmg.math,
          mathTypes: manualDmg ? undefined : rolledDmg.mathTypes,
        });
      } else {
        save();
      }
      sendTo({
        type: 'attackResult',
        targetId: target.id,
        targetName: target.displayName,
        die,
        total,
        outcome,
        damage,
      });
      return;
    }

    if (type === 'castSpell') {
      // Utility spells: spend the slot, log the cast, nothing to roll.
      const pc = cur().pcs.find((p) => p.id === pcId);
      const action = pc?.attacks.find((a) => a.id === cmd.attackId);
      if (!pc || !action || !action.spell) {
        sendTo({ type: 'error', code: 'badAttack' });
        return;
      }
      if (!playerGateAllows(pcId, [], 'attack')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      if (!playerSpendSlot(pcId, action, cmd.slotLevel)) {
        sendTo({ type: 'error', code: 'noSlot' });
        return;
      }
      sendTo({ type: 'castResult', actionId: action.id, slotLevel: (cmd.slotLevel as number) ?? null });
      return;
    }

    if (type === 'castHealDigital' || type === 'castHealManual') {
      // Healing spells: rolled or typed, applied as healing (mirror of the server).
      const pc = cur().pcs.find((p) => p.id === pcId);
      const action = pc?.attacks.find((a) => a.id === cmd.attackId);
      const targetIds = (cmd.targetIds as string[]) ?? [];
      if (!pc || !action || !action.spell?.healing) {
        sendTo({ type: 'error', code: 'badAttack' });
        return;
      }
      if (!playerGateAllows(pcId, targetIds, 'attack')) {
        sendTo({ type: 'error', code: 'notYourTurn' });
        return;
      }
      const combat = cur().combat;
      const target = combat?.combatants.find((c) => c.id === targetIds[0]);
      if (!combat || !target) {
        sendTo({ type: 'error', code: 'badTarget' });
        return;
      }
      if (!playerSpendSlot(pcId, action, cmd.slotLevel)) {
        sendTo({ type: 'error', code: 'noSlot' });
        return;
      }
      if (type === 'castHealManual') {
        const amount = cmd.amount as number;
        if (!Number.isInteger(amount) || amount < 1 || amount > 999) {
          sendTo({ type: 'error', code: 'badTarget' });
          return;
        }
        applyHeal(target.id, amount, playerCtx(pcId));
        sendTo({ type: 'healResult', targetId: target.id, targetName: target.displayName, amount });
        return;
      }
      const rolled = rollActionDamage(action, upcastExtraOf(action, cmd.slotLevel));
      setTimeout(() => {
        applyHeal(target.id, rolled.total, playerCtx(pcId));
      }, 2900);
      sendTo({
        type: 'healResult',
        targetId: target.id,
        targetName: target.displayName,
        amount: rolled.total,
        rolls: rolled.rolls,
        math: rolled.math,
      });
      return;
    }

    if (type === 'longRest') {
      // Never turn-gated, like saveAttack.
      if (pcId) longRestInner(pcId);
      return;
    }

    if (type === 'throwRetry') {
      // Mirror of playerServer.ts: only the character who owes it may ask.
      const combat = cur().combat;
      const entry = combat?.log.find((e) => e.id === cmd.entryId);
      if (!combat || !entry || entry.kind !== 'saveDeferred' || !entry.combatantId) return;
      const target = combat.combatants.find((c) => c.id === entry.combatantId);
      if (!target || target.type !== 'pc' || target.sourceId !== session.pcId) return;
      // Picked up by this player: the prompt lands on their phone only.
      if (reopenDeferredThrow(entry, { surface: 'phone', pcId: session.pcId! })) {
        if (applyLogEntryDelete(combat, entry.id)) combat.log = [...combat.log];
        save();
      }
      return;
    }

    if (type === 'throwDefer') {
      const prompt = typeof cmd.id === 'string' ? phonePrompts.get(cmd.id) : undefined;
      if (!prompt || prompt.session !== session) return;
      // Leave it registered: cancelPhonePrompt is what closes the phone.
      deferTarget(prompt.requestId, prompt.combatantId);
      return;
    }

    if (type === 'throwDigital' || type === 'throwManual') {
      const prompt = typeof cmd.id === 'string' ? phonePrompts.get(cmd.id) : undefined;
      if (!prompt || prompt.session !== session) return;
      const req = saveRequests.get(prompt.requestId);
      const target = req?.targets.find((t) => t.combatantId === prompt.combatantId);
      if (!req || !target) return;
      const digital = type === 'throwDigital';
      if (!digital && typeof cmd.total !== 'number') return;
      const die = digital ? 1 + Math.floor(Math.random() * 20) : null;
      const total = digital ? (die as number) + (target.mod ?? 0) : Math.floor(cmd.total as number);
      phonePrompts.delete(prompt.id);
      sendTo({
        type: 'throwResult',
        id: prompt.id,
        die,
        total,
        dc: req.dc,
        saved: total >= req.dc,
      });
      // Digital only: the phone tumbles, so hold the table-visible half back.
      resolveThrow(
        req.id,
        target.combatantId,
        { die, total, by: sourceNameFor(session.pcId ?? '') ?? 'phone' },
        digital ? 3600 : 0,
      );
      return;
    }

    if (type === 'getSpells') {
      sendTo({
        type: 'spellList',
        spells: data.spells
          .slice()
          .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
          .map((s) => ({
            id: s.id,
            name: s.name,
            level: s.level,
            school: s.school,
            castingTime: s.castingTime,
            range: s.range,
            components: s.components,
            duration: s.duration,
            concentration: s.concentration,
            ritual: s.ritual,
            text: s.text,
            attack: s.attack,
            save: s.save,
            damage: s.damage,
            healing: s.healing,
            upcast: s.upcast,
            upcastText: s.upcastText,
            l10n: s.l10n ?? null,
          })),
      });
      return;
    }

    if (type === 'saveAttack') {
      const action = cmd.action as MonsterAction;
      const pc = cur().pcs.find((p) => p.id === pcId);
      if (!pc || !action || typeof action.id !== 'string') return;
      const idx = pc.attacks.findIndex((a) => a.id === action.id);
      if (idx === -1) pc.attacks.push(action);
      else pc.attacks[idx] = action;
      const live = cur().combat?.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
      if (live) live.attacks = pc.attacks.map((a) => ({ ...a }));
      save();
      return;
    }

    if (type === 'deleteAttack') {
      const pc = cur().pcs.find((p) => p.id === pcId);
      if (!pc) return;
      pc.attacks = pc.attacks.filter((a) => a.id !== cmd.actionId);
      const live = cur().combat?.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
      if (live) live.attacks = pc.attacks.map((a) => ({ ...a }));
      save();
      return;
    }

    if (type === 'getArchive') {
      const found = cur().archive.find((a) => a.id === cmd.archiveId);
      if (!found) return;
      sendTo({
        type: 'archiveEntry',
        id: found.id,
        templateName: found.templateName,
        endedAt: found.endedAt,
        rounds: found.rounds,
        // Unredacted, like the real server: Past Combats show everything.
        log: found.log,
      });
      return;
    }
  }

  function resolvePlayerSave(
    id: string,
    results: Array<{ targetId: string; saved: boolean; total?: number; die?: number }>,
  ): void {
    const pending = pendingSaves.get(id);
    if (!pending) return;
    pendingSaves.delete(id);
    const combat = cur().combat;
    const half = pending.onSuccess === 'none' ? 0 : Math.floor(pending.damage / 2);
    const applied: Array<{ targetId: string; targetName: string; saved: boolean; amount: number }> = [];
    for (const r of results) {
      const target = combat?.combatants.find((c) => c.id === r.targetId);
      if (!target || !pending.targetIds.includes(r.targetId)) continue;
      const amount = r.saved ? half : pending.damage;
      if (combat) {
        pushLog(combat, {
          kind: 'save',
          actorName: target.displayName,
          actorType: target.type,
          targetName: pending.actorName,
          targetType: 'pc',
          attackName: pending.attackName,
          die: r.die,
          total: r.total,
          dc: pending.dc,
          ability: pending.ability,
          outcome: r.saved ? 'saved' : 'failed',
          source: 'dm',
        });
      }
      if (amount > 0) {
        applyDamage(r.targetId, amount, {
          source: 'player',
          actorName: pending.actorName,
          actorType: 'pc',
          // Mirror of playerServer.ts: a halved save still shows what was
          // thrown, with the halving spelled out.
          math: pending.math
            ? r.saved
              ? `${pending.math} → ½ ${amount}`
              : pending.math
            : undefined,
          mathTypes: pending.mathTypes,
          sourceName: sourceNameFor(pending.pcId),
        });
      }
      applied.push({ targetId: r.targetId, targetName: target.displayName, saved: r.saved, amount });
    }
    save();
    pending.session.onMessage(
      JSON.stringify({ type: 'saveResolved', id, results: applied }),
    );
  }

  function dismissPlayerSave(id: string): void {
    const pending = pendingSaves.get(id);
    if (!pending) return;
    pendingSaves.delete(id);
    pending.session.onMessage(
      JSON.stringify({ type: 'saveResolved', id, cancelled: true, results: [] }),
    );
  }

  (window as unknown as { __demo?: object }).__demo = {
    bridgeState,
    command,
    /** The phone-sim iframe attaches its fake WebSocket here. */
    playerAttach: (onMessage: (json: string) => void) => {
      const session: PlayerSession = { token: null, pcId: null, onMessage };
      playerSessions.add(session);
      onMessage(playerStateMessage(session));
      return {
        send: (json: string) => {
          try {
            handlePlayerCommand(session, JSON.parse(json) as Record<string, unknown>);
          } catch {
            /* malformed frames are dropped, like the real server */
          }
        },
        close: () => {
          playerSessions.delete(session);
        },
      };
    },
    onState: (cb: () => void) => {
      const wrapped = () => cb();
      stateListeners.add(wrapped);
      return () => stateListeners.delete(wrapped);
    },
    ready: () => ready,
  };

  // ---- the Api surface ---------------------------------------------------------

  return {
    getState: async () => {
      await ready;
      return appState();
    },
    getPlayerViewOpen: async () => pvOpen(),
    onState: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    onPlayerViewOpen: (cb) => {
      pvListeners.add(cb);
      return () => pvListeners.delete(cb);
    },
    onFocusCombat: (cb) => {
      focusListeners.add(cb);
      return () => focusListeners.delete(cb);
    },

    savePc: async (pc) => {
      const id = pc.id ?? uuid();
      cur().pcs = [...cur().pcs.filter((p) => p.id !== id), { ...pc, id }];
      save();
    },
    deletePc: async (id) => {
      cur().pcs = cur().pcs.filter((p) => p.id !== id);
      save();
    },
    savePcAttack: async (pcId, action) => {
      const pc = cur().pcs.find((p) => p.id === pcId);
      if (!pc) return;
      const idx = pc.attacks.findIndex((a) => a.id === action.id);
      if (idx === -1) pc.attacks.push(action);
      else pc.attacks[idx] = action;
      const live = cur().combat?.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
      if (live) live.attacks = pc.attacks.map((a) => ({ ...a }));
      save();
    },
    deletePcAttack: async (pcId, actionId) => {
      const pc = cur().pcs.find((p) => p.id === pcId);
      if (!pc) return;
      pc.attacks = pc.attacks.filter((a) => a.id !== actionId);
      const live = cur().combat?.combatants.find((c) => c.type === 'pc' && c.sourceId === pcId);
      if (live) live.attacks = pc.attacks.map((a) => ({ ...a }));
      save();
    },

    saveMonster: async (m) => {
      const id = m.id ?? uuid();
      const existing = data.monsters.find((x) => x.id === id);
      data.monsters = [
        ...data.monsters.filter((x) => x.id !== id),
        { ...existing, ...m, id, source: existing?.source ?? m.source ?? 'manual' } as MonsterTemplate,
      ];
      save();
    },
    deleteMonster: async (id) => {
      data.monsters = data.monsters.filter((m) => m.id !== id);
      for (const t of cur().templates) {
        t.entries = t.entries.filter((e) => e.monsterTemplateId !== id);
      }
      save();
    },
    importSrd,

    saveSpell: async (s) => {
      const id = s.id ?? uuid();
      const existing = data.spells.find((x) => x.id === id);
      data.spells = [
        ...data.spells.filter((x) => x.id !== id),
        { ...existing, ...s, id, source: existing?.source ?? s.source ?? 'manual' } as Spell,
      ];
      save();
    },
    deleteSpell: async (id) => {
      data.spells = data.spells.filter((s) => s.id !== id);
      save();
    },
    importSrdSpells,
    castSpell: async (pcId, spellName, slotLevel, concentration) =>
      castSpellInner(pcId, spellName, slotLevel, DM_CTX, concentration ?? null),
    longRest: async (pcId) => longRestInner(pcId),

    saveTemplate: async (t) => {
      const id = t.id ?? uuid();
      cur().templates = [...cur().templates.filter((x) => x.id !== id), { ...t, id }];
      save();
    },
    deleteTemplate: async (id) => {
      cur().templates = cur().templates.filter((t) => t.id !== id);
      save();
    },
    duplicateTemplate: async (id) => {
      const t = cur().templates.find((x) => x.id === id);
      if (!t) return;
      cur().templates.push({
        ...t,
        id: uuid(),
        name: `${t.name} (copy)`,
        entries: t.entries.map((e) => ({ ...e })),
      });
      save();
    },

    startCombatSetup: async (templateId, pcIds, rollMode) => {
      const template = cur().templates.find((t) => t.id === templateId);
      if (!template) return;
      const combatants: Combatant[] = [];
      for (const entry of template.entries) {
        const m = data.monsters.find((x) => x.id === entry.monsterTemplateId);
        if (!m) continue;
        for (let i = 1; i <= entry.quantity; i++) {
          combatants.push(combatantFrom(m, entry.quantity > 1 ? `${m.name} ${i}` : m.name));
        }
      }
      for (const pcId of pcIds) {
        const pc = cur().pcs.find((p) => p.id === pcId);
        if (!pc) continue;
        combatants.push({
          id: uuid(),
          displayName: pc.name,
          type: 'pc',
          sourceId: pc.id,
          maxHp: pc.maxHp,
          currentHp: pc.maxHp,
          ac: pc.ac,
          initMod: pc.initMod,
          abilities: null,
          attacks: [],
          conditions: [],
          initiative: rollMode === 'all' ? d20() + pc.initMod : null,
          isDowned: false,
        });
      }
      const combat: Combat = {
        id: uuid(),
        sourceTemplateId: templateId,
        phase: 'setup',
        combatants,
        currentIndex: 0,
        round: 0,
        log: [],
      };
      sortCombatants(combat);
      cur().combat = combat;
      save();
    },
    setInitiative: async (combatantId, value) => {
      const combat = cur().combat;
      if (!combat || combat.phase !== 'setup') return;
      const c = combat.combatants.find((x) => x.id === combatantId);
      if (!c) return;
      c.initiative = value;
      sortCombatants(combat);
      save();
    },
    rerollInitiative: async (id) => {
      const combat = cur().combat;
      if (!combat || combat.phase !== 'setup') return;
      const c = combat.combatants.find((x) => x.id === id);
      if (!c) return;
      c.initiative = d20() + c.initMod;
      sortCombatants(combat);
      save();
    },
    reorderCombatant: async (fromIndex, toIndex) => {
      const combat = cur().combat;
      if (!combat || combat.phase !== 'setup') return;
      const list = combat.combatants;
      if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
      save();
    },
    beginCombat: async () => {
      const combat = cur().combat;
      if (!combat || combat.phase !== 'setup') return;
      if (combat.combatants.some((c) => c.initiative === null)) return;
      combat.phase = 'active';
      combat.currentIndex = 0;
      combat.round = 1;
      pushLog(combat, { kind: 'combatStart', source: 'dm' });
      logTurn(combat, DM_CTX);
      save();
      kenkuCombatEvent('combatStart');
    },
    endCombat: async () => endCombatShared(),
    nextTurn: async () => nextTurn(),
    prevTurn: async () => prevTurn(),
    // The ctx carries the roll the attack modal just made — dropping it left
    // every DM-side damage entry in the demo with no composition to show.
    applyDamage: async (id, amount, ctx) =>
      applyDamage(id, amount, { source: 'dm', ...(ctx ?? {}) }),
    applyHeal: async (id, amount) => applyHeal(id, amount),
    toggleCondition: async (id, condition) => toggleCondition(id, condition),
    removeCombatant: async (id) => {
      const combat = cur().combat;
      if (!combat) return;
      const idx = combat.combatants.findIndex((c) => c.id === id);
      if (idx === -1) return;
      combat.combatants.splice(idx, 1);
      if (combat.combatants.length === 0) {
        combat.currentIndex = 0;
      } else if (idx < combat.currentIndex) {
        combat.currentIndex -= 1;
      } else if (combat.currentIndex >= combat.combatants.length) {
        combat.currentIndex = 0;
      }
      save();
    },
    editLogEntry: async (id, patch) => {
      const combat = cur().combat;
      if (!combat) return;
      if (applyLogEntryEdit(combat, id, patch)) {
        // Fresh array identity: unlike the real app (fresh objects over IPC),
        // the demo hands React the live objects, and LogCards memoizes on the
        // log array.
        combat.log = [...combat.log];
        save();
      }
    },
    // DM-side saving throw from the attack modal, twin of the player-web
    // route's own logging — see main/ipc.ts 'log:save'.
    logSaveRoll: async (p) => {
      const combat = cur().combat;
      if (!combat) return;
      pushLog(combat, {
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
      });
      save();
    },
    deleteLogEntry: async (id) => {
      const combat = cur().combat;
      if (!combat) return;
      if (applyLogEntryDelete(combat, id)) {
        combat.log = [...combat.log];
        save();
      }
    },
    addMonsterToCombat: async (monsterTemplateId, quantity) => {
      const combat = cur().combat;
      const monster = data.monsters.find((m) => m.id === monsterTemplateId);
      if (!combat || !monster || quantity < 1) return;
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
        const combatant = combatantFrom(
          monster,
          needsNumbers ? `${baseName} ${nextIndex++}` : baseName,
        );
        if (combat.phase === 'setup') {
          combat.combatants.push(combatant);
        } else {
          let idx = combat.combatants.findIndex(
            (c) => c.initiative !== null && c.initiative < combatant.initiative!,
          );
          if (idx === -1) idx = combat.combatants.length;
          combat.combatants.splice(idx, 0, combatant);
          if (idx <= combat.currentIndex) combat.currentIndex += 1;
        }
      }
      if (combat.phase === 'setup') sortCombatants(combat);
      save();
    },

    // Kenku in the demo: real Kenku Remote when reachable (its remote has no
    // CORS today, so usually not), otherwise the built-in synthesized board.
    kenkuGetLibrary: async () => demoKenkuLibrary(),
    kenkuPlaySound: async (id) => demoKenkuPlaySound(id),
    kenkuStopSound: async (id) => demoKenkuStopSound(id),
    kenkuStopAll: async () => demoKenkuStopAll(),
    kenkuSoundPlayback: async () => demoKenkuPlayback(),
    kenkuCheckConnection: async () => true,
    // ---- saving throws owed (mirror of the preload's saveRequest block) ----
    openSaveRequest: async (input) => openSaveRequest(input as DemoSaveRequestInput) as never,
    getSaveRequest: async (id) => (saveRequests.get(id) ?? null) as never,
    resolveSaveThrow: async (id, combatantId, result) =>
      resolveThrow(id, combatantId, result as DemoThrowResult),
    closeSaveRequest: async (id) => closeSaveRequest(id),
    deferSaveRequest: async (id) => deferSaveRequest(id),
    reopenDeferredThrow: async (entry) => reopenDeferredThrow(entry, { surface: 'dm' }),
    onSaveRequest: (cb) => {
      const wrapped = (req: DemoSaveRequest) => cb(req as never);
      saveReqListeners.add(wrapped);
      return () => saveReqListeners.delete(wrapped);
    },
    onSaveRequestClosed: (cb) => {
      saveReqClosedListeners.add(cb);
      return () => saveReqClosedListeners.delete(cb);
    },

    kenkuAttackEvent: async (payload) => {
      kenkuAttackEvent(payload);
      logAttackRoll(payload, 'dm');
    },

    updateSettings: async (patch) => {
      data.settings = { ...data.settings, ...patch };
      save();
    },
    togglePlayerView: async () => {
      if (pvOpen()) {
        pvWindow?.close();
        pvWindow = null;
        for (const cb of pvListeners) cb(false);
      } else {
        pvWindow = window.open('#player', 'dnd-demo-player', 'width=1000,height=650');
        if (pvWindow) for (const cb of pvListeners) cb(true);
      }
    },
    togglePlayerFullscreen: async () => {
      channel.postMessage('pv-fullscreen');
    },

    // Player web: backed by the in-page fake player server (phone-sim iframe).
    getPlayerWebQr: async () => ({ urls: [], port: 0, error: null, dataUrls: [] }),
    kickPlayer: async (pcId) => {
      playerClaims().delete(pcId);
      for (const s of playerSessions) {
        if (s.pcId === pcId) {
          s.pcId = null;
          s.token = null;
          s.onMessage(JSON.stringify({ type: 'kicked' }));
        }
      }
      publishPlayerClients();
    },
    resolvePlayerSave: async (id, results) => resolvePlayerSave(id, results),
    dismissPlayerSave: async (id) => dismissPlayerSave(id),
    setConcentration: async (combatantId, value) => {
      const combat = cur().combat;
      const c = combat?.combatants.find((x) => x.id === combatantId);
      if (!combat || !c) return;
      c.concentration = value ?? null;
      save();
    },
    onPlayerSavePending: (cb) => {
      const wrapped = (pending: object) => cb(pending as Parameters<typeof cb>[0]);
      savePendingListeners.add(wrapped);
      return () => savePendingListeners.delete(wrapped);
    },
    listArchive: async () => cur().archive,
    deleteArchivedCombat: async (id) => {
      cur().archive = cur().archive.filter((a) => a.id !== id);
      save();
    },

    // ---- Campaigns (mirror of main's hot-swap ordering) ----
    createCampaign: async (name) => {
      const info: CampaignInfo = {
        id: uuid(),
        name: name.trim().slice(0, 60) || 'New Campaign',
        createdAt: Date.now(),
      };
      data.campaigns.push(info);
      data.byCampaign[info.id] = emptyCampaignData();
      save();
      return info.id;
    },
    switchCampaign: async (id) => {
      if (id === data.activeId || !data.campaigns.some((c) => c.id === id)) return;
      // Same order as the real server: dismiss stale saves, swap, then
      // re-identify the phone session against the new campaign's claims.
      for (const pid of [...pendingSaves.keys()]) dismissPlayerSave(pid);
      data.activeId = id;
      for (const session of playerSessions) {
        session.pcId = tokenPcId(session.token);
      }
      save();
    },
    renameCampaign: async (id, name) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      data.campaigns = data.campaigns.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
      save();
    },
    deleteCampaign: async (id) => {
      if (id === data.activeId || data.campaigns.length <= 1) return false;
      if (!data.campaigns.some((c) => c.id === id)) return false;
      data.campaigns = data.campaigns.filter((c) => c.id !== id);
      delete data.byCampaign[id];
      claimsByCampaign.delete(id);
      save();
      return true;
    },
  } as Api;
}
