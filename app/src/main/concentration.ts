import { store } from './state';
import { openSaveRequest, resumeRequest, type SaveRequest } from './saveRequests';
import { translate } from '../shared/i18n';

/**
 * Damage to a concentrating PC forces a Constitution save. This used to be
 * raised inside playerServer.ts, which meant it only existed when a phone was
 * there to answer it: an unclaimed PC, a disconnected phone or the player
 * server being switched off dropped the check entirely — no prompt, no log
 * entry, nothing to tell the DM one was ever owed, and the spell stayed up.
 *
 * Now it opens a save request, which reaches the DM regardless and asks the
 * phone as well when there is one.
 */
export function startConcentrationChecks(): void {
  store.onConcentrationCheck((check) => {
    const lang = store.getState().settings.language;
    const spell = lang === 'de' && check.deName ? check.deName : check.spellName;
    openSaveRequest({
      kind: 'concentration',
      ability: 'CON',
      dc: check.dc,
      // The bare spell everywhere; the "Concentration (…)" label is built at
      // write time, so reopening a deferred card cannot double it up.
      attackName: spell,
      spellName: spell,
      damage: check.damage,
      combatantIds: [check.combatantId],
      onResolved: (req) => void applyConcentration(req, check.combatantId),
    });
  });
}

/**
 * Reopen a check the DM deferred. Lives here, not in saveRequests, so a
 * concentration card keeps its consequence: throwing it later still ends the
 * spell on a failure.
 */
export function reopenDeferredThrow(
  entry: {
    combatantId?: string;
    ability?: string;
    dc?: number;
    attackName?: string;
    amount?: number;
    conc?: boolean;
    requestId?: string;
  },
  by: { surface: 'dm' } | { surface: 'phone'; pcId: string },
): boolean {
  // The parked original first: it still carries what the throw decides. Only
  // when it is gone (a restart, a finished combat) do we rebuild a bare one.
  if (entry.requestId && resumeRequest(entry.requestId, by)) return true;
  if (!entry.combatantId || !entry.ability || entry.dc === undefined) return false;
  const combatantId = entry.combatantId;
  const isConc = entry.conc === true;
  const req = openSaveRequest({
    // Rebuilt rather than resumed, but still a pickup: it belongs to whoever
    // reached for it, not to everyone.
    pickedUpBy: by.surface,
    kind: isConc ? 'concentration' : 'save',
    ability: entry.ability,
    dc: entry.dc,
    attackName: entry.attackName ?? '',
    spellName: isConc ? entry.attackName : undefined,
    damage: entry.amount,
    combatantIds: [combatantId],
    onResolved: isConc ? (r) => void applyConcentration(r, combatantId) : undefined,
  });
  return req !== null;
}

async function applyConcentration(req: SaveRequest, combatantId: string): Promise<void> {
  const target = req.targets[0];
  if (!target?.result) return;
  const saved = target.result.total >= req.dc;
  const lang = store.getState().settings.language;
  await store.appendLog({
    kind: 'save',
    actorName: target.name,
    actorType: 'pc',
    attackName: `${translate(lang, 'spellbook.concentration')} (${req.spellName ?? req.attackName})`,
    die: target.result.die ?? undefined,
    total: target.result.total,
    dc: req.dc,
    ability: 'CON',
    outcome: saved ? 'saved' : 'failed',
    source: target.result.by === 'dm' ? 'dm' : 'player',
    sourceName: target.result.by === 'dm' ? undefined : target.result.by,
  });
  if (!saved) await store.setConcentration(combatantId, null);
}
