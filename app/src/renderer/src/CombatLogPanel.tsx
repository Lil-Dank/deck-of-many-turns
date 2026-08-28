import { useEffect, useRef, useState } from 'react';
import type { Combatant, LogEntry } from '../../shared/types';
import { LogCards } from '../../components/LogCards';
import { api } from './api';
import { useConfirm } from './Confirm';
import { useI18n } from './i18n';
import { monsterName } from '../../shared/i18n';

const COLLAPSE_KEY = 'dct-log-collapsed';

/* Below this the initiative columns and the open log can't share the width
   comfortably, so the log yields. Keep in sync with the styles.css media
   query of the same width. */
const NARROW_QUERY = '(max-width: 1280px)';

/**
 * The Combat screen's right-hand log sidebar. Always recording, costs nothing
 * when unwanted: the full-width button at the bottom collapses it to a slim
 * strip (remembered in localStorage). Newest entries at the bottom,
 * auto-scrolled — but not while an entry is being edited. The DM edits and
 * deletes entries here; every other log surface is read-only.
 */
export function CombatLogPanel({ log, combatants }: { log: LogEntry[]; combatants: Combatant[] }) {
  const { t, lang } = useI18n();
  const confirm = useConfirm();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1' || window.matchMedia(NARROW_QUERY).matches,
  );
  const [editing, setEditing] = useState(false);
  /** Whether the view is reading the present (the newest entries). */
  const [atBottom, setAtBottom] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(log.length);

  // A little slack, so a card's own padding doesn't count as "scrolled up".
  const nearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < 48;

  // Follow the window across the narrow threshold: squeeze in by collapsing
  // (without recording it as a choice), widen back out to the stored
  // preference. The manual toggle is the only writer of that preference.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const apply = (matches: boolean) => {
      if (matches) setCollapsed(true);
      else setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    };
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Entering the screen (or expanding the panel) starts at the present, not
  // round one: the newest entry is what a running fight is about.
  useEffect(() => {
    if (collapsed) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, [collapsed]);

  useEffect(() => {
    // Follow new entries only — edits in place must not yank the view down,
    // and neither must a new entry while the DM is reading history: the
    // jump-to-present pill is the way back, not a rug-pull.
    const grew = log.length > prevLen.current;
    prevLen.current = log.length;
    if (!collapsed && !editing && grew && atBottom) {
      endRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [log.length, collapsed, editing, atBottom]);

  const jumpToPresent = () => {
    // Instant, not smooth: a smooth scroll runs on animation frames, which a
    // hidden/backgrounded window never grants, leaving the button dead there.
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  if (collapsed) {
    return (
      <aside className="log-panel collapsed">
        <div className="log-panel-vertical">📜 {t('logPanel.title')}</div>
        <button className="log-panel-toggle" onClick={toggle} title={t('logPanel.expand')}>
          «
        </button>
      </aside>
    );
  }

  return (
    <aside className="log-panel">
      <header className="log-panel-header">
        <h3>📜 {t('logPanel.title')}</h3>
      </header>
      <div
        className="log-panel-body"
        ref={bodyRef}
        onScroll={(e) => setAtBottom(nearBottom(e.currentTarget))}
      >
        {log.length === 0 && <p className="muted">{t('logPanel.empty')}</p>}
        <LogCards
          log={log}
          lang={lang}
          t={t}
          showSource
          editable
          options={combatants.map((c) => ({
            // Localized like the log's own snapshots, so dropdown and entry agree.
            name: monsterName(lang, c.displayName),
            type: c.type,
          }))}
          onThrowDeferred={async (entry) => {
            // Reopens the prompt the DM put off. The card stays until the throw
            // lands, so a second dismissal just files it again.
            if (await api.reopenDeferredThrow(entry)) await api.deleteLogEntry(entry.id);
          }}
          onEditEntry={(id, patch) => api.editLogEntry(id, patch)}
          onDeleteEntry={async (id) => {
            if (await confirm(t('log.card.deleteConfirm'), t('common.delete'))) {
              await api.deleteLogEntry(id);
            }
          }}
          onEditingChange={setEditing}
        />
        <div ref={endRef} />
      </div>
      {!atBottom && (
        <button className="log-jump-now" onClick={jumpToPresent}>
          ↓ {t('logPanel.jumpToNow')}
        </button>
      )}
      <button className="log-panel-toggle" onClick={toggle} title={t('logPanel.collapse')}>
        {t('logPanel.collapse')} »
      </button>
    </aside>
  );
}
