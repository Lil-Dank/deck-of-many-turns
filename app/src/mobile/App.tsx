import { useEffect, useMemo, useRef, useState } from 'react';
import {
  abilityCodeLabel,
  abilityLabels,
  conditionLabel,
  damageTypeLabel,
  spellComponents,
  spellField,
  spellLevelLabel,
  spellSchoolLabel,
  translate,
  DAMAGE_TYPE_DE,
  type Lang,
} from '../shared/i18n';
import { displayDice, formatDice, parseDice, type RollMode } from '../shared/dice';
import {
  damageTypeSegments,
  logEntrySegments,
  logEntryText,
  rollMathSegments,
} from '../shared/logText';
import type { LogEntry, MonsterAction, SpellSlots } from '../shared/types';
import { ABILITY_KEYS, abilityMod } from '../shared/types';
import { formToAction, actionToForm, emptyAction, ABILITIES, type ActionForm } from '../renderer/src/actionForm';
import { spellToAction, spellActionName, spellActionText } from '../shared/spellAction';
import type {
  ArchiveEntryMsg,
  AttackResultMsg,
  AttackRollResultMsg,
  ThrowPromptMsg,
  ThrowResultMsg,
  DamageResultMsg,
  HealResultMsg,
  SavePendingMsg,
  SaveResolvedMsg,
  StateMsg,
  WireCombatant,
  WireSpell,
} from './protocol';
import { PlayerSocket, deviceToken } from './ws';
import { uuid } from '../shared/uuid';
import { DamageEditor } from '../components/DamageEditor';
import { Icon } from '../components/Icon';
import type { IconName } from '../shared/icons';
import { LogCards } from '../components/LogCards';

type View =
  | { id: 'home' }
  | { id: 'hp'; mode: 'damage' | 'heal' }
  | { id: 'attack' }
  | { id: 'myAttacks' }
  | { id: 'spellbook' }
  | { id: 'log' }
  | { id: 'archive' };

/** Rollable actions: attacks, damaging saves — and every spell snapshot
 * (healing and utility spells cast from the same flow). */
const rollable = (a: MonsterAction) =>
  a.spell != null || a.type === 'attack' || (a.type === 'save' && a.onHit.damage.length > 0);

export function App() {
  const [state, setState] = useState<StateMsg | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<View>({ id: 'home' });
  const [toast, setToast] = useState<string | null>(null);
  const [attackMsg, setAttackMsg] = useState<AttackResultMsg | SaveResolvedMsg | null>(null);
  const [atkRollMsg, setAtkRollMsg] = useState<AttackRollResultMsg | null>(null);
  const [dmgMsg, setDmgMsg] = useState<DamageResultMsg | null>(null);
  const [savePendingMsg, setSavePendingMsg] = useState<SavePendingMsg | null>(null);
  const [waitingSave, setWaitingSave] = useState(false);
  const [archiveEntry, setArchiveEntry] = useState<ArchiveEntryMsg | null>(null);
  const [healMsg, setHealMsg] = useState<HealResultMsg | null>(null);
  /** Session cache of the on-demand spellbook reference. */
  const [spellList, setSpellList] = useState<WireSpell[] | null>(null);
  /** Pending Concentration checks (queued: several hits, several saves). */
  const [throwQueue, setThrowQueue] = useState<ThrowPromptMsg[]>([]);
  const [throwResult, setThrowResult] = useState<ThrowResultMsg | null>(null);
  const socketRef = useRef<PlayerSocket | null>(null);

  const lang: Lang = state?.language ?? 'en';
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

  useEffect(() => {
    const socket = new PlayerSocket((msg) => {
      switch (msg.type) {
        case 'state':
          setState(msg);
          break;
        case 'attackResult':
          setAttackMsg(msg);
          break;
        case 'attackRollResult':
          setAtkRollMsg(msg);
          break;
        case 'damageResult':
          setDmgMsg(msg);
          break;
        case 'savePending':
          setWaitingSave(true);
          setSavePendingMsg(msg);
          break;
        case 'saveResolved':
          setWaitingSave(false);
          setAttackMsg(msg);
          break;
        case 'archiveEntry':
          setArchiveEntry(msg);
          break;
        case 'spellList':
          setSpellList(msg.spells);
          break;
        case 'healResult':
          setHealMsg(msg);
          break;
        case 'castResult':
          // Slot spend confirmed; the state push updates the pips.
          break;
        case 'throwPrompt':
          setThrowQueue((q) => [...q, msg]);
          break;
        case 'throwResult':
          // cancelled = the DM (or another surface) answered it first.
          if (msg.cancelled) {
            setThrowQueue((q) => q.filter((x) => x.id !== msg.id));
            setThrowResult((r) => (r?.id === msg.id ? null : r));
          } else {
            setThrowResult(msg);
          }
          break;
        case 'kicked':
          setToast('mob.kicked');
          setView({ id: 'home' });
          break;
        case 'error':
          setToast(`mob.err.${msg.code}`);
          break;
        default:
          break;
      }
    }, setConnected);
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    // Phones have no devtools: surface uncaught errors instead of dying
    // silently. (translate() falls through to the raw text for non-keys.)
    const onError = (e: ErrorEvent) => setToast(e.message || 'mob.err.generic');
    const onReject = (e: PromiseRejectionEvent) => setToast(String(e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onReject);
    };
  }, []);

  const send = (msg: Record<string, unknown>) =>
    socketRef.current?.send({ ...msg, token: deviceToken() });

  if (!state) {
    const guess: Lang = navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
    return <div className="center muted">{translate(guess, 'mob.connecting')}</div>;
  }

  const you = state.you;
  const gatingHint = !state.myTurn && state.combatActive && you?.combatantId
    ? state.gating === 'relaxed'
      ? 'mob.offTurnRelaxed'
      : 'mob.notYourTurn'
    : null;
  const canAct = state.myTurn;
  const canSelfHp = state.myTurn || state.gating === 'relaxed';

  return (
    <div className="mob">
      {!connected && <div className="banner offline">{t('mob.disconnected')}</div>}
      {toast && <div className="toast">{t(toast)}</div>}

      {!you ? (
        <ClaimScreen state={state} t={t} send={send} />
      ) : (
        <>
          <header className="mob-header">
            <div className="mob-title">
              <strong>{you.name}</strong>
              {state.combatActive && (
                <span className="round">{t('log.round', { round: state.round })}</span>
              )}
            </div>
            <button className="linkish" onClick={() => send({ type: 'release' })}>
              {t('mob.release')}
            </button>
          </header>

          {state.combatActive && (
            <div className={`turn-banner ${state.myTurn ? 'mine' : ''}`}>
              {state.myTurn && <Icon name="swords" size={18} />}
              {t(state.myTurn ? 'mob.yourTurn' : gatingHint ?? 'mob.notYourTurn')}
            </div>
          )}

          {view.id === 'home' && (
            <>
              {state.combatActive ? (
                <InitiativeList state={state} t={t} lang={lang} />
              ) : (
                <CharacterCard
                  state={state}
                  t={t}
                  lang={lang}
                  send={send}
                  onSpellbook={() => setView({ id: 'spellbook' })}
                  onActions={() => setView({ id: 'myAttacks' })}
                />
              )}
              <LogPeek state={state} lang={lang} onOpen={() => setView({ id: 'log' })} />
              <nav className="action-bar">
                <button
                  disabled={!state.combatActive || (!canAct && !canSelfHp)}
                  onClick={() => setView({ id: 'hp', mode: 'damage' })}
                >
                  <Icon name="burst" size={19} />
                  {t('mob.damage')}
                </button>
                <button
                  disabled={!state.combatActive || (!canAct && !canSelfHp)}
                  onClick={() => setView({ id: 'hp', mode: 'heal' })}
                >
                  <Icon name="plus" size={19} />
                  {t('mob.heal')}
                </button>
                <button
                  disabled={!state.combatActive || !canAct || you.attacks.filter(rollable).length === 0}
                  onClick={() => setView({ id: 'attack' })}
                >
                  <Icon name="swords" size={19} />
                  {t('mob.attack')}
                </button>
                {/* Navigation, not an action: no icon, and the ellipsis says
                    there is more behind it. */}
                <button className="ghost" onClick={() => setView({ id: 'myAttacks' })}>
                  {t('mob.myAttacksMore')}
                </button>
              </nav>
            </>
          )}

          {view.id === 'hp' && (
            <HpFlow
              state={state}
              t={t}
              mode={view.mode}
              selfOnly={!state.myTurn}
              onDone={(targets, amount) => {
                send({
                  type: view.mode === 'damage' ? 'applyDamage' : 'applyHeal',
                  targets,
                  amount,
                });
                setView({ id: 'home' });
              }}
              onCancel={() => setView({ id: 'home' })}
            />
          )}

          {view.id === 'attack' && (
            <AttackFlow
              state={state}
              t={t}
              send={send}
              result={attackMsg}
              atkRoll={atkRollMsg}
              dmgResult={dmgMsg}
              savePending={savePendingMsg}
              healResult={healMsg}
              waiting={waitingSave}
              clearResult={() => setAttackMsg(null)}
              onClose={() => {
                setAttackMsg(null);
                setAtkRollMsg(null);
                setDmgMsg(null);
                setSavePendingMsg(null);
                setHealMsg(null);
                setWaitingSave(false);
                setView({ id: 'home' });
              }}
            />
          )}

          {view.id === 'myAttacks' && (
            <MyAttacks
              state={state}
              t={t}
              send={send}
              spellList={spellList}
              onArchive={() => setView({ id: 'archive' })}
              onSpellbook={() => setView({ id: 'spellbook' })}
              onClose={() => setView({ id: 'home' })}
            />
          )}

          {view.id === 'spellbook' && (
            <SpellbookSheet
              t={t}
              lang={lang}
              send={send}
              spellList={spellList}
              onClose={() => setView({ id: 'home' })}
            />
          )}

          {view.id === 'log' && (
            <Sheet title={t('mob.logTitle')} onClose={() => setView({ id: 'home' })} t={t}>
              <LogList
                log={state.log}
                lang={lang}
                onThrowDeferred={(entry) => send({ type: 'throwRetry', entryId: entry.id })}
              />
            </Sheet>
          )}

          {view.id === 'archive' && (
            <Sheet title={t('mob.archive')} onClose={() => setView({ id: 'myAttacks' })} t={t}>
              {archiveEntry ? (
                <>
                  <button className="sheet-back" onClick={() => setArchiveEntry(null)}>
                    {t('common.back')}
                  </button>
                  <h3>
                    {archiveEntry.templateName}{' '}
                    <span className="muted">
                    {archiveEntry.rounds === 1
                      ? t('mob.roundsOne')
                      : t('mob.rounds', { rounds: archiveEntry.rounds })}
                  </span>
                  </h3>
                  <LogList log={archiveEntry.log} lang={lang} />
                </>
              ) : state.archive.length === 0 ? (
                <p className="muted">{t('mob.archiveEmpty')}</p>
              ) : (
                <ul className="archive-list">
                  {state.archive.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => send({ type: 'getArchive', archiveId: a.id })}>
                        <strong>{a.templateName}</strong>
                        <span className="muted">
                          {new Date(a.endedAt).toLocaleDateString(
                            state.language === 'de' ? 'de-DE' : 'en-US',
                          )}{' '}
                          · {a.rounds === 1 ? t('mob.roundsOne') : t('mob.rounds', { rounds: a.rounds })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Sheet>
          )}

          {throwQueue.length > 0 && (
            <ThrowPromptOverlay
              msg={throwQueue[0]}
              result={throwResult?.id === throwQueue[0].id ? throwResult : null}
              pending={throwQueue.length - 1}
              lang={lang}
              t={t}
              send={send}
              onDone={() => {
                setThrowQueue((q) => q.slice(1));
                setThrowResult(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---- saving throws you can answer -------------------------------------------

/**
 * A saving throw is owed and you can answer it: the Constitution check that
 * keeps a spell after damage, or an ordinary save the DM or the deck aimed at
 * you. Rolls digitally (d20 + your modifier) or takes a manually rolled total,
 * with the hint of what to throw.
 *
 * The DM is prompted for the same throw at the same time and can answer it if
 * the player is stuck — that arrives here as a `cancelled` result and takes the
 * sheet away. Unskippable while it is yours to answer: the fight waits on it.
 */
function ThrowPromptOverlay({
  msg,
  result,
  pending,
  lang,
  t,
  send,
  onDone,
}: {
  msg: ThrowPromptMsg;
  result: ThrowResultMsg | null;
  /** How many more throws are queued behind this one. */
  pending: number;
  lang: Lang;
  t: (k: string, p?: Record<string, string | number>) => string;
  send: (m: Record<string, unknown>) => void;
  onDone: () => void;
}) {
  const [manual, setManual] = useState(false);
  const [total, setTotal] = useState('');
  const [sent, setSent] = useState(false);
  // The dice have to be in the air for a beat or the roll has no weight. Same
  // recipe as AttackFlow's fireDigitalSave: hold the result until BOTH the
  // tumble has run its course and the server has answered.
  const [tumbling, setTumbling] = useState(false);
  const [tumbleDone, setTumbleDone] = useState(false);
  const isConc = msg.kind === 'concentration';
  // attackName is the log label, "Concentration (Bless)". The heading wants the
  // spell on its own next to the \u24b8 glyph.
  const spell = msg.spellName ?? msg.attackName;
  const title = isConc ? `\u24b8 ${spell}` : msg.attackName;
  const modStr = msg.mod === null ? '' : ` ${msg.mod >= 0 ? '+' : '\u2212'}${Math.abs(msg.mod)}`;

  if (tumbling && !(tumbleDone && result)) {
    return (
      <Sheet title={title} onClose={() => undefined} t={t} noBack>
        <RollingDice label={t('mob.rolling')} sizes={[20]} />
      </Sheet>
    );
  }

  if (result) {
    return (
      <Sheet title={title} onClose={onDone} t={t}>
        <div className="result">
          {result.die != null && <DiceValues dice={[result.die]} size={80} settled />}
          <div className={`verdict ${result.saved ? 'hit' : 'miss'}`}>
            {isConc
              ? t(result.saved ? 'mob.concKept' : 'mob.concLost', { spell })
              : t(result.saved ? 'mob.throwSaved' : 'mob.throwFailed')}
          </div>
          <p className="atk-math tnum">
            {result.total} {t('mob.concVs', { dc: result.dc ?? msg.dc })}
          </p>
          <button className="big primary" onClick={onDone}>
            {t('mob.done')}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={title}
      // Backing out is not skipping it: the throw becomes a card in the log
      // that this character (or the DM) can pick up whenever they are ready.
      onClose={() => {
        setSent(true);
        send({ type: 'throwDefer', id: msg.id });
      }}
      t={t}
    >
      <p className="conc-info">
        {isConc
          ? t('mob.concInfo', { damage: msg.damage ?? 0, dc: msg.dc, spell })
          : t('mob.throwInfo', {
              ability: abilityCodeLabel(lang, msg.ability),
              dc: msg.dc,
              actor: msg.attackerName ?? msg.attackName,
            })}
      </p>
      {pending > 0 && <p className="muted tnum">{t('mob.throwMore', { count: pending })}</p>}
      <div className="mode-toggle">
        <button className={manual ? '' : 'selected'} onClick={() => setManual(false)}>
          {t('mob.digital')}
        </button>
        <button className={manual ? 'selected' : ''} onClick={() => setManual(true)}>
          {t('mob.manual')}
        </button>
      </div>
      {!manual ? (
        <button
          className="big primary"
          disabled={sent}
          onClick={() => {
            setSent(true);
            setTumbling(true);
            setTumbleDone(false);
            setTimeout(() => setTumbleDone(true), 3000);
            send({ type: 'throwDigital', id: msg.id });
          }}
        >
          🎲 {displayDice(lang, 'd20')}
          {modStr}
        </button>
      ) : (
        <div className="manual-entry">
          <label>
            {t('mob.d20Total')}
            <span className="roll-hint tnum">
              🎲 {displayDice(lang, 'd20')}
              {modStr}
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </label>
          <button
            className="big primary"
            disabled={sent || total.trim() === ''}
            onClick={() => {
              setSent(true);
              send({ type: 'throwManual', id: msg.id, total: parseInt(total, 10) || 0 });
            }}
          >
            {t('mob.resolve')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---- claim ------------------------------------------------------------------

function ClaimScreen({
  state,
  t,
  send,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  send: (msg: Record<string, unknown>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const pc = state.claims.find((c) => c.pcId === selected);

  return (
    <div className="claim">
      <h1>{t('mob.pickPc')}</h1>
      <ul className="claim-list">
        {state.claims.map((c) => (
          <li key={c.pcId}>
            <button
              className={`claim-pc ${selected === c.pcId ? 'selected' : ''} ${c.taken ? 'taken' : ''}`}
              disabled={c.taken}
              onClick={() => setSelected(c.pcId)}
            >
              <strong>{c.name}</strong>
              {c.taken && (
                <span className="muted">
                  {t('mob.taken')}
                  {c.playerName ? ` · ${c.playerName}` : ''}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {pc && (
        <div className="claim-join">
          <label>
            {t('mob.yourName')}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
          <button
            className="big primary"
            onClick={() => send({ type: 'claim', pcId: pc.pcId, playerName: name })}
          >
            {t('mob.join', { name: pc.name })}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- character card (home, no combat) ---------------------------------------

function PhoneSlotPips({ slots }: { slots: SpellSlots | null }) {
  if (!slots) return null;
  const groups = slots.max
    .map((max, i) => ({ level: i + 1, max, current: slots.current[i] ?? 0 }))
    .filter((g) => g.max > 0);
  if (!groups.length) return null;
  return (
    <div className="card-slots">
      {groups.map((g) => (
        <span key={g.level} className="card-slot tnum">
          <b>L{g.level}</b>{' '}
          {g.max <= 6 ? '●'.repeat(g.current) + '○'.repeat(g.max - g.current) : `${g.current}/${g.max}`}
        </span>
      ))}
    </div>
  );
}

/**
 * The between-sessions view of your character: stats, notes, spell slots and
 * the spellbook — a tidy sheet instead of the old "no combat" shrug.
 */
function CharacterCard({
  state,
  t,
  lang,
  send,
  onSpellbook,
  onActions,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  lang: Lang;
  send: (msg: Record<string, unknown>) => void;
  onSpellbook: () => void;
  onActions: () => void;
}) {
  const you = state.you!;
  const [restArmed, setRestArmed] = useState(false);
  useEffect(() => {
    if (!restArmed) return;
    const id = setTimeout(() => setRestArmed(false), 3000);
    return () => clearTimeout(id);
  }, [restArmed]);

  return (
    <div className="char-card">
      <p className="muted card-idle">{t('mob.noCombat')}</p>
      <div className="card-stats tnum">
        <span>
          <b>{t('common.maxHp')}</b> {you.maxHp}
        </span>
        <span>
          <b>{t('common.ac')}</b> {you.ac}
        </span>
        <span>
          <b>{t('common.initMod')}</b> {you.initMod >= 0 ? `+${you.initMod}` : you.initMod}
        </span>
      </div>
      {you.abilities && (
        <div className="you-stats card-abilities">
          {ABILITY_KEYS.map((k) => {
            const score = you.abilities![k];
            const mod = abilityMod(score);
            return (
              <span key={k} className="you-stat tnum">
                <b>{abilityLabels(lang)[k]}</b> {score} ({mod >= 0 ? `+${mod}` : mod})
              </span>
            );
          })}
        </div>
      )}
      {you.notes && <div className="you-notes card-notes">{you.notes}</div>}
      <PhoneSlotPips slots={you.spellSlots} />
      <div className="card-actions">
        <button className="big" onClick={onActions}>
          {t('mob.myAttacksMore')}
        </button>
        <button className="big" onClick={onSpellbook}>
          <Icon name="book" size={18} />
          {t('spellbook.title')}
        </button>
        {you.spellSlots && (
          <button
            className={`big ${restArmed ? 'primary' : ''}`}
            onClick={() => {
              if (restArmed) {
                send({ type: 'longRest' });
                setRestArmed(false);
              } else {
                setRestArmed(true);
              }
            }}
          >
            {restArmed ? `🛌 ${t('mob.longRestConfirm')}` : t('pcs.longRest')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- spellbook reference -----------------------------------------------------

/**
 * The table spellbook: every spell the DM has imported (no class filter, on
 * purpose — browse what you might prepare tomorrow). Fetched once per
 * session, full rules text readable at the table.
 */
function SpellbookSheet({
  t,
  lang,
  send,
  spellList,
  onClose,
}: {
  t: (k: string, p?: Record<string, string | number>) => string;
  lang: Lang;
  send: (msg: Record<string, unknown>) => void;
  spellList: WireSpell[] | null;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!spellList) send({ type: 'getSpells' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locName = (s: WireSpell) => (lang === 'de' && s.l10n?.de?.name ? s.l10n.de.name : s.name);
  const locText = (s: WireSpell) => (lang === 'de' && s.l10n?.de?.text ? s.l10n.de.text : s.text);
  const list = (spellList ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      locName(s).toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Sheet title={t('spellbook.title')} icon="book" onClose={onClose} t={t}>
      {!spellList ? (
        <p className="muted">{t('mob.connecting')}</p>
      ) : spellList.length === 0 ? (
        <p className="muted">{t('spellbook.empty')}</p>
      ) : (
        <>
          <input
            className="spell-search"
            placeholder={t('spellbook.search')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="attack-list spell-list">
            {list.map((s) => (
              <li key={s.id}>
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                  <strong>
                    {locName(s)}
                    {s.concentration && <span className="muted"> {lang === 'de' ? 'Ⓚ' : 'Ⓒ'}</span>}
                  </strong>
                  <span className="muted">
                    {spellLevelLabel(lang, s.level)} · {spellSchoolLabel(lang, s.school)}
                  </span>
                </button>
                {openId === s.id && (
                  <div className="spell-detail">
                    <p className="muted spell-detail-head">
                      {spellField(lang, s.castingTime)} · {spellField(lang, s.range)} ·{' '}
                      {spellComponents(lang, s.components)} · {spellField(lang, s.duration)}
                      {s.ritual && ` · ${t('spellbook.ritual')}`}
                    </p>
                    <p className="spell-detail-text">{locText(s)}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

// ---- initiative ------------------------------------------------------------

function InitiativeList({
  state,
  t,
  lang,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  lang: Lang;
}) {
  return (
    <ul className="init-list">
      {state.combatants.map((c) => (
        <li
          key={c.id}
          className={`init-row ${c.type} ${c.isCurrentTurn ? 'current' : ''} ${
            c.id === state.you?.combatantId ? 'me' : ''
          } ${c.isDowned ? 'downed' : ''}`}
        >
          <div className="init-main">
            <span className="init-name">
              {c.isCurrentTurn && '▶ '}
              {c.name}
            </span>
            <span className="init-status">
              {c.type === 'pc' && c.currentHp !== undefined && (
                <span className="hp">
                  {c.isDowned ? t('pv.downed') : `${c.currentHp}/${c.maxHp}`}
                </span>
              )}
              {c.type === 'monster' && c.isBloodied && (
                <span className="bloodied">🩸 {t('pv.bloodied')}</span>
              )}
            </span>
          </div>
          {(c.conditions.length > 0 || c.concentration) && (
            <div className="init-conditions">
              {c.conditions.map((cond) => (
                <span key={cond} className="chip">
                  {conditionLabel(lang, cond)}
                </span>
              ))}
              {c.concentration && (
                <span className="chip conc-chip">
                  {t('spellbook.concentration')} (
                  {lang === 'de' && c.concentration.deName
                    ? c.concentration.deName
                    : c.concentration.name}
                  )
                </span>
              )}
            </div>
          )}
          {c.id === state.you?.combatantId && state.you.abilities && (
            <div className="you-stats">
              {ABILITY_KEYS.map((k) => {
                const score = state.you!.abilities![k];
                const mod = abilityMod(score);
                return (
                  <span key={k} className="you-stat tnum">
                    <b>{abilityLabels(lang)[k]}</b> {score} ({mod >= 0 ? `+${mod}` : mod})
                  </span>
                );
              })}
            </div>
          )}
          {c.id === state.you?.combatantId && state.you.notes && (
            <div className="you-notes">{state.you.notes}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- damage / heal ----------------------------------------------------------

function HpFlow({
  state,
  t,
  mode,
  selfOnly,
  onDone,
  onCancel,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  mode: 'damage' | 'heal';
  selfOnly: boolean;
  onDone: (targets: string[], amount: number) => void;
  onCancel: () => void;
}) {
  const [targets, setTargets] = useState<string[]>(
    selfOnly && state.you?.combatantId ? [state.you.combatantId] : [],
  );
  const [amount, setAmount] = useState('');

  const toggle = (id: string) =>
    setTargets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  const parsed = parseInt(amount, 10);
  const valid = targets.length > 0 && Number.isInteger(parsed) && parsed >= 1 && parsed <= 999;

  return (
    <Sheet title={t(`mob.${mode}`)} icon={mode === 'damage' ? 'burst' : 'plus'} onClose={onCancel} t={t}>
      <h3>{t('mob.pickTargets')}</h3>
      <div className="target-grid">
        {state.combatants
          .filter((c) => !selfOnly || c.id === state.you?.combatantId)
          .map((c) => (
            <button
              key={c.id}
              className={`target ${c.type} ${targets.includes(c.id) ? 'selected' : ''}`}
              onClick={() => toggle(c.id)}
            >
              {c.name}
            </button>
          ))}
      </div>
      <label className="amount-label">
        {t('mob.amount')}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </label>
      <div className="quick-amounts">
        {[1, 5, 10].map((n) => (
          <button key={n} onClick={() => setAmount(String((parseInt(amount, 10) || 0) + n))}>
            +{n}
          </button>
        ))}
        <button onClick={() => setAmount('')}>{t('mob.clear')}</button>
      </div>
      <button className="big primary" disabled={!valid} onClick={() => onDone(targets, parsed)}>
        {t('mob.apply')}
      </button>
    </Sheet>
  );
}

// ---- attack flow ------------------------------------------------------------

function AttackFlow({
  state,
  t,
  send,
  result,
  atkRoll,
  dmgResult,
  savePending,
  healResult,
  waiting,
  clearResult,
  onClose,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  send: (msg: Record<string, unknown>) => void;
  result: AttackResultMsg | SaveResolvedMsg | null;
  atkRoll: AttackRollResultMsg | null;
  dmgResult: DamageResultMsg | null;
  savePending: SavePendingMsg | null;
  healResult: HealResultMsg | null;
  waiting: boolean;
  clearResult: () => void;
  onClose: () => void;
}) {
  const you = state.you!;
  const [attack, setAttack] = useState<MonsterAction | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [d20, setD20] = useState('');
  const [natural, setNatural] = useState<20 | 1 | null>(null);
  const [damage, setDamage] = useState('');
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  // Spell casts: the chosen slot level (null = cantrip / not a spell), and
  // whether the slot step has been passed.
  const [slotLevel, setSlotLevel] = useState<number | null>(null);
  const [slotChosen, setSlotChosen] = useState(false);
  // Split digital flow: tumble → the dice settle on their numbers → the
  // verdict builds around them → damage tumbles and settles in place.
  // Save-based digital rolls ride the same phases with their damage dice.
  const [phase, setPhase] = useState<
    'form' | 'tumbling' | 'settled' | 'verdict' | 'dmgTumbling' | 'dmgSettled'
  >('form');
  const [tumbleDone, setTumbleDone] = useState(false);

  const attacks = useMemo(() => you.attacks.filter(rollable), [you.attacks]);
  const isSave = attack ? attack.type === 'save' || attack.save !== null : false;
  const isHeal = attack?.spell?.healing === true;
  const isUtility =
    attack != null && attack.spell != null && !isHeal && attack.type === 'other' &&
    attack.onHit.damage.length === 0;
  const needsSlot = attack?.spell != null && attack.spell.level > 0;
  /** Upcast dice added by the chosen slot ("+2d6"), for hints and animations. */
  const upcastDice = useMemo(() => {
    const meta = attack?.spell;
    if (!meta?.upcast || slotLevel === null || slotLevel <= meta.level) return null;
    return { count: meta.upcast.count * (slotLevel - meta.level), die: meta.upcast.die };
  }, [attack, slotLevel]);

  // One animated die per damage die of the attack (capped to stay readable).
  const dmgDiceSizes = useMemo(() => {
    if (!attack) return [6];
    const sizes: number[] = [];
    for (const d of attack.onHit.damage) {
      if (d.condition || !d.count || !d.die) continue;
      for (let i = 0; i < d.count && sizes.length < 12; i++) sizes.push(d.die);
    }
    if (upcastDice) {
      for (let i = 0; i < upcastDice.count && sizes.length < 12; i++) sizes.push(upcastDice.die);
    }
    return sizes.length > 0 ? sizes : [6];
  }, [attack, upcastDice]);

  // The tumble ends AND the server result is in → settle on the numbers.
  useEffect(() => {
    if (phase !== 'tumbling' || !tumbleDone) return;
    if (atkRoll) setPhase('settled');
    else if (savePending) setPhase(savePending.rolls?.length ? 'settled' : 'verdict');
    else if (healResult) setPhase(healResult.rolls?.length ? 'settled' : 'verdict');
  }, [phase, tumbleDone, atkRoll, savePending, healResult]);

  // Hold the settled number for a beat, then build the verdict around it.
  useEffect(() => {
    if (phase !== 'settled') return;
    const id = setTimeout(() => setPhase('verdict'), 950);
    return () => clearTimeout(id);
  }, [phase]);

  // Damage tumble ends AND the damage arrived → settle on the rolled dice.
  useEffect(() => {
    if (phase === 'dmgTumbling' && tumbleDone && dmgResult) setPhase('dmgSettled');
  }, [phase, tumbleDone, dmgResult]);

  // Hold the settled damage dice, then show breakdown and total.
  useEffect(() => {
    if (phase !== 'dmgSettled') return;
    const id = setTimeout(() => setPhase('verdict'), 950);
    return () => clearTimeout(id);
  }, [phase]);

  const toggleTarget = (id: string) => {
    if (isSave) {
      setTargets((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));
    } else {
      setTargets([id]);
    }
  };

  // Every cast command carries the chosen slot level (undefined = cantrip);
  // the server validates and spends it.
  const slot = slotLevel ?? undefined;

  // Save-based actions: one shot (the DM adjudicates), but the roller still
  // gets the damage-dice reveal before the waiting screen.
  const fireDigitalSave = () => {
    setPhase('tumbling');
    setTumbleDone(false);
    setTimeout(() => setTumbleDone(true), 3000);
    send({ type: 'attackDigital', attackId: attack!.id, targetIds: targets, slotLevel: slot });
  };

  const fireAttackRoll = () => {
    setPhase('tumbling');
    setTumbleDone(false);
    setTimeout(() => setTumbleDone(true), 3000);
    send({
      type: 'attackRollDigital',
      attackId: attack!.id,
      targetIds: targets,
      advantage: rollMode === 'normal' ? undefined : rollMode,
      slotLevel: slot,
    });
  };

  const fireDamageRoll = () => {
    setPhase('dmgTumbling');
    setTumbleDone(false);
    setTimeout(() => setTumbleDone(true), 2200);
    send({ type: 'damageRollDigital', attackId: attack!.id, targetIds: targets, slotLevel: slot });
  };

  const fireHealDigital = () => {
    setPhase('tumbling');
    setTumbleDone(false);
    setTimeout(() => setTumbleDone(true), 2200);
    send({ type: 'castHealDigital', attackId: attack!.id, targetIds: targets, slotLevel: slot });
  };

  const fireHealManual = () => {
    send({
      type: 'castHealManual',
      attackId: attack!.id,
      targetIds: targets,
      amount: parseInt(damage, 10) || 0,
      slotLevel: slot,
    });
    onClose();
  };

  const fireUtilityCast = () => {
    send({ type: 'castSpell', attackId: attack!.id, slotLevel: slot });
    onClose();
  };

  const fireManual = () => {
    if (isSave) {
      send({
        type: 'attackManual',
        attackId: attack!.id,
        targetIds: targets,
        damage: parseInt(damage, 10) || 0,
        slotLevel: slot,
      });
      return;
    }
    send({
      type: 'attackManual',
      attackId: attack!.id,
      targetIds: targets,
      d20Total: parseInt(d20, 10) || 0,
      natural: natural ?? undefined,
      damage: parseInt(damage, 10) || 0,
      slotLevel: slot,
    });
  };

  // The dice are in the air: the result stays hidden until the tumble ends.
  if (phase === 'tumbling') {
    return (
      <Sheet title={(attack ? spellActionName(state.language, attack) : t('mob.attack'))} onClose={onClose} t={t}>
        <RollingDice
          label={t('mob.rolling')}
          sizes={isSave || isHeal ? dmgDiceSizes : rollMode !== 'normal' ? [20, 20] : [20]}
        />
      </Sheet>
    );
  }

  // The dice settle on their numbers and hold a beat before the verdict.
  if (phase === 'settled' && (atkRoll || savePending || healResult)) {
    const dice = atkRoll ? atkRoll.dice : (savePending?.rolls ?? healResult?.rolls ?? []);
    return (
      <Sheet title={(attack ? spellActionName(state.language, attack) : t('mob.attack'))} onClose={onClose} t={t}>
        <div className="rolling">
          <DiceValues
            dice={dice}
            kept={atkRoll?.die}
            size={dice.length > 6 ? 44 : dice.length > 1 ? 76 : 96}
            settled
          />
        </div>
      </Sheet>
    );
  }

  // Healing verdict: the settled dice, the total restored, done.
  if (phase === 'verdict' && healResult) {
    return (
      <Sheet title={(attack ? spellActionName(state.language, attack) : t('mob.attack'))} onClose={onClose} t={t}>
        <div className="result">
          {healResult.rolls && healResult.rolls.length > 0 && (
            <DiceValues dice={healResult.rolls} size={healResult.rolls.length > 6 ? 44 : 58} />
          )}
          <div className="verdict heal">✚ {healResult.amount}</div>
          {healResult.math && (
            <p className="dmg-breakdown tnum">{displayDice(state.language, healResult.math)}</p>
          )}
          <p className="muted">{t('mob.healedTarget', { name: healResult.targetName })}</p>
          <button className="big primary" onClick={onClose}>
            {t('mob.done')}
          </button>
        </div>
      </Sheet>
    );
  }

  // The verdict builds around the settled dice, which stay put.
  if ((phase === 'verdict' || phase === 'dmgTumbling' || phase === 'dmgSettled') && atkRoll) {
    const bonus = atkRoll.total - atkRoll.die;
    const bonusStr = bonus === 0 ? '' : ` ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}`;
    return (
      <Sheet title={(attack ? spellActionName(state.language, attack) : t('mob.attack'))} onClose={onClose} t={t}>
        <div className="result">
          <DiceValues dice={atkRoll.dice} kept={atkRoll.die} size={atkRoll.dice.length > 1 ? 64 : 80} />
          <div className={`verdict ${atkRoll.outcome}`}>
            {t(`log.outcome.${atkRoll.outcome}`)}
          </div>
          <p className="atk-math tnum">
            {atkRoll.die}
            {bonusStr} = <strong className="atk-total">{atkRoll.total}</strong>
          </p>
          <p className="muted">{atkRoll.targetName}</p>
          {phase === 'dmgTumbling' && (
            <RollingDice label={t('mob.rolling')} sizes={dmgDiceSizes} inline />
          )}
          {phase === 'dmgSettled' && dmgResult && (
            <div className="rolling inline">
              <DiceValues dice={dmgResult.rolls} size={dmgResult.rolls.length > 6 ? 44 : 58} settled />
            </div>
          )}
          {phase === 'verdict' && dmgResult && (
            <div className="dmg-detail">
              <p className="dmg-breakdown tnum">
                {rollMathSegments(
                  displayDice(state.language, dmgResult.math),
                  dmgResult.mathTypes,
                ).map((seg, i) =>
                  seg.cls ? (
                    <span key={i} className={seg.cls}>
                      {seg.text}
                    </span>
                  ) : (
                    seg.text
                  ),
                )}
              </p>
              <p className="dmg-total tnum">{dmgResult.damage}</p>
              <p className="muted">{t('mob.dmgDealtShort')}</p>
            </div>
          )}
          {phase === 'verdict' && (
            <>
              {atkRoll.outcome !== 'miss' && !dmgResult && (
                <button className="big primary" onClick={fireDamageRoll}>
                  {t('mob.rollDamage')}
                </button>
              )}
              <button
                className={`big ${atkRoll.outcome === 'miss' || dmgResult ? 'primary' : ''}`}
                onClick={onClose}
              >
                {t('mob.done')}
              </button>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  // Result view (single attack or resolved saves)
  if (result || waiting) {
    return (
      <Sheet title={(attack ? spellActionName(state.language, attack) : t('mob.attack'))} onClose={onClose} t={t}>
        {waiting && (
          <div className="result">
            {savePending?.rolls && savePending.rolls.length > 0 && (
              <DiceValues
                dice={savePending.rolls}
                size={savePending.rolls.length > 6 ? 44 : 58}
              />
            )}
            {savePending?.math && (
              <div className="dmg-detail">
                <p className="dmg-breakdown tnum">
                  {rollMathSegments(
                    displayDice(state.language, savePending.math),
                    savePending.mathTypes,
                  ).map((seg, i) =>
                    seg.cls ? (
                      <span key={i} className={seg.cls}>
                        {seg.text}
                      </span>
                    ) : (
                      seg.text
                    ),
                  )}
                </p>
                <p className="dmg-total tnum">{savePending.damage}</p>
              </div>
            )}
            <p className="waiting">{t('mob.waitingDm')}</p>
          </div>
        )}
        {result?.type === 'attackResult' && (
          <div className="result">
            <div className={`verdict ${result.outcome}`}>
              {t(`log.outcome.${result.outcome}`)}
            </div>
            <p>
              {result.targetName}
              {result.die !== null && ` · ${displayDice(state.language, 'd20')}: ${result.die}`}
              {` · ${result.total}`}
            </p>
            <p className="big-num">
              {result.damage !== null
                ? t('mob.dmgDealt', { damage: result.damage })
                : t('mob.noDamage')}
            </p>
            <button className="big primary" onClick={onClose}>
              {t('mob.done')}
            </button>
          </div>
        )}
        {result?.type === 'saveResolved' && (
          <div className="result">
            {result.cancelled ? (
              <p>{t('mob.cancelled')}</p>
            ) : (
              <ul className="save-results">
                {result.results.map((r) => (
                  <li key={r.targetId}>
                    <strong>{r.targetName}</strong>{' '}
                    <span className={r.saved ? 'save-ok' : 'save-fail'}>
                      {t(r.saved ? 'mob.savedHalf' : 'mob.failedFull')}
                    </span>{' '}
                    · <strong className="save-amount tnum">{r.amount}</strong>{' '}
                    {t('mob.dmgDealtShort')}
                  </li>
                ))}
              </ul>
            )}
            <button className="big primary" onClick={onClose}>
              {t('mob.done')}
            </button>
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={t('mob.attack')} icon="swords" onClose={onClose} t={t}>
      {!attack && (
        <>
          <h3>{t('mob.pickAttack')}</h3>
          <ul className="attack-list">
            {attacks.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => {
                    setAttack(a);
                    setSlotLevel(null);
                    setSlotChosen(false);
                  }}
                >
                  <strong>
                    {spellActionName(state.language, a)}
                    {a.spell && (
                      <span className="spell-chip-mob">
                        {' '}✨ {spellLevelLabel(state.language, a.spell.level)}
                      </span>
                    )}
                  </strong>
                  <span className="muted">
                    {a.display.toHit ?? (a.save ? `${abilityCodeLabel(state.language, a.save.ability)} ${a.save.dc}` : '')}
                    {a.display.damage ? (
                      <> · <DmgText lang={state.language} text={a.display.damage} /></>
                    ) : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {attack && needsSlot && !slotChosen && attack.spell && (
        <>
          <h3>{t('cast.slotTitle', { spell: spellActionName(state.language, attack) })}</h3>
          <div className="slot-grid">
            {Array.from({ length: 10 - attack.spell.level }, (_, i) => attack.spell!.level + i)
              .filter((lvl) => (you.spellSlots?.max[lvl - 1] ?? 0) > 0)
              .map((lvl) => {
                const left = you.spellSlots?.current[lvl - 1] ?? 0;
                return (
                  <button
                    key={lvl}
                    className="target slot-btn"
                    disabled={left <= 0}
                    onClick={() => {
                      setSlotLevel(lvl);
                      setSlotChosen(true);
                    }}
                  >
                    {t('cast.slotBtn', { n: lvl, left })}
                  </button>
                );
              })}
          </div>
          {Array.from({ length: 10 - attack.spell.level }, (_, i) => attack.spell!.level + i).every(
            (lvl) => (you.spellSlots?.current[lvl - 1] ?? 0) <= 0,
          ) && <p className="muted">{t('cast.noSlots')}</p>}
          {attack.spell.upcast && (
            <p className="muted">
              ⬆{' '}
              {t('spellbook.upcastPerLevel', {
                dice: displayDice(state.language, `${attack.spell.upcast.count}d${attack.spell.upcast.die}`),
                level: attack.spell.level,
              })}
            </p>
          )}
          {!attack.spell.upcast && attack.spell.upcastText && (
            <p className="muted">⬆ {attack.spell.upcastText}</p>
          )}
          {spellActionText(state.language, attack) && (
            <p className="spell-note">{spellActionText(state.language, attack)}</p>
          )}
        </>
      )}

      {attack && (!needsSlot || slotChosen) && isUtility && (
        <>
          <h3>
            {spellActionName(state.language, attack)}
            {slotLevel !== null && <span className="muted"> · {spellLevelLabel(state.language, slotLevel)}</span>}
          </h3>
          {spellActionText(state.language, attack) && (
            <p className="spell-note">{spellActionText(state.language, attack)}</p>
          )}
          <button className="big primary" onClick={fireUtilityCast}>
            ✨ {t('mob.cast')}
          </button>
        </>
      )}

      {attack && (!needsSlot || slotChosen) && !isUtility && (
        <>
          <h3>
            {spellActionName(state.language, attack)} — {t(isHeal ? 'mob.pickAlly' : 'mob.pickTargets')}
          </h3>
          <div className="target-grid">
            {state.combatants
              // Healing may target anyone, yourself included; attacks
              // exclude your own combatant as before.
              .filter((c) => (isHeal ? true : c.id !== you.combatantId))
              .map((c) => (
                <button
                  key={c.id}
                  className={`target ${c.type} ${targets.includes(c.id) ? 'selected' : ''}`}
                  onClick={() => toggleTarget(c.id)}
                >
                  {c.name}
                </button>
              ))}
          </div>

          {targets.length > 0 && (
            <>
              <div className="mode-toggle">
                <button className={manual ? '' : 'selected'} onClick={() => setManual(false)}>
                  {t('mob.digital')}
                </button>
                <button className={manual ? 'selected' : ''} onClick={() => setManual(true)}>
                  {t('mob.manual')}
                </button>
              </div>

              {!manual && isHeal && (
                <button className="big primary" onClick={fireHealDigital}>
                  ✚ {t('mob.roll')}
                </button>
              )}

              {manual && isHeal && (
                <div className="manual-entry">
                  <label>
                    {t('mob.healRolled')}
                    {attack.display.damage && (
                      <span className="roll-hint tnum">
                        🎲 <DmgText lang={state.language} text={attack.display.damage} />
                        {upcastDice && ` + ${displayDice(state.language, `${upcastDice.count}d${upcastDice.die}`)}`}
                      </span>
                    )}
                    <input
                      type="number"
                      inputMode="numeric"
                      value={damage}
                      onChange={(e) => setDamage(e.target.value)}
                    />
                  </label>
                  <button
                    className="big primary"
                    disabled={damage.trim() === ''}
                    onClick={fireHealManual}
                  >
                    {t('mob.resolve')}
                  </button>
                </div>
              )}

              {!manual && !isSave && !isHeal && (
                <>
                  <div className="mode-toggle adv-toggle">
                    <button
                      className={rollMode === 'dis' ? 'selected' : ''}
                      onClick={() => setRollMode(rollMode === 'dis' ? 'normal' : 'dis')}
                    >
                      {t('roll.dis')}
                    </button>
                    <button
                      className={rollMode === 'normal' ? 'selected' : ''}
                      onClick={() => setRollMode('normal')}
                    >
                      {t('roll.normal')}
                    </button>
                    <button
                      className={rollMode === 'adv' ? 'selected' : ''}
                      onClick={() => setRollMode(rollMode === 'adv' ? 'normal' : 'adv')}
                    >
                      {t('roll.adv')}
                    </button>
                  </div>
                  <button className="big primary" onClick={fireAttackRoll}>
                    {t('mob.rollAttack')}
                  </button>
                </>
              )}

              {!manual && isSave && (
                <button className="big primary" onClick={fireDigitalSave}>
                  {t('mob.roll')}
                </button>
              )}

              {manual && !isHeal && (
                <div className="manual-entry">
                  {!isSave && (
                    <>
                      <label>
                        {t('mob.d20Total')}
                        {attack.display.toHit && (
                          <span className="roll-hint tnum">
                            🎲 {displayDice(state.language, 'd20')} {attack.display.toHit}
                          </span>
                        )}
                        <input
                          type="number"
                          inputMode="numeric"
                          value={d20}
                          onChange={(e) => setD20(e.target.value)}
                        />
                      </label>
                      <div className="nat-toggle">
                        <button
                          className={natural === 20 ? 'selected' : ''}
                          onClick={() => setNatural(natural === 20 ? null : 20)}
                        >
                          {t('mob.nat20')}
                        </button>
                        <button
                          className={natural === 1 ? 'selected' : ''}
                          onClick={() => setNatural(natural === 1 ? null : 1)}
                        >
                          {t('mob.nat1')}
                        </button>
                      </div>
                    </>
                  )}
                  <label>
                    {t('mob.damageRolled')}
                    {attack.display.damage && (
                      <span className="roll-hint tnum">
                        🎲 <DmgText lang={state.language} text={attack.display.damage} />
                        {upcastDice &&
                          ` + ${displayDice(state.language, `${upcastDice.count}d${upcastDice.die}`)}`}
                      </span>
                    )}
                    <input
                      type="number"
                      inputMode="numeric"
                      value={damage}
                      onChange={(e) => setDamage(e.target.value)}
                    />
                  </label>
                  <button
                    className="big primary"
                    disabled={!isSave && d20.trim() === '' && natural === null}
                    onClick={fireManual}
                  >
                    {t('mob.resolve')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---- my attacks -------------------------------------------------------------

function MyAttacks({
  state,
  t,
  send,
  spellList,
  onArchive,
  onSpellbook,
  onClose,
}: {
  state: StateMsg;
  t: (k: string, p?: Record<string, string | number>) => string;
  send: (msg: Record<string, unknown>) => void;
  spellList: WireSpell[] | null;
  onArchive: () => void;
  onSpellbook: () => void;
  onClose: () => void;
}) {
  const you = state.you!;
  const [form, setForm] = useState<ActionForm | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickFilter, setPickFilter] = useState('');
  const [picked, setPicked] = useState<WireSpell | null>(null);
  const [bonus, setBonus] = useState('');

  const patch = (p: Partial<ActionForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = () => {
    if (!form || !form.name.trim()) return;
    const existing = you.attacks.find((a) => a.id === form.id);
    send({ type: 'saveAttack', action: formToAction(form, existing?.order ?? you.attacks.length, existing) });
    setForm(null);
  };

  const attach = (spell: WireSpell, opts: { toHit?: number; dc?: number }) => {
    // crypto.randomUUID is unavailable on insecure LAN origins — shared/uuid
    // falls back to getRandomValues there (same as the device token).
    const action = spellToAction(spell, opts, `spell.${uuid()}`, you.attacks.length);
    send({ type: 'saveAttack', action });
    setPicking(false);
    setPicked(null);
    setBonus('');
    setPickFilter('');
  };

  const locSpellName = (s: WireSpell) =>
    state.language === 'de' && s.l10n?.de?.name ? s.l10n.de.name : s.name;
  const pickList = (spellList ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(pickFilter.toLowerCase()) ||
      locSpellName(s).toLowerCase().includes(pickFilter.toLowerCase()),
  );

  if (picking) {
    if (picked) {
      const needsToHit = picked.attack;
      const needsDc = !picked.attack && !!picked.save;
      const n = parseInt(bonus, 10);
      return (
        <Sheet title={locSpellName(picked)} onClose={onClose} t={t}>
          <p className="muted">
            {spellLevelLabel(state.language, picked.level)} ·{' '}
            {spellSchoolLabel(state.language, picked.school)}
          </p>
          {needsToHit && (
            <label className="mob-form">
              {t('pcs.spellToHit')}
              <input
                autoFocus
                type="number"
                inputMode="numeric"
                placeholder="+5"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </label>
          )}
          {needsDc && (
            <label className="mob-form">
              {t('pcs.spellDc')}
              <input
                autoFocus
                type="number"
                inputMode="numeric"
                placeholder="13"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </label>
          )}
          <div className="form-pair">
            <button className="big" onClick={() => setPicked(null)}>
              {t('common.back')}
            </button>
            <button
              className="big primary"
              disabled={(needsToHit || needsDc) && !Number.isFinite(n)}
              onClick={() =>
                attach(picked, needsToHit ? { toHit: n || 0 } : needsDc ? { dc: n || 10 } : {})
              }
            >
              {t('pcs.attach')}
            </button>
          </div>
        </Sheet>
      );
    }
    return (
      <Sheet title={`✨ ${t('pcs.fromSpellbook')}`} onClose={onClose} t={t}>
        <button className="sheet-back" onClick={() => setPicking(false)}>
          {t('common.back')}
        </button>
        {!spellList ? (
          <p className="muted">{t('mob.connecting')}</p>
        ) : (
          <>
            <input
              className="spell-search"
              placeholder={t('spellbook.search')}
              value={pickFilter}
              onChange={(e) => setPickFilter(e.target.value)}
            />
            <ul className="attack-list spell-list">
              {pickList.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setPicked(s)}>
                    <strong>{locSpellName(s)}</strong>
                    <span className="muted">
                      {spellLevelLabel(state.language, s.level)} ·{' '}
                      {spellSchoolLabel(state.language, s.school)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={t('mob.myAttacks')} onClose={onClose} t={t}>
      {!form && (
        <>
          <ul className="attack-list">
            {you.attacks.map((a) => (
              <li key={a.id}>
                <button onClick={() => setForm(actionToForm(a))}>
                  <strong>
                    {spellActionName(state.language, a)}
                    {a.spell && (
                      <span className="spell-chip-mob">
                        {' '}✨ {spellLevelLabel(state.language, a.spell.level)}
                      </span>
                    )}
                  </strong>
                  <span className="muted">
                    {a.display.toHit ?? (a.save ? `${abilityCodeLabel(state.language, a.save.ability)} ${a.save.dc}` : '')}
                    {a.display.damage ? (
                      <> · <DmgText lang={state.language} text={a.display.damage} /></>
                    ) : ''}
                  </span>
                </button>
                <button
                  className="delete"
                  aria-label={t('common.delete')}
                  onClick={() => send({ type: 'deleteAttack', actionId: a.id })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button className="big" onClick={() => setForm(emptyAction())}>
            + {t('pcs.addAttack')}
          </button>
          <button
            className="big"
            onClick={() => {
              if (!spellList) send({ type: 'getSpells' });
              setPicking(true);
            }}
          >
            {t('pcs.fromSpellbook')}
          </button>
          {/* Navigation, not actions: real buttons, but in the lighter
              outline style so they read apart from the editor buttons. */}
          <div className="sheet-nav-row">
            <button className="big ghost" onClick={onSpellbook}>
              <Icon name="book" size={18} />
              {t('spellbook.title')}
            </button>
            <button className="big ghost" onClick={onArchive}>
              <Icon name="archive" size={18} />
              {t('mob.archive')}
            </button>
          </div>
        </>
      )}

      {form && (
        <div className="mob-form">
          <label>
            {t('common.name')}
            <input value={form.name} onChange={(e) => patch({ name: e.target.value })} autoFocus />
          </label>
          <label>
            {t('common.type')}
            <select
              value={form.type}
              onChange={(e) => patch({ type: e.target.value as ActionForm['type'] })}
            >
              <option value="attack">{t('monsters.type.attack')}</option>
              <option value="save">{t('monsters.type.save')}</option>
            </select>
          </label>
          {form.type === 'attack' && (
            <label>
              {t('monsters.f.toHit')}
              <input
                type="number"
                inputMode="numeric"
                placeholder="+5"
                value={form.toHit}
                onChange={(e) => patch({ toHit: e.target.value })}
              />
            </label>
          )}
          {form.type === 'save' && (
            <div className="form-pair">
              <label>
                {t('monsters.f.saveAbility')}
                <select
                  value={form.saveAbility}
                  onChange={(e) => patch({ saveAbility: e.target.value })}
                >
                  {ABILITIES.map((ab) => (
                    <option key={ab} value={ab}>
                      {ab}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('common.dc')}
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.saveDc}
                  onChange={(e) => patch({ saveDc: e.target.value })}
                />
              </label>
            </div>
          )}
          <DamageEditor
            t={t}
            lang={state.language}
            value={{
              dice: form.damage[0]?.dice ?? '',
              flat: form.damage[0]?.flat ?? '',
              type: form.damage[0]?.type ?? '',
              condition: form.damage[0]?.condition ?? '',
            }}
            onChange={(p) =>
              patch({
                damage: [
                  {
                    dice: form.damage[0]?.dice ?? '',
                    flat: form.damage[0]?.flat ?? '',
                    type: form.damage[0]?.type ?? '',
                    condition: form.damage[0]?.condition ?? '',
                    ...p,
                  },
                ],
              })
            }
          />
          <div className="form-pair">
            <button className="big" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
            <button className="big primary" disabled={!form.name.trim()} onClick={save}>
              {t('pcs.save')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---- log --------------------------------------------------------------------

function LogPeek({
  state,
  lang,
  onOpen,
}: {
  state: StateMsg;
  lang: Lang;
  onOpen: () => void;
}) {
  const last = state.log[state.log.length - 1];
  if (!last) return null;
  return (
    <button className="log-peek" onClick={onOpen}>
      <span className="peek-entry">{logEntryText(lang, last)}</span>
      <span className="peek-chevron">▴</span>
    </button>
  );
}

/**
 * The suspense dice: a tumbling die cycling random faces, decelerating
 * toward the end of the ~3.5 s hold before the real result shows.
 */
/** Flat polyhedral die (d20 silhouette) with the number on its face. */
function DieGlyph({
  value,
  size,
  className = '',
}: {
  value: number | string;
  size: number;
  className?: string;
}) {
  return (
    <div className={`die-glyph ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon points="50,2 92,26 92,74 50,98 8,74 8,26" className="die-outline" />
        <polygon points="50,22 78,66 22,66" className="die-face" />
        <line x1="50" y1="2" x2="50" y2="22" />
        <line x1="92" y1="26" x2="78" y2="66" />
        <line x1="8" y1="26" x2="22" y2="66" />
        <line x1="92" y1="74" x2="78" y2="66" />
        <line x1="8" y1="74" x2="22" y2="66" />
        <line x1="50" y1="98" x2="78" y2="66" />
        <line x1="50" y1="98" x2="22" y2="66" />
      </svg>
      <span className="die-glyph-num tnum" style={{ fontSize: Math.round(size * 0.34) }}>
        {value}
      </span>
    </div>
  );
}

/** A row of settled dice; under adv/dis the discarded one dims out. */
function DiceValues({
  dice,
  kept,
  size,
  settled,
}: {
  dice: number[];
  kept?: number;
  size: number;
  settled?: boolean;
}) {
  let keptShown = false;
  return (
    <div className="die-row">
      {dice.map((d, i) => {
        let cls = 'kept';
        if (kept !== undefined && dice.length > 1) {
          if (d === kept && !keptShown) {
            keptShown = true;
          } else {
            cls = 'dropped';
          }
        }
        return (
          <DieGlyph key={i} value={d} size={size} className={`${cls} ${settled ? 'settle-pop' : ''}`} />
        );
      })}
    </div>
  );
}

/**
 * The suspense dice: one tumbling die per die thrown, cycling random faces
 * (each within its own die size) and decelerating toward the reveal.
 */
function RollingDice({ label, sizes, inline }: { label: string; sizes: number[]; inline?: boolean }) {
  const [faces, setFaces] = useState<number[]>(() => sizes.map(() => 1));
  useEffect(() => {
    let delay = 80;
    let stopped = false;
    let id: number;
    const tick = () => {
      if (stopped) return;
      setFaces(sizes.map((s) => 1 + Math.floor(Math.random() * s)));
      delay = Math.min(280, delay * 1.09);
      id = window.setTimeout(tick, delay);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const size = inline ? (sizes.length > 6 ? 44 : 58) : sizes.length > 1 ? 76 : 96;
  return (
    <div className={`rolling ${inline ? 'inline' : ''}`}>
      <div className="die-row">
        {faces.map((f, i) => (
          <DieGlyph key={i} value={f} size={size} className="tumbling" />
        ))}
      </div>
      <p className="muted">{label}</p>
    </div>
  );
}

/** Damage display string with dt-<type> colored damage-type words. */
function DmgText({ lang, text }: { lang: Lang; text: string }) {
  return (
    <>
      {damageTypeSegments(lang, text).map((seg, i) =>
        seg.cls ? (
          <span key={i} className={seg.cls}>
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

function LogList({
  log,
  lang,
  onThrowDeferred,
}: {
  log: LogEntry[];
  lang: Lang;
  /** Ask the DM to reopen a throw this character still owes. */
  onThrowDeferred?: (entry: LogEntry) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  return (
    <div className="log-list">
      <LogCards
        log={log}
        lang={lang}
        t={(key, params) => translate(lang, key, params)}
        onThrowDeferred={onThrowDeferred}
      />
      <div ref={endRef} />
    </div>
  );
}

// ---- shared sheet -----------------------------------------------------------

function Sheet({
  title,
  icon,
  onClose,
  t,
  children,
  noBack = false,
}: {
  title: string;
  /** Matches the button that opened the sheet. */
  icon?: IconName;
  onClose: () => void;
  t: (k: string) => string;
  children: React.ReactNode;
  /** Must-answer overlays (concentration checks) hide the back button. */
  noBack?: boolean;
}) {
  return (
    <div className="sheet">
      <header className="sheet-header">
        {!noBack && (
          <button className="sheet-back" onClick={onClose}>
            {t('common.back')}
          </button>
        )}
        <h2>
          {icon && <Icon name={icon} size={19} />}
          {title}
        </h2>
      </header>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
