import type { SaveRequest } from '../../main/saveRequests';
import { api } from './api';
import { useI18n } from './i18n';
import { SaveThrowRows } from './SaveThrowRows';

/**
 * A saving throw is owed and the DM did not start it — a concentration check
 * after damage, or a save a phone or the deck put on the table.
 *
 * It always appears, even when nobody could have been prompted. Concentration
 * checks used to be raised inside the player-web server, so an unclaimed PC or
 * a switched-off server dropped them silently and the spell just stayed up.
 *
 * Styled urgent on purpose: this arrives unbidden, mid-something-else, and the
 * fight waits on it.
 */
export function SaveRequestModal({
  req,
  pending,
  onDismiss,
}: {
  req: SaveRequest;
  /** How many more requests are queued behind this one. */
  pending: number;
  onDismiss: (req: SaveRequest) => void;
}) {
  const { t, abilityCode } = useI18n();
  const isConc = req.kind === 'concentration';
  // Concentration's attackName is the log label, "Concentration (Bless)" — the
  // heading wants the spell on its own so it does not read doubled.
  const spell = req.spellName ?? req.attackName;

  const answer = (combatantId: string, die: number | null, total: number) => {
    void api.resolveSaveThrow(req.id, combatantId, { die, total, by: 'dm' });
  };

  return (
    <div className="modal-backdrop urgent">
      <div className="modal urgent" onClick={(e) => e.stopPropagation()}>
        <h2>
          {isConc
            ? t('save.concTitle', { spell })
            : t('save.title', { attack: spell, ability: abilityCode(req.ability) })}
        </h2>
        <p className="muted">
          {isConc
            ? t('save.concInfo', {
                actor: req.targets[0]?.name ?? '',
                damage: req.damage ?? 0,
                dc: req.dc,
                spell,
              })
            : t('save.info', { dc: req.dc })}
        </p>
        <SaveThrowRows req={req} onAnswer={answer} />
        {pending > 0 && <p className="muted tnum">{t('save.more', { count: pending })}</p>}
        <footer className="modal-actions">
          <button className="btn" onClick={() => onDismiss(req)}>
            {t('save.dismiss')}
          </button>
        </footer>
      </div>
    </div>
  );
}
