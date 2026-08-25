import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { api } from './api';
import { PcScreen } from './screens/PcScreen';
import { MonsterScreen } from './screens/MonsterScreen';
import { SpellbookScreen } from './screens/SpellbookScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { CombatScreen } from './screens/CombatScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { PlayerView } from './screens/PlayerView';
import { CampaignSelector } from './CampaignSelector';
import { ConfirmProvider } from './Confirm';
import { I18nProvider } from './i18n';
import { KenkuSoundboardModal } from './KenkuSoundboardModal';
import { PlayerWebQrModal } from './PlayerWebQrModal';
import { PlayerSaveModal } from './PlayerSaveModal';
import { SaveRequestModal } from './SaveRequestModal';
import type { SaveRequest } from '../../main/saveRequests';
import type { PlayerSavePendingInfo } from '../../preload/index';
import { translate } from '../../shared/i18n';
import { DEFAULT_PALETTE, PALETTE_BY_ID } from '../../shared/brand';
import type { IconName } from '../../shared/icons';
import { Icon } from '../../components/Icon';
import { BrandLockup } from '../../components/BrandMark';

type Tab = 'combat' | 'pcs' | 'monsters' | 'spellbook' | 'templates' | 'archive' | 'settings';

// The glyph lives here rather than inside the translated label: it is the
// same drawing in every language, and parsing it back out of the string only
// worked while every label happened to start with an emoji.
const TABS: { id: Tab; key: string; icon: IconName }[] = [
  { id: 'combat', key: 'nav.combat', icon: 'swords' },
  { id: 'pcs', key: 'nav.party', icon: 'shield' },
  { id: 'monsters', key: 'nav.monsters', icon: 'eye' },
  { id: 'spellbook', key: 'nav.spellbook', icon: 'book' },
  { id: 'templates', key: 'nav.encounters', icon: 'map' },
  { id: 'archive', key: 'nav.archive', icon: 'archive' },
  { id: 'settings', key: 'nav.settings', icon: 'sliders' },
];

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('combat');
  const [playerViewOpen, setPlayerViewOpen] = useState(false);
  const [combatTemplateId, setCombatTemplateId] = useState<string | null>(null);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [pendingSave, setPendingSave] = useState<PlayerSavePendingInfo | null>(null);
  // Saving throws owed. A queue, because several hits in a round mean several
  // concentration checks and they must not stack on top of each other.
  const [saveReqs, setSaveReqs] = useState<SaveRequest[]>([]);
  const isPlayerView = window.location.hash.replace('#', '') === 'player';
  const lang = state?.settings.language ?? 'en';

  useEffect(() => {
    // The page <title> overrides the BrowserWindow title, so distinguish the
    // Player View here (helps OBS window capture tell the two apart).
    if (isPlayerView) document.title = translate(lang, 'app.playerViewTitle');
  }, [isPlayerView, lang]);

  useEffect(() => {
    // Theme presets swap the CSS variables via these attributes (DM window UI
    // only — the Player View has its own fixed styling + background color).
    // data-scheme carries the light/dark trait, so rules that depend on the
    // ground key off it instead of enumerating every theme id.
    // The Player View is projected or keyed and must never inherit the DM's
    // theme — the body carries --font-ui and --bg, so PHB Style's serif and a
    // parchment ground would otherwise reach the players' screen.
    if (isPlayerView) {
      document.documentElement.dataset.theme = DEFAULT_PALETTE;
      document.documentElement.dataset.scheme = 'dark';
      return;
    }
    if (!state) return;
    const palette = PALETTE_BY_ID[state.settings.theme];
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.dataset.scheme = palette?.scheme ?? 'dark';
  }, [state?.settings.theme, isPlayerView]);

  useEffect(() => {
    // A campaign switch invalidates cross-screen leftovers: a preselected
    // encounter template and any save-adjudication modal belong to the
    // previous campaign (its pending saves were dismissed server-side).
    setCombatTemplateId(null);
    setPendingSave(null);
  }, [state?.activeCampaignId]);

  useEffect(() => {
    let mounted = true;
    api.getState().then((s) => {
      if (mounted) setState(s);
    });
    api.getPlayerViewOpen().then((open) => {
      if (mounted) setPlayerViewOpen(open);
    });
    const off = api.onState(setState);
    const offPv = api.onPlayerViewOpen(setPlayerViewOpen);
    // A Stream Deck press pulls the DM window to the Combat screen.
    const offFocus = api.onFocusCombat(() => {
      if (!isPlayerView) setTab('combat');
    });
    // A phone launched a save-based attack: the DM adjudicates in a modal.
    const offSave = api.onPlayerSavePending((pending) => {
      if (!isPlayerView) {
        setPendingSave(pending);
        setTab('combat');
      }
    });
    // A saving throw is owed: concentration after damage, or a save aimed at a
    // PC. Arrives whether or not a phone was also asked.
    const offReq = api.onSaveRequest((req) => {
      if (isPlayerView) return;
      setSaveReqs((qs) => {
        const i = qs.findIndex((q) => q.id === req.id);
        if (i === -1) return [...qs, req];
        const next = [...qs];
        next[i] = req;
        return next;
      });
    });
    const offReqClosed = api.onSaveRequestClosed((id) => {
      setSaveReqs((qs) => qs.filter((q) => q.id !== id));
    });
    return () => {
      mounted = false;
      off();
      offPv();
      offFocus();
      offSave();
      offReq();
      offReqClosed();
    };
  }, []);

  if (!state) return <div className="loading">{translate(lang, 'app.loading')}</div>;

  if (isPlayerView) {
    return (
      <I18nProvider lang={lang}>
        <PlayerView state={state} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider lang={lang}>
    <ConfirmProvider cancelLabel={translate(lang, 'common.cancel')}>
    <div className="app">
      <nav className="sidebar">
        <BrandLockup appName={translate(lang, 'app.title')} />
        <CampaignSelector state={state} />
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon">
              <Icon name={t.icon} />
            </span>
            <span>{translate(lang, t.key)}</span>
          </button>
        ))}
        <div className="sidebar-footer">
          {state.settings.kenku.enabled && (
            <button className="nav-btn" onClick={() => setShowSoundboard(true)}>
              <span className="nav-icon">
                <Icon name="equalizer" />
              </span>
              <span>{translate(lang, 'kenku.soundboard')}</span>
            </button>
          )}
          {state.settings.playerWeb.enabled && (
            <button className="nav-btn" onClick={() => setShowQr(true)}>
              <span className="nav-icon">
                <Icon name="phone" />
              </span>
              <span>{translate(lang, 'pw.qrButton')}</span>
            </button>
          )}
          <button
            className={`nav-btn pv-toggle ${playerViewOpen ? 'active' : ''}`}
            onClick={() => void api.togglePlayerView()}
          >
            <span className="nav-icon">
                <Icon name="monitor" />
              </span>
            <span>{translate(lang, playerViewOpen ? 'nav.closePlayerView' : 'nav.openPlayerView')}</span>
          </button>
          {playerViewOpen && (
            <button className="nav-btn" onClick={() => void api.togglePlayerFullscreen()}>
              <span className="nav-icon">
                <Icon name="expand" />
              </span>
              <span>{translate(lang, 'nav.fullscreen')}</span>
            </button>
          )}
          <div className={`bridge-status ${state.bridgeClientCount > 0 ? 'on' : ''}`}>
            <span className="nav-icon">
              <Icon name={state.bridgeClientCount > 0 ? 'dotOn' : 'dotOff'} />
            </span>
            <span>{translate(lang, state.bridgeClientCount > 0 ? 'nav.deckConnected' : 'nav.deckOffline')}</span>
          </div>
        </div>
      </nav>
      <main className="content">
        {tab === 'pcs' && <PcScreen state={state} />}
        {tab === 'monsters' && <MonsterScreen state={state} />}
        {tab === 'spellbook' && <SpellbookScreen state={state} />}
        {tab === 'templates' && (
          <TemplatesScreen
            state={state}
            onStartCombat={(templateId) => {
              setCombatTemplateId(templateId);
              setTab('combat');
            }}
          />
        )}
        {tab === 'combat' && <CombatScreen state={state} preselectedTemplateId={combatTemplateId} />}
        {tab === 'archive' && <ArchiveScreen key={state.activeCampaignId} />}
        {tab === 'settings' && <SettingsScreen state={state} />}
        {showSoundboard && <KenkuSoundboardModal onClose={() => setShowSoundboard(false)} />}
        {showQr && <PlayerWebQrModal onClose={() => setShowQr(false)} />}
        {pendingSave && (
          <PlayerSaveModal
            state={state}
            pending={pendingSave}
            onClose={() => setPendingSave(null)}
          />
        )}
        {saveReqs.length > 0 && (
          <SaveRequestModal
            req={saveReqs[0]}
            pending={saveReqs.length - 1}
            onDismiss={(req) => {
              // Not lost: it becomes a card in the log that can still be thrown.
              void api.deferSaveRequest(req.id);
            }}
          />
        )}
      </main>
    </div>
    </ConfirmProvider>
    </I18nProvider>
  );
}
