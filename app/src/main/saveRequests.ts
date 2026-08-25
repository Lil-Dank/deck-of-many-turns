import { randomUUID } from 'crypto';
import { store } from './state';
import { abilityMod, type CombatantType } from '../shared/types';
import { monsterName } from '../shared/i18n';

/**
 * One authority for "a saving throw is owed", so every surface that can answer
 * one is just a view of the same request.
 *
 * A throw can be asked for by the DM window, a player's phone or the Stream
 * Deck, and any of them may answer it. The rule is **first writer wins, per
 * target**: on a Fireball hitting three PCs and two monsters, each player fills
 * in their own row while the DM adjudicates the rest, and a late second answer
 * for a row that is already filled is ignored rather than overwriting it.
 *
 * This deliberately lives outside playerServer.ts. Concentration checks used to
 * be raised there, which meant an unclaimed PC — or the player server simply
 * being switched off — dropped the check on the floor: no prompt, no log entry,
 * no way for the DM to find out one was ever owed. Here the request exists
 * whether or not a phone can see it.
 */

export type ThrowKind = 'concentration' | 'save';

export interface ThrowResult {
  /** The raw d20, or null when a physical die was rolled and the total typed. */
  die: number | null;
  total: number;
  /** Who answered: 'dm', 'deck', or a player's name / device label. */
  by: string;
}

export interface ThrowTarget {
  combatantId: string;
  /** Display name, already localized. */
  name: string;
  type: CombatantType;
  /** The library PC id when this target is a played character. */
  pcId: string | null;
  /** Ability modifier for this save; null when the creature has no scores. */
  mod: number | null;
  /** Label of the phone that was asked, while it has yet to answer. */
  awaiting: string | null;
  result: ThrowResult | null;
}

export interface SaveRequest {
  id: string;
  kind: ThrowKind;
  /** Ability code thrown against the DC, e.g. 'CON'. */
  ability: string;
  dc: number;
  /** The spell or action that caused it. */
  attackName: string;
  attackerName?: string;
  /** Concentration: the spell at stake, without the "Concentration (…)" wrapper. */
  spellName?: string;
  /** Concentration: the damage that forced the check. */
  damage?: number;
  /**
   * Set when this request was picked up off a deferred card. A fresh throw is
   * announced to everyone who can answer it; picking one back up is one person
   * saying "I've got this", so it stays with them and does not reopen a prompt
   * on anybody else's screen.
   */
  pickedUpBy?: 'dm' | 'phone';
  targets: ThrowTarget[];
}

export interface SaveRequestInput {
  kind: ThrowKind;
  ability: string;
  dc: number;
  attackName: string;
  attackerName?: string;
  spellName?: string;
  damage?: number;
  combatantIds: string[];
  /** See SaveRequest.pickedUpBy: a rebuilt pickup stays with its picker. */
  pickedUpBy?: 'dm' | 'phone';
  /**
   * Runs once every target has an answer. Concentration uses it to log the
   * throw and drop the spell; the DM's attack flow resolves its own damage in
   * the renderer instead and leaves this unset.
   */
  onResolved?: (req: SaveRequest) => void | Promise<void>;
}

const requests = new Map<string, SaveRequest>();
const finishers = new Map<string, NonNullable<SaveRequestInput['onResolved']>>();
/**
 * Requests the DM put off. They keep their finisher, because that is where the
 * consequences live — the damage a Fireball still owes its targets, the spell a
 * failed check still ends. Throwing the card in the log resumes this exact
 * request, so nothing is recomputed and nothing is lost.
 */
const parked = new Map<string, SaveRequest>();

// ---- surface hooks ----------------------------------------------------------
// Registered by the surfaces themselves so this module imports none of them —
// playerServer imports us, never the other way round.

/** Asks a phone to answer one target. Returns the label of who was asked. */
type PhonePrompter = (req: SaveRequest, target: ThrowTarget) => string | null;
/** Tells a surface to take its prompt down: one target, or the whole request. */
type PromptCanceller = (requestId: string, combatantId: string | null) => void;

let phonePrompter: PhonePrompter | null = null;
let phoneCanceller: PromptCanceller | null = null;
let changeListener: ((req: SaveRequest) => void) | null = null;
let closeListener: ((requestId: string) => void) | null = null;

export function setPhoneSurface(prompt: PhonePrompter, cancel: PromptCanceller): void {
  phonePrompter = prompt;
  phoneCanceller = cancel;
}

/** The DM window's subscription: a request opened, or one of its rows changed. */
export function onSaveRequestChanged(cb: (req: SaveRequest) => void): void {
  changeListener = cb;
}

export function onSaveRequestClosed(cb: (requestId: string) => void): void {
  closeListener = cb;
}

/** The DM hears about a request unless a player picked it up for themselves. */
function announce(req: SaveRequest): void {
  if (req.pickedUpBy === 'phone') return;
  changeListener?.(req);
}

// ---- lifecycle --------------------------------------------------------------

export function getSaveRequest(id: string): SaveRequest | undefined {
  return requests.get(id);
}

export function openSaveRequest(input: SaveRequestInput): SaveRequest | null {
  const state = store.getState();
  const combat = state.combat;
  if (!combat) return null;
  const lang = state.settings.language;
  const key = input.ability.toLowerCase().slice(0, 3);

  const targets: ThrowTarget[] = [];
  for (const id of input.combatantIds) {
    const c = combat.combatants.find((x) => x.id === id);
    if (!c) continue;
      // Prefer the PC's own record: a combatant added mid-fight snapshots
      // abilities as null, and the modifier is the whole point of the hint.
    const pc = c.type === 'pc' ? state.pcs.find((p) => p.id === c.sourceId) : undefined;
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

  const req: SaveRequest = {
    id: randomUUID(),
    kind: input.kind,
    ability: input.ability,
    dc: input.dc,
    attackName: input.attackName,
    attackerName: input.attackerName,
    spellName: input.spellName,
    damage: input.damage,
    pickedUpBy: input.pickedUpBy,
    targets,
  };
  requests.set(req.id, req);
  if (input.onResolved) finishers.set(req.id, input.onResolved);

  // Ask every phone that can answer for itself. A target with no claim, or one
  // whose phone is offline, simply stays with the DM.
  // A DM pickup is answered by the DM; do not light up a phone for it.
  if (req.pickedUpBy !== 'dm') {
    for (const t of req.targets) {
      if (t.pcId) t.awaiting = phonePrompter?.(req, t) ?? null;
    }
  }
  announce(req);
  return req;
}

/**
 * Record one target's throw. Returns false when that row was already answered —
 * the race is decided by whoever committed first, and the loser is discarded
 * rather than overwriting a number the table has already seen.
 */
export function resolveThrow(
  requestId: string,
  combatantId: string,
  result: ThrowResult,
  revealMs = 0,
): boolean {
  const req = requests.get(requestId);
  if (!req) return false;
  const target = req.targets.find((t) => t.combatantId === combatantId);
  if (!target || target.result) return false;
  target.result = result;
  target.awaiting = null;
  // Whoever else was holding this prompt can put it away — including a card in
  // the log, if this row had been deferred and someone answered it live.
  phoneCanceller?.(requestId, combatantId);
  clearDeferredCards(requestId, combatantId);
  announce(req);
  if (req.targets.every((t) => t.result)) void finish(requestId, revealMs);
  return true;
}

/**
 * `revealMs` holds the consequences back while the answering phone's dice are
 * still in the air — the log entry and a dropped spell are table-visible, and
 * the player who threw should see their own result first. The race itself is
 * already decided: it was settled the moment resolveThrow was called.
 */
async function finish(requestId: string, revealMs: number): Promise<void> {
  const req = requests.get(requestId);
  if (!req) return;
  const done = finishers.get(requestId);
  closeRequest(requestId);
  if (!done) return;
  if (revealMs > 0) setTimeout(() => void done(req), revealMs);
  else await done(req);
}

/** Take the request down everywhere without resolving what is still open. */
export function closeRequest(requestId: string): void {
  if (!requests.has(requestId)) return;
  requests.delete(requestId);
  finishers.delete(requestId);
  parked.delete(requestId);
  phoneCanceller?.(requestId, null);
  closeListener?.(requestId);
}

/**
 * Put a deferred request back on the table for whoever picked it up — and only
 * them. The DM taking a card gets the modal with every row still owed; a player
 * taking their own gets the prompt on their phone and leaves everyone else's
 * screen alone, along with any other cards from the same request.
 */
export function resumeRequest(
  requestId: string,
  by: { surface: 'dm' } | { surface: 'phone'; pcId: string },
): SaveRequest | null {
  const req = parked.get(requestId) ?? requests.get(requestId);
  if (!req) return null;
  parked.delete(requestId);
  requests.set(requestId, req);
  req.pickedUpBy = by.surface;

  if (by.surface === 'dm') {
    // The DM adjudicates the lot, so every card from this request is spent.
    clearDeferredCards(requestId, null);
    announce(req);
    return req;
  }

  const own = req.targets.find((t) => t.pcId === by.pcId && !t.result);
  if (!own) return null;
  clearDeferredCards(requestId, own.combatantId);
  own.awaiting = phonePrompter?.(req, own) ?? null;
  return req;
}

/**
 * The DM waved it away. Rather than losing the check, every row still owed
 * becomes a card in the combat log carrying the throw it was going to be — the
 * DM and the player it belongs to can come back and throw it, ignore it, or
 * delete it. Concentration is deliberately NOT broken by this: dismissing by
 * accident should cost nothing.
 */
export async function deferRequest(requestId: string): Promise<void> {
  const req = requests.get(requestId);
  if (!req) return;
  const owed = req.targets.filter((t) => !t.result);
  // Park rather than close: closeRequest would drop the finisher, and with it
  // the damage or the spell this throw was going to decide.
  requests.delete(requestId);
  parked.set(requestId, req);
  phoneCanceller?.(requestId, null);
  closeListener?.(requestId);
  for (const t of owed) await fileDeferredCard(req, t, requestId);
}

async function fileDeferredCard(
  req: SaveRequest,
  t: ThrowTarget,
  requestId: string,
): Promise<void> {
  await store.appendLog({
    kind: 'saveDeferred',
    actorName: t.name,
    actorType: t.type,
    attackName: req.attackName,
    ability: req.ability,
    dc: req.dc,
    amount: req.damage,
    combatantId: t.combatantId,
    // Points back at the parked request, so throwing the card resumes the
    // real thing instead of a bare re-derived copy.
    requestId,
    // Marks it as a concentration check, so throwing it later still ends the
    // spell on a failure rather than quietly logging a number.
    conc: req.kind === 'concentration',
    source: 'dm',
  });
}

/**
 * One player stepped away from their own row. Everyone else's throw is still
 * owed and stays exactly where it was — only this target is filed as a card.
 *
 * If the request was private to that player (they had picked it up off a card
 * themselves) it goes back to being parked, since nobody is looking at it any
 * more. If the DM is adjudicating alongside them, it stays live: their row
 * simply stops waiting on a phone and the DM can take it.
 */
export async function deferTarget(requestId: string, combatantId: string): Promise<void> {
  const req = requests.get(requestId);
  if (!req) return;
  const target = req.targets.find((t) => t.combatantId === combatantId && !t.result);
  if (!target) return;
  target.awaiting = null;
  phoneCanceller?.(requestId, combatantId);
  await fileDeferredCard(req, target, requestId);
  if (req.pickedUpBy === 'phone') {
    requests.delete(requestId);
    parked.set(requestId, req);
    closeListener?.(requestId);
    return;
  }
  announce(req);
}

/** Every live or parked request — swept on combat end and campaign switch. */
export function openRequestIds(): string[] {
  return [...new Set([...requests.keys(), ...parked.keys()])];
}

/**
 * Drop deferred cards filed from one request — all of them, or just the one
 * belonging to a single target when only that row is being picked up.
 */
function clearDeferredCards(requestId: string, combatantId: string | null): void {
  const log = store.getState().combat?.log ?? [];
  for (const e of log) {
    if (e.kind !== 'saveDeferred' || e.requestId !== requestId) continue;
    if (combatantId !== null && e.combatantId !== combatantId) continue;
    void store.deleteLogEntry(e.id);
  }
}

/** A parked request is gone once its combat is: drop it with the live ones. */
export function forgetParked(requestId: string): void {
  parked.delete(requestId);
  finishers.delete(requestId);
}
