import streamDeck, {
  action,
  SingletonAction,
  type Device,
  type JsonValue,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyAction,
} from '@elgato/streamdeck';
import { bridge } from './bridge';
import { picker, type PickerOp } from './picker';
import { actorAt, actorKeyLines } from './turn-labels';
import { turnKeyImage, type KeyPalette } from './key-image';

interface GlobalSettings {
  port?: number;
  [key: string]: JsonValue | undefined;
}

interface SlotSettings {
  slot?: number;
  [key: string]: JsonValue | undefined;
}

const UUID = 'com.dmtools.dnd-combat-tracker';

/**
 * Turn keys. Next/Previous name the actor they would move to; the Current
 * Turn key names whoever is acting now and does nothing when pressed.
 */
class TurnAction extends SingletonAction {
  constructor(
    private label: string,
    private offset: number,
    private cmd: 'nextTurn' | 'prevTurn' | null,
    private palette: KeyPalette,
  ) {
    super();
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!this.cmd) return; // display-only key
    if (!bridge.send({ type: this.cmd })) await ev.action.showAlert();
  }

  /**
   * Draw the key ourselves so the name gets a heavy outline and the largest
   * font size that still fits; the built-in title layer is cleared so it
   * can't draw over the rendered image.
   */
  async refreshTitles(): Promise<void> {
    const image = turnKeyImage(
      this.label,
      actorKeyLines(actorAt(bridge.state, this.offset)),
      this.palette,
    );
    for (const a of this.actions) {
      if (a.isKey()) {
        await a.setImage(image);
        await a.setTitle('');
      }
    }
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refreshTitles();
  }
}

const TURN_PURPLE: KeyPalette = { from: '#3b1d63', to: '#7c3aed' };
const TURN_GOLD: KeyPalette = { from: '#4a3410', to: '#d4a94f' };

@action({ UUID: `${UUID}.next-turn` })
class NextTurn extends TurnAction {
  constructor() {
    super('Next ▶', 1, 'nextTurn', TURN_PURPLE);
  }
}

@action({ UUID: `${UUID}.prev-turn` })
class PrevTurn extends TurnAction {
  constructor() {
    super('◀ Prev', -1, 'prevTurn', TURN_PURPLE);
  }
}

/** Display-only: whose turn it is right now. */
@action({ UUID: `${UUID}.current-turn` })
class CurrentTurn extends TurnAction {
  constructor() {
    super('▶ Now', 0, null, TURN_GOLD);
  }
}

/**
 * The last deck a key was pressed on. An app-pushed prompt has no event of its
 * own to read a device from, and picker.device stays null until the DM opens
 * something themselves.
 */
let lastDevice: Device | null = null;

/** Damage / Heal / Condition all open the picker flow with a pending op. */
class OpAction extends SingletonAction {
  constructor(private op: PickerOp) {
    super();
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridge.connected || bridge.state.combatants.length === 0) {
      await ev.action.showAlert();
      return;
    }
    lastDevice = ev.action.device;
    const ok = await picker.begin(this.op, ev.action.device);
    if (!ok) await ev.action.showAlert();
  }
}

@action({ UUID: `${UUID}.damage` })
class DamageAction extends OpAction {
  constructor() {
    super('damage');
  }
}

@action({ UUID: `${UUID}.heal` })
class HealAction extends OpAction {
  constructor() {
    super('heal');
  }
}

@action({ UUID: `${UUID}.condition` })
class ConditionAction extends OpAction {
  constructor() {
    super('condition');
  }
}

/** End Combat: uses the picker profile as an on-deck confirm screen. */
@action({ UUID: `${UUID}.end-combat` })
class EndCombatAction extends SingletonAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridge.connected || bridge.state.combatants.length === 0) {
      await ev.action.showAlert();
      return;
    }
    lastDevice = ev.action.device;
    const ok = await picker.beginEndConfirm(ev.action.device);
    if (!ok) await ev.action.showAlert();
  }
}

/** Dice Roller: NdX+M → roll → optionally apply as damage/heal. */
@action({ UUID: `${UUID}.dice` })
class DiceAction extends SingletonAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    // Works without the app too (pure rolling); apply needs the bridge.
    lastDevice = ev.action.device;
    const ok = await picker.beginDice(ev.action.device);
    if (!ok) await ev.action.showAlert();
  }
}

/** Attack: pick one of the current-turn monster's attacks, then roll it. */
@action({ UUID: `${UUID}.attack` })
class AttackAction extends SingletonAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridge.connected) {
      await ev.action.showAlert();
      return;
    }
    lastDevice = ev.action.device;
    const ok = await picker.beginAttack(ev.action.device);
    if (!ok) await ev.action.showAlert();
  }
}

/**
 * The generic keys inside the bundled picker profiles. Keys are identified by
 * their grid coordinates (the profile carries no per-key settings).
 */
@action({ UUID: `${UUID}.slot` })
class SlotAction extends SingletonAction<SlotSettings> {
  private slotOf(ev: {
    payload: { coordinates?: { column: number; row: number } };
  }): number | null {
    // Slot math lives in the picker: it maps coordinates against the grid of
    // the profile actually in use (robust when profile ≠ device dimensions).
    return picker.slotFromCoordinates(ev.payload.coordinates);
  }

  override async onWillAppear(ev: WillAppearEvent<SlotSettings>): Promise<void> {
    const slot = this.slotOf(ev as never);
    if (slot !== null && ev.action.isKey()) {
      await picker.slotAppeared(slot, ev.action as KeyAction);
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<SlotSettings>): Promise<void> {
    const slot = this.slotOf(ev as never);
    if (slot !== null) picker.slotDisappeared(slot);
  }

  override async onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
    const slot = this.slotOf(ev as never);
    if (slot !== null && ev.action.isKey()) {
      await picker.slotPressed(slot, ev.action as KeyAction);
    }
  }
}

const nextTurn = new NextTurn();
const prevTurn = new PrevTurn();
const currentTurn = new CurrentTurn();

streamDeck.actions.registerAction(nextTurn);
streamDeck.actions.registerAction(prevTurn);
streamDeck.actions.registerAction(currentTurn);
streamDeck.actions.registerAction(new DamageAction());
streamDeck.actions.registerAction(new HealAction());
streamDeck.actions.registerAction(new ConditionAction());
streamDeck.actions.registerAction(new EndCombatAction());
streamDeck.actions.registerAction(new AttackAction());
streamDeck.actions.registerAction(new DiceAction());
streamDeck.actions.registerAction(new SlotAction());

bridge.onState(() => {
  void nextTurn.refreshTitles();
  void prevTurn.refreshTitles();
  void currentTurn.refreshTitles();
});

/**
 * A saving throw can arrive with no key press behind it, and the picker only
 * learns which device it is on when the DM presses something. So remember the
 * last device any key reported, and fall back to whatever is attached.
 */
function promptDevice(): Device | null {
  if (lastDevice) return lastDevice;
  for (const device of streamDeck.devices) {
    if (device.isConnected) return device;
  }
  return null;
}

bridge.onPrompt((msg) => {
  if (msg.type === 'savePrompt') void picker.beginSavePrompt(promptDevice(), msg);
  else void picker.closeSavePrompt(msg.id);
});

// Bridge port is configurable from any action's property inspector.
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  if (typeof ev.settings.port === 'number') bridge.setPort(ev.settings.port);
});

streamDeck.connect().then(async () => {
  const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
  if (typeof settings.port === 'number') bridge.setPort(settings.port);
  bridge.start();
});
