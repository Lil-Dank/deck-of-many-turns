import { useState } from 'react';
import type { SaveRequest, ThrowTarget } from '../../main/saveRequests';
import { useI18n } from './i18n';

/**
 * One row per target of a saving throw: roll it digitally with that creature's
 * own modifier, or type a physically rolled total.
 *
 * A row can also be answered somewhere else. When the target is a PC whose
 * phone is connected, that phone is prompted at the same time and the row reads
 * "waiting for Darius…" until one of them commits — first answer wins, per row,
 * so on an area save the DM keeps adjudicating the monsters while the players
 * fill in their own. An answered row locks and says who threw it.
 */
export function SaveThrowRows({
  req,
  onAnswer,
}: {
  req: SaveRequest;
  /** Commit one row. Returns false when someone else got there first. */
  onAnswer: (combatantId: string, die: number | null, total: number) => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState<Record<string, string>>({});

  const roll = (target: ThrowTarget) => {
    const die = Math.floor(Math.random() * 20) + 1;
    onAnswer(target.combatantId, die, die + (target.mod ?? 0));
  };

  const commitTyped = (target: ThrowTarget) => {
    const n = parseInt(typed[target.combatantId] ?? '', 10);
    if (!Number.isFinite(n)) return;
    onAnswer(target.combatantId, null, n);
  };

  return (
    <table className="pw-save-table">
      <tbody>
        {req.targets.map((target) => {
          const done = target.result;
          return (
            <tr key={target.combatantId} className={done ? 'answered' : ''}>
              <td>{target.name}</td>
              {done ? (
                <>
                  <td colSpan={2} className="tnum">
                    {done.die !== null && <span className="muted">(d20: {done.die}) </span>}
                    <strong>{done.total}</strong>{' '}
                    <span className="muted">{t('save.answeredBy', { who: done.by })}</span>
                  </td>
                  <td>
                    {done.total >= req.dc ? (
                      <span className="pw-online">✓ {t('pw.saveSaved')}</span>
                    ) : (
                      <span className="pw-error">✗ {t('pw.saveFailed')}</span>
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td>
                    <button className="btn small" onClick={() => roll(target)}>
                      🎲 {target.mod !== null && (target.mod >= 0 ? `+${target.mod}` : target.mod)}
                    </button>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="pw-save-input"
                      value={typed[target.combatantId] ?? ''}
                      placeholder="…"
                      onChange={(e) =>
                        setTyped((r) => ({ ...r, [target.combatantId]: e.target.value }))
                      }
                      onBlur={() => commitTyped(target)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitTyped(target);
                      }}
                    />
                  </td>
                  <td>
                    {target.awaiting && (
                      <span className="muted">{t('save.waitingFor', { who: target.awaiting })}</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
