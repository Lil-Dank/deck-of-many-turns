import type { CombatantType, LogEntry } from './types';

/**
 * Card view-model for the combat log: pure derivation from the entry stream,
 * shared by the DM panel, the archive and the phone. A card belongs to the
 * character an entry is ABOUT — roll kinds (attackRoll, cast, save) to the
 * acting character, application kinds (damage, heal, conditions, down, kill)
 * to the target. Consecutive entries about the same character merge into one
 * card; round/turn/combat markers become cardless separators.
 */

export interface CardSubject {
  name: string;
  type?: CombatantType;
}

export type CardBlock =
  /** Attacker's action block: verdict row from `roll`, damage-roll line from
   *  the paired damage entry's math (the application renders on the target). */
  | { kind: 'attack'; key: string; roll: LogEntry; damage?: LogEntry }
  | { kind: 'cast'; key: string; entry: LogEntry }
  | { kind: 'save'; key: string; entry: LogEntry }
  | { kind: 'deferred'; key: string; entry: LogEntry }
  /** `paired`: the roll math already renders on the attacker's card. */
  | { kind: 'take'; key: string; entry: LogEntry; paired?: boolean }
  | { kind: 'heal'; key: string; entry: LogEntry }
  | { kind: 'condition'; key: string; entry: LogEntry }
  | { kind: 'downkill'; key: string; entry: LogEntry };

export type CardItem =
  | {
      type: 'separator';
      key: string;
      sepKind: 'round' | 'turn' | 'combatStart' | 'combatEnd';
      round?: number;
      entry?: LogEntry;
    }
  | {
      type: 'card';
      key: string;
      subject: CardSubject;
      /** First block's timestamp — the card's "x ago". */
      ts: number;
      /** First block's source tag data. */
      source: LogEntry['source'];
      sourceName?: string;
      blocks: CardBlock[];
    };

/** Display damage type: the explicit field wins, else a unique mathTypes value. */
export function entryDamageType(e: LogEntry): string | null {
  if (e.damageType) return e.damageType;
  const known = [...new Set((e.mathTypes ?? []).filter((x): x is string => x !== null))];
  return known.length === 1 ? known[0] : null;
}

/** Every entry id a block owns (attack blocks own up to two). */
export function blockEntryIds(b: CardBlock): string[] {
  if (b.kind === 'attack') return b.damage ? [b.roll.id, b.damage.id] : [b.roll.id];
  return [b.entry.id];
}

/** How far back a damage entry may look for its attack roll. */
const PAIR_WINDOW = 10;

/**
 * Pairs damage entries to the attackRoll they resolved (nearest preceding,
 * same actor/target/source, non-miss, same or adjacent round). Under-pairing
 * is safe — an unpaired damage entry just renders standalone on the target.
 */
function pairDamage(log: LogEntry[]): Map<string, string> {
  const damageToAttack = new Map<string, string>();
  const claimed = new Set<string>();
  for (let i = 0; i < log.length; i++) {
    const d = log[i];
    if (d.kind !== 'damage' || !d.actorName) continue;
    for (let j = i - 1; j >= 0 && i - j <= PAIR_WINDOW; j--) {
      const a = log[j];
      if (a.kind !== 'attackRoll' || claimed.has(a.id)) continue;
      if (a.outcome === 'miss') continue;
      if (a.actorName !== d.actorName) continue;
      if (a.targetName && d.targetName && a.targetName !== d.targetName) continue;
      if (a.source !== d.source || a.sourceName !== d.sourceName) continue;
      if (Math.abs(a.round - d.round) > 1) continue;
      damageToAttack.set(d.id, a.id);
      claimed.add(a.id);
      break;
    }
  }
  return damageToAttack;
}

/** The character an entry is about (card subject), or null for separators. */
function subjectOf(e: LogEntry): CardSubject | null {
  switch (e.kind) {
    case 'attackRoll':
    case 'cast':
    case 'save':
    case 'saveDeferred':
      return e.actorName ? { name: e.actorName, type: e.actorType } : null;
    case 'damage':
    case 'heal':
    case 'conditionAdded':
    case 'conditionRemoved':
    case 'down':
    case 'kill':
      return e.targetName ? { name: e.targetName, type: e.targetType } : null;
    default:
      return null;
  }
}

function blockOf(e: LogEntry): CardBlock {
  switch (e.kind) {
    case 'attackRoll':
      return { kind: 'attack', key: e.id, roll: e };
    case 'cast':
      return { kind: 'cast', key: e.id, entry: e };
    case 'save':
      return { kind: 'save', key: e.id, entry: e };
    case 'saveDeferred':
      return { kind: 'deferred', key: e.id, entry: e };
    case 'heal':
      return { kind: 'heal', key: e.id, entry: e };
    case 'conditionAdded':
    case 'conditionRemoved':
      return { kind: 'condition', key: e.id, entry: e };
    case 'down':
    case 'kill':
      return { kind: 'downkill', key: e.id, entry: e };
    default:
      return { kind: 'take', key: e.id, entry: e };
  }
}

export function buildLogCards(log: LogEntry[]): CardItem[] {
  const damageToAttack = pairDamage(log);
  const attackBlocks = new Map<string, CardBlock & { kind: 'attack' }>();

  const out: CardItem[] = [];
  let current: (CardItem & { type: 'card' }) | null = null;
  let lastRound = -1;

  const flush = () => {
    if (current) out.push(current);
    current = null;
  };

  for (const e of log) {
    // Round separator on any change (prevTurn legitimately repeats numbers).
    if (e.round > 0 && e.round !== lastRound) {
      flush();
      out.push({ type: 'separator', key: `r${e.round}-${e.id}`, sepKind: 'round', round: e.round });
      lastRound = e.round;
    }

    if (e.kind === 'combatStart' || e.kind === 'combatEnd' || e.kind === 'turn') {
      flush();
      out.push({
        type: 'separator',
        key: e.id,
        sepKind: e.kind === 'turn' ? 'turn' : e.kind,
        entry: e,
      });
      continue;
    }

    // Paired damage: attach the roll math to the attacker's block, then let
    // the application line fall through to the target's card as usual.
    const attackId = e.kind === 'damage' ? damageToAttack.get(e.id) : undefined;
    let paired = false;
    if (attackId) {
      const ab = attackBlocks.get(attackId);
      if (ab) {
        ab.damage = e;
        paired = true;
      }
    }

    const subject = subjectOf(e);
    if (!subject) {
      // Actor-less system entry with no target either — extremely rare
      // (defensive): render as its own unheaded card.
      flush();
      out.push({
        type: 'card',
        key: `c-${e.id}`,
        subject: { name: '' },
        ts: e.ts,
        source: e.source,
        sourceName: e.sourceName,
        blocks: [blockOf(e)],
      });
      continue;
    }

    if (!current || current.subject.name !== subject.name || current.subject.type !== subject.type) {
      flush();
      current = {
        type: 'card',
        key: `c-${e.id}`,
        subject,
        ts: e.ts,
        source: e.source,
        sourceName: e.sourceName,
        blocks: [],
      };
    }
    const block = blockOf(e);
    if (block.kind === 'attack') attackBlocks.set(e.id, block);
    if (block.kind === 'take' && paired) block.paired = true;
    current.blocks.push(block);
    current.ts = e.ts; // the card's clock follows its latest entry
  }
  flush();
  return out;
}
