import { WebSocketServer, WebSocket } from 'ws';
import { store } from './state';
import type { AppState } from '../shared/types';
import { ABILITY_KEYS, abilityMod } from '../shared/types';
import { abilityCodeLabel, monsterName } from '../shared/i18n';
import { handleAttackEvent, type AttackEventPayload } from './kenku';
import { logAttackEvent, type AttackRollDetails } from './combatLog';
import { resolveThrow } from './saveRequests';

/**
 * Local WebSocket bridge for the Stream Deck plugin. The app is the server;
 * the plugin connects as a client on 127.0.0.1:<bridgePort>.
 */

let wss: WebSocketServer | null = null;
let currentPort = 0;
let listenersRegistered = false;
let commandListener: (() => void) | null = null;

/** Notified whenever the plugin sends a command (used to focus the DM view). */
export function onBridgeCommand(cb: () => void): void {
  commandListener = cb;
}

interface BridgeCommand {
  type: string;
  actorId?: string;
  amount?: number;
  condition?: string;
  sourceId?: string;
  attackId?: string;
  phase?: string;
  /** applyDamage attribution + dice composition (v2.2+ plugins). */
  actorName?: string;
  actorType?: string;
  math?: string;
  /** Damage type per bracket group of `math` (v3.1+ plugins). */
  mathTypes?: (string | null)[];
  /** Optional attackEvent roll details for the combat log (v1.4+ plugins). */
  roll?: AttackRollDetails;
  /**
   * applyDamage from a save-based action (v3.6+ plugins): the throw this
   * target made. Logged as its own entry immediately before the damage, so
   * the deck leaves the same card as the DM window and the player web app.
   */
  save?: {
    ability: string;
    dc: number;
    /** Absent when the DM declared the outcome without a number. */
    die?: number;
    total?: number;
    saved: boolean;
    attackName?: string;
    attackerName?: string;
  };
  /** saveResult (v3.6+): one target's answer to a pushed savePrompt. */
  id?: string;
  targetId?: string;
  die?: number | null;
  total?: number;
}

function stateMessage(state: AppState): string {
  const combat = state.combat;
  const active = combat !== null && combat.phase === 'active';
  // Actor names are localized here rather than in the plugin: the German SRD
  // name map is app-side data, and this keeps the deck and the DM window
  // showing the same name for the same creature.
  const lang = state.settings.language;
  const templates = new Map(state.monsters.map((m) => [m.id, m]));
  return JSON.stringify({
    type: 'state',
    language: lang,
    combatants: active
      ? combat!.combatants.map((c, i) => ({
          id: c.id,
          sourceId: c.sourceId,
          type: c.type,
          displayName: monsterName(lang, c.displayName),
          currentHp: c.currentHp,
          maxHp: c.maxHp,
          ac: c.ac,
          isCurrentTurn: i === combat!.currentIndex,
          isDowned: c.isDowned,
          conditions: c.conditions,
          // Ability modifiers, so the deck can roll a target's saving throw
          // without a round trip. Absent when the creature has no scores;
          // plugins older than v3.6 ignore the field.
          saveMods: c.abilities
            ? Object.fromEntries(ABILITY_KEYS.map((k) => [k, abilityMod(c.abilities![k])]))
            : undefined,
          // Localized spell name the actor concentrates on, for the deck's
          // condition flow (labels arrive pre-translated, like action names).
          concentration: c.concentration
            ? (lang === 'de' && c.concentration.deName) || c.concentration.name
            : null,
          // Rollable actions for the deck's Attack flow (attack rolls, plus
          // save actions that deal damage — e.g. breath weapons). Spell
          // snapshots stay off the deck: no slot UI there this release.
          attacks: c.attacks
            .filter(
              (a) =>
                !a.spell &&
                (a.type === 'attack' || (a.type === 'save' && a.onHit.damage.length > 0)),
            )
            .map((a) => ({
              id: a.id,
              // Deck labels use the German SRD action name when the template
              // carries one; manual monsters have no l10n and stay as typed.
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
    currentIndex: active ? combat!.currentIndex : 0,
    round: active ? combat!.round : 0,
  });
}

const KNOWN_COMMANDS = new Set([
  'nextTurn',
  'prevTurn',
  'endCombat',
  'applyDamage',
  'applyHeal',
  'toggleCondition',
  'clearConcentration',
]);

async function handleCommand(cmd: BridgeCommand): Promise<void> {
  // Any hardware action means the DM is running combat — surface that screen.
  if (KNOWN_COMMANDS.has(cmd.type)) commandListener?.();
  const actorType =
    cmd.actorType === 'pc' || cmd.actorType === 'monster'
      ? (cmd.actorType as 'pc' | 'monster')
      : undefined;
  const ctx = {
    source: 'deck' as const,
    actorName: cmd.actorName,
    actorType,
    math: cmd.math,
    mathTypes: Array.isArray(cmd.mathTypes)
      ? cmd.mathTypes.map((t) => (typeof t === 'string' ? t : null))
      : undefined,
  };
  switch (cmd.type) {
    case 'nextTurn':
      return store.nextTurn(ctx);
    case 'prevTurn':
      return store.prevTurn(ctx);
    case 'endCombat':
      return store.endCombat(ctx);
    case 'applyDamage':
      if (cmd.actorId && typeof cmd.amount === 'number') {
        if (cmd.save) logDeckSave(cmd.actorId, cmd.save);
        return store.applyDamage(cmd.actorId, cmd.amount, ctx);
      }
      return;
    case 'applyHeal':
      if (cmd.actorId && typeof cmd.amount === 'number') {
        return store.applyHeal(cmd.actorId, cmd.amount, ctx);
      }
      return;
    case 'toggleCondition':
      if (cmd.actorId && typeof cmd.condition === 'string') {
        return store.toggleCondition(cmd.actorId, cmd.condition as never, ctx);
      }
      return;
    case 'clearConcentration':
      // The deck's condition flow drops a combatant's Concentration tag.
      if (cmd.actorId) return store.setConcentration(cmd.actorId, null);
      return;
    case 'saveResult': {
      // The deck answering a throw the app asked for. resolveThrow decides the
      // race: a row already taken elsewhere is left alone.
      if (typeof cmd.id === 'string' && typeof cmd.targetId === 'string' && typeof cmd.total === 'number') {
        resolveThrow(cmd.id, cmd.targetId, {
          die: typeof cmd.die === 'number' ? cmd.die : null,
          total: cmd.total,
          by: 'deck',
        });
      }
      return;
    }
    case 'attackEvent': {
      // Deliberately absent from KNOWN_COMMANDS: a sound trigger should not
      // yank the DM window to the Combat screen.
      const c = cmd as unknown as AttackEventPayload & { type: string };
      // sourceId is recommended but optional - the handler can resolve the
      // per-attack sound from the attack id alone (older clients).
      if (typeof c.attackId === 'string' && c.phase) {
        handleAttackEvent({ sourceId: c.sourceId ?? '', attackId: c.attackId, phase: c.phase });
        // Log the verdict. Clients that don't send roll details (older
        // plugins, third-party bridge users) still get a log line - the
        // attacker resolves from the current turn / attack id.
        logAttackEvent(c.phase, cmd.roll ?? synthesizeRollDetails(c.sourceId, c.attackId), 'deck');
      }
      return;
    }
    default:
      return;
  }
}

/**
 * A saving throw the deck adjudicated, logged as its own entry just before
 * the damage it caused — the same shape main/ipc.ts writes for the DM window
 * and playerServer.ts writes for the player web app.
 */
function logDeckSave(
  targetId: string,
  save: NonNullable<BridgeCommand['save']>,
): void {
  const state = store.getState();
  const target = state.combat?.combatants.find((c) => c.id === targetId);
  if (!target) return;
  void store.appendLog({
    kind: 'save',
    actorName: monsterName(state.settings.language, target.displayName),
    actorType: target.type,
    targetName: save.attackerName,
    attackName: save.attackName,
    ability: save.ability,
    die: save.die,
    total: save.total,
    dc: save.dc,
    outcome: save.saved ? 'saved' : 'failed',
    source: 'deck',
  });
}

/**
 * Fallback attacker resolution for verdict logging when a client sent no
 * roll block: prefer the current-turn combatant when it matches the attack,
 * else name the attack's owning template/PC.
 */
function synthesizeRollDetails(
  sourceId: string | undefined,
  attackId: string,
): AttackRollDetails | undefined {
  const state = store.getState();
  const combat = state.combat;
  if (combat && combat.phase === 'active') {
    const current = combat.combatants[combat.currentIndex];
    if (current?.attacks.some((a) => a.id === attackId)) {
      const action = current.attacks.find((a) => a.id === attackId);
      return {
        actorName: monsterName(state.settings.language, current.displayName),
        actorType: current.type,
        attackName: action?.name,
      };
    }
  }
  const owner =
    state.monsters.find((m) => m.id === sourceId) ??
    state.pcs.find((p) => p.id === sourceId) ??
    state.monsters.find((m) => m.attacks.some((a) => a.id === attackId)) ??
    state.pcs.find((p) => p.attacks.some((a) => a.id === attackId));
  if (!owner) return undefined;
  const action = owner.attacks.find((a) => a.id === attackId);
  const isPc = state.pcs.some((p) => p.id === owner.id);
  return {
    actorName: monsterName(state.settings.language, owner.name),
    actorType: isPc ? 'pc' : 'monster',
    attackName: action?.name,
  };
}

/**
 * Ask the decks for a saving throw. Pushed the moment a request opens, which is
 * the first time the app has ever sent them anything but state — older plugins
 * ignore unknown types, so this is safe in both directions.
 */
export function pushSavePrompt(req: {
  id: string;
  kind: 'concentration' | 'save';
  ability: string;
  dc: number;
  attackName: string;
  targets: Array<{ combatantId: string; result: unknown }>;
}): void {
  const owed = req.targets.filter((t) => !t.result).map((t) => t.combatantId);
  if (owed.length === 0) return;
  sendAll(
    JSON.stringify({
      type: 'savePrompt',
      id: req.id,
      kind: req.kind,
      ability: req.ability,
      dc: req.dc,
      attackName: req.attackName,
      targetIds: owed,
    }),
  );
}

/** Someone else answered it, or the fight moved on. */
export function closeSavePrompt(id: string): void {
  sendAll(JSON.stringify({ type: 'savePromptClosed', id }));
}

function broadcast(): void {
  sendAll(stateMessage(store.getState()));
}

/** One frame to every connected deck. */
function sendAll(msg: string): void {
  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

export function startBridge(): void {
  const port = store.getState().settings.bridgePort;
  stopBridge();
  currentPort = port;
  try {
    wss = new WebSocketServer({ host: '127.0.0.1', port });
  } catch (err) {
    console.error('Bridge: failed to start WebSocket server', err);
    return;
  }
  wss.on('error', (err) => {
    console.error('Bridge: server error', err);
  });
  wss.on('connection', (socket) => {
    store.setBridgeClientCount(wss?.clients.size ?? 0);
    socket.send(stateMessage(store.getState()));
    socket.on('message', (data) => {
      try {
        const cmd = JSON.parse(data.toString()) as BridgeCommand;
        void handleCommand(cmd);
      } catch {
        // Ignore malformed messages.
      }
    });
    socket.on('close', () => {
      store.setBridgeClientCount(wss?.clients.size ?? 0);
    });
    socket.on('error', () => {
      // Individual socket errors are handled by 'close'.
    });
  });

  if (!listenersRegistered) {
    listenersRegistered = true;
    store.onChange((state) => {
      broadcast();
      // If the DM changes the port in settings, restart the server on it.
      if (state.settings.bridgePort !== currentPort) {
        startBridge();
      }
    });
  }
}

export function stopBridge(): void {
  if (wss) {
    wss.close();
    for (const client of wss.clients) client.terminate();
    wss = null;
  }
}
