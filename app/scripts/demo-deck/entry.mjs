// The demo's right-hand simulator sidebar: a simulated player phone (the real
// mobile bundle in an iframe, talking to the in-page fake player server) on
// top, and the simulated Stream Deck below.
//
// The deck is not a mock-up: it bundles the plugin's REAL picker state
// machine, bridge and key renderer (with '@elgato/streamdeck' and 'ws'
// stubbed), so every flow behaves exactly like the hardware — actor select,
// numpad, conditions, dice roller, monster attacks, end-combat confirm,
// timeouts and all. Commands land in the demo engine the same way the desktop
// app would receive them over the WebSocket.
import { picker } from '../../../plugin/src/picker.ts';
import { bridge } from '../../../plugin/src/bridge.ts';
import { turnKeyImage, pickerKeyImage } from '../../../plugin/src/key-image.ts';
import { actorAt, actorKeyLines } from '../../../plugin/src/turn-labels.ts';
import { profileListeners } from './sd-stub.mjs';
import FakeWs from './ws-stub.mjs';

const COLS = 5;
const ROWS = 3;
const SLOTS = COLS * ROWS;
const DEVICE = { id: 'demo-deck', size: { columns: COLS, rows: ROWS } };
const SIDE_W = 392;

// Same palettes the real plugin uses for its turn keys.
const TURN_PURPLE = { from: '#3b1d63', to: '#7c3aed' };
const TURN_GOLD = { from: '#4a3410', to: '#d4a94f' };

const css = `
body.with-demo-side { padding-right: ${SIDE_W}px; }
#demo-side { position: fixed; right: 0; top: 0; bottom: 0; z-index: 9999;
  width: ${SIDE_W}px; display: flex; flex-direction: column; gap: 10px;
  padding: 10px; overflow-y: auto; background: #131315;
  border-left: 1px solid #303033; font-family: 'Inter', 'Segoe UI', sans-serif;
  user-select: none; }
#demo-side .sim-panel { background: #1c1c1e; border: 1px solid #3a3a3d;
  border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.55); flex-shrink: 0; }
#demo-side .sim-panel > header { display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; color: #d8d8dc; font-size: 12.5px;
  border-bottom: 1px solid #303033; }
#demo-side .sim-panel > header strong { flex: 1; font-weight: 600; }
#demo-side .sim-panel > header button { background: #2c2c30; color: #cfcfd4;
  border: 1px solid #444; border-radius: 6px; font-size: 11.5px; padding: 3px 8px;
  cursor: pointer; }
#demo-side .sim-panel > header button:hover { background: #38383d; }
#demo-side .sim-panel.collapsed > *:not(header) { display: none; }
#demo-side .hint { padding: 6px 12px 8px; color: #8b8b92; font-size: 11px; }
/* phone */
#demo-phone .phone-frame { padding: 10px 10px 2px; display: flex; justify-content: center; }
#demo-phone iframe { width: 340px; height: 640px; border: 6px solid #060607;
  border-radius: 22px; background: #1a1423; display: block; }
/* deck */
#demo-deck-grid { display: grid; grid-template-columns: repeat(${COLS}, 1fr);
  gap: 6px; padding: 10px; background: #111; }
#demo-deck-grid .key { aspect-ratio: 1; border-radius: 8px; overflow: hidden;
  background: #060606; border: 1px solid #2b2b2b; padding: 0; cursor: pointer; }
#demo-deck-grid .key img { width: 100%; height: 100%; display: block; }
#demo-deck-grid .key:active { transform: scale(0.94); }
/* narrow screens: sidebar becomes an overlay behind floating toggles */
#demo-side-toggle { display: none; }
@media (max-width: 1100px) {
  body.with-demo-side { padding-right: 0; }
  #demo-side { transform: translateX(100%); transition: transform .2s ease; }
  #demo-side.open { transform: none; box-shadow: -12px 0 40px rgba(0,0,0,.6); }
  #demo-side-toggle { display: block; position: fixed; right: 14px; bottom: 14px;
    z-index: 10000; background: #2c2c30; color: #e8e8ec; border: 1px solid #4a4a50;
    border-radius: 24px; padding: 10px 16px; font-size: 14px; cursor: pointer;
    box-shadow: 0 6px 24px rgba(0,0,0,.5); }
}
`;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function collapsible(panel, btn) {
  btn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '▲' : '—';
  });
}

// The sidebar belongs on the DM view only; the Player View tab loads the same
// page and must stay clean for chroma keying.
function boot() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- shell ------------------------------------------------------------------

  const resetBtn = el('button', { text: 'Reset demo' });
  const phoneCollapse = el('button', { text: '—' });
  const deckCollapse = el('button', { text: '—' });

  const phonePanel = el('div', { class: 'sim-panel', id: 'demo-phone' }, [
    el('header', {}, [el('strong', { text: '📱 Player phone (simulated)' }), phoneCollapse]),
    el('div', { class: 'phone-frame' }, [el('iframe', { src: './player/', title: 'Player phone demo' })]),
    el('div', {
      class: 'hint',
      text: 'The real player web app. Claim a character and act on their turn.',
    }),
  ]);

  const grid = el('div', { id: 'demo-deck-grid' });
  const deckPanel = el('div', { class: 'sim-panel', id: 'demo-deck' }, [
    el('header', {}, [el('strong', { text: '🎛 Stream Deck (simulated)' }), resetBtn, deckCollapse]),
    grid,
    el('div', {
      class: 'hint',
      text: 'The real plugin logic, running in your browser. Demo data stays local.',
    }),
  ]);

  const side = el('aside', { id: 'demo-side' }, [phonePanel, deckPanel]);
  document.body.appendChild(side);
  document.body.classList.add('with-demo-side');

  const toggle = el('button', { id: 'demo-side-toggle', text: '📱🎛 Simulators' });
  toggle.addEventListener('click', () => side.classList.toggle('open'));
  document.body.appendChild(toggle);

  collapsible(phonePanel, phoneCollapse);
  collapsible(deckPanel, deckCollapse);
  resetBtn.addEventListener('click', () => {
    localStorage.clear();
    location.reload();
  });

  // ---- keys -------------------------------------------------------------------

  const keys = [];
  for (let i = 0; i < SLOTS; i++) {
    const img = el('img', { alt: '' });
    const btn = el('button', { class: 'key' }, [img]);
    btn.addEventListener('click', () => onPress(i));
    grid.appendChild(btn);
    keys.push({ btn, img });
  }

  const BLANK =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#060606"/></svg>');

  function setKey(slot, image) {
    keys[slot].img.src = image || BLANK;
  }

  /** Fake SDK key action handed to the picker: setImage lands in our grid. */
  const slotAction = (slot) => ({
    setTitle: async () => {},
    setImage: async (image) => {
      if (mode === 'picker') setKey(slot, image);
    },
    showOk: async () => {},
    showAlert: async () => flash(slot),
  });

  function flash(slot) {
    keys[slot].btn.style.outline = '2px solid #d94040';
    setTimeout(() => (keys[slot].btn.style.outline = ''), 350);
  }

  // ---- main profile layout ----------------------------------------------------

  // slot -> action key (mirrors a sensible home-profile layout)
  const MAIN = new Map([
    [0, { kind: 'prev' }],
    [1, { kind: 'current' }],
    [2, { kind: 'next' }],
    [3, { kind: 'begin', op: 'dice', lines: ['🎲', 'Dice'] }],
    [4, { kind: 'begin', op: 'end', lines: ['⏻', 'End'] }],
    [5, { kind: 'begin', op: 'damage', lines: ['⚔', 'Damage'] }],
    [6, { kind: 'begin', op: 'heal', lines: ['✚', 'Heal'] }],
    [7, { kind: 'begin', op: 'condition', lines: ['☰', 'Condi-', 'tion'] }],
    [8, { kind: 'begin', op: 'attack', lines: ['🎲', 'Attack'] }],
  ]);

  let mode = 'main'; // 'main' | 'picker'

  function renderMain() {
    for (let i = 0; i < SLOTS; i++) {
      const spec = MAIN.get(i);
      if (!spec) {
        setKey(i, BLANK);
        continue;
      }
      if (spec.kind === 'prev') {
        setKey(i, turnKeyImage('◀ Prev', actorKeyLines(actorAt(bridge.state, -1)), TURN_PURPLE));
      } else if (spec.kind === 'current') {
        setKey(i, turnKeyImage('▶ Now', actorKeyLines(actorAt(bridge.state, 0)), TURN_GOLD));
      } else if (spec.kind === 'next') {
        setKey(i, turnKeyImage('Next ▶', actorKeyLines(actorAt(bridge.state, 1)), TURN_PURPLE));
      } else {
        setKey(i, pickerKeyImage(spec.lines, 'item'));
      }
    }
  }

  async function onPress(slot) {
    if (mode === 'picker') {
      await picker.slotPressed(slot, slotAction(slot));
      return;
    }
    const spec = MAIN.get(slot);
    if (!spec) return;
    let ok = true;
    if (spec.kind === 'prev') bridge.send({ type: 'prevTurn' });
    else if (spec.kind === 'next') bridge.send({ type: 'nextTurn' });
    else if (spec.kind === 'current') return;
    else if (spec.op === 'dice') ok = await picker.beginDice(DEVICE);
    else if (spec.op === 'end') ok = await picker.beginEndConfirm(DEVICE);
    else if (spec.op === 'attack') ok = await picker.beginAttack(DEVICE);
    else ok = await picker.begin(spec.op, DEVICE);
    if (ok === false) flash(slot);
  }

  // ---- wiring -----------------------------------------------------------------

  profileListeners.add((profile) => {
    mode = profile ? 'picker' : 'main';
    if (mode === 'main') renderMain();
    // picker mode: the picker pushes images through slotAction.setImage
  });

  async function start() {
    const demo = window.__demo;
    if (!demo) return;
    await demo.ready();

    // Register every slot with the picker once, like keys appearing on the deck.
    for (let i = 0; i < SLOTS; i++) await picker.slotAppeared(i, slotAction(i));

    bridge.start();
    await new Promise((r) => setTimeout(r, 30));
    const sock = FakeWs.instances.at(-1);
    const push = () => sock.emit('message', JSON.stringify(demo.bridgeState()));
    push();
    demo.onState(push);
    // Saving throws the app pushes at the deck, same socket as state.
    demo.onDeckMessage?.((json) => sock.emit('message', json));
    // Mirror of plugin.ts: the real hardware reads its device off the key
    // event that opened a flow; the simulator only ever has the one.
    bridge.onPrompt((msg) => {
      if (msg.type === 'savePrompt') void picker.beginSavePrompt(DEVICE, msg);
      else void picker.closeSavePrompt(msg.id);
    });
    renderMain();
    demo.onState(() => {
      if (mode === 'main') renderMain();
    });
  }

  start();
}

if (location.hash.replace('#', '') !== 'player') boot();
