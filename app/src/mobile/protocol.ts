import type {
  AbilityScores,
  Condition,
  DamageInstance,
  LogEntry,
  MonsterAction,
  PlayerWebGating,
  SpellSlots,
  SpellUpcast,
} from '../shared/types';
import type { Lang } from '../shared/i18n';

/** Wire shapes of the player server's WebSocket protocol (server → client). */

export interface WireClaim {
  pcId: string;
  name: string;
  taken: boolean;
  mine: boolean;
  playerName: string | null;
}

export interface WireCombatant {
  id: string;
  name: string;
  type: 'pc' | 'monster';
  isCurrentTurn: boolean;
  isDowned: boolean;
  conditions: Condition[];
  /** The Concentration spell being maintained, shown as a condition-like tag. */
  concentration?: { name: string; deName?: string | null } | null;
  /** Monsters only — HP/AC never cross the wire for them. */
  isBloodied?: boolean;
  /** PCs only. */
  currentHp?: number;
  maxHp?: number;
  /** Own combatant only. */
  ac?: number;
  initiative?: number | null;
}

export interface WireYou {
  pcId: string;
  name: string;
  maxHp: number;
  ac: number;
  initMod: number;
  abilities: AbilityScores | null;
  notes: string;
  attacks: MonsterAction[];
  spellSlots: SpellSlots | null;
  combatantId: string | null;
}

/**
 * One spellbook entry as served to phones. `name`/`text` are canonical
 * English; `l10n` carries the German pair — the phone localizes at render,
 * so a language switch flips the open spellbook too.
 */
export interface WireSpell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  text: string;
  attack: boolean;
  save: { ability: string; onSuccess: 'half' | 'none' } | null;
  damage: DamageInstance[];
  healing: { dice: string; count: number; die: number } | null;
  upcast: SpellUpcast | null;
  upcastText: string | null;
  l10n?: { de?: { name: string; text: string } } | null;
}

export interface WireArchiveSummary {
  id: string;
  templateName: string;
  endedAt: number;
  rounds: number;
}

export interface StateMsg {
  type: 'state';
  language: Lang;
  gating: PlayerWebGating;
  combatActive: boolean;
  round: number;
  currentIndex: number;
  myTurn: boolean;
  claims: WireClaim[];
  you: WireYou | null;
  combatants: WireCombatant[];
  log: LogEntry[];
  archive: WireArchiveSummary[];
}

export interface AttackResultMsg {
  type: 'attackResult';
  targetId: string;
  targetName: string;
  die: number | null;
  total: number;
  outcome: 'crit' | 'hit' | 'miss';
  damage: number | null;
}

/** Stage 1 of the split digital flow: the d20 verdict, no damage yet. */
export interface AttackRollResultMsg {
  type: 'attackRollResult';
  targetId: string;
  targetName: string;
  /** The die that counts (higher/lower of `dice` under adv/dis). */
  die: number;
  /** Every d20 thrown: one entry normally, two under adv/dis. */
  dice: number[];
  total: number;
  outcome: 'crit' | 'hit' | 'miss';
}

/**
 * A save-based action is parked for DM adjudication. Digital rolls carry
 * the roller's own damage dice so the phone can reveal them while waiting.
 */
export interface SavePendingMsg {
  type: 'savePending';
  id: string;
  damage: number;
  rolls?: number[];
  math?: string;
  mathTypes?: (string | null)[];
}

/** Stage 2: damage rolled and applied. The roller sees their own numbers. */
export interface DamageResultMsg {
  type: 'damageResult';
  targetId: string;
  targetName: string;
  damage: number;
  /** Every individual die result, in roll order (settle animation). */
  rolls: number[];
  /** Breakdown string ("1d8 [7] +3 = 10"). */
  math: string;
  /** Damage type per bracket group of `math`. */
  mathTypes: (string | null)[];
}

export interface SaveResolvedMsg {
  type: 'saveResolved';
  id: string;
  cancelled?: boolean;
  results: Array<{ targetId: string; targetName: string; saved: boolean; amount: number }>;
}

export interface ArchiveEntryMsg {
  type: 'archiveEntry';
  id: string;
  templateName: string;
  endedAt: number;
  rounds: number;
  log: LogEntry[];
}

/** The on-demand spellbook reference (answer to getSpells). */
export interface SpellListMsg {
  type: 'spellList';
  spells: WireSpell[];
}

/** A utility spell was cast: slot spent (or cantrip), nothing rolled. */
export interface CastResultMsg {
  type: 'castResult';
  actionId: string;
  slotLevel: number | null;
}

/** A healing spell resolved; digital rolls carry the roller's dice. */
export interface HealResultMsg {
  type: 'healResult';
  targetId: string;
  targetName: string;
  amount: number;
  rolls?: number[];
  math?: string;
}

/**
 * A saving throw is owed and you can answer it: roll digitally, or roll your
 * own dice and type the total. Covers both the Constitution check that keeps a
 * spell after damage and an ordinary save the DM or the deck aimed at you.
 *
 * The DM is prompted for the same throw at the same time. Whoever answers
 * first wins; the other prompt comes down as `cancelled`.
 */
export interface ThrowPromptMsg {
  type: 'throwPrompt';
  id: string;
  kind: 'concentration' | 'save';
  /** "Concentration (Bless)", or the action that forced the save. */
  attackName: string;
  attackerName?: string;
  /** Concentration: the spell alone, so the heading does not read doubled. */
  spellName?: string;
  /** Ability code thrown against the DC, e.g. 'CON'. */
  ability: string;
  dc: number;
  /** Concentration: the damage that forced the check. */
  damage?: number;
  /** Modifier for the roll button and the manual hint; null = unknown. */
  mod: number | null;
}

export interface ThrowResultMsg {
  type: 'throwResult';
  id: string;
  /** Someone else answered first, or the fight ended. */
  cancelled?: boolean;
  die?: number | null;
  total?: number;
  dc?: number;
  saved?: boolean;
}

export type ServerMsg =
  | StateMsg
  | AttackResultMsg
  | AttackRollResultMsg
  | DamageResultMsg
  | SaveResolvedMsg
  | ArchiveEntryMsg
  | SpellListMsg
  | CastResultMsg
  | HealResultMsg
  | ThrowPromptMsg
  | ThrowResultMsg
  | { type: 'claimResult'; ok: boolean; reason?: string }
  | SavePendingMsg
  | { type: 'kicked' }
  | { type: 'error'; code: string };
