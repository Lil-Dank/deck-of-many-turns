import { useEffect, useRef, useState } from 'react';
import type { Combatant, LogEntry } from '../../shared/types';
import { LogCards } from '../../components/LogCards';
import { api } from './api';
import { useConfirm } from './Confirm';
import { useI18n } from './i18n';
import { monsterName } from '../../shared/i18n';

const COLLAPSE_KEY = 'dct-log-collapsed';

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
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const [editing, setEditing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(log.length);

  useEffect(() => {
    // Follow new entries only — edits in place must not yank the view down.
    const grew = log.length > prevLen.current;
    prevLen.current = log.length;
    if (!collapsed && !editing && grew) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length, collapsed, editing]);

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
      <div className="log-panel-body">
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
      <button className="log-panel-toggle" onClick={toggle} title={t('logPanel.collapse')}>
        {t('logPanel.collapse')} »
      </button>
    </aside>
  );
}
