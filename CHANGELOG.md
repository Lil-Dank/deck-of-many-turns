# Changelog

All notable changes to **Deck of Many Turns** — the app and its Stream Deck
plugin — are documented here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); each version links
to its GitHub release, where the installer and the packed plugin are attached.

## [Unreleased]

## [3.6.0] — 2026-08-21

### Added

- **A saving throw can be answered anywhere.** When one is owed — a
  concentration check after damage, or a save aimed at a character — the DM
  window, the player's phone and the Stream Deck are all asked at once, and
  whoever answers first settles it. The others put their prompt away. On an
  area save the race is per target, so each player fills in their own row while
  the DM adjudicates the rest.
- **Concentration checks now always reach the DM.** They used to exist only if
  a phone was connected to answer them: an unclaimed character, a disconnected
  phone or the player server being switched off dropped the check silently and
  the spell stayed up.
- **Putting a throw off doesn't lose it.** Dismissing files it as a card in the
  combat log, which the DM or the character who owes it can throw later, ignore,
  or delete. Only those two see it.

- **The combat log opens at the present.** Entering the Combat screen mid-fight
  starts the log at the newest entry instead of round one, and scrolling up to
  read history shows a *Jump to present* button — while it is up, new entries no
  longer yank the view down.

### Fixed

- **A concentration check rolled on the phone now tumbles like every other
  digital roll.** The dice were skipped entirely — the die appeared already
  settled on its result. The table-visible half, the log entry and the spell
  dropping off the DM's combat row, now waits for the roll to land too, so
  nobody learns the outcome before the player who threw it.

### Changed

- **The Stream Deck rolls saving throws too.** A save-based action now asks
  Auto or Manual after the damage roll. Auto throws every target's d20 with
  that creature's own modifier and shows each total against the DC; Manual
  leaves them blank so a physically rolled total can be typed on the numpad,
  with the modifier shown as a hint. Either way a target key opens the numpad
  to correct one, the centre key re-rolls the area, and Apply waits until every
  throw is in. Each one is logged, so a deck-run area attack now leaves the
  same card as the DM window.
- **The DM's attack modal rolls saving throws instead of just asking who made
  them.** A save-based action — a breath weapon, Fireball — now gets a row per
  target with a digital d20 button showing that target's modifier, a field for a
  physically rolled total, and a *Roll all* button for the whole area. Each throw
  is written to the log, so a DM-run save leaves the same card as one a player
  launched from their phone; before, it left only the damage line.
- **Saving throws in the combat log now show the throw, not just its sum.**
  A save adjudicated in the DM's modal records the d20 behind the total, so the
  card reads `17 +2 19 vs DC 14` the way an attack roll does — it previously
  logged the total alone. The card also names the throw: *Fireball DEX saving
  throw* instead of a bare spell name over a `SAVE` row. Player phones keep the
  total and the verdict but not the d20, which would give away the roller's
  ability modifier.
- The player phone's combat-log bar drops its "Combat log" caption. On a phone
  that caption took a fixed slice of a single-line bar; the latest entry now
  gets the full width. The sheet it opens still carries the title.

## [3.5.1] — 2026-08-20

### Fixed

- Damage that arrives without an attack roll of its own — a saving throw, an
  area spell, the dice roller — now shows the same dark composition row as a
  weapon hit, with what was thrown, the total, and the per-die breakdown behind
  the chevron. It previously rendered as a bare line of math, or as nothing at
  all on the player phone.
- The player phone now shows what was thrown. Every roll in the live combat log
  carries its composition — `d20 + 5` on an attack, `3d4 +2` on damage — while
  the individual die results stay DM-side. Attack rolls previously reached the
  phone as a bare verdict with no dice at all.

## [3.5.0] — 2026-08-20

### Added

- **A new identity.** The d20 is replaced by a fanned stack of cards whose front
  card carries an initiative row — an avatar dot, a name bar, an HP bar. It ships
  everywhere the old icon did: window and taskbar, the installer, the README, the
  GitHub social banner and the Stream Deck plugin's store and category icons. The
  sidebar's logo and text are now one drawn lock-up that recolours with the theme.
- **Ten themes instead of four.** Eight brand palettes — Violet ink (the new
  default), Arcane gold, Ember slate, Verdant brass, Midnight cyan, Parchment
  inverted, Steel amber, Plum and mint — plus PHB Style and Light, which keep
  their exact colours. Each palette declares ten colours and the rest of the UI
  is derived from them, so a theme recolours the whole window *and* the logo.
- **A theme picker you can see.** Settings shows a swatch grid, each swatch
  rendered in its own palette with a live copy of the mark, grouped into Brand
  and Paper — instead of a dropdown that showed one name at a time.
- **A monoline icon set** across the sidebar, its footer and the phone, replacing
  the emoji. Icons inherit their row's colour, so the active tab tints its icon
  with the palette accent.

### Changed

- The current-turn highlight has a colour of its own on every theme, separate
  from the accent. On PHB Style and Light the two used to be the same colour, so
  whose turn it was never stood out; now it does.
- The active navigation item is an accent tint with a left bar rather than a
  solid fill, so it stops competing with the current-turn row.
- PHB Style and Light gained real borders and a subtle lift under rows, cards and
  buttons — a hairline at 12% alpha disappeared against their bright grounds.
- On the phone, "My attacks" became "My attacks…" in the lighter outline style,
  since it opens a sheet rather than doing something.
- Text that carries the brand colour (headings, totals, the active tab, dice
  notation) uses a variant pulled toward the body colour, so it clears contrast
  on every palette; fills keep the accent at full strength.

### Fixed

- The Player View no longer inherits anything from the DM's theme. It sits on the
  body, which carries the UI font and background, so PHB Style's serif and its
  parchment ground reached the projector. It is now byte-identical under every
  theme.
- Damage-type inks, the monster colour and several button labels missed WCAG AA
  on one ground or another; an audit across all ten themes brought them up.
- The DM window no longer flashes the old purple before painting: it opens on the
  stored theme's own background.

## [3.4.0] — 2026-08-20

### Added

- **Combat log as cards** — the log renders one card per character instead of
  a flat line list: attack rolls show both advantage/disadvantage d20s with
  the dropped die struck through and a big hit/miss/crit verdict, damage rows
  carry their type and dice composition and click open into the full per-die
  breakdown, spell casts get slot and concentration chips, saving throws show
  die, modifier and total against the DC. Rounds, turns and combat bounds
  divide the stream as slim cardless rules. Shared by the DM sidebar, the
  Combat Archive and the phones.
- **Editable log entries** — hover a block in the live sidebar for ✎/🗑.
  Actors, targets, amounts, rolls, outcomes, damage types and conditions can
  be corrected in place; damage and healing edits re-apply the HP difference
  to the target, and deleting an entry reverts what it did (deleting the hit
  that downed a PC brings them back up, with concentration handled). Dead
  monsters are never resurrected — edits to their history are record-only.
- **Enrichable damage entries** — bare "takes 6 damage" lines from the dice
  roller can be given the missing attacker and a damage type from the same
  editor.
- Saving throws record their d20 and the DC; casts record whether they hold
  concentration — save rows and cast chips show them on every surface.

### Changed

- **Player-facing redaction** — the live phone log now shows a damage roll's
  thrown composition ("2d6 +4"); only the per-die results and attack-roll
  numbers stay DM-side. Past Combats browsed from a phone are no longer
  redacted at all — the fight is history, breakdowns included.
- Unpaired damage with dice math (area spells, save-based casts, dice-roller
  hits) shows its roll line under the "takes X damage" sentence, so the roll
  is visible even without an attack card.
- The combat-log sidebar auto-scrolls only when new entries arrive — never
  while an entry is being edited — and the archive's log uses a fixed-width
  card column.

### Fixed

- Damage compositions no longer repeat the modifier ("1W4+2 +2 = 5"): the
  bracket group is prefixed with the plain dice term.
- Long German verdicts ("kritischer Treffer!") wrapped the attack-roll row to
  two lines; card verdicts are now compact ("Krit!") and never wrap, and the
  save row's DC ("SG 14") stays on one line.

## [3.3.0] — 2026-08-19

### Added

- **Spellbook** — a global spell library beside the monsters: **Import SRD
  Spells** loads all 339 SRD 5.2.1 spells with full rules text in English and
  German; homebrew spells live in the same editor. A minimal structured layer
  (spell attack, save with its damage-on-success rule, damage/healing dice,
  linear upcast) covers what gets rolled — everything else stays readable
  rules text.
- **Spells as character actions** — attach a spell to a PC from the Party
  editor or the phone ("✨ From Spellbook"), supplying the caster's attack
  bonus or save DC. The copy is editable like any attack, which is also how
  cantrip dice scale as characters level.
- **Spell slots & casting** — per-level slot rows on the PC (straight off the
  character sheet); casting asks which slot to spend, previews the upcast
  bonus and decrements automatically. Cantrips cast free; Long Rest (Party
  screen or phone) restores everything. Healing spells roll and apply as
  healing, digital or manual with a what-to-roll hint; utility spells spend
  the slot and land in the log. The DM attack modal runs the same flow for
  players without a phone; slots show as pips on Party rows and the combat
  expander.
- **Concentration tracking** — casting a concentration spell tags the
  character (condition-style chip on the DM combat row with ✕, phone
  initiative rows and the Player View). Damage prompts the claiming phone
  with the Constitution save (DC = half the damage, min 10) — rolled
  digitally or typed with a hint; a failed save or going down breaks the
  spell. The Stream Deck's condition grid gains a one-shot **Ⓒ** key to end a
  single selected actor's Concentration.
- **Phone spellbook & character card** — a searchable reference of every
  imported spell with full rules text, and an out-of-combat home screen
  showing stats, notes, slot pips, Long Rest and quick navigation.
- Bridge protocol: combatants carry a localized `concentration` label; new
  `clearConcentration` command.

### Changed

- Save-based actions can now deal **no** damage on a successful save (Acid
  Splash and friends) instead of always half; every resolver and label
  respects the rule. Existing monster data keeps its half-on-save behavior.
- The phone's Spellbook and Past-combats links are proper outline buttons.

### Fixed

- Starting a second copy of the app while another held the player-web port
  left it stuck behind an "Uncaught Exception: EADDRINUSE" dialog with no
  window; the port conflict now surfaces only as the Settings status text.

## [3.2.0] — 2026-08-18

### Added

- **Campaigns** — run several tables from one install: Party, Encounters,
  Combat and Archive are scoped per campaign and hot-swap from the new sidebar
  selector, even mid-combat. A fight left behind resumes exactly where it stood
  when you switch back. The monster library and settings stay shared.
- **Campaign manager** (✎) — create, rename and delete campaigns; the active
  and the last remaining campaign are protected from deletion.

### Changed

- **Player phones follow the active campaign** — on a switch they drop to the
  new campaign's claim screen, and a previously claimed PC re-attaches
  automatically on switch-back.
- **Existing data migrates automatically** — everything becomes "Main
  Campaign" on first launch, unchanged. Fresh installs silently start with one.

## [3.1.2] — 2026-08-18

### Changed

- **Archive layout** — the past-combat selector stays put and scrolls in its
  own pane, and the opened log scrolls independently beside it, so long
  archives browse without either side jumping around.

### Fixed

- The Archive frames flush with the window edges like the combat screen — no
  more dead window-edge scrollbar.

## [3.1.1] — 2026-08-17

### Added

- **Save rolls get the dice treatment** — rolling a save-based action
  digitally tumbles and settles the damage dice like an attack, then shows the
  breakdown and total while the DM adjudicates. The resolution screen
  highlights each target: saved (half) in green, failed (full) in red.

### Changed

- **No more log-sniping** — the combat-log entry, the Kenku verdict sound and
  the damage application wait until the roller's phone animation has revealed
  the result (~3.6 s attacks, ~2.9 s damage). Everyone learns the outcome at
  the same moment the roller does.

## [3.1.0] — 2026-08-17

### Added

- **Advantage / Disadvantage** on every attack-rolling surface — DM attack
  modal, player phones and the Stream Deck (⬆/⬇ toggle keys). Two d20s are
  thrown, the higher (or lower) counts; crits and nat 1s judge the kept die.
- **Split phone rolls** — attack and damage roll separately when rolling
  digitally: roll the d20, see the verdict, then roll damage on a hit. A miss
  never rolls damage.
- **Die-glyph roll animation** — one flat polyhedral die per die thrown, the
  cycling number on its face; the dice settle on their real numbers before the
  verdict builds around them with the full math spelled out.
- Manual rolling now says what to throw ("d20 +5", the attack's damage line).
- **Damage types in the log** — unambiguous types are named and tinted in
  their color; dice math carries Adv./Dis. tags with the discarded d20 struck
  through.

### Changed

- The combat screen owns its viewport: the initiative list scrolls in its own
  column, the log is wider and frames flush with the window edges.
- Player actions are attributed as **Phone (name)** using the claim name or a
  device label.
- Monster names localize everywhere (dice roller targets, modals, log
  snapshots).
- Bridge protocol: `applyDamage` gains optional `mathTypes`, `attackEvent`
  roll details gain optional `dice`.

### Fixed

- The Kenku FM settings grid lines up.

## [3.0.0] — 2026-08-17

### Added

- **PC stat blocks** — the six ability scores plus free-text notes; the
  scores power the save-DC modal's roll buttons, and players see their own
  stats on their phone.
- **Dice math on every roll** in the combat log — `d20 15 + 4 = 19`, damage
  composition `2d6 [3+5] +4 = 12` — from the DM modal, the deck and phones
  alike. DM-side only: phones never receive dice compositions.
- **Log attribution everywhere** — every damage/heal names its actor; hits
  red, misses dark red, crits amber; player actions tagged **Phone (name)**
  with a device-label fallback.
- **Add Monster** is a searchable multi-select — full names, HP/AC per row,
  several monster types in one go, German search included.
- Structured damage editors (dice stepper + die + bonus + type) for PC
  attacks, monster attacks and the phone.

### Changed

- **D&D Combat Tracker is now Deck of Many Turns.** Data migrates
  automatically from the old `%APPDATA%/dnd-combat-tracker` location (the old
  folder stays as a backup). The Stream Deck plugin keeps its UUID and
  upgrades in place — keys and profiles stay put.
- Combat Archive uses a two-pane layout, newest fight preselected.
- Dice Roller rebuilt: stacked layout, full-width roll button, flush grid of
  apply-to targets.
- The log sidebar uses the full window height; log names always localize.
- Phones: clearer back buttons, a tappable combat-log bar, a stat preview on
  your own card, complete German coverage (W20 statt d20, localized dates).

## [2.1.0] — 2026-08-17

### Added

- **The DM can roll PC attacks** — on a player's turn the row shows the same
  Attack button monsters get; no phone required.
- The phone's attack editor uses structured pickers: die selector, +/− count
  stepper, bonus field and a damage-type dropdown with a custom escape hatch.

### Changed

- **Laptop-first UI overhaul** — dark is the new default theme (existing
  installs keep their choice), the Inter typeface is bundled, and the combat
  list is a true table: initiative, name, HP, AC and actions in fixed columns
  that never shift. Bloodied is a 🩸 in the HP cell; conditions are removable
  chips picked from a checklist popover.
- **One color language** — PCs are navy-blue on the deck's picker keys,
  blue-edged on the phone and blue-marked in the DM table and log; monsters
  stay amber.
- The combat log lives in a collapsible right-hand sidebar and highlights
  like a dev log: PC names blue, monsters orange, damage red, healing green,
  crits amber, with a muted d20 math line and right-justified source tags.
- Bridge protocol: `attackEvent` roll blocks carry the target's type, and
  verdicts log even without a roll block.

### Fixed

- A class collision that broke the Monster/Party table borders.
- The combat list overflowing beneath the log panel on narrow windows.

## [2.0.0] — 2026-08-17

### Added

- **Player web companion** — an opt-in mobile webpage on your Wi-Fi: players
  claim their character via QR code (claims survive restarts, the DM can kick
  them), follow initiative live, deal damage and healing, and roll their
  attacks — app-rolled or "I roll my dice" with typed results. Save-based
  actions open an adjudication modal on the DM window; saves take half.
  Turn gating is enforced server-side (strict or relaxed). Monster HP and AC
  never leave the machine.
- **Players build their own attacks** on the phone, saved straight to the
  DM's library.
- **Combat log** — everything is logged with who-did-what-to-whom and its
  source (DM window / Stream Deck / phone). Phones get a one-line ticker that
  pulls up into the full log, with monster roll numbers hidden.
- **Combat Archive** — ended combats keep their complete log, browsable from
  phones too, until you delete them.

### Changed

- Bridge protocol: combatants carry `type`, `attackEvent` accepts an optional
  `roll` block (backward compatible). The deck reports attack-roll details
  for the log.
- Kenku FM per-attack sounds work on PC attacks as well.
- The log is fully localized — switching language re-renders history.

## [1.3.0] — 2026-08-16

### Added

- **Kenku FM integration** — event sounds (combat start/end, turn change,
  damage, healing, PC down, monster killed, crit/hit/miss) with optional
  delays; per-attack sounds with trigger points (attack roll / hit / damage
  roll / damage applied); one encounter playlist per template that starts and
  pauses with combat; a soundboard panel with Stop All. Everything is
  fail-soft — Kenku being closed never blocks combat.
- New `attackEvent` bridge message: the deck reports its attack flow, so
  per-attack sounds fire identically from the DM window and the Stream Deck.
  Update app and plugin together (older pairs degrade gracefully).

## [1.2.0] — 2026-08-16

### Added

- **Bloodied indication for player characters** — the Player View's
  progressive red treatment now applies to PC cards too (chroma-key-safe;
  downed keeps its own muted look).
- The DM combat list tints rows progressively redder below half HP, with a
  **BLOODIED** badge beside the HP.

## [1.1.3] — 2026-08-16

### Fixed

- The Stream Deck plugin showed a placeholder purple hexagon in the Stream
  Deck app's action list — both its icons are now the same d20 as the app.

## [1.1.2] — 2026-08-15

### Fixed

- Action rows wrap to their actual content, so longer German labels no longer
  clip buttons out of encounter-template cards, screen headers, modals or the
  combat list (verified at 900–1600 px in both languages).
- The *downed* tag on combat rows was the last unlocalized string.

## [1.1.1] — 2026-08-15

### Added

- **A real app icon** — a crimson d20 with a gold wireframe, with
  size-specific `.ico` variants so it stays crisp from 256 px tiles down to
  the 16 px title-bar corner.

## [1.1.0] — 2026-08-15

### Added

- **Full English / German localization** — one Language selector switches the
  DM window, the Player View and the Stream Deck plugin together; the deck
  relabels its keys live. Game terminology follows the SRD 5.2.1 in each
  language.
- **Imported monsters translate themselves** — German names, action names and
  full German rules text for 327 of 331 SRD monsters (854 actions); libraries
  imported under 1.0.0 are backfilled automatically. Search matches German
  names; stored data stays language-neutral.
- **Battle-grid squares** — every reach and range shows its size on a 1-inch
  grid: `reach 10 ft. (2 sq)`, `Reichweite 3 m (2 Felder)`.
- Localized save DCs (`GES-Rettungswurf SG 18`) on the DM window and the deck.

## [1.0.0] — 2026-08-15

First packaged release.

### Added

- **DM window** — PC and monster libraries, encounter templates, initiative
  tracking, live HP and conditions, a monster quick reference with ability
  table, a dice roller and mid-combat monster adds. 331 SRD 5.2.1 monsters
  importable in one click.
- **Player View** — display-only second-monitor window; monster HP never
  shown, monsters redden progressively once bloodied, layout auto-fits any
  actor count, styled for chroma keying.
- **Stream Deck plugin** — turn keys that name the actual actors, a
  damage/heal numpad, multi-actor condition toggles, monster attack rolls
  with saving-throw handling, a dice roller and end-combat confirmation.
  Picker profiles for MK.2 (5×3), XL (8×4) and 9×4 decks.
- Four themes; local-only JSON storage.

[Unreleased]: https://github.com/Lil-Dank/deck-of-many-turns/compare/v3.6.0...HEAD
[3.6.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.6.0
[3.5.1]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.5.1
[3.5.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.5.0
[3.4.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.4.0
[3.3.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.3.0
[3.2.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.2.0
[3.1.2]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.1.2
[3.1.1]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.1.1
[3.1.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.1.0
[3.0.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v3.0.0
[2.1.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v2.1.0
[2.0.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v2.0.0
[1.3.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.3.0
[1.2.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.2.0
[1.1.3]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.1.3
[1.1.2]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.1.2
[1.1.1]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.1.1
[1.1.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.1.0
[1.0.0]: https://github.com/Lil-Dank/deck-of-many-turns/releases/tag/v1.0.0
