import { useState } from 'react';
import type { AppState, PC } from '../../../shared/types';
import { ABILITY_KEYS } from '../../../shared/types';
import { abilitiesToForm, formToAbilities, type AbilitiesForm } from '../abilitiesForm';
import { api } from '../api';
import { useConfirm } from '../Confirm';
import { useI18n } from '../i18n';
import { PcAttackEditor } from '../PcAttackEditor';
import { SlotPips } from '../SlotPips';

interface PcFormData {
  id?: string;
  name: string;
  maxHp: string;
  ac: string;
  initMod: string;
  abilities: AbilitiesForm;
  notes: string;
  /** Max spell slots per level 1–9, as typed. */
  slots: string[];
  /** Custom pools (Ki, sorcery points, homebrew), as typed. */
  resources: Array<{ id: string | null; name: string; max: string }>;
}

const emptyForm = (): PcFormData => ({
  name: '',
  maxHp: '10',
  ac: '10',
  initMod: '0',
  abilities: abilitiesToForm(null),
  notes: '',
  slots: Array.from({ length: 9 }, () => ''),
  resources: [],
});

export function PcScreen({ state }: { state: AppState }) {
  const { t } = useI18n();
  const [form, setForm] = useState<PcFormData | null>(null);
  const confirm = useConfirm();

  const startEdit = (pc: PC) =>
    setForm({
      id: pc.id,
      name: pc.name,
      maxHp: String(pc.maxHp),
      ac: String(pc.ac),
      initMod: String(pc.initMod),
      abilities: abilitiesToForm(pc.abilities),
      notes: pc.notes ?? '',
      slots: Array.from({ length: 9 }, (_, i) => {
        const v = pc.spellSlots?.max[i] ?? 0;
        return v > 0 ? String(v) : '';
      }),
      resources: (pc.resources ?? []).map((r) => ({ id: r.id, name: r.name, max: String(r.max) })),
    });

  const submit = async () => {
    if (!form || !form.name.trim()) return;
    const existing = form.id ? state.pcs.find((p) => p.id === form.id) : undefined;
    const max = form.slots.map((v) => Math.max(0, parseInt(v, 10) || 0));
    await api.savePc({
      id: form.id,
      name: form.name.trim(),
      maxHp: Math.max(1, parseInt(form.maxHp, 10) || 1),
      ac: parseInt(form.ac, 10) || 10,
      initMod: parseInt(form.initMod, 10) || 0,
      abilities: formToAbilities(form.abilities),
      notes: form.notes.trim() || undefined,
      attacks: existing?.attacks ?? [],
      // Current slots carry over; the store clamps them to the new max.
      spellSlots: max.some((v) => v > 0)
        ? { max, current: existing?.spellSlots?.current ?? [...max] }
        : null,
      // Current counts carry over on edit (clamped to a shrunken max); a new
      // pool starts full.
      resources: form.resources
        .filter((r) => r.name.trim())
        .map((r) => {
          const rMax = Math.max(1, Math.min(99, parseInt(r.max, 10) || 1));
          const prev = r.id ? existing?.resources?.find((x) => x.id === r.id) : undefined;
          return {
            id: r.id ?? crypto.randomUUID(),
            name: r.name.trim().slice(0, 40),
            max: rMax,
            current: prev ? Math.min(prev.current, rMax) : rMax,
          };
        }),
    });
    setForm(null);
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>{t('pcs.titleFull')}</h1>
        <button className="btn primary" onClick={() => setForm(emptyForm())}>
          {t('pcs.add')}
        </button>
      </header>

      {state.pcs.length === 0 && !form && (
        <p className="empty-note">{t('pcs.emptyFull')}</p>
      )}

      <table className="data-table">
        {state.pcs.length > 0 && (
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.maxHp')}</th>
              <th>{t('common.ac')}</th>
              <th>{t('common.initMod')}</th>
              <th></th>
            </tr>
          </thead>
        )}
        <tbody>
          {state.pcs.map((pc) => (
            <tr key={pc.id}>
              <td className="name-cell">
                {pc.name}
                <SlotPips slots={pc.spellSlots} />
              </td>
              <td>{pc.maxHp}</td>
              <td>{pc.ac}</td>
              <td>{pc.initMod >= 0 ? `+${pc.initMod}` : pc.initMod}</td>
              <td className="row-actions">
                {pc.spellSlots && (
                  <button
                    className="btn small"
                    title={t('pcs.longRestNote')}
                    onClick={() => void api.longRest(pc.id)}
                  >
                    {t('pcs.longRest')}
                  </button>
                )}
                <button className="btn small" onClick={() => startEdit(pc)}>{t('common.edit')}</button>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    if (await confirm(t('pcs.deleteConfirm', { name: pc.name }), t('common.delete'))) void api.deletePc(pc.id);
                  }}
                >
                  {t('common.delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>{t(form.id ? 'pcs.editPc' : 'pcs.addPc')}</h2>
            <h3>
              {t('pcs.resources')} <span className="muted">{t('pcs.resourcesNote')}</span>
            </h3>
            <div className="pc-res-editor">
              {form.resources.map((r, i) => (
                <div key={r.id ?? `new-${i}`} className="form-row pc-res-row">
                  <input
                    type="text"
                    placeholder={t('common.name')}
                    value={r.name}
                    onChange={(e) => {
                      const resources = [...form.resources];
                      resources[i] = { ...r, name: e.target.value };
                      setForm({ ...form, resources });
                    }}
                  />
                  <input
                    type="number"
                    min={1}
                    className="pc-res-max"
                    value={r.max}
                    onChange={(e) => {
                      const resources = [...form.resources];
                      resources[i] = { ...r, max: e.target.value };
                      setForm({ ...form, resources });
                    }}
                  />
                  <button
                    className="btn small danger"
                    onClick={() =>
                      setForm({ ...form, resources: form.resources.filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn small"
                onClick={() =>
                  setForm({
                    ...form,
                    resources: [...form.resources, { id: null, name: '', max: '1' }],
                  })
                }
              >
                + {t('pcs.addResource')}
              </button>
            </div>

            <label>
              {t('common.name')}
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <div className="form-row">
              <label>
                {t('common.maxHp')}
                <input
                  type="number"
                  min={1}
                  value={form.maxHp}
                  onChange={(e) => setForm({ ...form, maxHp: e.target.value })}
                />
              </label>
              <label>
                {t('common.ac')}
                <input
                  type="number"
                  value={form.ac}
                  onChange={(e) => setForm({ ...form, ac: e.target.value })}
                />
              </label>
              <label>
                {t('common.initMod')}
                <input
                  type="number"
                  value={form.initMod}
                  onChange={(e) => setForm({ ...form, initMod: e.target.value })}
                />
              </label>
            </div>
            <h3>
              {t('monsters.abilities')} <span className="muted">{t('monsters.abilitiesNote')}</span>
            </h3>
            <div className="form-row">
              {ABILITY_KEYS.map((k) => (
                <label key={k}>
                  {k.toUpperCase()}
                  <input
                    type="number"
                    placeholder="10"
                    value={form.abilities[k]}
                    onChange={(e) =>
                      setForm({ ...form, abilities: { ...form.abilities, [k]: e.target.value } })
                    }
                  />
                </label>
              ))}
            </div>

            <h3>
              {t('pcs.slots')} <span className="muted">{t('pcs.slotsNote')}</span>
            </h3>
            <div className="form-row slot-row">
              {form.slots.map((v, i) => (
                <label key={i}>
                  L{i + 1}
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={v}
                    onChange={(e) => {
                      const slots = [...form.slots];
                      slots[i] = e.target.value;
                      setForm({ ...form, slots });
                    }}
                  />
                </label>
              ))}
            </div>

            <label>
              {t('pcs.notes')} <span className="muted">{t('pcs.notesNote')}</span>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            {(() => {
              const savedPc = form.id ? state.pcs.find((p) => p.id === form.id) : undefined;
              return savedPc ? (
                <PcAttackEditor
                  pc={savedPc}
                  kenkuOn={state.settings.kenku.enabled}
                  spells={state.spells}
                />
              ) : null;
            })()}
            <div className="modal-actions">
              <button className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button className="btn primary" disabled={!form.name.trim()} onClick={() => void submit()}>
                {t('pcs.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
