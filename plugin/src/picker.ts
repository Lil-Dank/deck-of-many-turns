import streamDeck, { type KeyAction, type Device } from '@elgato/streamdeck';
import {
  bridge,
  type BridgeAttack,
  type BridgeCombatant,
  type BridgeCommand,
  type BridgeSavePrompt,
} from './bridge';
import { rollD20, rollDice, rollPool } from './dice';
import { pickerKeyImage, type KeyRole } from './key-image';
import { L, conditionLabel, setPluginLang } from './i18n';

/** A rendered key: what it says and what kind of key it is. */
interface KeySpec {
  text: string;
  role: KeyRole;
}

const K = (text: string, role: KeyRole = 'item'): KeySpec => ({ text, role });
const BLANK: KeySpec = { text: '', role: 'empty' };

export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
  'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone',
  'Restrained', 'Stunned', 'Unconscious',
] as const;

/** Sentinel item on the conditions grid: end the actor's Concentration. */
const CONC_ITEM = '__concentration__';

export type PickerOp = 'damage' | 'heal' | 'condition';
type Mode =
  | 'actorSelect'
  | 'numpad'
  | 'conditions'
  | 'confirmEnd'
  | 'attackSelect'
  | 'targetSelect'
  | 'attackRoll'
  | 'saveMode'
  | 'saveResult'
  | 'saveEntry'
  | 'diceAmount'
  | 'diceType'
  | 'diceMod'
  | 'diceMore'
  | 'diceRoll'
  | 'diceTargets';

const DICE_TYPES = [4, 6, 8, 10, 12, 20, 100] as const;

interface ProfileGrid {
  name: string;
  cols: number;
  rows: number;
}

/**
 * Bundled picker profiles by grid size. The runtime layout is grid-agnostic
 * (slots derive from key coordinates against the PROFILE's grid), so adding
 * support for a new deck size — e.g. a 9×4 model — only needs a matching
 * entry here plus one profile in scripts/build-profiles.mjs and the manifest.
 */
const PROFILES: ProfileGrid[] = [
  { name: 'profiles/DnD Combat Picker XL', cols: 8, rows: 4 },
  { name: 'profiles/DnD Combat Picker', cols: 5, rows: 3 },
];

interface NumKey {
  kind: 'digit' | 'enter' | 'clear' | 'back' | 'display' | 'cancel';
  label: string;
  value?: string;
}

/**
 * Break a name over key-sized lines. The key font isn't monospaced; ~7 chars
 * per line is what reliably fits, so long single words get hard-split with a
 * hyphen ("Incapa-\ncitated") rather than overflowing the key.
 */
export function wrapTitle(text: string, maxLine = 7, maxLines = 3): string {
  const words: string[] = [];
  for (const raw of text.split(/\s+/)) {
    let w = raw;
    while (w.length > maxLine) {
      words.push(w.slice(0, maxLine - 1) + '-');
      w = w.slice(maxLine - 1);
    }
    if (w) words.push(w);
  }
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if ((line + ' ' + word).length <= maxLine) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
}

/** "Goblin Warrior 3" → base "Goblin Warrior", num "3" (matches DM-screen numbering). */
export function splitNumber(name: string): { base: string; num: string | null } {
  const m = name.match(/^(.*?)\s+(\d+)$/);
  return m ? { base: m[1], num: m[2] } : { base: name, num: null };
}

/** Background colour class for the fixed numpad keys. */
function numpadRole(kind: NumKey['kind']): KeyRole {
  switch (kind) {
    case 'enter':
      return 'confirm';
    case 'cancel':
      return 'cancel';
    case 'back':
    case 'clear':
      return 'back';
    case 'display':
      return 'display';
    default:
      return 'item';
  }
}

function numpadLayout(cols: number, rows: number): Map<number, NumKey> | null {
  const at = (col: number, row: number) => row * cols + col;
  const map = new Map<number, NumKey>();
  const digit = (d: string): NumKey => ({ kind: 'digit', label: d, value: d });
  if (cols >= 8 && rows >= 4) {
    map.set(at(0, 0), { kind: 'back', label: L('back') });
    map.set(at(1, 1), { kind: 'display', label: '' });
    map.set(at(0, rows - 1), { kind: 'cancel', label: L('cancel') });
    map.set(at(3, 0), digit('7')); map.set(at(4, 0), digit('8')); map.set(at(5, 0), digit('9'));
    map.set(at(3, 1), digit('4')); map.set(at(4, 1), digit('5')); map.set(at(5, 1), digit('6'));
    map.set(at(3, 2), digit('1')); map.set(at(4, 2), digit('2')); map.set(at(5, 2), digit('3'));
    map.set(at(4, 3), digit('0'));
    map.set(at(cols - 1, 0), { kind: 'clear', label: 'C' });
    map.set(at(cols - 1, rows - 1), { kind: 'enter', label: L('enter') });
    return map;
  }
  if (cols >= 5 && rows >= 3) {
    map.set(at(0, 0), { kind: 'back', label: L('back') });
    map.set(at(0, 1), { kind: 'display', label: '' });
    map.set(at(0, 2), { kind: 'cancel', label: L('cancel') });
    map.set(at(1, 0), digit('7')); map.set(at(2, 0), digit('8')); map.set(at(3, 0), digit('9'));
    map.set(at(1, 1), digit('4')); map.set(at(2, 1), digit('5')); map.set(at(3, 1), digit('6'));
    map.set(at(1, 2), digit('1')); map.set(at(2, 2), digit('2')); map.set(at(3, 2), digit('3'));
    map.set(at(4, 0), { kind: 'clear', label: 'C' });
    map.set(at(4, 1), { kind: 'enter', label: L('enter') });
    map.set(at(4, 2), digit('0'));
    return map;
  }
  return null;
}

/**
 * Drives the "DnD Picker" profile: one grid of generic slot keys whose
 * behavior/labels depend on the current mode (actor select → numpad or
 * conditions). Bundled profiles can't grow keys at runtime, so a single
 * relabeled grid stands in for the three logical profiles.
 */
class Picker {
  private mode: Mode | null = null;
  private op: PickerOp | null = null;
  private device: Device | null = null;
  /** Grid of the ACTIVE PROFILE (not the device) — all slot math uses this. */
  private grid: ProfileGrid = PROFILES[0];
  private page = 0;
  private actorId: string | null = null;
  private actorName = '';
  private digits = '';
  private attackList: BridgeAttack[] = [];
  /** Template id of the attacking monster, for per-attack Kenku sounds. */
  private attackerSourceId = '';
  /** 'pc' | 'monster' when the app sends it; drives combat-log attribution. */
  private attackerType: string | undefined;
  /** Composition of the last damage roll, sent with the apply for the log. */
  private lastDamageMath = '';
  /** Damage type per bracket group of lastDamageMath (log tinting). */
  private lastDamageMathTypes: (string | null)[] = [];
  /** Attack-roll advantage state, toggled on the attack screen. */
  private advMode: 'normal' | 'adv' | 'dis' = 'normal';
  private selectedAttack: BridgeAttack | null = null;
  private lastRoll = '';
  /** Selected target ids (one for attack rolls, several for AoE saves). */
  private targets: string[] = [];
  /**
   * Concentration entry on the conditions screen: snapshotted once when the
   * screen opens, only when exactly one actor is selected and it is
   * concentrating. Pressing the key clears the spell and the key with it.
   */
  private concEntry: { actorId: string; label: string } | null = null;
  // Custom dice roller state
  private diceCount = 1;
  private dieFaces = 20;
  private diceModValue = 0;
  private diceSign: 1 | -1 = 1;
  /** The full roll: first part + any extra dice of different kinds. */
  private dicePool: { count: number; die: number }[] = [];
  /** Whether the amount/type screens are entering the first or an extra part. */
  private diceStage: 'first' | 'extra' = 'first';
  private rolledTotal: number | null = null;
  private applyOp: 'damage' | 'heal' | null = null;
  private applyTimer: NodeJS.Timeout | null = null;
  private applyCountdown: NodeJS.Timeout | null = null;
  /** Injectable for tests; production keeps the 5 s apply delay. */
  applyDelayMs = 5000;
  /** Rolled save-action damage awaiting the "who saved?" answer. */
  private pendingDamage = 0;
  /**
   * Saving throws for the pending save action, by target id — rolled on the
   * deck (die + the target's modifier) or typed on the numpad (die null).
   */
  private saveRolls = new Map<string, { die: number | null; total: number }>();
  /** Target whose total the saveEntry numpad is filling in. */
  private saveEntryId: string | null = null;
  /**
   * A throw the APP asked for, rather than one this deck started. The screens
   * are the same; what differs is the ending — there is no damage to apply
   * here, the deck just reports each throw and the app owns the consequences.
   */
  private savePrompt: BridgeSavePrompt | null = null;
  /** Idle timeout: exit when a picker screen gets no input. */
  private idleTimer: NodeJS.Timeout | null = null;
  idleTimeoutMs = 90_000;
  idleTimeoutLongMs = 150_000;
  /** Visible slot key actions in the picker profile, by slot index. */
  private slots = new Map<number, KeyAction>();
  /** Last image pushed per slot, so unchanged keys aren't redrawn. */
  private lastImage = new Map<number, string>();

  constructor() {
    bridge.onState(() => {
      setPluginLang(bridge.state.language);
      this.onBridgeState();
    });
  }

  private get cols(): number {
    return this.grid.cols;
  }
  private get rows(): number {
    return this.grid.rows;
  }
  private get slotCount(): number {
    return this.cols * this.rows;
  }

  /**
   * Best-fitting bundled profile for a device grid: exact match first, then
   * the largest profile that fits inside the device (covers future larger
   * decks); devices smaller than every profile are unsupported.
   */
  private profileForDevice(device: Device): ProfileGrid | null {
    const { columns, rows } = device.size ?? { columns: 0, rows: 0 };
    const exact = PROFILES.find((p) => p.cols === columns && p.rows === rows);
    if (exact) return exact;
    const fitting = PROFILES.filter((p) => p.cols <= columns && p.rows <= rows);
    return fitting.length > 0 ? fitting[0] : null;
  }

  /** Slot index from key coordinates, based on the active profile's grid. */
  slotFromCoordinates(coords: { column: number; row: number } | undefined): number | null {
    if (!coords) return null;
    return coords.row * this.cols + coords.column;
  }

  /** Entry point from the Damage / Heal / Condition actions. */
  async begin(op: PickerOp, device: Device): Promise<boolean> {
    return this.enter(device, 'actorSelect', op);
  }

  /** Entry point from the End Combat action: the picker acts as a confirm screen. */
  async beginEndConfirm(device: Device): Promise<boolean> {
    return this.enter(device, 'confirmEnd', null);
  }

  /** Entry point from the Dice Roller action: NdX+M → roll → optionally apply. */
  async beginDice(device: Device): Promise<boolean> {
    return this.enter(device, 'diceAmount', null);
  }

  /**
   * Entry point from the Attack action: pick one of the current-turn
   * monster's attacks, then roll attack/damage from the deck.
   */
  /**
   * Reports attack-flow progress; the app triggers Kenku sounds on every
   * phase and logs a combat-log line on verdict phases carrying roll details.
   */
  private sendAttackEvent(
    phase: 'attackRoll' | 'attackHit' | 'attackCrit' | 'attackMiss' | 'damageRoll' | 'damageApplied',
    roll?: { die: number; dice?: number[]; total: number },
  ): void {
    if (!this.selectedAttack) return;
    const target = roll ? this.alive().find((c) => c.id === this.targets[0]) : undefined;
    bridge.send({
      type: 'attackEvent',
      sourceId: this.attackerSourceId,
      attackId: this.selectedAttack.id,
      phase,
      ...(roll
        ? {
            roll: {
              actorName: this.actorName,
              actorType: this.attackerType,
              targetName: target?.displayName,
              targetType: target?.type,
              attackName: this.selectedAttack.name,
              die: roll.die,
              dice: roll.dice,
              total: roll.total,
            },
          }
        : {}),
    });
  }

  /**
   * The app is asking for a saving throw. Only taken when the deck is idle:
   * jumping out of a flow the DM has their hands in — mid target-pick, mid
   * numpad, mid apply countdown — loses their work, and the same throw is on
   * the DM's screen and the players' phones anyway.
   */
  async beginSavePrompt(device: Device | null, prompt: BridgeSavePrompt): Promise<void> {
    if (this.mode !== null) return;
    const dev = device ?? this.device;
    if (!dev) return;
    const targets = prompt.targetIds.filter((id) => this.alive().some((c) => c.id === id));
    if (targets.length === 0) return;
    await this.enter(dev, 'saveMode', null, () => {
      this.savePrompt = prompt;
      this.targets = targets;
      // saveInfo and isAoe both read selectedAttack, so stand one in: it
      // carries the ability and DC in the shape the save screens already parse.
      this.selectedAttack = {
        id: `prompt:${prompt.id}`,
        name: prompt.attackName,
        toHit: null,
        save: `${prompt.ability} ${prompt.dc}`,
        damage: [],
      };
      this.actorName = prompt.attackName;
    });
  }

  /** Someone else answered it, or the fight moved on. */
  async closeSavePrompt(id: string): Promise<void> {
    if (this.savePrompt?.id !== id) return;
    this.savePrompt = null;
    await this.exit();
  }

  async beginAttack(device: Device): Promise<boolean> {
    const current = bridge.state.combatants.find((c) => c.isCurrentTurn);
    const attacks = current?.attacks ?? [];
    if (!current || attacks.length === 0) return false;
    const ok = await this.enter(device, 'attackSelect', null);
    if (ok) {
      this.actorId = current.id;
      this.actorName = current.displayName;
      this.attackerSourceId = current.sourceId;
      this.attackerType = current.type;
      this.attackList = attacks;
      await this.render();
    }
    return ok;
  }

  /**
   * `seed` runs after the reset but before the first await. A flow that needs
   * state on entry must set it there: this method yields twice (profile switch,
   * render), and a bridge state push landing in that window sees a half-built
   * screen — an empty target list is enough to bounce the mode back to
   * targetSelect under the DM's fingers.
   */
  private async enter(
    device: Device,
    mode: Mode,
    op: PickerOp | null,
    seed?: () => void,
  ): Promise<boolean> {
    const profile = this.profileForDevice(device);
    if (!profile) {
      streamDeck.logger.warn(`No picker profile for device grid ${device.size?.columns}x${device.size?.rows}`);
      return false;
    }
    this.clearPendingApply();
    // The profile we're switching to still shows its static key images.
    this.lastImage.clear();
    this.op = op;
    this.device = device;
    this.grid = profile;
    this.mode = mode;
    this.page = 0;
    this.actorId = null;
    this.digits = '';
    this.attackList = [];
    this.selectedAttack = null;
    this.targets = [];
    this.lastRoll = '';
    this.diceCount = 1;
    this.dieFaces = 20;
    this.diceModValue = 0;
    this.diceSign = 1;
    this.dicePool = [];
    this.diceStage = 'first';
    this.rolledTotal = null;
    this.applyOp = null;
    this.pendingDamage = 0;
    this.saveRolls.clear();
    this.saveEntryId = null;
    this.savePrompt = null;
    seed?.();
    this.touchIdle();
    await streamDeck.profiles.switchToProfile(device.id, profile.name);
    await this.render();
    return true;
  }

  private clearPendingApply(): void {
    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }
    if (this.applyCountdown) {
      clearInterval(this.applyCountdown);
      this.applyCountdown = null;
    }
  }

  /**
   * (Re)arm the idle timeout for the current screen: dice-roller and
   * monster-attack screens get the long window, everything else the default.
   * Fires → leave the picker as if cancelled.
   */
  private touchIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.mode) return;
    const long =
      this.mode.startsWith('dice') ||
      this.mode === 'attackSelect' ||
      this.mode === 'targetSelect' ||
      this.mode === 'attackRoll' ||
      this.mode === 'saveMode' ||
      this.mode === 'saveResult' ||
      this.mode === 'saveEntry';
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.exit();
    }, long ? this.idleTimeoutLongMs : this.idleTimeoutMs);
  }

  /** Targets whose entered total met the DC — they take half damage. */
  private get savedTargets(): string[] {
    const info = this.saveInfo;
    if (!info) return [];
    return this.selectedTargetCombatants()
      .filter((c) => (this.saveRolls.get(c.id)?.total ?? -Infinity) >= info.dc)
      .map((c) => c.id);
  }

  /** This action's save ability and DC, parsed from the bridge's "DEX 18". */
  private get saveInfo(): { ability: string; dc: number } | null {
    const raw = this.selectedAttack?.save;
    if (!raw) return null;
    const [ability, dc] = raw.split(' ');
    const n = parseInt(dc ?? '', 10);
    return ability && Number.isFinite(n) ? { ability, dc: n } : null;
  }

  /** The target's modifier for this save, when the app sent ability scores. */
  private saveModFor(c: BridgeCombatant): number | null {
    const info = this.saveInfo;
    const mod = info ? c.saveMods?.[info.ability.toLowerCase()] : undefined;
    return typeof mod === 'number' ? mod : null;
  }

  private rollSaveFor(c: BridgeCombatant): void {
    const die = 1 + Math.floor(Math.random() * 20);
    this.saveRolls.set(c.id, { die, total: die + (this.saveModFor(c) ?? 0) });
  }

  private get allSavesEntered(): boolean {
    const targets = this.selectedTargetCombatants();
    return targets.length > 0 && targets.every((c) => this.saveRolls.has(c.id));
  }

  /** Auto/Manual keys on the save-mode screen (same corners as more-dice). */
  private get saveAutoSlot(): number {
    return this.slotCount - 1 - this.cols;
  }
  private get saveManualSlot(): number {
    return this.slotCount - 1;
  }

  /** Center-ish slot used as the confirm/roll screens' message display. */
  private get confirmDisplaySlot(): number {
    return this.cols + 1; // (1,1)
  }

  private get confirmYesSlot(): number {
    return this.slotCount - 1; // bottom-right
  }

  /** Roll keys on the attack screen: right edge, bottom two rows. */
  private get rollDamageSlot(): number {
    return this.slotCount - 1; // bottom-right
  }

  private get rollAttackSlot(): number {
    return this.slotCount - 1 - this.cols; // directly above Roll Damage
  }

  /** Advantage / disadvantage toggles, left of the two roll keys. */
  private get advSlot(): number {
    return this.rollAttackSlot - 1;
  }

  private get disSlot(): number {
    return this.rollDamageSlot - 1;
  }

  private async exit(): Promise<void> {
    this.clearPendingApply();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const deviceId = this.device?.id;
    this.mode = null;
    this.op = null;
    this.actorId = null;
    this.advMode = 'normal';
    this.savePrompt = null;
    if (deviceId) {
      // Switching without a profile returns to the previously active profile.
      await streamDeck.profiles.switchToProfile(deviceId);
    }
  }

  /** AoE = save-based action (breath weapon etc.): several targets allowed. */
  private get isAoe(): boolean {
    return this.selectedAttack !== null && this.selectedAttack.toHit === null;
  }

  /** Multi-target selection screens (AoE saves + dice-roller apply). */
  private get isMultiTarget(): boolean {
    return this.mode === 'diceTargets' ? true : this.isAoe;
  }

  /** Attack flow excludes the attacker; the dice roller can hit anyone. */
  private targetCandidates(): BridgeCombatant[] {
    if (this.mode === 'diceTargets') return this.alive();
    return this.alive().filter((c) => c.id !== this.actorId);
  }

  /** "3d8+2" then extra parts ("+1d4") on their own lines; key-width friendly. */
  private diceExprLines(maxLines: number): string[] {
    const mod = this.diceSign * this.diceModValue;
    const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '';
    const first = this.dicePool[0] ?? { count: this.diceCount, die: this.dieFaces };
    const lines = [`${first.count}d${first.die}${modStr}`];
    const extras = this.dicePool.slice(1);
    if (extras.length > maxLines - 1) {
      lines.push(`+${extras.length} dice`);
    } else {
      for (const p of extras) lines.push(`+${p.count}d${p.die}`);
    }
    return lines;
  }

  /** Bottom-left key: ✕ Cancel on every non-numpad picker screen. */
  private get cancelSlot(): number {
    return (this.rows - 1) * this.cols;
  }

  /** Dice-roll screen keys: right edge, bottom three rows. */
  private get diceRollSlot(): number {
    return this.slotCount - 1; // bottom-right
  }
  private get diceDamageSlot(): number {
    return this.slotCount - 1 - this.cols;
  }
  private get diceHealSlot(): number {
    return this.slotCount - 1 - 2 * this.cols;
  }
  /** "+ Dice" on the roll screen (top row, clear of the right-edge keys). */
  private get diceAddSlot(): number {
    return 2;
  }
  /** Yes/No keys on the "more dice?" screen. */
  private get moreYesSlot(): number {
    return this.slotCount - 1 - this.cols;
  }
  private get moreNoSlot(): number {
    return this.slotCount - 1;
  }

  /**
   * Next/Done/Apply key: bottom-right — the "proceed" corner on every screen
   * (matches Enter, Roll, and the End Combat confirm). Grid-derived, so it
   * lands correctly on 5×3, 8×4, and a future 9×4 profile alike.
   */
  private get doneSlot(): number {
    return this.slotCount - 1;
  }

  /** Second display key on the roll screen, right of the main one. */
  private get targetDisplaySlot(): number {
    return this.confirmDisplaySlot + 1; // (2,1)
  }

  /**
   * Slot→item layout for reserved-key screens: keeps ✕ Cancel (bottom-left),
   * the Done key when multi-select, the page key when paging, and slot 0 when
   * the screen has a Back/Done key there. Items fill every remaining slot in
   * order — first-screen flows have no Back key, so an item starts at slot 0.
   */
  private listLayout<T>(
    items: T[],
    multi: boolean,
    extraReserved: number[] = [],
    reserveSlot0 = true,
  ): {
    map: Map<number, T>;
    paged: boolean;
    pageSlot: number;
  } {
    // Paging lives top-right; the bottom-right corner belongs to Done/Next.
    const pageSlot = this.cols - 1;
    const reserved = new Set<number>([this.cancelSlot, ...extraReserved]);
    if (reserveSlot0) reserved.add(0);
    if (multi) reserved.add(this.doneSlot);
    const plainCapacity = this.slotCount - reserved.size;
    const paged = items.length > plainCapacity;
    if (paged) reserved.add(pageSlot);
    const capacity = this.slotCount - reserved.size;
    const pages = Math.max(1, Math.ceil(items.length / capacity));
    const page = this.page % pages;
    const visible = items.slice(page * capacity, (page + 1) * capacity);
    const map = new Map<number, T>();
    let slot = 0;
    for (const item of visible) {
      while (reserved.has(slot)) slot++;
      if (slot >= this.slotCount) break;
      map.set(slot, item);
      slot++;
    }
    return { map, paged, pageSlot };
  }

  private targetLayout(): {
    map: Map<number, BridgeCombatant>;
    paged: boolean;
    pageSlot: number;
  } {
    return this.listLayout(this.targetCandidates(), this.isMultiTarget);
  }

  private targetName(c: BridgeCombatant, maxLines: number): string {
    const { base, num } = splitNumber(c.displayName);
    const downed = c.isDowned ? '💀' : '';
    if (num !== null) return `${downed}#${num}\n${wrapTitle(base, 7, maxLines - 1)}`;
    return wrapTitle(`${downed}${c.displayName}`, 7, maxLines);
  }

  /** Actor-select label: current-turn marker + downed marker + numbered name. */
  private actorLabel(c: BridgeCombatant, maxLines: number): string {
    const { base, num } = splitNumber(c.displayName);
    const downed = c.isDowned ? '💀' : '';
    if (num !== null) {
      // Numbered instance: its number gets a dedicated line so it always
      // matches the DM combat screen ("Goblin Warrior 3" → "#3").
      const marker = c.isCurrentTurn ? '▶' : '';
      return `${marker}${downed}#${num}\n${wrapTitle(base, 7, maxLines - 1)}`;
    }
    const marker = c.isCurrentTurn ? '▶ ' : '';
    return wrapTitle(`${marker}${downed}${c.displayName}`, 7, maxLines);
  }

  // ---- slot registry (kept in sync via onWillAppear / onWillDisappear) ----

  async slotAppeared(slot: number, action: KeyAction): Promise<void> {
    this.slots.set(slot, action);
    // A fresh key carries the profile's static image, so force a redraw.
    this.lastImage.delete(slot);
    streamDeck.logger.info(`Picker slot ${slot} appeared (${this.slots.size} visible)`);
    await this.renderSlot(slot);
  }

  slotDisappeared(slot: number): void {
    this.slots.delete(slot);
    this.lastImage.delete(slot);
  }

  // ---- layout helpers ----

  private alive(): BridgeCombatant[] {
    return bridge.state.combatants;
  }

  // ---- rendering ----

  private async render(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((slot) => this.renderSlot(slot)));
  }

  private async renderSlot(slot: number): Promise<void> {
    const action = this.slots.get(slot);
    if (!action) return;
    const { text, role } = this.keyFor(slot);
    const image = pickerKeyImage(text === '' ? [] : text.split('\n'), role);
    // Keys are redrawn on every state push; skip the ones that didn't change.
    if (this.lastImage.get(slot) === image) return;
    this.lastImage.set(slot, image);
    await action.setImage(image);
    await action.setTitle('');
  }

  /** Text of a key — exposed for tests and diagnostics. */
  keyText(slot: number): string {
    return this.keyFor(slot).text;
  }

  /** Role of a key (drives its background colour) — exposed for tests. */
  keyRole(slot: number): KeyRole {
    return this.keyFor(slot).role;
  }

  private keyFor(slot: number): KeySpec {
    if (this.mode === 'actorSelect') {
      // Damage, Heal, and Condition all select several actors at once.
      // Cancel lives at the bottom-left on every screen; this screen has no
      // previous step, so slot 0 carries the first actor instead of a Back key.
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const { map, paged, pageSlot } = this.listLayout(this.alive(), true, [], false);
      if (slot === this.doneSlot) {
        return this.targets.length > 0
          ? K(`${L('next')}\n(${this.targets.length})`, 'confirm')
          : K(L('next'), 'confirm');
      }
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const c = map.get(slot);
      if (!c) return BLANK;
      const picked = this.targets.includes(c.id);
      return K(
        `${picked ? '✓\n' : ''}${this.actorLabel(c, picked ? 2 : 3)}`,
        picked ? 'selected' : c.type === 'pc' ? 'itemPc' : 'item',
      );
    }

    if (this.mode === 'numpad') {
      const layout = numpadLayout(this.cols, this.rows);
      const key = layout?.get(slot);
      if (!key) return BLANK;
      if (key.kind === 'display') {
        const icon = this.op === 'damage' ? '⚔' : '✚';
        const digits = this.digits === '' ? '_' : this.digits;
        if (this.targets.length === 1) {
          const target = this.alive().find((c) => c.id === this.targets[0]);
          const { base, num } = splitNumber(target?.displayName ?? '');
          if (num !== null) {
            return K(`${icon} ${digits}\n#${num}\n${wrapTitle(base, 7, 1)}`, 'display');
          }
          return K(`${icon} ${digits}\n${wrapTitle(base, 7, 2)}`, 'display');
        }
        return K(`${icon} ${digits}\n${this.targets.length}\n${L('targets')}`, 'display');
      }
      return K(key.label, numpadRole(key.kind));
    }

    if (this.mode === 'confirmEnd') {
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.confirmYesSlot) return K(L('endCombat'), 'confirm');
      if (slot === this.confirmDisplaySlot) {
        return K(L('endPrompt', { round: bridge.state.round }), 'display');
      }
      return BLANK;
    }

    if (this.mode === 'attackSelect') {
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const { map, paged, pageSlot } = this.listLayout(this.attackList, false, [], false);
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const atk = map.get(slot);
      if (!atk) return BLANK;
      // Name only — to-hit/DC detail lives on the roll screen and DM view.
      return K(wrapTitle(atk.name, 7, 3));
    }

    if (this.mode === 'targetSelect') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const { map, paged, pageSlot } = this.targetLayout();
      if (this.isAoe && slot === this.doneSlot) {
        return this.targets.length > 0
          ? K(`${L('done')}\n(${this.targets.length})`, 'confirm')
          : K(L('done'), 'confirm');
      }
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const c = map.get(slot);
      if (!c) return BLANK;
      const picked = this.targets.includes(c.id);
      return K(
        `${picked ? '✓\n' : ''}${this.targetName(c, picked ? 2 : 3)}`,
        picked ? 'selected' : c.type === 'pc' ? 'itemPc' : 'item',
      );
    }

    if (this.mode === 'attackRoll') {
      const atk = this.selectedAttack;
      if (!atk) return BLANK;
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.confirmDisplaySlot) {
        return K(`${wrapTitle(atk.name, 7, 1)}\n${this.lastRoll || '—'}`, 'display');
      }
      if (slot === this.targetDisplaySlot) {
        // Save actions show the required save + DC instead of a target's AC.
        if (atk.save) {
          const [ability, dc] = atk.save.split(' ');
          const n = this.targets.length;
          return K(`${ability} save\nDC ${dc}\n${n} tgt${n === 1 ? '' : 's'}`, 'display');
        }
        if (this.targets.length === 1) {
          const target = this.alive().find((c) => c.id === this.targets[0]);
          if (!target) return BLANK;
          return K(`${this.targetName(target, 2)}\n${L('ac')} ${target.ac ?? '?'}`, 'display');
        }
        return K(`${this.targets.length}\n${L('targets')}`, 'display');
      }
      if (slot === this.rollAttackSlot && atk.toHit !== null) return K(L('rollAttack'), 'confirm');
      if (slot === this.rollDamageSlot && atk.damage.length > 0) return K(L('rollDamage'), 'confirm');
      if (slot === this.advSlot && atk.toHit !== null) {
        return K(L('adv'), this.advMode === 'adv' ? 'selected' : 'item');
      }
      if (slot === this.disSlot && atk.toHit !== null) {
        return K(L('dis'), this.advMode === 'dis' ? 'selected' : 'item');
      }
      return BLANK;
    }

    if (this.mode === 'saveMode') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.confirmDisplaySlot) {
        const info = this.saveInfo;
        const head = this.savePrompt
          ? wrapTitle(this.savePrompt.attackName, 8, 1)
          : L('saveDmg', { amount: this.pendingDamage });
        return K(
          [head, info ? `${info.ability} ${info.dc}` : '', L('saveHow')]
            .filter(Boolean)
            .join('\n'),
          'display',
        );
      }
      if (slot === this.saveAutoSlot) return K(L('saveAuto'), 'confirm');
      if (slot === this.saveManualSlot) return K(L('saveManual'), 'item');
      return BLANK;
    }

    // One target's total on the numpad. The modifier rides along as a hint so
    // the DM can add it to a physically rolled d20 without leaving the screen.
    if (this.mode === 'saveEntry') {
      const key = numpadLayout(this.cols, this.rows)?.get(slot);
      if (!key) return BLANK;
      if (key.kind === 'display') {
        const c = this.alive().find((x) => x.id === this.saveEntryId);
        const mod = c ? this.saveModFor(c) : null;
        const hint = mod === null ? '' : ` (${mod >= 0 ? '+' : ''}${mod})`;
        const digits = this.digits === '' ? '_' : this.digits;
        const name = wrapTitle(splitNumber(c?.displayName ?? '').base, 7, 1);
        return K(`${digits}${hint}\n${name}`, 'display');
      }
      return K(key.label, numpadRole(key.kind));
    }

    if (this.mode === 'saveResult') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const { map, paged, pageSlot } = this.listLayout(
        this.selectedTargetCombatants(),
        true,
        [this.confirmDisplaySlot],
      );
      if (slot === this.confirmDisplaySlot) {
        if (this.applyTimer) return K(this.lastRoll, 'display');
        // Doubles as the re-roll key for the whole area.
        if (this.savePrompt) {
          const info = this.saveInfo;
          return K(
            [wrapTitle(this.savePrompt.attackName, 8, 1), info ? `${info.ability} ${info.dc}` : '',
              L('rollAgain')].filter(Boolean).join('\n'),
            'item',
          );
        }
        return K(L('rollSaves', { amount: this.pendingDamage }), 'item');
      }
      if (slot === this.doneSlot) {
        if (!this.allSavesEntered) return K(L('savesPending'), 'display');
        // A prompt has nothing to apply: the app owns what the throw decides.
        if (this.savePrompt) return K(L('saveSend'), 'confirm');
        const half = Math.floor(this.pendingDamage / 2);
        return K(`⚔ Apply\n${this.savedTargets.length}×½(${half})`, 'confirm');
      }
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const c = map.get(slot);
      if (!c) return BLANK;
      const roll = this.saveRolls.get(c.id);
      const saved = this.savedTargets.includes(c.id);
      if (!roll) {
        return K(`—\n${this.targetName(c, 2)}`, c.type === 'pc' ? 'itemPc' : 'item');
      }
      return K(
        `${roll.total} ${saved ? (this.savePrompt ? '✓' : '✓½') : '✗'}\n${this.targetName(c, 2)}`,
        saved ? 'selected' : c.type === 'pc' ? 'itemPc' : 'item',
      );
    }

    if (this.mode === 'diceAmount' || this.mode === 'diceMod') {
      const layout = numpadLayout(this.cols, this.rows);
      const key = layout?.get(slot);
      if (!key) return BLANK;
      if (key.kind === 'back') {
        // The very first dice screen has nowhere to go back to; Cancel is the
        // dedicated key at the bottom-left, so leave this one blank.
        return this.mode === 'diceAmount' && this.diceStage === 'first'
          ? BLANK
          : K(L('back'), 'back');
      }
      if (key.kind === 'display') {
        if (this.mode === 'diceAmount') {
          // Kept to three lines so the value stays large on a 72px key.
          const header = this.diceStage === 'extra' ? L('extraDice') : L('howMany');
          return K(`${header}\n${this.digits === '' ? '_' : this.digits}`, 'display');
        }
        // Pressing this key flips the modifier's sign, so it's a real button.
        return K(
          `${this.diceCount}d${this.dieFaces}\n± mod:\n${this.diceSign < 0 ? '-' : '+'}${this.digits === '' ? '0' : this.digits}`,
          'item',
        );
      }
      return K(key.label, numpadRole(key.kind));
    }

    if (this.mode === 'diceType') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const die = DICE_TYPES[slot - 1];
      return die !== undefined ? K(`${this.diceCount}\nd${die}`) : BLANK;
    }

    if (this.mode === 'diceMore') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.confirmDisplaySlot) {
        return K([...this.diceExprLines(2), 'more', 'dice?'].join('\n'), 'display');
      }
      if (slot === this.moreYesSlot) return K('✓ Yes\n+ dice', 'confirm');
      if (slot === this.moreNoSlot) return K('✕ No\n🎲', 'item');
      return BLANK;
    }

    if (this.mode === 'diceRoll') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.confirmDisplaySlot) {
        return K(
          [
            ...this.diceExprLines(3),
            this.rolledTotal === null ? '—' : `= ${this.rolledTotal}`,
          ].join('\n'),
          'display',
        );
      }
      if (slot === this.diceAddSlot) return K(L('addDice'), 'item');
      if (slot === this.diceRollSlot) return K(L('roll'), 'confirm');
      if (slot === this.diceDamageSlot) return K(L('applyDamage'), 'item');
      if (slot === this.diceHealSlot) return K(L('applyHeal'), 'item');
      return BLANK;
    }

    if (this.mode === 'diceTargets') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      const { map, paged, pageSlot } = this.targetLayout();
      if (slot === this.doneSlot) {
        const op = this.applyOp === 'damage' ? '⚔' : '✚';
        return K(
          this.targets.length > 0
            ? `${op} Apply\n${this.rolledTotal}\n(${this.targets.length})`
            : `${op} Apply\n${this.rolledTotal}`,
          'confirm',
        );
      }
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const c = map.get(slot);
      if (!c) return BLANK;
      const picked = this.targets.includes(c.id);
      return K(
        `${picked ? '✓\n' : ''}${this.targetName(c, picked ? 2 : 3)}`,
        picked ? 'selected' : c.type === 'pc' ? 'itemPc' : 'item',
      );
    }

    if (this.mode === 'conditions') {
      if (slot === 0) return K(L('back'), 'back');
      if (slot === this.cancelSlot) return K(L('cancel'), 'cancel');
      if (slot === this.doneSlot) return K(L('doneKey'), 'confirm');
      // multi=true only reserves the Done key's slot for the layout.
      const { map, paged, pageSlot } = this.listLayout(this.conditionItems(), true);
      if (paged && slot === pageSlot) return K(L('more'), 'page');
      const cond = map.get(slot);
      if (!cond) return BLANK;
      if (cond === CONC_ITEM) {
        // Active concentration: pressing it ends the spell.
        return K(`Ⓒ\n${wrapTitle(this.concEntry?.label ?? '', 7, 2)}`, 'selected');
      }
      const selected = this.selectedTargetCombatants();
      const haveCount = selected.filter((c) => c.conditions.includes(cond)).length;
      // ✓ = all selected actors have it; ~ = only some (mixed).
      const marker = haveCount === 0 ? '' : haveCount === selected.length ? '✓\n' : '~\n';
      return K(
        `${marker}${wrapTitle(conditionLabel(cond), 7, marker ? 2 : 3)}`,
        haveCount === 0 ? 'item' : 'selected',
      );
    }

    return BLANK;
  }

  // ---- input ----

  async slotPressed(slot: number, action: KeyAction): Promise<void> {
    const dispatch = async (): Promise<void> => {
      if (this.mode === 'actorSelect') return this.pressActorSelect(slot, action);
      if (this.mode === 'numpad') return this.pressNumpad(slot, action);
      if (this.mode === 'conditions') return this.pressConditions(slot, action);
      if (this.mode === 'confirmEnd') return this.pressConfirmEnd(slot, action);
      if (this.mode === 'attackSelect') return this.pressAttackSelect(slot, action);
      if (this.mode === 'targetSelect') return this.pressTargetSelect(slot, action);
      if (this.mode === 'attackRoll') return this.pressAttackRoll(slot, action);
      if (this.mode === 'saveMode') return this.pressSaveMode(slot, action);
      if (this.mode === 'saveResult') return this.pressSaveResult(slot, action);
      if (this.mode === 'saveEntry') return this.pressSaveEntry(slot, action);
      if (this.mode === 'diceAmount' || this.mode === 'diceMod') return this.pressDiceNumpad(slot, action);
      if (this.mode === 'diceType') return this.pressDiceType(slot, action);
      if (this.mode === 'diceMore') return this.pressDiceMore(slot, action);
      if (this.mode === 'diceRoll') return this.pressDiceRoll(slot, action);
      if (this.mode === 'diceTargets') return this.pressDiceTargets(slot, action);
      return undefined;
    };
    if (this.mode !== null) {
      await dispatch();
      // Every key press restarts the silence window for the (new) screen.
      this.touchIdle();
      return;
    }
    // Stale profile without an active flow (e.g. plugin restarted): leave.
    if (this.device) await streamDeck.profiles.switchToProfile(this.device.id);
  }

  private async pressActorSelect(slot: number, action: KeyAction): Promise<void> {
    if (slot === this.cancelSlot) return this.exit();
    const { map, paged, pageSlot } = this.listLayout(this.alive(), true, [], false);
    if (slot === this.doneSlot) {
      if (this.targets.length === 0) return;
      if (this.op === 'condition') {
        this.mode = 'conditions';
        this.page = 0;
        // Checked once, on open: a single selected actor that is
        // concentrating gets an extra key to drop the spell. Groups never do.
        const sel = this.selectedTargetCombatants();
        this.concEntry =
          sel.length === 1 && sel[0].concentration
            ? { actorId: sel[0].id, label: sel[0].concentration }
            : null;
        return this.render();
      }
      if (!numpadLayout(this.cols, this.rows)) {
        await action.showAlert();
        return;
      }
      this.mode = 'numpad';
      this.digits = '';
      return this.render();
    }
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const c = map.get(slot);
    if (!c) return;
    this.targets = this.targets.includes(c.id)
      ? this.targets.filter((id) => id !== c.id)
      : [...this.targets, c.id];
    return this.render();
  }

  private async pressNumpad(slot: number, action: KeyAction): Promise<void> {
    const key = numpadLayout(this.cols, this.rows)?.get(slot);
    if (!key) return;
    switch (key.kind) {
      case 'cancel':
        return this.exit();
      case 'digit':
        if (this.digits.length < 3) this.digits += key.value!;
        return this.render();
      case 'clear':
        this.digits = '';
        return this.render();
      case 'back':
        this.mode = 'actorSelect';
        this.digits = '';
        return this.render();
      case 'enter': {
        const amount = parseInt(this.digits || '0', 10);
        if (amount <= 0) return; // nothing entered yet
        if (this.targets.length > 0 && this.op && this.op !== 'condition') {
          let ok = true;
          for (const id of this.targets) {
            ok =
              bridge.send({
                type: this.op === 'damage' ? 'applyDamage' : 'applyHeal',
                actorId: id,
                amount,
              }) && ok;
          }
          if (!ok) {
            await action.showAlert();
            return;
          }
        }
        // Done: return to the profile the Damage/Heal key was pressed on.
        return this.exit();
      }
      case 'display':
        return;
    }
  }

  private async pressAttackSelect(slot: number, _action: KeyAction): Promise<void> {
    if (slot === this.cancelSlot) return this.exit();
    const { map, paged, pageSlot } = this.listLayout(this.attackList, false, [], false);
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const atk = map.get(slot);
    if (!atk) return;
    this.selectedAttack = atk;
    this.mode = 'targetSelect';
    this.page = 0;
    this.targets = [];
    this.lastRoll = '';
    return this.render();
  }

  private async pressTargetSelect(slot: number, _action: KeyAction): Promise<void> {
    if (slot === 0) {
      this.mode = 'attackSelect';
      this.selectedAttack = null;
      this.targets = [];
      this.page = 0;
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    const { map, paged, pageSlot } = this.targetLayout();
    if (this.isAoe && slot === this.doneSlot) {
      if (this.targets.length === 0) return;
      this.mode = 'attackRoll';
      this.lastRoll = '';
      return this.render();
    }
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const c = map.get(slot);
    if (!c) return;
    if (this.isAoe) {
      this.targets = this.targets.includes(c.id)
        ? this.targets.filter((id) => id !== c.id)
        : [...this.targets, c.id];
      return this.render();
    }
    this.targets = [c.id];
    this.mode = 'attackRoll';
    this.lastRoll = '';
    return this.render();
  }

  /** Short damage-type tag for key-width breakdown lines ("sla", "aci"). */
  private static typeTag(type: string): string {
    return type.slice(0, 3);
  }

  private async pressAttackRoll(slot: number, action: KeyAction): Promise<void> {
    const atk = this.selectedAttack;
    if (!atk) return;
    if (slot === 0) {
      // Back cancels a pending damage apply (re-roll or retreat safely).
      this.clearPendingApply();
      this.mode = 'targetSelect';
      this.lastRoll = '';
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit(); // clears any pending apply
    if (slot === this.advSlot && atk.toHit !== null) {
      this.advMode = this.advMode === 'adv' ? 'normal' : 'adv';
      return this.render();
    }
    if (slot === this.disSlot && atk.toHit !== null) {
      this.advMode = this.advMode === 'dis' ? 'normal' : 'dis';
      return this.render();
    }
    if (slot === this.rollAttackSlot && atk.toHit !== null) {
      const { die, dice, total } = rollD20(atk.toHit, this.advMode);
      const target = this.alive().find((c) => c.id === this.targets[0]);
      const ac = target?.ac ?? null;
      // Nat 20 always hits, nat 1 always misses; otherwise meet-or-beat AC.
      const hit = die === 20 ? true : die === 1 ? false : ac !== null ? total >= ac : null;
      const pair = dice.length > 1 ? `${dice[0]}|${dice[1]}` : `${die}`;
      const note = die === 20 ? L('crit') : die === 1 ? L('nat1') : `d20: ${pair}`;
      const verdict = hit === null ? '' : `\n${L(hit ? 'hit' : 'miss')}`;
      this.lastRoll = `${L('atk')} ${total}\n${note}${verdict}`;
      this.sendAttackEvent('attackRoll');
      if (die === 20) this.sendAttackEvent('attackCrit', { die, dice, total });
      else if (hit === true) this.sendAttackEvent('attackHit', { die, dice, total });
      else if (hit === false) this.sendAttackEvent('attackMiss', { die, dice, total });
      await action.showOk();
      return this.render();
    }
    if (slot === this.rollDamageSlot && atk.damage.length > 0) {
      this.clearPendingApply();
      let total = 0;
      const lines: string[] = [];
      const mathParts: string[] = [];
      const mathTypes: (string | null)[] = [];
      for (const d of atk.damage) {
        // Diceless entries use their flat/average value.
        const roll = d.dice ? rollDice(d.dice) : null;
        const value = roll ? roll.total : (d.average ?? 0);
        if (d.condition) {
          // Conditional damage (e.g. "if the attack roll had Advantage") is
          // rolled but shown separately, not added to the base total.
          lines.push(`+${value} if…`);
        } else {
          total += value;
          if (roll) {
            const bonusStr =
              roll.bonus === 0 ? '' : roll.bonus > 0 ? ` +${roll.bonus}` : ` ${roll.bonus}`;
            mathParts.push(`${d.dice} [${roll.rolls.join('+')}]${bonusStr}`);
            mathTypes.push(d.type ?? null);
          } else {
            mathParts.push(`${value}`);
          }
          if (atk.damage.filter((x) => !x.condition).length > 1) {
            lines.push(`${value} ${Picker.typeTag(d.type)}`);
          }
        }
      }
      this.lastDamageMath = `${mathParts.join(' + ')} = ${total}`;
      this.lastDamageMathTypes = mathTypes;
      this.sendAttackEvent('damageRoll');
      const summary = [`DMG ${total}`, ...lines.slice(0, 1)];
      if (atk.save) {
        // Saving-throw action: ask which targets succeeded (they take half)
        // before the apply countdown starts.
        this.pendingDamage = total;
        this.saveRolls.clear();
        this.saveEntryId = null;
        this.lastRoll = summary.join('\n');
        this.mode = 'saveMode';
        await action.showOk();
        return this.render();
      }
      // Attack roll: countdown, then apply to the target and return to the
      // profile the Monster Attack key was pressed on.
      this.startDamageApply(summary, () =>
        this.targets.map((id) => ({ id, amount: total, math: this.lastDamageMath })),
      );
      await action.showOk();
      return this.render();
    }
  }

  /** Shared 5 s countdown → apply amounts → exit. */
  private startDamageApply(
    summary: string[],
    amounts: () => {
      id: string;
      amount: number;
      math?: string;
      save?: NonNullable<Extract<BridgeCommand, { type: 'applyDamage' }>['save']>;
    }[],
  ): void {
    this.clearPendingApply();
    let secondsLeft = Math.max(1, Math.round(this.applyDelayMs / 1000));
    this.lastRoll = [...summary, `→ in ${secondsLeft}s`].join('\n');
    if (this.applyDelayMs >= 1500) {
      this.applyCountdown = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          this.lastRoll = [...summary, `→ in ${secondsLeft}s`].join('\n');
          void this.render();
        }
      }, 1000);
    }
    this.applyTimer = setTimeout(async () => {
      this.clearPendingApply();
      for (const { id, amount, math, save } of amounts()) {
        bridge.send({
          type: 'applyDamage',
          actorId: id,
          amount,
          actorName: this.actorName,
          actorType: this.attackerType,
          math,
          mathTypes: math ? this.lastDamageMathTypes : undefined,
          save,
        });
      }
      this.sendAttackEvent('damageApplied');
      await this.exit();
    }, this.applyDelayMs);
  }

  /**
   * Auto or manual? Auto rolls every target's save on the deck; manual leaves
   * the list empty so each total can be typed on the numpad. Either way the
   * other route stays available on the results screen.
   */
  private async pressSaveMode(slot: number, _action: KeyAction): Promise<void> {
    if (slot === 0) {
      // An app-pushed prompt has no roll screen behind it: Back declines,
      // leaving the throw with the DM window and the phones.
      if (this.savePrompt) return this.exit();
      this.mode = 'attackRoll';
      this.lastRoll = `DMG ${this.pendingDamage}`;
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    if (slot === this.saveAutoSlot) {
      for (const c of this.selectedTargetCombatants()) this.rollSaveFor(c);
      this.mode = 'saveResult';
      return this.render();
    }
    if (slot === this.saveManualSlot) {
      this.saveRolls.clear();
      this.mode = 'saveResult';
      return this.render();
    }
  }

  /** The numpad, filling in one target's total. */
  private async pressSaveEntry(slot: number, _action: KeyAction): Promise<void> {
    const key = numpadLayout(this.cols, this.rows)?.get(slot);
    if (!key) return;
    switch (key.kind) {
      case 'cancel':
        return this.exit();
      case 'digit':
        if (this.digits.length < 3) this.digits += key.value!;
        return this.render();
      case 'clear':
        this.digits = '';
        return this.render();
      case 'back':
        this.digits = '';
        this.saveEntryId = null;
        this.mode = 'saveResult';
        return this.render();
      case 'enter': {
        const total = parseInt(this.digits, 10);
        // A typed total carries no die: the d20 is on the table, not here.
        if (this.saveEntryId && Number.isFinite(total)) {
          this.saveRolls.set(this.saveEntryId, { die: null, total });
        }
        this.digits = '';
        this.saveEntryId = null;
        this.mode = 'saveResult';
        return this.render();
      }
      case 'display':
        return;
    }
  }

  private async pressSaveResult(slot: number, _action: KeyAction): Promise<void> {
    if (slot === 0) {
      // Back on an app-pushed prompt declines it — no roll screen behind it.
      if (this.savePrompt) return this.exit();
      // Back: abandon a pending apply and return to the roll screen.
      this.clearPendingApply();
      this.mode = 'attackRoll';
      this.lastRoll = `DMG ${this.pendingDamage}`;
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    if (this.applyTimer) return; // countdown running — only Back/Cancel act
    const { map, paged, pageSlot } = this.listLayout(
      this.selectedTargetCombatants(),
      true,
      [this.confirmDisplaySlot],
    );
    if (slot === this.confirmDisplaySlot) {
      // Re-roll the whole area — also the way into rolling from manual mode.
      for (const c of this.selectedTargetCombatants()) this.rollSaveFor(c);
      return this.render();
    }
    if (slot === this.doneSlot) {
      if (!this.allSavesEntered) return;
      if (this.savePrompt) {
        // Report each throw and step aside. Whichever surface answered first
        // wins app-side, so a row already taken elsewhere is simply ignored.
        const promptId = this.savePrompt.id;
        for (const [targetId, roll] of this.saveRolls) {
          bridge.send({ type: 'saveResult', id: promptId, targetId, die: roll.die, total: roll.total });
        }
        this.savePrompt = null;
        return this.exit();
      }
      const full = this.pendingDamage;
      const half = Math.floor(full / 2);
      const info = this.saveInfo;
      this.startDamageApply([`DMG ${full}`, `½ = ${half}×${this.savedTargets.length}`], () =>
        this.targets.map((id) => {
          const saved = this.savedTargets.includes(id);
          const roll = this.saveRolls.get(id);
          return {
            id,
            amount: saved ? half : full,
            math: saved ? `${this.lastDamageMath} → ½ ${half}` : this.lastDamageMath,
            // Rides along so the app logs the throw right before the damage,
            // leaving the same card the DM window and the phones produce.
            save:
              info && roll
                ? {
                    ability: info.ability,
                    dc: info.dc,
                    die: roll.die ?? undefined,
                    total: roll.total,
                    saved,
                    attackName: this.selectedAttack?.name,
                    attackerName: this.actorName,
                  }
                : undefined,
          };
        }),
      );
      return this.render();
    }
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const c = map.get(slot);
    if (!c) return;
    // Pressing a target types its total — the way to record a physical roll,
    // and the way to correct one the deck rolled.
    this.saveEntryId = c.id;
    this.digits = '';
    this.mode = 'saveEntry';
    return this.render();
  }

  /** The combatants previously picked as targets, in pick order. */
  private selectedTargetCombatants(): BridgeCombatant[] {
    return this.targets
      .map((id) => this.alive().find((c) => c.id === id))
      .filter((c): c is BridgeCombatant => c !== undefined);
  }

  private async pressDiceNumpad(slot: number, _action: KeyAction): Promise<void> {
    const key = numpadLayout(this.cols, this.rows)?.get(slot);
    if (!key) return;
    switch (key.kind) {
      case 'cancel':
        return this.exit();
      case 'display':
        // On the modifier screen the value display doubles as the ± toggle.
        if (this.mode === 'diceMod') {
          this.diceSign = this.diceSign === 1 ? -1 : 1;
          return this.render();
        }
        return;
      case 'digit':
        if (this.digits.length < 3) this.digits += key.value!;
        return this.render();
      case 'clear':
        this.digits = '';
        return this.render();
      case 'back':
        if (this.mode === 'diceAmount') {
          // First screen: nothing to go back to (the key renders blank).
          if (this.diceStage === 'first') return;
          // Extra-dice entry backs out to the "more dice?" question.
          this.mode = 'diceMore';
          this.digits = '';
          return this.render();
        }
        this.mode = 'diceType';
        this.digits = '';
        return this.render();
      case 'enter':
        if (this.mode === 'diceAmount') {
          this.diceCount = Math.max(1, parseInt(this.digits || '1', 10));
          this.digits = '';
          this.mode = 'diceType';
        } else {
          this.diceModValue = parseInt(this.digits || '0', 10);
          this.digits = '';
          this.rolledTotal = null;
          this.mode = 'diceMore';
        }
        return this.render();
    }
  }

  private async pressDiceType(slot: number, _action: KeyAction): Promise<void> {
    if (slot === 0) {
      this.mode = 'diceAmount';
      this.digits = String(this.diceCount);
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    const die = DICE_TYPES[slot - 1];
    if (die === undefined) return;
    this.dieFaces = die;
    this.digits = '';
    this.rolledTotal = null;
    if (this.diceStage === 'first') {
      this.dicePool = [{ count: this.diceCount, die }];
      this.diceSign = 1;
      this.mode = 'diceMod';
    } else {
      // Extra part recorded — ask again until the user says no.
      this.dicePool.push({ count: this.diceCount, die });
      this.mode = 'diceMore';
    }
    return this.render();
  }

  private async pressDiceMore(slot: number, _action: KeyAction): Promise<void> {
    if (slot === 0) {
      // Back to the modifier entry (the pool's extras stay).
      this.mode = 'diceMod';
      this.digits = this.diceModValue === 0 ? '' : String(this.diceModValue);
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    if (slot === this.moreYesSlot) {
      this.diceStage = 'extra';
      this.digits = '';
      this.mode = 'diceAmount';
      return this.render();
    }
    if (slot === this.moreNoSlot) {
      this.mode = 'diceRoll';
      return this.render();
    }
  }

  private async pressDiceRoll(slot: number, action: KeyAction): Promise<void> {
    if (slot === 0) {
      this.mode = 'diceMore';
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    if (slot === this.diceAddSlot) {
      // Add another kind of dice to the pool.
      this.diceStage = 'extra';
      this.digits = '';
      this.mode = 'diceAmount';
      return this.render();
    }
    if (slot === this.diceRollSlot) {
      this.rolledTotal = rollPool(this.dicePool, this.diceSign * this.diceModValue);
      await action.showOk();
      return this.render();
    }
    if (slot === this.diceDamageSlot || slot === this.diceHealSlot) {
      if (this.rolledTotal === null || this.alive().length === 0) {
        await action.showAlert(); // roll first / no combatants to apply to
        return;
      }
      this.applyOp = slot === this.diceDamageSlot ? 'damage' : 'heal';
      this.targets = [];
      this.page = 0;
      this.mode = 'diceTargets';
      return this.render();
    }
  }

  private async pressDiceTargets(slot: number, action: KeyAction): Promise<void> {
    if (slot === 0) {
      this.mode = 'diceRoll';
      this.targets = [];
      return this.render();
    }
    if (slot === this.cancelSlot) return this.exit();
    const { map, paged, pageSlot } = this.targetLayout();
    if (slot === this.doneSlot) {
      if (this.targets.length === 0 || this.rolledTotal === null || !this.applyOp) return;
      const sent = this.targets.every((id) =>
        bridge.send({
          type: this.applyOp === 'damage' ? 'applyDamage' : 'applyHeal',
          actorId: id,
          amount: this.rolledTotal!,
        }),
      );
      if (!sent) {
        await action.showAlert();
        return;
      }
      return this.exit();
    }
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const c = map.get(slot);
    if (!c) return;
    this.targets = this.targets.includes(c.id)
      ? this.targets.filter((id) => id !== c.id)
      : [...this.targets, c.id];
    return this.render();
  }

  private async pressConfirmEnd(slot: number, action: KeyAction): Promise<void> {
    if (slot === this.cancelSlot) return this.exit();
    if (slot === this.confirmYesSlot) {
      const sent = bridge.send({ type: 'endCombat' });
      if (!sent) {
        await action.showAlert();
        return;
      }
      return this.exit();
    }
  }

  /** The conditions grid, plus the one-shot concentration key when present. */
  private conditionItems(): string[] {
    return this.concEntry ? [...CONDITIONS, CONC_ITEM] : [...CONDITIONS];
  }

  private async pressConditions(slot: number, action: KeyAction): Promise<void> {
    if (slot === 0) {
      // Back to actor select (selection kept) to adjust who's affected.
      this.mode = 'actorSelect';
      this.page = 0;
      return this.render();
    }
    if (slot === this.doneSlot || slot === this.cancelSlot) {
      // Done/Cancel: return to the profile the Condition key was pressed on.
      return this.exit();
    }
    const { map, paged, pageSlot } = this.listLayout(this.conditionItems(), true);
    if (paged && slot === pageSlot) {
      this.page += 1;
      return this.render();
    }
    const cond = map.get(slot);
    if (!cond) return;
    if (cond === CONC_ITEM) {
      // Drop the spell; the key disappears with the entry.
      if (this.concEntry) {
        if (!bridge.send({ type: 'clearConcentration', actorId: this.concEntry.actorId })) {
          await action.showAlert();
          return;
        }
        this.concEntry = null;
      }
      return this.render();
    }
    const selected = this.selectedTargetCombatants();
    if (selected.length === 0) return;
    // Uniform group toggle: if every selected actor has it → remove from all;
    // otherwise add to all. Only actors whose state differs get the command.
    const allHave = selected.every((c) => c.conditions.includes(cond));
    const wantOn = !allHave;
    let ok = true;
    for (const c of selected) {
      if (c.conditions.includes(cond) !== wantOn) {
        ok = bridge.send({ type: 'toggleCondition', actorId: c.id, condition: cond }) && ok;
      }
    }
    if (!ok) await action.showAlert();
    // The ✓ refresh arrives with the next state broadcast.
  }

  // ---- reacting to app state ----

  private async onBridgeState(): Promise<void> {
    if (!this.mode) return;
    // Combat ended (e.g. from the app) while the confirm screen was up: leave.
    if (this.mode === 'confirmEnd' && this.alive().length === 0) {
      return this.exit();
    }
    // The attack flow is bound to one monster; if it's gone, leave the flow.
    if (
      (this.mode === 'attackSelect' ||
        this.mode === 'targetSelect' ||
        this.mode === 'attackRoll' ||
        this.mode === 'saveMode' ||
        this.mode === 'saveResult' ||
        this.mode === 'saveEntry') &&
      this.actorId
    ) {
      if (!this.alive().some((c) => c.id === this.actorId)) {
        return this.exit();
      }
    }
    // Save-result list: prune vanished targets (unless the apply in flight
    // is what removed them).
    if ((this.mode === 'saveResult' || this.mode === 'saveMode') && !this.applyTimer) {
      this.targets = this.targets.filter((id) => this.alive().some((c) => c.id === id));
      for (const id of [...this.saveRolls.keys()]) {
        if (!this.targets.includes(id)) this.saveRolls.delete(id);
      }
      if (this.targets.length === 0) {
        this.mode = 'targetSelect';
        this.lastRoll = '';
      }
    }
    // Dice-roller target list: drop combatants that vanished.
    if (this.mode === 'diceTargets') {
      this.targets = this.targets.filter((id) => this.alive().some((c) => c.id === id));
    }
    // Drop targets that died; an empty roll screen falls back to selection —
    // unless the pending damage apply is what removed them (monster at 0 HP
    // leaves the combat) — in that case exit() is already on its way.
    if (this.mode === 'attackRoll' && this.targets.length > 0 && !this.applyTimer) {
      this.targets = this.targets.filter((id) => this.alive().some((c) => c.id === id));
      if (this.targets.length === 0) {
        this.mode = 'targetSelect';
        this.lastRoll = '';
      }
    }
    // Damage/Heal/Condition flows: prune vanished actors from the selection;
    // an emptied numpad/conditions screen falls back to actor select.
    if (this.mode === 'actorSelect' || this.mode === 'numpad' || this.mode === 'conditions') {
      this.targets = this.targets.filter((id) => this.alive().some((c) => c.id === id));
      if ((this.mode === 'numpad' || this.mode === 'conditions') && this.targets.length === 0) {
        this.mode = 'actorSelect';
        this.page = 0;
        this.digits = '';
      }
    }
    await this.render();
  }
}

export const picker = new Picker();
