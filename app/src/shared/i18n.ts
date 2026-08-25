/**
 * UI localization. Two languages, no runtime loading: the dictionaries are
 * bundled so the DM window, the Player View and the Stream Deck plugin all
 * resolve the same key to the same string without a fetch.
 *
 * Game terminology (conditions, abilities, damage types) comes from the German
 * SRD 5.2.1 rather than a general translation, so what the app shows matches
 * what a German-speaking table reads in the rules.
 */
import type { Condition } from './types';

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['id'];
export const DEFAULT_LANG: Lang = 'en';

/** Conditions as named in the German SRD 5.2.1 glossary ("Zustände"). */
export const CONDITION_DE: Record<Condition, string> = {
  Blinded: 'Blind',
  Charmed: 'Bezaubert',
  Deafened: 'Taub',
  Exhaustion: 'Erschöpft',
  Frightened: 'Verängstigt',
  Grappled: 'Gepackt',
  Incapacitated: 'Kampfunfähig',
  Invisible: 'Unsichtbar',
  Paralyzed: 'Gelähmt',
  Petrified: 'Versteinert',
  Poisoned: 'Vergiftet',
  Prone: 'Liegend',
  Restrained: 'Festgesetzt',
  Stunned: 'Betäubt',
  Unconscious: 'Bewusstlos',
};

/** Ability abbreviations, matching the SRD stat block headers in each language. */
export const ABILITY_DE = { str: 'Stä', dex: 'Ges', con: 'Kon', int: 'Int', wis: 'Wei', cha: 'Cha' };
export const ABILITY_EN = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

/** Damage types, as printed in the German SRD. */
export const DAMAGE_TYPE_DE: Record<string, string> = {
  acid: 'Säure',
  bludgeoning: 'Wucht',
  cold: 'Kälte',
  fire: 'Feuer',
  force: 'Energie',
  lightning: 'Blitz',
  necrotic: 'Nekrotisch',
  piercing: 'Stich',
  poison: 'Gift',
  psychic: 'Psychisch',
  radiant: 'Gleißend',
  slashing: 'Hieb',
  thunder: 'Donner',
};

/** Schools of magic, as named in the German SRD 5.2.1. */
export const SPELL_SCHOOL_DE: Record<string, string> = {
  abjuration: 'Bannmagie',
  conjuration: 'Beschwörung',
  divination: 'Erkenntnismagie',
  enchantment: 'Verzauberung',
  evocation: 'Hervorrufung',
  illusion: 'Illusion',
  necromancy: 'Nekromantie',
  transmutation: 'Verwandlung',
};

/**
 * German words for the enumerable parts of a spell header (casting times,
 * range keywords, duration keywords, component letters). Free-text values
 * (manual spells, material descriptions) pass through untranslated — the
 * same split the monster library makes.
 */
const SPELL_WORD_DE: Record<string, string> = {
  Action: 'Aktion',
  'Bonus Action': 'Bonusaktion',
  Reaction: 'Reaktion',
  '1 Minute': '1 Minute',
  '10 Minutes': '10 Minuten',
  '1 Hour': '1 Stunde',
  'or Ritual': 'oder Ritual',
  Touch: 'Berührung',
  Self: 'Selbst',
  Instantaneous: 'Unmittelbar',
  Concentration: 'Konzentration',
  'up to': 'bis zu',
  round: 'Runde',
  rounds: 'Runden',
  minute: 'Minute',
  minutes: 'Minuten',
  hour: 'Stunde',
  hours: 'Stunden',
  day: 'Tag',
  days: 'Tage',
  'until dispelled': 'bis zur Bannung',
  'until dispelled or triggered': 'bis zur Bannung oder Auslösung',
  special: 'besonders',
};

/** Class names as in the German SRD 5.2.1. */
const SPELL_CLASS_DE: Record<string, string> = {
  Barbarian: 'Barbar',
  Bard: 'Barde',
  Cleric: 'Kleriker',
  Druid: 'Druide',
  Fighter: 'Kämpfer',
  Monk: 'Mönch',
  Paladin: 'Paladin',
  Ranger: 'Waldläufer',
  Rogue: 'Schurke',
  Sorcerer: 'Zauberer',
  Warlock: 'Hexenmeister',
  Wizard: 'Magier',
};

export function spellClassLabel(lang: Lang, cls: string): string {
  return lang === 'de' ? (SPELL_CLASS_DE[cls] ?? cls) : cls;
}

export function spellSchoolLabel(lang: Lang, school: string): string {
  return lang === 'de' ? (SPELL_SCHOOL_DE[school] ?? school) : school.charAt(0).toUpperCase() + school.slice(1);
}

/** "Cantrip" / "Level 3" — DE "Zaubertrick" / "3. Grad". */
export function spellLevelLabel(lang: Lang, level: number): string {
  if (level === 0) return lang === 'de' ? 'Zaubertrick' : 'Cantrip';
  return lang === 'de' ? `${level}. Grad` : `Level ${level}`;
}

// Longest phrases first, so "until dispelled or triggered" wins over
// "until dispelled" and "up to" is replaced as a unit.
const SPELL_WORD_ENTRIES = Object.entries(SPELL_WORD_DE)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([enWord, deWord]) => ({
    re: new RegExp(`\\b${enWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
    de: deWord,
  }));

/**
 * Translates a spell header value (casting time, range, duration) phrase by
 * phrase using SPELL_WORD_DE; unknown words pass through untranslated.
 * Distances convert to meters like the German SRD (5 ft = 1,5 m).
 */
export function spellField(lang: Lang, value: string): string {
  if (lang !== 'de' || !value) return value;
  let out = value.replace(/(\d+)[ -](?:feet|foot)/g, (_, n) => {
    const meters = (Number(n) / 5) * 1.5;
    return `${String(meters).replace('.', ',')} Meter`;
  });
  for (const { re, de } of SPELL_WORD_ENTRIES) out = out.replace(re, de);
  return out;
}

/** Component string for display: German swaps S (Somatic) for G (Gestik). */
export function spellComponents(lang: Lang, components: string): string {
  if (lang !== 'de') return components;
  return components.replace(/\bS\b/, 'G');
}

type Dict = Record<string, string>;

const en: Dict = {
  'app.title': 'Deck of Many Turns',
  'app.loading': 'Loading…',
  'app.playerViewTitle': 'Deck of Many Turns — Player View',
  'nav.combat': 'Combat',
  'nav.party': 'Party',
  'nav.monsters': 'Monsters',
  'nav.spellbook': 'Spellbook',
  'nav.encounters': 'Encounters',
  'nav.settings': 'Settings',
  'nav.openPlayerView': 'Open Player View',
  'nav.closePlayerView': 'Close Player View',
  'nav.fullscreen': 'Fullscreen',
  'nav.deckConnected': 'Stream Deck connected',
  'nav.deckOffline': 'Stream Deck offline',

  'common.add': 'Add',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.duplicate': 'Duplicate',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.name': 'Name',
  'common.maxHp': 'Max HP',
  'common.ac': 'AC',
  'common.initMod': 'Init mod',
  'common.quantity': 'Quantity',

  'pcs.title': 'Party',
  'pcs.add': '+ Add Character',
  'pcs.empty': 'No characters yet. Add your players here.',
  'pcs.deleteConfirm': 'Delete {name}?',

  'monsters.title': 'Monster Library',
  'monsters.import': '⤓ Import SRD Monsters',
  'monsters.add': '+ Add Monster',
  'monsters.search': 'Search monsters…',
  'monsters.actions': 'Actions',
  'monsters.source': 'Source',
  'monsters.empty': 'No monsters yet. Import the SRD set or add your own.',
  'monsters.deleteConfirm': 'Delete {name}? It will also be removed from any encounter templates.',
  'monsters.abilities': 'Ability scores',
  'monsters.attacks': 'Attacks',
  'monsters.toHit': 'to hit',
  'monsters.reach': 'reach',
  'monsters.range': 'range',
  'monsters.save': 'save',
  'monsters.dc': 'DC',

  'spellbook.title': 'Spellbook',
  'spellbook.import': '⤓ Import SRD Spells',
  'spellbook.add': '+ Add Spell',
  'spellbook.search': 'Search spells…',
  'spellbook.empty': 'No spells yet. Import the SRD set or add your own.',
  'spellbook.deleteConfirm': 'Delete {name}? PCs keep any copies already attached to their actions.',
  'spellbook.imported': 'Imported {n} spells from the SRD 5.2.1 dataset.',
  'spellbook.level': 'Level',
  'spellbook.school': 'School',
  'spellbook.castingTime': 'Casting Time',
  'spellbook.range': 'Range',
  'spellbook.components': 'Components',
  'spellbook.duration': 'Duration',
  'spellbook.classes': 'Classes',
  'spellbook.concentration': 'Concentration',
  'spellbook.ritual': 'Ritual',
  'spellbook.editSpell': 'Edit Spell',
  'spellbook.addSpell': 'Add Spell',
  'spellbook.rollLayer': 'Rolls',
  'spellbook.rollLayerNote': '(what gets rolled at the table — everything else stays in the text)',
  'spellbook.attackRoll': 'Spell attack roll',
  'spellbook.saveAbility': 'Save',
  'spellbook.onSuccess': 'On success',
  'spellbook.onSuccessHalf': 'Half damage',
  'spellbook.onSuccessNone': 'No damage',
  'spellbook.damage': 'Damage',
  'spellbook.healing': 'Healing dice',
  'spellbook.upcast': 'Upcast',
  'spellbook.upcastPerLevel': '+{dice} per slot level above {level}',
  'spellbook.text': 'Rules text',
  'spellbook.noSave': 'None',

  'templates.title': 'Encounter Templates',
  'templates.new': '+ New Template',
  'templates.start': '⚔ Start Combat',
  'templates.monsters': 'monsters',
  'templates.empty': 'No templates yet. Build a reusable encounter here.',
  'templates.deleteConfirm': 'Delete template {name}?',

  'combat.title': 'Combat',
  'combat.round': 'Round {n}',
  'combat.begin': 'Begin Combat',
  'combat.end': 'End Combat',
  'combat.next': 'Next Turn ➜',
  'combat.prev': '⬅ Prev',
  'combat.addMonster': '+ Add Monster',
  'combat.diceRoller': '🎲 Dice Roller',
  'combat.conditions': 'Conditions',
  'combat.attacks': 'Attacks',
  'combat.attack': '🎲 Attack',
  'combat.damage': 'Dmg',
  'combat.heal': 'Heal',
  'combat.downed': 'downed',
  'combat.rollAll': 'Roll for all',
  'combat.rollMonsters': 'Roll for monsters only',
  'combat.endConfirm': 'End the current combat?',
  'combat.initiative': 'Initiative',

  'pv.turn': '⚔ Turn',
  'pv.downed': '💀 Downed',
  'pv.bloodied': 'Bloodied',

  'dice.title': 'Dice Roller',
  'dice.roll': '🎲 Roll',
  'dice.addDice': '+ Dice',
  'dice.total': 'Total',
  'dice.applyDamage': '⚔ Damage',
  'dice.applyHeal': '✚ Heal',
  'dice.modifier': 'Modifier',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.themeBrand': 'Brand',
  'settings.themePaper': 'Paper',
  'settings.themeNote': 'Applies to the DM window. The Player View keeps its own look.',
  'settings.language': 'Language',
  'settings.languageNote':
    'Applies to the DM window, the Player View and the Stream Deck plugin. Game terms follow the SRD 5.2.1 in the chosen language.',
  'settings.combatScreen': 'DM Combat Screen',
  'settings.autoOpen':
    'Automatically open the attack quick reference for the monster whose turn it is',
  'settings.playerView': 'Player View',
  'settings.bgColor': 'Background color',
  'settings.bridge': 'Stream Deck bridge',
  'settings.port': 'WebSocket port',
  'settings.portNote':
    'Default 57321. Change only on a port conflict, and set the same port in the Stream Deck plugin settings. Status: {status}.',
  'settings.connected': 'connected',
  'settings.noPlugin': 'no plugin connected',
  'settings.about': 'About / Credits',
  'settings.credits': 'Monster data: SRD 5.2.1 by Wizards of the Coast, licensed under',
  'settings.creditsDataset': '. Dataset: Open5e (srd-2024).',
  'settings.creditsNote':
    'German rules terminology is taken from the German SRD 5.2.1. Monster names absent from it stay in English.',

  'pw.section': 'Player Web (phones)',
  'pw.enable': 'Enable the player web server',
  'pw.enableNote':
    'Hosts a mobile page on your Wi-Fi where players claim their character, follow the initiative order, and act on their turn. The app works fully without it. Windows asks for firewall permission on first enable.',
  'pw.port': 'HTTP port',
  'pw.gating': 'Off-turn actions',
  'pw.gating.strict': 'Strict — players act only on their own turn',
  'pw.gating.relaxed': 'Relaxed — own damage/heal allowed anytime',
  'pw.claims': 'Claimed characters',
  'pw.noClaims': 'No characters claimed yet.',
  'pw.kick': 'Kick',
  'pw.connected': 'online',
  'pw.offline': 'offline',
  'pw.claimedBy': 'claimed by {name}',
  'pw.qrTitle': 'Scan to join',
  'pw.qrButton': 'Player Access',
  'pw.urlNote': 'Phones must be on the same Wi-Fi/network as this PC.',
  'pw.noNetwork': 'No network interface found — is this PC connected to a network?',
  'pw.error': 'Server error: {code} — try another port.',
  'pw.saveTitle': 'Saving throw — {attack}',
  'pw.saveInfo':
    '{actor} forces a {ability} saving throw (DC {dc}). Damage: {damage} (half on a success).',
  'pw.saveInfoNone':
    '{actor} forces a {ability} saving throw (DC {dc}). Damage: {damage} (none on a success).',
  'pw.saveSaved': 'saved',
  'pw.saveFailed': 'failed',
  'pw.saveApply': 'Apply',
  'pw.saveDismiss': 'Dismiss',

  'log.combatStart': 'Combat started',
  'log.combatEnd': 'Combat ended',
  'log.turn': "{actor}'s turn",
  'log.damage': '{target} took {amount} damage',
  'log.damageBy': '{actor} dealt {amount} damage to {target}',
  'log.damageTyped': '{target} took {amount} {type} damage',
  'log.damageByTyped': '{actor} dealt {amount} {type} damage to {target}',
  'log.adv': 'Adv.',
  'log.dis': 'Dis.',
  'log.heal': '{target} healed {amount} HP',
  'log.healBy': '{actor} healed {target} for {amount} HP',
  'log.attack': '{actor}: {attack} vs {target} — {total}, {outcome}',
  'log.attackNoTarget': '{actor}: {attack} — {total}, {outcome}',
  'log.attackNoNums': '{actor}: {attack} vs {target} — {outcome}',
  'log.attackNoNumsNoTarget': '{actor}: {attack} — {outcome}',
  'log.outcome.crit': 'critical hit!',
  'log.outcome.hit': 'hit',
  'log.outcome.miss': 'miss',
  'log.cast': '{actor} casts {spell} (level {level})',
  'log.castCantrip': '{actor} casts {spell}',
  'log.saveSuccess': '{actor} saved against {attack} ({total})',
  'log.saveFail': '{actor} failed the save against {attack} ({total})',
  'log.conditionAdded': '{target} is {condition}',
  'log.conditionRemoved': '{target} is no longer {condition}',
  'log.down': '{target} went down',
  'log.kill': '{target} was slain',

  'log.card.takes': 'takes {amount} damage',
  'log.card.takesTyped': 'takes {amount} {type} damage',
  'log.card.takesFrom': 'takes {amount} damage — from {actor}',
  'log.card.takesTypedFrom': 'takes {amount} {type} damage — from {actor}',
  'log.card.heals': 'heals {amount} HP',
  'log.card.healsFrom': 'heals {amount} HP — from {actor}',
  'log.card.is': 'is {condition}',
  'log.card.noLonger': 'no longer {condition}',
  'log.card.down': '💀 goes down',
  'log.card.kill': '💀 slain',
  'log.card.casts': 'casts',
  'log.card.cantrip': 'Cantrip',
  'log.card.slot': 'Level {n} slot',
  'log.card.saveOk': 'saved',
  'log.card.saveFail': 'failed',
  'log.card.outcome.hit': 'hit',
  'log.card.outcome.miss': 'miss',
  'log.card.outcome.crit': 'crit!',
  'log.card.vsDc': 'vs DC {dc}',
  'log.card.save': 'Save',
  'log.card.savingThrow': '{attack} saving throw',
  'log.card.savingThrowOf': '{attack} {ability} saving throw',
  'log.card.attack': 'Attack',
  'log.card.damageLabel': 'Damage',
  'log.card.keep': 'keep {die}',
  'log.card.agoS': '{n}s ago',
  'log.card.agoM': '{n}m ago',
  'log.card.agoH': '{n}h ago',
  'log.card.f.amount': 'Amount',
  'log.card.f.type': 'Type',
  'log.card.f.from': 'From',
  'log.card.f.target': 'Target',
  'log.card.f.total': 'Total',
  'log.card.f.outcome': 'Outcome',
  'log.card.f.spell': 'Spell',
  'log.card.f.slot': 'Slot level',
  'log.card.f.condition': 'Condition',
  'log.card.deleteConfirm':
    'Delete this log entry? Damage and healing it applied will be reverted.',
  'log.src.dm': 'DM',
  'log.src.deck': 'Deck',
  'log.src.player': 'Phone',
  'log.round': 'Round {round}',

  'mob.pickPc': 'Choose your character',
  'mob.taken': 'taken',
  'mob.yourName': 'Your name (optional)',
  'mob.join': 'Join as {name}',
  'mob.kicked': 'The DM freed this character.',
  'mob.connecting': 'Connecting…',
  'mob.disconnected': 'Connection lost — retrying…',
  'mob.noCombat': 'No combat running — hang tight!',
  'mob.yourTurn': 'Your turn!',
  'mob.notYourTurn': 'Wait for your turn',
  'mob.offTurnRelaxed': 'Not your turn — only self damage/heal allowed',
  'mob.damage': 'Damage',
  'mob.heal': 'Heal',
  'mob.attack': 'Attack',
  'mob.myAttacks': 'My Attacks',
  /* Ellipsis: the button opens a sheet with more behind it. */
  'mob.myAttacksMore': 'My attacks…',
  'mob.logTitle': 'Combat log',
  'mob.pickTargets': 'Pick target(s)',
  'mob.pickAttack': 'Pick an attack',
  'mob.amount': 'Amount',
  'mob.apply': 'Apply',
  'mob.roll': '🎲 Roll',
  'mob.digital': 'App rolls',
  'mob.manual': 'I roll my dice',
  'mob.d20Total': 'd20 total (incl. bonus)',
  'mob.nat20': 'Natural 20',
  'mob.nat1': 'Natural 1',
  'mob.damageRolled': 'Damage rolled',
  'mob.healRolled': 'Healing rolled',
  'mob.healedTarget': '{name} healed',
  'mob.pickAlly': 'choose who to heal',
  'mob.cast': 'Cast',
  'mob.longRestConfirm': 'Tap again to confirm',
  'mob.err.noSlot': 'No spell slot of that level left.',
  'mob.concInfo':
    'You took {damage} damage while concentrating on {spell} — make a DC {dc} Constitution saving throw to keep it.',
  'mob.concKept': 'Concentration held!',
  'mob.concLost': '{spell} slips away…',
  'mob.concVs': 'vs DC {dc}',
  'mob.resolve': 'Resolve',
  'mob.waitingDm': 'Waiting for the DM to roll saves…',
  'mob.dmgDealt': '{damage} damage dealt',
  'mob.noDamage': 'no damage applied',
  'mob.savedHalf': 'saved — half damage',
  'mob.failedFull': 'failed — full damage',
  'mob.cancelled': 'Cancelled by the DM.',
  'mob.release': 'Switch character',
  'mob.archive': 'Past combats',
  'mob.archiveEmpty': 'No archived combats yet.',
  'mob.rounds': '{rounds} rounds',
  'mob.roundsOne': '1 round',
  'mob.rolling': 'Rolling…',
  'mob.throwInfo': '{actor} forces a {ability} saving throw. Beat DC {dc}.',
  'mob.throwSaved': 'Made it!',
  'mob.throwFailed': 'Failed',
  'mob.throwMore': '{count} more waiting',
  'mob.rollAttack': 'Roll attack',
  'mob.rollDamage': '🎲 Roll damage',
  'mob.dmgDealtShort': 'damage dealt',
  'roll.adv': 'Advantage',
  'roll.normal': 'Normal',
  'roll.dis': 'Disadvantage',
  'mob.err.notYourTurn': 'Not your turn.',
  'mob.err.badTarget': 'Invalid target.',
  'mob.err.badAttack': 'Unknown attack.',
  'mob.done': 'Done',
  'mob.clear': 'C',
  'mob.typeNone': '—',
  'mob.err.generic': 'Something went wrong.',
  'mob.bonus': 'Bonus',
  'mob.dmgType': 'Damage type',
  'mob.typeOther': 'Other…',
  'mob.typeCustom': 'custom type',
  'mob.usePicker': 'use picker',

  'nav.archive': 'Archive',
  'archive.title': 'Combat Archive',
  'archive.empty': 'No archived combats yet — every ended combat lands here with its full log.',
  'archive.encounter': 'Encounter',
  'archive.ended': 'Ended',
  'archive.roundsCol': 'Rounds',
  'archive.rounds': '{rounds} rounds',
  'archive.roundsOne': '1 round',
  'campaign.manage': 'Manage campaigns',
  'campaign.modalTitle': 'Campaigns',
  'campaign.create': 'Create',
  'campaign.namePlaceholder': 'New campaign name…',
  'campaign.rename': 'Rename',
  'campaign.active': 'active',
  'campaign.deleteConfirm':
    'Delete this campaign and ALL its data (party, encounters, combat, archive)? This cannot be undone.',
  'campaign.cannotDeleteActive': 'The active campaign cannot be deleted',
  'campaign.cannotDeleteLast': 'The last campaign cannot be deleted',
  'archive.deleteConfirm': 'Delete this combat log permanently?',
  'logPanel.title': 'Combat log',
  'logPanel.collapse': 'Collapse',
  'logPanel.expand': 'Expand',
  'logPanel.empty': 'Actions will appear here as they happen.',

  'pcs.notes': 'Notes',
  'pcs.slots': 'Spell slots',
  'pcs.slotsNote': '(max per level, straight off the character sheet — casting tracks the rest)',
  'pcs.longRest': '🛌 Long Rest',
  'pcs.longRestNote': 'Restore all spell slots',
  'pcs.fromSpellbook': '✨ From Spellbook',
  'pcs.spellToHit': 'Spell attack bonus',
  'pcs.spellDc': 'Spell save DC',
  'pcs.attach': 'Attach',
  'pcs.spellChipNote': 'Attached from the Spellbook — casting asks for a slot',
  'pcs.notesNote': '(class, level, passive perception — shown on the player’s phone)',
  'pcs.attacks': 'Attacks',
  'pcs.attacksNote': '(rollable from the phone, the DM attack modal and the Stream Deck)',
  'pcs.noAttacks': 'No attacks yet — players can also add their own from their phone.',
  'pcs.addAttack': 'Add attack',
  'pcs.reach': 'Reach (ft)',
  'pcs.range': 'Range (ft)',

  'common.back': '← Back',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.search': 'Search…',

  'pcs.titleFull': 'Party — Player Characters',
  'pcs.emptyFull':
    'No player characters yet. Add your party here once — they persist and can join any combat.',
  'pcs.editPc': 'Edit PC',
  'pcs.addPc': 'Add PC',

  'templates.emptyTemplate': 'Empty template',
  'templates.combatInProgress': 'A combat is already in progress. End it and start a new one?',
  'templates.endAndStart': 'End & Start New',
  'templates.editTemplate': 'Edit Template',
  'templates.newTemplate': 'New Template',
  'templates.namePlaceholder': 'e.g. Goblin Ambush',
  'templates.inThisEncounter': 'In this encounter',
  'templates.addMonsters': 'Add monsters',
  'templates.searchLibrary': 'Search library…',

  'combat.startCombat': 'Start Combat',
  'combat.noPcs': 'No PCs in the party yet — you can still run a monsters-only combat.',
  'combat.rollAllNote': 'Auto-roll monsters and PCs (d20 + modifier)',
  'combat.rollMonstersNote': 'Players roll at the table; you type in their results',
  'combat.initiativeOrder': 'Initiative Order',
  'combat.enterInitFirst': 'Enter initiative for every PC first',
  'combat.reroll': 'Re-roll',
  'combat.endThisCombat': 'End this combat?',
  'combat.armorClass': 'Armor Class',
  'combat.applyDamage': 'Apply damage (Enter)',
  'combat.applyHealing': 'Apply healing (Shift+Enter)',
  'combat.rollMonsterAttack': 'Roll this monster\u2019s attack (same flow as the Stream Deck)',
  'combat.clickToRemove': 'Click to remove',
  'combat.noCombatants': 'No combatants left. End the combat when you are done.',
  'combat.addMonsterToCombat': 'Add Monster to Combat',

  'monsters.importing': 'Importing…',
  'monsters.manual': 'Manual',
  'monsters.showActions': 'Show actions',
  'monsters.noActions': 'No actions recorded.',
  'monsters.editMonster': 'Edit Monster',
  'monsters.addMonster': 'Add Monster',
  'monsters.abilitiesNote': '(optional — modifiers derive automatically)',
  'monsters.actionsNote': '(attacks, saves, abilities — DM-only reference)',
  'monsters.section.action': 'Action',
  'monsters.section.bonus_action': 'Bonus Action',
  'monsters.section.reaction': 'Reaction',
  'monsters.section.legendary_action': 'Legendary',
  'monsters.section.trait': 'Trait',
  'monsters.type.attack': 'Attack roll',
  'monsters.type.save': 'Saving throw',
  'monsters.type.other': 'Other',
  'monsters.kind.melee': 'Melee',
  'monsters.kind.ranged': 'Ranged',
  'monsters.kind.melee_or_ranged': 'Melee or Ranged',

  'attack.pickAttack': 'Pick an attack',
  'attack.rollAttack': '🎲 Roll Attack',
  'attack.rollDamage': '🎲 Roll Damage',
  'attack.whoSaved': 'Saving throws →',
  'attack.apply': '⚔ Apply {total}',

  'dice.amount': 'Amount',
  'dice.extraAmount': 'Extra amount',
  'dice.applyTo': 'Apply to',
  'dice.pickOneOrMore': '(pick one or more)',
  'dice.rollFirst': 'Roll first',
  'attack.heading': '🎲 {name} attacks',
  'attack.pickTargetsFor': '{name} — pick targets',
  'attack.pickTargetFor': '{name} — pick a target',
  'attack.severalAllowed': '(save-based: several allowed)',
  'attack.vsTarget': 'vs {name} — AC {ac}',
  'attack.whoSucceeded': 'Who succeeded the {ability} save DC {dc}?',
  'attack.rollSaves': 'Roll each {ability} saving throw vs DC {dc}',
  'attack.rollAllSaves': 'Roll all',
  'save.concTitle': 'Concentration — {spell}',
  'save.title': '{attack} — {ability} saving throw',
  'save.concInfo': '{actor} took {damage} damage. Beat DC {dc} or {spell} ends.',
  'save.info': 'Beat DC {dc} or take the hit.',
  'save.waitingFor': 'waiting for {who}…',
  'save.answeredBy': 'by {who}',
  'save.more': '{count} more pending',
  'save.dismiss': 'Not now',
  'save.apply': 'Apply',
  'save.deferred': '{ability} saving throw owed',
  'save.throwIt': 'Throw it',
  'attack.savedTakeHalf': '(saved take {half} instead of {full})',
  'attack.savedTakeNone': '(saved take no damage)',
  'attack.applyHeal': '✚ Apply healing ({total})',

  'cast.slotTitle': 'Cast {spell} — choose a slot',
  'cast.slotBtn': 'Level {n} — {left} left',
  'cast.noSlots': 'No slot of that level left — take a Long Rest.',
  'attack.recharge': 'Recharge {min}+',
  'combat.step1': '1. Pick an encounter template',
  'combat.step2': '2. Choose the PCs joining the fight',
  'combat.step3': '3. Initiative',
  'combat.hpAc': 'HP {hp} · AC {ac}',
  'combat.setupHint':
    'Monsters are rolled automatically (🎲 to re-roll). Drag rows to break ties manually.',
  'combat.mod': 'mod',
  'kenku.section': 'Kenku FM',
  'kenku.enable': 'Enable Kenku FM integration',
  'kenku.address': 'Kenku Remote address',
  'kenku.statusConnected': 'connected',
  'kenku.statusOffline': 'not reachable',
  'kenku.test': 'Test connection',
  'kenku.outputNote':
    'Sounds play through Kenku FM — the audio output device is chosen in Kenku FM\u2019s own settings. Enable \u201cKenku Remote\u201d in Kenku FM under Settings.',
  'kenku.events': 'Event sounds',
  'kenku.eventsNote':
    'Each event can trigger one Kenku soundboard sound, with an optional delay. Per-attack sounds (set in the monster editor) can fire alongside these.',
  'kenku.noSound': '— no sound —',
  'kenku.noPlaylist': '— no playlist —',
  'kenku.delay': 'Delay (ms)',
  'kenku.preview': 'Play',
  'kenku.playlist': 'Kenku playlist',
  'kenku.playlistNote': 'Starts when combat begins from this encounter; playback pauses when combat ends.',
  'kenku.offline': 'Kenku FM not reachable — check that Kenku Remote is enabled.',
  'kenku.offlineKeep': 'Kenku offline — keeping “{title}”',
  'kenku.sound': 'Kenku sound',
  'kenku.trigger': 'Plays on',
  'kenku.trg.attackRoll': 'Attack roll',
  'kenku.trg.attackHit': 'Hit',
  'kenku.trg.damageRoll': 'Damage roll',
  'kenku.trg.damageApplied': 'Damage applied',
  'kenku.soundboard': 'Kenku Soundboard',
  'kenku.stopAll': '■ Stop all',
  'kenku.refresh': '↻ Refresh',
  'kenku.ev.combatStart': 'Combat starts',
  'kenku.ev.combatEnd': 'Combat ends',
  'kenku.ev.turnChange': 'Turn changes',
  'kenku.ev.damageApplied': 'Damage applied',
  'kenku.ev.healApplied': 'Healing applied',
  'kenku.ev.pcDowned': 'A PC goes down',
  'kenku.ev.monsterKilled': 'A monster dies',
  'kenku.ev.attackCrit': 'Attack crits',
  'kenku.ev.attackHit': 'Attack hits',
  'kenku.ev.attackMiss': 'Attack misses',

  'unit.square': 'sq',
  'unit.squares': 'sq',



  'common.ok': 'OK',
  'common.section': 'Section',
  'common.type': 'Type',
  'common.kind': 'Kind',
  'common.dc': 'DC',

  'pcs.save': 'Save',

  'monsters.libraryEmpty':
    'The library is empty. Add monsters manually, or import the bundled SRD 5.2.1 set.',
  'monsters.f.toHit': 'To hit',
  'monsters.f.longRange': 'Long range',
  'monsters.f.saveAbility': 'Save ability',
  'monsters.f.damageDice': 'Damage dice',
  'monsters.f.flatDamage': 'Flat damage',
  'monsters.f.onlyIf': 'Only if…',
  'monsters.f.addDamage': '+ Add damage',
  'monsters.f.addAction': '+ Add action',

  'templates.noLibrary':
    'Add monsters to the library first — templates are built from monster-library entries.',
  'templates.emptyNote':
    'No encounter templates yet. A template is a reusable blueprint of monsters with quantities.',
  'templates.nameLabel': 'Template name',
  'templates.saveTemplate': 'Save Template',

  'combat.header': 'Combat',
  'combat.roundBadge': 'Round {n}',
  'combat.needTemplate':
    'Combat starts from an encounter template. Build one on the Encounters screen first.',
  'combat.rollInitiative': 'Roll Initiative →',
  'combat.beginCombat': '▶ Begin Combat',
  'combat.dmgBtn': '⚔ Dmg',
  'combat.healBtn': '✚ Heal',
  'combat.initiativeAuto':
    'Initiative is rolled automatically; the monster joins the order at its roll.',
  'combat.moreRefine': '…{n} more, refine search',
  'combat.toHit': 'to hit',
  'combat.saveDc': '{ability} save DC {dc}',
  'combat.targetsCount': '{ability} save DC {dc} — {n} target(s)',

  'dice.die': 'Die',
  'dice.addExtra': '＋ Add extra dice',
  'dice.rollPool': '🎲 Roll {pool}',

  'attack.crit': '💥 CRIT!',
  'attack.nat1': 'NAT 1 — MISS',
  'attack.hit': '✔ HIT',
  'attack.miss': '✘ MISS',
};

const de: Dict = {
  'app.title': 'Deck of Many Turns',
  'app.loading': 'Lädt…',
  'app.playerViewTitle': 'Deck of Many Turns – Spieleransicht',
  'nav.combat': 'Kampf',
  'nav.party': 'Gruppe',
  'nav.monsters': 'Monster',
  'nav.spellbook': 'Zauberbuch',
  'nav.encounters': 'Begegnungen',
  'nav.settings': 'Einstellungen',
  'nav.openPlayerView': 'Spieleransicht öffnen',
  'nav.closePlayerView': 'Spieleransicht schließen',
  'nav.fullscreen': 'Vollbild',
  'nav.deckConnected': 'Stream Deck verbunden',
  'nav.deckOffline': 'Stream Deck getrennt',

  'common.add': 'Hinzufügen',
  'common.edit': 'Bearbeiten',
  'common.delete': 'Löschen',
  'common.duplicate': 'Duplizieren',
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.done': 'Fertig',
  'common.name': 'Name',
  'common.maxHp': 'Max. TP',
  'common.ac': 'RK',
  'common.initMod': 'Ini-Mod',
  'common.quantity': 'Anzahl',

  'pcs.title': 'Gruppe',
  'pcs.add': '+ Charakter hinzufügen',
  'pcs.empty': 'Noch keine Charaktere. Trage hier deine Spieler ein.',
  'pcs.deleteConfirm': '{name} löschen?',

  'monsters.title': 'Monsterbibliothek',
  'monsters.import': '⤓ SRD-Monster importieren',
  'monsters.add': '+ Monster hinzufügen',
  'monsters.search': 'Monster suchen…',
  'monsters.actions': 'Aktionen',
  'monsters.source': 'Quelle',
  'monsters.empty': 'Noch keine Monster. Importiere den SRD-Satz oder lege eigene an.',
  'monsters.deleteConfirm':
    '{name} löschen? Das Monster wird auch aus allen Begegnungsvorlagen entfernt.',
  'monsters.abilities': 'Attributswerte',
  'monsters.attacks': 'Angriffe',
  'monsters.toHit': 'Angriffswurf',
  'monsters.reach': 'Reichweite',
  'monsters.range': 'Distanz',
  'monsters.save': 'Rettungswurf',
  'monsters.dc': 'SG',

  'spellbook.title': 'Zauberbuch',
  'spellbook.import': '⤓ SRD-Zauber importieren',
  'spellbook.add': '+ Zauber hinzufügen',
  'spellbook.search': 'Zauber suchen…',
  'spellbook.empty': 'Noch keine Zauber. Importiere das SRD-Set oder lege eigene an.',
  'spellbook.deleteConfirm':
    '{name} löschen? Bereits an Charaktere angehängte Kopien bleiben erhalten.',
  'spellbook.imported': '{n} Zauber aus dem SRD-5.2.1-Datensatz importiert.',
  'spellbook.level': 'Grad',
  'spellbook.school': 'Schule',
  'spellbook.castingTime': 'Zeitaufwand',
  'spellbook.range': 'Reichweite',
  'spellbook.components': 'Komponenten',
  'spellbook.duration': 'Wirkungsdauer',
  'spellbook.classes': 'Klassen',
  'spellbook.concentration': 'Konzentration',
  'spellbook.ritual': 'Ritual',
  'spellbook.editSpell': 'Zauber bearbeiten',
  'spellbook.addSpell': 'Zauber hinzufügen',
  'spellbook.rollLayer': 'Würfe',
  'spellbook.rollLayerNote': '(was am Tisch gewürfelt wird — alles andere bleibt im Text)',
  'spellbook.attackRoll': 'Zauberangriffswurf',
  'spellbook.saveAbility': 'Rettungswurf',
  'spellbook.onSuccess': 'Bei Erfolg',
  'spellbook.onSuccessHalf': 'Halber Schaden',
  'spellbook.onSuccessNone': 'Kein Schaden',
  'spellbook.damage': 'Schaden',
  'spellbook.healing': 'Heilungswürfel',
  'spellbook.upcast': 'Hochstufen',
  'spellbook.upcastPerLevel': '+{dice} je Zauberplatzgrad über {level}',
  'spellbook.text': 'Regeltext',
  'spellbook.noSave': 'Keiner',

  'templates.title': 'Begegnungsvorlagen',
  'templates.new': '+ Neue Vorlage',
  'templates.start': '⚔ Kampf starten',
  'templates.monsters': 'Monster',
  'templates.empty': 'Noch keine Vorlagen. Erstelle hier eine wiederverwendbare Begegnung.',
  'templates.deleteConfirm': 'Vorlage {name} löschen?',

  'combat.title': 'Kampf',
  'combat.round': 'Runde {n}',
  'combat.begin': 'Kampf beginnen',
  'combat.end': 'Kampf beenden',
  'combat.next': 'Nächster Zug ➜',
  'combat.prev': '⬅ Zurück',
  'combat.addMonster': '+ Monster hinzufügen',
  'combat.diceRoller': '🎲 Würfeln',
  'combat.conditions': 'Zustände',
  'combat.attacks': 'Angriffe',
  'combat.attack': '🎲 Angriff',
  'combat.damage': 'Schaden',
  'combat.heal': 'Heilen',
  'combat.downed': 'kampfunfähig',
  'combat.rollAll': 'Für alle würfeln',
  'combat.rollMonsters': 'Nur für Monster würfeln',
  'combat.endConfirm': 'Den laufenden Kampf beenden?',
  'combat.initiative': 'Initiative',

  'pv.turn': '⚔ Zug',
  'pv.downed': '💀 Kampfunfähig',
  'pv.bloodied': 'Blutend',

  'dice.title': 'Würfeln',
  'dice.roll': '🎲 Würfeln',
  'dice.addDice': '+ Würfel',
  'dice.total': 'Summe',
  'dice.applyDamage': '⚔ Schaden',
  'dice.applyHeal': '✚ Heilen',
  'dice.modifier': 'Modifikator',

  'settings.title': 'Einstellungen',
  'settings.appearance': 'Darstellung',
  'settings.theme': 'Design',
  'settings.themeBrand': 'Marke',
  'settings.themePaper': 'Papier',
  'settings.themeNote': 'Gilt für das SL-Fenster. Die Spieleransicht behält ihr eigenes Aussehen.',
  'settings.language': 'Sprache',
  'settings.languageNote':
    'Gilt für das SL-Fenster, die Spieleransicht und das Stream-Deck-Plugin. Spielbegriffe folgen dem SRD 5.2.1 in der gewählten Sprache.',
  'settings.combatScreen': 'SL-Kampfbildschirm',
  'settings.autoOpen':
    'Die Angriffsübersicht des Monsters, das gerade am Zug ist, automatisch öffnen',
  'settings.playerView': 'Spieleransicht',
  'settings.bgColor': 'Hintergrundfarbe',
  'settings.bridge': 'Stream-Deck-Brücke',
  'settings.port': 'WebSocket-Port',
  'settings.portNote':
    'Standard 57321. Nur bei Portkonflikten ändern und denselben Port in den Plugin-Einstellungen eintragen. Status: {status}.',
  'settings.connected': 'verbunden',
  'settings.noPlugin': 'kein Plugin verbunden',

  'pw.section': 'Spieler-Web (Handys)',
  'pw.enable': 'Spieler-Webserver aktivieren',
  'pw.enableNote':
    'Stellt im WLAN eine mobile Seite bereit, auf der Spieler ihren Charakter übernehmen, die Initiative verfolgen und in ihrem Zug handeln. Die App funktioniert auch ohne. Windows fragt beim ersten Aktivieren nach einer Firewall-Freigabe.',
  'pw.port': 'HTTP-Port',
  'pw.gating': 'Aktionen außerhalb des Zugs',
  'pw.gating.strict': 'Strikt — Spieler handeln nur im eigenen Zug',
  'pw.gating.relaxed': 'Locker — eigener Schaden/Heilung jederzeit',
  'pw.claims': 'Übernommene Charaktere',
  'pw.noClaims': 'Noch keine Charaktere übernommen.',
  'pw.kick': 'Entfernen',
  'pw.connected': 'online',
  'pw.offline': 'offline',
  'pw.claimedBy': 'übernommen von {name}',
  'pw.qrTitle': 'Zum Beitreten scannen',
  'pw.qrButton': 'Spieler-Zugang',
  'pw.urlNote': 'Handys müssen im selben WLAN/Netzwerk sein wie dieser PC.',
  'pw.noNetwork': 'Keine Netzwerkschnittstelle gefunden — ist dieser PC mit einem Netzwerk verbunden?',
  'pw.error': 'Serverfehler: {code} — anderen Port versuchen.',
  'pw.saveTitle': 'Rettungswurf — {attack}',
  'pw.saveInfo':
    '{actor} erzwingt einen {ability}-Rettungswurf (SG {dc}). Schaden: {damage} (halber bei Erfolg).',
  'pw.saveInfoNone':
    '{actor} erzwingt einen {ability}-Rettungswurf (SG {dc}). Schaden: {damage} (keiner bei Erfolg).',
  'pw.saveSaved': 'geschafft',
  'pw.saveFailed': 'verpatzt',
  'pw.saveApply': 'Anwenden',
  'pw.saveDismiss': 'Verwerfen',

  'log.combatStart': 'Kampf begonnen',
  'log.combatEnd': 'Kampf beendet',
  'log.turn': '{actor} ist am Zug',
  'log.damage': '{target} erleidet {amount} Schaden',
  'log.damageBy': '{actor} verursacht {amount} Schaden an {target}',
  'log.damageTyped': '{target} erleidet {amount} Schaden ({type})',
  'log.damageByTyped': '{actor} verursacht {amount} Schaden ({type}) an {target}',
  'log.adv': 'Vorteil',
  'log.dis': 'Nachteil',
  'log.heal': '{target} wird um {amount} TP geheilt',
  'log.healBy': '{actor} heilt {target} um {amount} TP',
  'log.attack': '{actor}: {attack} gegen {target} — {total}, {outcome}',
  'log.attackNoTarget': '{actor}: {attack} — {total}, {outcome}',
  'log.attackNoNums': '{actor}: {attack} gegen {target} — {outcome}',
  'log.attackNoNumsNoTarget': '{actor}: {attack} — {outcome}',
  'log.outcome.crit': 'kritischer Treffer!',
  'log.outcome.hit': 'Treffer',
  'log.outcome.miss': 'verfehlt',
  'log.cast': '{actor} wirkt {spell} ({level}. Grad)',
  'log.castCantrip': '{actor} wirkt {spell}',
  'log.saveSuccess': '{actor} schafft den Rettungswurf gegen {attack} ({total})',
  'log.saveFail': '{actor} verpatzt den Rettungswurf gegen {attack} ({total})',
  'log.conditionAdded': '{target} ist {condition}',
  'log.conditionRemoved': '{target} ist nicht mehr {condition}',
  'log.down': '{target} geht zu Boden',
  'log.kill': '{target} wurde besiegt',

  'log.card.takes': 'erleidet {amount} Schaden',
  'log.card.takesTyped': 'erleidet {amount} {type}-Schaden',
  'log.card.takesFrom': 'erleidet {amount} Schaden — durch {actor}',
  'log.card.takesTypedFrom': 'erleidet {amount} {type}-Schaden — durch {actor}',
  'log.card.heals': 'erhält {amount} TP',
  'log.card.healsFrom': 'erhält {amount} TP — durch {actor}',
  'log.card.is': 'ist {condition}',
  'log.card.noLonger': 'nicht mehr {condition}',
  'log.card.down': '💀 geht zu Boden',
  'log.card.kill': '💀 besiegt',
  'log.card.casts': 'wirkt',
  'log.card.cantrip': 'Zaubertrick',
  'log.card.slot': 'Platz {n}. Grades',
  'log.card.saveOk': 'geschafft',
  'log.card.saveFail': 'misslungen',
  'log.card.outcome.hit': 'Treffer',
  'log.card.outcome.miss': 'verfehlt',
  'log.card.outcome.crit': 'Krit!',
  'log.card.vsDc': 'SG {dc}',
  'log.card.save': 'Wurf',
  'log.card.savingThrow': '{attack}-Rettungswurf',
  'log.card.savingThrowOf': '{attack} {ability}-Rettungswurf',
  'log.card.attack': 'Angriff',
  'log.card.damageLabel': 'Schaden',
  'log.card.keep': 'behalte {die}',
  'log.card.agoS': 'vor {n}s',
  'log.card.agoM': 'vor {n}m',
  'log.card.agoH': 'vor {n}h',
  'log.card.f.amount': 'Wert',
  'log.card.f.type': 'Typ',
  'log.card.f.from': 'Durch',
  'log.card.f.target': 'Ziel',
  'log.card.f.total': 'Gesamt',
  'log.card.f.outcome': 'Ergebnis',
  'log.card.f.spell': 'Zauber',
  'log.card.f.slot': 'Platzgrad',
  'log.card.f.condition': 'Zustand',
  'log.card.deleteConfirm':
    'Diesen Log-Eintrag löschen? Verursachter Schaden und Heilung werden zurückgenommen.',
  'log.src.dm': 'SL',
  'log.src.deck': 'Deck',
  'log.src.player': 'Handy',
  'log.round': 'Runde {round}',

  'mob.pickPc': 'Wähle deinen Charakter',
  'mob.taken': 'vergeben',
  'mob.yourName': 'Dein Name (optional)',
  'mob.join': 'Als {name} beitreten',
  'mob.kicked': 'Der SL hat diesen Charakter freigegeben.',
  'mob.connecting': 'Verbinde…',
  'mob.disconnected': 'Verbindung verloren — neuer Versuch…',
  'mob.noCombat': 'Kein Kampf aktiv — gleich geht’s los!',
  'mob.yourTurn': 'Du bist dran!',
  'mob.notYourTurn': 'Warte auf deinen Zug',
  'mob.offTurnRelaxed': 'Nicht dein Zug — nur eigener Schaden/Heilung möglich',
  'mob.damage': 'Schaden',
  'mob.heal': 'Heilen',
  'mob.attack': 'Angriff',
  'mob.myAttacks': 'Meine Angriffe',
  'mob.myAttacksMore': 'Meine Angriffe…',
  'mob.logTitle': 'Kampflog',
  'mob.pickTargets': 'Ziel(e) wählen',
  'mob.pickAttack': 'Angriff wählen',
  'mob.amount': 'Betrag',
  'mob.apply': 'Anwenden',
  'mob.roll': '🎲 Würfeln',
  'mob.digital': 'App würfelt',
  'mob.manual': 'Ich würfle selbst',
  'mob.d20Total': 'W20-Summe (inkl. Bonus)',
  'mob.nat20': 'Natürliche 20',
  'mob.nat1': 'Natürliche 1',
  'mob.damageRolled': 'Gewürfelter Schaden',
  'mob.healRolled': 'Gewürfelte Heilung',
  'mob.healedTarget': '{name} geheilt',
  'mob.pickAlly': 'wen heilen?',
  'mob.cast': 'Wirken',
  'mob.longRestConfirm': 'Zum Bestätigen erneut tippen',
  'mob.err.noSlot': 'Kein Zauberplatz dieses Grades übrig.',
  'mob.concInfo':
    'Du hast {damage} Schaden erlitten, während du dich auf {spell} konzentrierst — bestehe einen Konstitutions-Rettungswurf (SG {dc}), um die Konzentration zu halten.',
  'mob.concKept': 'Konzentration gehalten!',
  'mob.concLost': '{spell} entgleitet dir…',
  'mob.concVs': 'gegen SG {dc}',
  'mob.resolve': 'Auswerten',
  'mob.waitingDm': 'Der SL würfelt die Rettungswürfe…',
  'mob.dmgDealt': '{damage} Schaden verursacht',
  'mob.noDamage': 'kein Schaden angewendet',
  'mob.savedHalf': 'geschafft — halber Schaden',
  'mob.failedFull': 'verpatzt — voller Schaden',
  'mob.cancelled': 'Vom SL abgebrochen.',
  'mob.release': 'Charakter wechseln',
  'mob.archive': 'Vergangene Kämpfe',
  'mob.archiveEmpty': 'Noch keine archivierten Kämpfe.',
  'mob.rounds': '{rounds} Runden',
  'mob.roundsOne': '1 Runde',
  'mob.rolling': 'Würfelt…',
  'mob.throwInfo': '{actor} erzwingt einen {ability}-Rettungswurf. Schaffe SG {dc}.',
  'mob.throwSaved': 'Geschafft!',
  'mob.throwFailed': 'Misslungen',
  'mob.throwMore': 'Noch {count} offen',
  'mob.rollAttack': 'Angriff würfeln',
  'mob.rollDamage': '🎲 Schaden würfeln',
  'mob.dmgDealtShort': 'Schaden verursacht',
  'roll.adv': 'Vorteil',
  'roll.normal': 'Normal',
  'roll.dis': 'Nachteil',
  'mob.err.notYourTurn': 'Nicht dein Zug.',
  'mob.err.badTarget': 'Ungültiges Ziel.',
  'mob.err.badAttack': 'Unbekannter Angriff.',
  'mob.done': 'Fertig',
  'mob.clear': 'C',
  'mob.typeNone': '—',
  'mob.err.generic': 'Etwas ist schiefgelaufen.',
  'mob.bonus': 'Bonus',
  'mob.dmgType': 'Schadensart',
  'mob.typeOther': 'Andere…',
  'mob.typeCustom': 'eigener Typ',
  'mob.usePicker': 'Auswahl verwenden',

  'nav.archive': 'Archiv',
  'archive.title': 'Kampf-Archiv',
  'archive.empty': 'Noch keine archivierten Kämpfe — jeder beendete Kampf landet hier mit vollem Log.',
  'archive.encounter': 'Begegnung',
  'archive.ended': 'Beendet',
  'archive.roundsCol': 'Runden',
  'archive.rounds': '{rounds} Runden',
  'archive.roundsOne': '1 Runde',
  'campaign.manage': 'Kampagnen verwalten',
  'campaign.modalTitle': 'Kampagnen',
  'campaign.create': 'Erstellen',
  'campaign.namePlaceholder': 'Name der neuen Kampagne…',
  'campaign.rename': 'Umbenennen',
  'campaign.active': 'aktiv',
  'campaign.deleteConfirm':
    'Diese Kampagne mit ALLEN Daten löschen (Gruppe, Begegnungen, Kampf, Archiv)? Das kann nicht rückgängig gemacht werden.',
  'campaign.cannotDeleteActive': 'Die aktive Kampagne kann nicht gelöscht werden',
  'campaign.cannotDeleteLast': 'Die letzte Kampagne kann nicht gelöscht werden',
  'archive.deleteConfirm': 'Dieses Kampflog endgültig löschen?',
  'logPanel.title': 'Kampflog',
  'logPanel.collapse': 'Einklappen',
  'logPanel.expand': 'Ausklappen',
  'logPanel.empty': 'Aktionen erscheinen hier, sobald sie passieren.',

  'pcs.notes': 'Notizen',
  'pcs.slots': 'Zauberplätze',
  'pcs.slotsNote': '(Maximum je Grad, direkt vom Charakterbogen — den Rest verwaltet das Wirken)',
  'pcs.longRest': '🛌 Lange Rast',
  'pcs.longRestNote': 'Alle Zauberplätze wiederherstellen',
  'pcs.fromSpellbook': '✨ Aus dem Zauberbuch',
  'pcs.spellToHit': 'Zauberangriffsbonus',
  'pcs.spellDc': 'Zauberrettungswurf-SG',
  'pcs.attach': 'Anhängen',
  'pcs.spellChipNote': 'Aus dem Zauberbuch angehängt — das Wirken fragt nach einem Zauberplatz',
  'pcs.notesNote': '(Klasse, Stufe, passive Wahrnehmung — auf dem Spieler-Handy sichtbar)',
  'pcs.attacks': 'Angriffe',
  'pcs.attacksNote': '(würfelbar vom Handy, im Angriffsfenster und am Stream Deck)',
  'pcs.noAttacks': 'Noch keine Angriffe — Spieler können eigene auch am Handy anlegen.',
  'pcs.addAttack': 'Angriff hinzufügen',
  'pcs.reach': 'Reichweite (ft)',
  'pcs.range': 'Distanz (ft)',
  'settings.about': 'Über / Danksagungen',
  'settings.credits': 'Monsterdaten: SRD 5.2.1 von Wizards of the Coast, lizenziert unter',
  'settings.creditsDataset': '. Datensatz: Open5e (srd-2024).',
  'settings.creditsNote':
    'Die deutschen Regelbegriffe stammen aus dem deutschen SRD 5.2.1. Monsternamen, die dort nicht vorkommen, bleiben englisch.',

  'common.back': '← Zurück',
  'common.close': 'Schließen',
  'common.confirm': 'Bestätigen',
  'common.search': 'Suchen…',

  'pcs.titleFull': 'Gruppe – Spielercharaktere',
  'pcs.emptyFull':
    'Noch keine Spielercharaktere. Lege deine Gruppe einmal an – sie bleibt gespeichert und kann an jedem Kampf teilnehmen.',
  'pcs.editPc': 'Charakter bearbeiten',
  'pcs.addPc': 'Charakter hinzufügen',

  'templates.emptyTemplate': 'Leere Vorlage',
  'templates.combatInProgress': 'Es läuft bereits ein Kampf. Beenden und einen neuen starten?',
  'templates.endAndStart': 'Beenden & neu starten',
  'templates.editTemplate': 'Vorlage bearbeiten',
  'templates.newTemplate': 'Neue Vorlage',
  'templates.namePlaceholder': 'z. B. Goblin-Hinterhalt',
  'templates.inThisEncounter': 'In dieser Begegnung',
  'templates.addMonsters': 'Monster hinzufügen',
  'templates.searchLibrary': 'Bibliothek durchsuchen…',

  'combat.startCombat': 'Kampf starten',
  'combat.noPcs':
    'Noch keine Charaktere in der Gruppe – ein reiner Monsterkampf ist trotzdem möglich.',
  'combat.rollAllNote': 'Monster und Charaktere automatisch auswürfeln (W20 + Modifikator)',
  'combat.rollMonstersNote': 'Die Spieler würfeln am Tisch; du trägst ihre Ergebnisse ein',
  'combat.initiativeOrder': 'Initiativreihenfolge',
  'combat.enterInitFirst': 'Zuerst für jeden Charakter die Initiative eintragen',
  'combat.reroll': 'Neu würfeln',
  'combat.endThisCombat': 'Diesen Kampf beenden?',
  'combat.armorClass': 'Rüstungsklasse',
  'combat.applyDamage': 'Schaden anwenden (Enter)',
  'combat.applyHealing': 'Heilung anwenden (Umschalt+Enter)',
  'combat.rollMonsterAttack': 'Angriff dieses Monsters würfeln (wie über das Stream Deck)',
  'combat.clickToRemove': 'Zum Entfernen klicken',
  'combat.noCombatants': 'Keine Teilnehmer mehr. Beende den Kampf, wenn du fertig bist.',
  'combat.addMonsterToCombat': 'Monster zum Kampf hinzufügen',

  'monsters.importing': 'Importiere…',
  'monsters.manual': 'Eigen',
  'monsters.showActions': 'Aktionen anzeigen',
  'monsters.noActions': 'Keine Aktionen hinterlegt.',
  'monsters.editMonster': 'Monster bearbeiten',
  'monsters.addMonster': 'Monster hinzufügen',
  'monsters.abilitiesNote': '(optional – Modifikatoren werden automatisch berechnet)',
  'monsters.actionsNote': '(Angriffe, Rettungswürfe, Fähigkeiten – nur für den SL)',
  'monsters.section.action': 'Aktion',
  'monsters.section.bonus_action': 'Bonusaktion',
  'monsters.section.reaction': 'Reaktion',
  'monsters.section.legendary_action': 'Legendär',
  'monsters.section.trait': 'Merkmal',
  'monsters.type.attack': 'Angriffswurf',
  'monsters.type.save': 'Rettungswurf',
  'monsters.type.other': 'Sonstiges',
  'monsters.kind.melee': 'Nahkampf',
  'monsters.kind.ranged': 'Fernkampf',
  'monsters.kind.melee_or_ranged': 'Nah- oder Fernkampf',

  'attack.pickAttack': 'Angriff wählen',
  'attack.rollAttack': '🎲 Angriff würfeln',
  'attack.rollDamage': '🎲 Schaden würfeln',
  'attack.whoSaved': 'Rettungswürfe →',
  'attack.apply': '⚔ {total} anwenden',

  'dice.amount': 'Anzahl',
  'dice.extraAmount': 'Weitere Anzahl',
  'dice.applyTo': 'Anwenden auf',
  'dice.pickOneOrMore': '(eine oder mehrere auswählen)',
  'dice.rollFirst': 'Zuerst würfeln',
  'attack.heading': '🎲 {name} greift an',
  'attack.pickTargetsFor': '{name} – Ziele wählen',
  'attack.pickTargetFor': '{name} – Ziel wählen',
  'attack.severalAllowed': '(Rettungswurf: mehrere möglich)',
  'attack.vsTarget': 'gegen {name} – RK {ac}',
  'attack.whoSucceeded': 'Wer hat den {ability}-Rettungswurf SG {dc} bestanden?',
  'attack.rollSaves': 'Jeden {ability}-Rettungswurf gegen SG {dc} würfeln',
  'attack.rollAllSaves': 'Alle würfeln',
  'save.concTitle': 'Konzentration — {spell}',
  'save.title': '{attack} — {ability}-Rettungswurf',
  'save.concInfo': '{actor} erlitt {damage} Schaden. Schaffe SG {dc}, sonst endet {spell}.',
  'save.info': 'Schaffe SG {dc} oder nimm den Treffer.',
  'save.waitingFor': 'wartet auf {who}…',
  'save.answeredBy': 'von {who}',
  'save.more': 'Noch {count} offen',
  'save.dismiss': 'Später',
  'save.apply': 'Übernehmen',
  'save.deferred': '{ability}-Rettungswurf offen',
  'save.throwIt': 'Jetzt würfeln',
  'attack.savedTakeHalf': '(Bestandene erleiden {half} statt {full})',
  'attack.savedTakeNone': '(Bestandene erleiden keinen Schaden)',
  'attack.applyHeal': '✚ Heilung anwenden ({total})',

  'cast.slotTitle': '{spell} wirken — Zauberplatz wählen',
  'cast.slotBtn': '{n}. Grad — {left} übrig',
  'cast.noSlots': 'Kein Zauberplatz dieses Grades übrig — Lange Rast einlegen.',
  'attack.recharge': 'Aufladung {min}+',
  'combat.step1': '1. Begegnungsvorlage wählen',
  'combat.step2': '2. Teilnehmende Charaktere wählen',
  'combat.step3': '3. Initiative',
  'combat.hpAc': 'TP {hp} · RK {ac}',
  'combat.setupHint':
    'Monster werden automatisch ausgewürfelt (🎲 zum Neuwürfeln). Ziehe Zeilen, um Gleichstände manuell zu klären.',
  'combat.mod': 'Mod.',
  'kenku.section': 'Kenku FM',
  'kenku.enable': 'Kenku-FM-Integration aktivieren',
  'kenku.address': 'Kenku-Remote-Adresse',
  'kenku.statusConnected': 'verbunden',
  'kenku.statusOffline': 'nicht erreichbar',
  'kenku.test': 'Verbindung testen',
  'kenku.outputNote':
    'Sounds werden von Kenku FM abgespielt – das Audioausgabegerät wird in den Einstellungen von Kenku FM gewählt. Aktiviere dort „Kenku Remote“.',
  'kenku.events': 'Ereignis-Sounds',
  'kenku.eventsNote':
    'Jedes Ereignis kann einen Kenku-Soundboard-Sound auslösen, optional verzögert. Angriffs-Sounds (im Monster-Editor) können zusätzlich feuern.',
  'kenku.noSound': '– kein Sound –',
  'kenku.noPlaylist': '– keine Playlist –',
  'kenku.delay': 'Verzögerung (ms)',
  'kenku.preview': 'Abspielen',
  'kenku.playlist': 'Kenku-Playlist',
  'kenku.playlistNote': 'Startet mit dem Kampfbeginn dieser Begegnung; endet der Kampf, pausiert die Wiedergabe.',
  'kenku.offline': 'Kenku FM nicht erreichbar – ist Kenku Remote aktiviert?',
  'kenku.offlineKeep': 'Kenku offline – „{title}“ bleibt eingestellt',
  'kenku.sound': 'Kenku-Sound',
  'kenku.trigger': 'Spielt bei',
  'kenku.trg.attackRoll': 'Angriffswurf',
  'kenku.trg.attackHit': 'Treffer',
  'kenku.trg.damageRoll': 'Schadenswurf',
  'kenku.trg.damageApplied': 'Schaden angewendet',
  'kenku.soundboard': 'Kenku-Soundboard',
  'kenku.stopAll': '■ Alle stoppen',
  'kenku.refresh': '↻ Aktualisieren',
  'kenku.ev.combatStart': 'Kampf beginnt',
  'kenku.ev.combatEnd': 'Kampf endet',
  'kenku.ev.turnChange': 'Zugwechsel',
  'kenku.ev.damageApplied': 'Schaden angewendet',
  'kenku.ev.healApplied': 'Heilung angewendet',
  'kenku.ev.pcDowned': 'Ein Charakter geht zu Boden',
  'kenku.ev.monsterKilled': 'Ein Monster stirbt',
  'kenku.ev.attackCrit': 'Kritischer Treffer',
  'kenku.ev.attackHit': 'Angriff trifft',
  'kenku.ev.attackMiss': 'Angriff verfehlt',

  'unit.square': 'Feld',
  'unit.squares': 'Felder',



  'common.ok': 'OK',
  'common.section': 'Abschnitt',
  'common.type': 'Typ',
  'common.kind': 'Art',
  'common.dc': 'SG',

  'pcs.save': 'Speichern',

  'monsters.libraryEmpty':
    'Die Bibliothek ist leer. Lege Monster manuell an oder importiere den mitgelieferten SRD-5.2.1-Satz.',
  'monsters.f.toHit': 'Angriffsbonus',
  'monsters.f.longRange': 'Weite Distanz',
  'monsters.f.saveAbility': 'Rettungswurf-Attribut',
  'monsters.f.damageDice': 'Schadenswürfel',
  'monsters.f.flatDamage': 'Fester Schaden',
  'monsters.f.onlyIf': 'Nur wenn…',
  'monsters.f.addDamage': '+ Schaden hinzufügen',
  'monsters.f.addAction': '+ Aktion hinzufügen',

  'templates.noLibrary':
    'Lege zuerst Monster in der Bibliothek an – Vorlagen werden aus Bibliothekseinträgen gebaut.',
  'templates.emptyNote':
    'Noch keine Begegnungsvorlagen. Eine Vorlage ist ein wiederverwendbarer Bauplan aus Monstern mit Anzahl.',
  'templates.nameLabel': 'Vorlagenname',
  'templates.saveTemplate': 'Vorlage speichern',

  'combat.header': 'Kampf',
  'combat.roundBadge': 'Runde {n}',
  'combat.needTemplate':
    'Ein Kampf beginnt mit einer Begegnungsvorlage. Lege zuerst eine im Bereich „Begegnungen“ an.',
  'combat.rollInitiative': 'Initiative würfeln →',
  'combat.beginCombat': '▶ Kampf beginnen',
  'combat.dmgBtn': 'Schaden',
  'combat.healBtn': 'Heilen',
  'combat.initiativeAuto':
    'Die Initiative wird automatisch gewürfelt; das Monster reiht sich entsprechend ein.',
  'combat.moreRefine': '…{n} weitere, Suche eingrenzen',
  'combat.toHit': 'Angriffswurf',
  'combat.saveDc': '{ability}-Rettungswurf SG {dc}',
  'combat.targetsCount': '{ability}-Rettungswurf SG {dc} – {n} Ziel(e)',

  'dice.die': 'Würfel',
  'dice.addExtra': '＋ Weitere Würfel',
  'dice.rollPool': '🎲 {pool} würfeln',

  'attack.crit': '💥 KRITISCH!',
  'attack.nat1': 'NAT 1 – DANEBEN',
  'attack.hit': '✔ TREFFER',
  'attack.miss': '✘ DANEBEN',
};

const DICTS: Record<Lang, Dict> = { en, de };

/**
 * Look up `key`, substituting `{placeholders}`. Falls back to English and then
 * to the key itself, so a missing translation degrades to readable text rather
 * than a blank label.
 */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m));
}


/** Feet or meters per battle-grid square (D&D squares are 5 ft = 1,5 m). */
const FEET_PER_SQUARE = 5;
const METERS_PER_SQUARE = 1.5;

/**
 * Annotates every distance in a range/reach string with its size in grid
 * squares, for play on a 1-inch battle map: "reach 10 ft." becomes
 * "reach 10 ft. (2 sq)", "Reichweite 3 m" becomes "Reichweite 3 m (2 Felder)".
 * Compound strings annotate each segment ("reach 5 ft. (1 sq) or range
 * 150 ft. (30 sq)"). Strings without a recognizable distance pass through.
 */
export function rangeWithSquares(lang: Lang, range: string | null): string | null {
  if (!range) return range;
  return range.replace(
    /(\d+(?:[.,]\d+)?)(\s*\/\s*(\d+(?:[.,]\d+)?))?\s*(ft\.?|m)(?![A-Za-z])/gi,
    (whole, first, _pair, second, unit) => {
      const per = unit.toLowerCase().startsWith('m') ? METERS_PER_SQUARE : FEET_PER_SQUARE;
      const toSq = (v: string) => Math.round(parseFloat(v.replace(',', '.')) / per);
      const a = toSq(first);
      const b = second ? toSq(second) : null;
      const label = translate(lang, b !== null || a !== 1 ? 'unit.squares' : 'unit.square');
      return `${whole} (${b !== null ? `${a}/${b}` : a} ${label})`;
    },
  );
}

export function conditionLabel(lang: Lang, c: Condition): string {
  return lang === 'de' ? CONDITION_DE[c] ?? c : c;
}

export function abilityLabels(lang: Lang): Record<string, string> {
  return lang === 'de' ? ABILITY_DE : ABILITY_EN;
}

export function damageTypeLabel(lang: Lang, type: string | null | undefined): string {
  if (!type) return '';
  return lang === 'de' ? DAMAGE_TYPE_DE[type.toLowerCase()] ?? type : type;
}

/** German ability codes as printed in SRD stat blocks (STR -> STÄ). */
const ABILITY_CODES_DE: Record<string, string> = {
  STR: 'STÄ', DEX: 'GES', CON: 'KON', INT: 'INT', WIS: 'WEI', CHA: 'CHA',
};

export function abilityCodeLabel(lang: Lang, code: string): string {
  return lang === 'de' ? ABILITY_CODES_DE[code.toUpperCase()] ?? code : code;
}

/** Localized name + rules text for one monster action. */
export interface MonsterActionL10n {
  name: string;
  text: string;
}

/** Everything the German SRD provides for one monster. */
export interface MonsterL10n {
  name: string;
  actions: Record<string, MonsterActionL10n>;
}

/**
 * Monster localization from the German SRD, injected at startup from
 * resources/srd/monsters.de.json and stored on imported monster templates.
 * Anything missing from it keeps its English form rather than being
 * machine-translated.
 */
let monsterMap: Record<string, MonsterL10n> = {};

export function setMonsterNameMap(map: Record<string, MonsterL10n | string>): void {
  monsterMap = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    monsterMap[k] = typeof v === 'string' ? { name: v, actions: {} } : v;
  }
}

export function monsterL10n(englishName: string): MonsterL10n | undefined {
  return monsterMap[englishName];
}

export function monsterName(lang: Lang, englishName: string): string {
  if (lang !== 'de') return englishName;
  const direct = monsterMap[englishName];
  if (direct) return direct.name;
  // Combat instances carry a trailing number ("Goblin Warrior 3"): translate
  // the base name and keep the number, so the deck and the DM list agree.
  const m = englishName.match(/^(.*?)(\s+\d+)$/);
  if (m && monsterMap[m[1]]) return monsterMap[m[1]].name + m[2];
  return englishName;
}
