/**
 * Instrument Tracker — configuration, tab headers and seed data.
 * BAPS Shri Swaminarayan Mandir, London.
 *
 * Everything in this file is data. No SpreadsheetApp calls, no logic.
 */

var APP_VERSION = '1.4.16';
var TIMEZONE = 'Europe/London';

/** Script Property keys. The access code lives here, NOT in the Sheet. */
var PROP_ACCESS_CODE = 'ACCESS_CODE';
var DEFAULT_ACCESS_CODE = 'mandir2026';

/**
 * Photos live in a Drive folder owned by the same account as the Sheet.
 * Created on first use; the id is remembered here so it is never made twice.
 */
var PROP_PHOTO_FOLDER = 'PHOTO_FOLDER_ID';
var PHOTO_FOLDER_NAME = 'Instrument Tracker Photos';

/**
 * Photos arrive already downscaled by the browser. This is a backstop against
 * a phone that ignores that, not the primary limit — Apps Script POST bodies
 * top out well below this anyway.
 */
var MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/**
 * Tab names and their header rows, in order.
 *
 * Columns are looked up by header TEXT at runtime, never by index, so a volunteer
 * can reorder or add columns in the Sheet without breaking the app. Renaming or
 * deleting one of these headers WILL break it — that is the one thing not to do.
 */
var TABS = {
  Centres: ['id', 'name', 'active'],

  InstrumentTypes: ['id', 'name', 'prefix', 'active'],

  QualityGrades: ['id', 'name', 'rank', 'active'],

  Items: [
    'asset_id', 'qr_token', 'name', 'instrument_type', 'quality_grade',
    'parent_asset_id', 'is_kit', 'status', 'current_condition',
    'storage_location', 'notes', 'photo_url', 'active'
  ],

  Events: [
    'event_id', 'name', 'parent_event_id', 'start_date', 'end_date',
    'location', 'centre', 'status'
  ],

  // needed_from + expected_return_date together form the window an item is
  // spoken for. Without a start date there is no way to answer "is HAR-003
  // free on the 14th?" — only "is it spoken for at all", which is too blunt
  // once two centres want the same harmonium in the same month.
  Allocations: [
    'allocation_id', 'asset_id', 'event_id', 'centre', 'needed_from',
    'expected_return_date', 'allocated_by', 'allocated_at', 'notes', 'status'
  ],

  // photo_out_url / photo_in_url hold Drive links to pictures taken as the
  // instrument left and came back. A photo is required when something is
  // returned damaged — "the skin was already split when we got it" is the
  // argument this exists to settle.
  Movements: [
    'movement_id', 'asset_id', 'allocation_id', 'event_id', 'sub_event_id',
    'centre', 'checked_out_at', 'checked_out_by', 'condition_out', 'photo_out_url',
    'expected_return_date', 'checked_in_at', 'checked_in_by', 'condition_in',
    'photo_in_url', 'damage_notes', 'via_parent_asset_id', 'outcome'
  ]
};

/** Tab order left-to-right in the Sheet. Reference lists last — they are rarely opened. */
var TAB_ORDER = [
  'Items', 'Events', 'Allocations', 'Movements',
  'Centres', 'InstrumentTypes', 'QualityGrades'
];

/* ------------------------------------------------------------------ *
 * Controlled vocabularies
 * ------------------------------------------------------------------ */

var ITEM_STATUS = ['available', 'checked_out', 'maintenance', 'lost'];
var CONDITIONS = ['excellent', 'good', 'fair', 'needs_repair'];
var EVENT_STATUS = ['planned', 'active', 'completed', 'cancelled'];
var ALLOCATION_STATUS = ['open', 'fulfilled', 'cancelled'];
var MOVEMENT_OUTCOME = ['returned', 'missing', 'damaged'];

/* ------------------------------------------------------------------ *
 * Seed data — written once by setupSheet(), never again
 * ------------------------------------------------------------------ */

var SEED_CENTRES = [
  ['C-001', 'East London', 'TRUE'],
  ['C-002', 'Ruislip', 'TRUE'],
  ['C-003', 'Central London', 'TRUE'],
  // Placeholders — rename these in Settings rather than adding new rows,
  // so the ids stay stable for anything already pointing at them.
  ['C-004', 'Centre 4 (rename me)', 'FALSE'],
  ['C-005', 'Centre 5 (rename me)', 'FALSE'],
  ['C-006', 'Centre 6 (rename me)', 'FALSE']
];

var SEED_INSTRUMENT_TYPES = [
  ['IT-001', 'Tabla', 'TAB', 'TRUE'],
  ['IT-002', 'Harmonium', 'HAR', 'TRUE'],
  ['IT-003', 'Keyboard', 'KEY', 'TRUE'],
  ['IT-004', 'Dholak', 'DHO', 'TRUE'],
  ['IT-005', 'Manjira', 'MAN', 'TRUE'],
  ['IT-006', 'Kartal', 'KAR', 'TRUE'],
  ['IT-007', 'Jhanjh', 'JHA', 'TRUE'],
  ['IT-008', 'Violin', 'VIO', 'TRUE'],
  ['IT-009', 'Sitar', 'SIT', 'TRUE'],
  ['IT-010', 'Amplifier', 'AMP', 'TRUE'],
  ['IT-011', 'Microphone', 'MIC', 'TRUE'],
  ['IT-012', 'Cables', 'CAB', 'TRUE'],
  ['IT-013', 'Other', 'OTH', 'TRUE']
];

var SEED_QUALITY_GRADES = [
  ['QG-001', 'Aradhana', 1, 'TRUE'],
  ['QG-002', 'Normal Sabha', 2, 'TRUE'],
  ['QG-003', 'Practice Use', 3, 'TRUE']
];

/** "Paris Mandir Mahotsav" with two sub-events. One level of nesting. */
var SEED_EVENTS = [
  ['EV-001', 'Paris Mandir Mahotsav', '', '2026-08-10', '2026-08-16', 'Paris', '', 'active'],
  ['EV-002', 'Bal Din', 'EV-001', '2026-08-12', '2026-08-12', 'Paris', '', 'active'],
  ['EV-003', 'Nagar Yatra', 'EV-001', '2026-08-15', '2026-08-15', 'Paris', '', 'planned']
];

/**
 * 10 sample items: one full 6-piece tabla kit (parent + 5 children) plus 4 standalone.
 *
 * Kit children carry their own type-sequence asset ids (OTH-001 for the hammer, not
 * TAB-014-3). Membership in the set is held by parent_asset_id alone — which is why
 * every child's printed label also carries a "Part of: Tabla Set A (TAB-014)" line.
 *
 * qr_token is left blank here; setupSheet() fills it with a fresh random token per row.
 * The QR code itself encodes the asset_id in plain text, so the token is currently
 * unused — it exists as the migration path if labels ever need to be unforgeable.
 */
var SEED_ITEMS = [
  // asset_id, name, type, grade, parent, is_kit, status, condition, location, notes
  ['TAB-014', 'Tabla Set A', 'Tabla', 'Aradhana', '', 'TRUE', 'available', 'good', 'Store Room 2, Shelf B', 'Full set: dayyu, bayyu, hammer, powder, bag'],
  ['TAB-015', 'Tabla Set A — Dayyu', 'Tabla', 'Aradhana', 'TAB-014', 'FALSE', 'available', 'good', 'Store Room 2, Shelf B', ''],
  ['TAB-016', 'Tabla Set A — Bayyu', 'Tabla', 'Aradhana', 'TAB-014', 'FALSE', 'available', 'good', 'Store Room 2, Shelf B', ''],
  ['OTH-001', 'Tabla Set A — Hammer', 'Other', 'Aradhana', 'TAB-014', 'FALSE', 'available', 'good', 'Store Room 2, Shelf B', 'Small — easily lost'],
  ['OTH-002', 'Tabla Set A — Powder Bottle', 'Other', 'Aradhana', 'TAB-014', 'FALSE', 'available', 'good', 'Store Room 2, Shelf B', ''],
  ['OTH-003', 'Tabla Set A — Bag', 'Other', 'Aradhana', 'TAB-014', 'FALSE', 'available', 'good', 'Store Room 2, Shelf B', '40mm tag on the handle'],

  ['HAR-003', 'Harmonium (Bina, 3.5 octave)', 'Harmonium', 'Aradhana', '', 'FALSE', 'available', 'excellent', 'Store Room 2, Shelf A', ''],
  ['KEY-002', 'Yamaha PSR-E373', 'Keyboard', 'Normal Sabha', '', 'FALSE', 'available', 'good', 'Store Room 1, Cupboard', 'Stand and adaptor in the same case'],
  ['DHO-007', 'Dholak — brass shell', 'Dholak', 'Normal Sabha', '', 'FALSE', 'available', 'fair', 'Store Room 2, Floor', 'Left skin worn — usable'],
  ['MIC-011', 'Shure SM58', 'Microphone', 'Practice Use', '', 'FALSE', 'available', 'good', 'Sound Desk Drawer', '']
];
