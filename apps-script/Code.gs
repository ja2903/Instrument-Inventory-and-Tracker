/**
 * ===================================================================
 *  Instrument Tracker — BAPS Shri Swaminarayan Mandir, London
 *
 *  GENERATED FILE. Do not edit this in the Apps Script editor and
 *  expect the change to survive — edit apps-script/src/*.js in the
 *  repository and run `node tools/build-gs.js`.
 *
 *  Built from: 00-config.js, 10-rules.js, 15-core.js, 20-sheet.js, 30-api-read.js, 40-api-write.js, 50-entry.js, 60-demo.js
 * ===================================================================
 */

/* ================================================================
 * 00-config.js
 * ================================================================ */

/**
 * Instrument Tracker — configuration, tab headers and seed data.
 * BAPS Shri Swaminarayan Mandir, London.
 *
 * Everything in this file is data. No SpreadsheetApp calls, no logic.
 */

var APP_VERSION = '1.4.14';
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

/* ================================================================
 * 10-rules.js
 * ================================================================ */

/**
 * Instrument Tracker — PURE RULES.
 *
 * ===================================================================
 *  Nothing in this file may touch SpreadsheetApp, Session, Utilities,
 *  Date.now(), or any other ambient state. Every function takes plain
 *  data in and returns plain data out.
 *
 *  That constraint is the only reason the kit cascade and the overdue
 *  maths are testable at all — tests/run.js loads this exact file in
 *  plain Node. If you add a SpreadsheetApp call here, the tests stop
 *  running and the trickiest logic in the app goes unchecked.
 * ===================================================================
 *
 * Shapes it expects (plain objects mirroring Sheet rows):
 *
 *   item     { asset_id, name, parent_asset_id, is_kit:boolean, status,
 *              current_condition, active:boolean, instrument_type, quality_grade }
 *   movement { movement_id, asset_id, checked_in_at, via_parent_asset_id,
 *              event_id, sub_event_id, centre, expected_return_date, checked_out_by }
 *   alloc    { allocation_id, asset_id, event_id, centre, expected_return_date, status }
 *
 *   state    { items: [item], movements: [movement], allocations: [alloc] }
 *
 * Dates are date-only strings 'YYYY-MM-DD'. Timestamps are ISO strings; this
 * module only ever asks whether a timestamp is blank.
 */

var Rules = (function () {
  'use strict';

  /* ================================================================
   * Dates and overdue
   * ================================================================ */

  /**
   * Whole days between two 'YYYY-MM-DD' strings (b − a), via Date.UTC.
   *
   * Using UTC deliberately keeps British Summer Time out of the arithmetic
   * entirely. A local-time subtraction across the March or October clock
   * change lands on 23 or 25 hours and silently truncates to the wrong
   * number of days. Date-only strings have no clocks to change.
   */
  function daysBetween(a, b) {
    var pa = parseDate(a), pb = parseDate(b);
    if (!pa || !pb) return null;
    var MS_PER_DAY = 86400000;
    return Math.round((pb - pa) / MS_PER_DAY);
  }

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function isValidDate(s) {
    return parseDate(s) !== null;
  }

  /**
   * Overdue is COMPUTED, never stored. A stored flag would be wrong every
   * midnight. An item is overdue when it is still out and its expected
   * return date has already passed.
   *
   * Due today is NOT overdue — you have until the end of the day.
   */
  function isOverdue(expectedReturnDate, checkedInAt, todayISO) {
    return daysOverdue(expectedReturnDate, checkedInAt, todayISO) > 0;
  }

  /** "1 day overdue" / "3 days overdue". One place, so it is never "1 days". */
  function daysLatePhrase(n) {
    return n === 1 ? '1 day overdue' : n + ' days overdue';
  }

  /** 0 when not overdue (including when already returned, or no date set). */
  function daysOverdue(expectedReturnDate, checkedInAt, todayISO) {
    if (checkedInAt) return 0;                    // already back
    if (!expectedReturnDate) return 0;            // no date promised
    var late = daysBetween(expectedReturnDate, todayISO);
    if (late === null) return 0;
    return late > 0 ? late : 0;
  }

  /* ================================================================
   * Small lookups
   * ================================================================ */

  function indexItems(items) {
    var map = {};
    for (var i = 0; i < items.length; i++) map[items[i].asset_id] = items[i];
    return map;
  }

  /** Active children of a kit parent, in sheet order. */
  function childrenOf(items, parentAssetId) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].parent_asset_id === parentAssetId && items[i].active) out.push(items[i]);
    }
    return out;
  }

  /** The open movement for an item (blank checked_in_at), or null. */
  function openMovementFor(movements, assetId) {
    for (var i = 0; i < movements.length; i++) {
      if (movements[i].asset_id === assetId && !movements[i].checked_in_at) return movements[i];
    }
    return null;
  }

  /** Open movements for every child currently out via this parent (rule K6). */
  function openMovementsViaParent(movements, parentAssetId) {
    var out = [];
    for (var i = 0; i < movements.length; i++) {
      if (movements[i].via_parent_asset_id === parentAssetId && !movements[i].checked_in_at) {
        out.push(movements[i]);
      }
    }
    return out;
  }

  function openAllocationFor(allocations, assetId) {
    for (var i = 0; i < (allocations || []).length; i++) {
      if (allocations[i].asset_id === assetId && allocations[i].status === 'open') {
        return allocations[i];
      }
    }
    return null;
  }

  /* ================================================================
   * Availability over a date range
   * ================================================================
   *
   * An allocation reserves an item for a WINDOW — from the day it is
   * needed to the day it is due back. Two requests for the same item
   * only clash if those windows overlap.
   *
   * This is what lets East London hold HAR-003 for the 10th to the 12th
   * while Paris takes it on the 14th, and what stops Paris booking it
   * for the 11th.
   */

  /**
   * Do [aFrom, aTo] and [bFrom, bTo] share at least one day?
   *
   * Both ends are INCLUSIVE: an item due back on the 12th is not free for
   * someone else on the 12th, because it may not physically return until
   * that evening. Erring towards "unavailable" is the cheap mistake here —
   * the expensive one is two centres arriving for the same harmonium.
   *
   * A missing end date means "open-ended", which overlaps everything after
   * its start.
   */
  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    var a1 = parseDate(aFrom), a2 = parseDate(aTo);
    var b1 = parseDate(bFrom), b2 = parseDate(bTo);

    // Anything with no usable start date cannot be reasoned about; treat it
    // as clashing so it surfaces to a human rather than being waved through.
    if (a1 === null && a2 === null) return true;
    if (b1 === null && b2 === null) return true;

    if (a1 === null) a1 = a2;
    if (a2 === null) a2 = Infinity;
    if (b1 === null) b1 = b2;
    if (b2 === null) b2 = Infinity;

    return a1 <= b2 && b1 <= a2;
  }

  /**
   * Everything standing in the way of using `assetId` between `from` and `to`.
   *
   * Returns a list of clashes, each with enough detail for the UI to say WHY
   * something is unavailable rather than just greying it out:
   *
   *   { kind: 'allocation' | 'checked_out' | 'status',
   *     from, to, event_id, centre, allocated_by, allocation_id, reason }
   *
   * `ignoreAllocationIds` lets an allocation being edited exclude itself.
   */
  function conflictsFor(state, assetId, from, to, ignoreAllocationIds) {
    var ignore = {};
    (ignoreAllocationIds || []).forEach(function (id) { ignore[id] = true; });

    var byId = indexItems(state.items);
    var item = byId[assetId];
    var out = [];
    if (!item) return out;

    // 1. A status that rules the item out whatever the dates are.
    if (item.status === 'maintenance' || item.status === 'lost') {
      out.push({
        kind: 'status',
        reason: item.status === 'maintenance' ? 'In maintenance' : 'Marked lost'
      });
    }

    // 2. Physically out right now. The window runs from today until it is due.
    if (item.status === 'checked_out') {
      var mv = openMovementFor(state.movements || [], assetId);
      var dueBack = mv ? mv.expected_return_date : '';
      var today = state.today || from;

      // An item that is ALREADY overdue has no known end date. Treating its
      // window as ending on a date that has passed would report a late tabla
      // set as free next week, which is exactly backwards — it is not even
      // back yet. Overdue means open-ended until someone returns it.
      var late = daysOverdue(dueBack, '', today) > 0;
      var effectiveTo = late ? '' : dueBack;

      if (rangesOverlap(from, to, today, effectiveTo)) {
        out.push({
          kind: 'checked_out',
          from: today,
          to: effectiveTo,
          event_id: mv ? mv.event_id : '',
          sub_event_id: mv ? mv.sub_event_id : '',
          event_name: mv ? (mv.event_name || '') : '',
          centre: mv ? mv.centre : '',
          reason: late
            ? 'Still out' + (mv && mv.centre ? ' with ' + mv.centre : '') +
              ' — ' + daysLatePhrase(daysOverdue(dueBack, '', today))
            : 'Out' + (mv && mv.centre ? ' with ' + mv.centre : '') +
              (dueBack ? ' until ' + formatDayMonth(dueBack) : '')
        });
      }
    }

    // 3. Promised to someone else over an overlapping window.
    (state.allocations || []).forEach(function (a) {
      if (a.asset_id !== assetId) return;
      if (a.status !== 'open') return;
      if (ignore[a.allocation_id]) return;
      if (!rangesOverlap(from, to, a.needed_from, a.expected_return_date)) return;

      out.push({
        kind: 'allocation',
        allocation_id: a.allocation_id,
        from: a.needed_from || '',
        to: a.expected_return_date || '',
        event_id: a.event_id || '',
        event_name: a.event_name || '',
        centre: a.centre || '',
        allocated_by: a.allocated_by || '',
        reason: 'Allocated to ' +
                (a.event_name || a.centre || 'another event') +
                windowPhrase(a.needed_from, a.expected_return_date)
      });
    });

    return out;
  }

  /** " (10–12 Aug)" — the bracketed window that follows a clash description. */
  function windowPhrase(from, to) {
    if (!from && !to) return '';
    if (from && to && from === to) return ' (' + formatDayMonth(from) + ')';
    if (from && to) return ' (' + formatDayMonth(from) + ' – ' + formatDayMonth(to) + ')';
    return ' (until ' + formatDayMonth(to || from) + ')';
  }

  /** True when nothing at all stands in the way of that window. */
  function isFreeBetween(state, assetId, from, to, ignoreAllocationIds) {
    return conflictsFor(state, assetId, from, to, ignoreAllocationIds).length === 0;
  }

  function label(item) {
    return item ? item.asset_id + ' (' + item.name + ')' : 'unknown item';
  }

  function err(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  /** Human phrase for where an item currently is. */
  function whereabouts(movement) {
    if (!movement) return 'checked out';
    var bits = [];
    if (movement.centre) bits.push(movement.centre);
    if (movement.event_name) bits.push(movement.event_name);
    return bits.length ? 'checked out to ' + bits.join(' — ') : 'checked out';
  }

  /* ================================================================
   * CHECK-OUT  (rules K1, K2, K3, K5)
   * ================================================================
   *
   * req = { asset_ids: [...], allow_partial: boolean }
   *
   * Returns on success:
   *   { ok:true, lines:[{asset_id, via_parent_asset_id}], warnings:[{asset_id,name,reason}] }
   *
   * Kit expansion happens HERE, server-side, so a stale browser can never
   * produce a half-checked-out kit.
   */
  function planCheckout(state, req) {
    var byId = indexItems(state.items);
    var movements = state.movements || [];
    var allowPartial = !!req.allow_partial;

    var lines = [];        // ordered, deduped below
    var seen = {};
    var warnings = [];
    var blockers = [];     // children already out alone — rule K3

    function addLine(assetId, via) {
      var existing = seen[assetId];
      if (existing) {
        // Scanning both a parent and one of its children: keep the line that
        // carries via_parent_asset_id, so a later parent check-in sweeps it up.
        if (via && !existing.via_parent_asset_id) existing.via_parent_asset_id = via;
        return;
      }
      var line = { asset_id: assetId, via_parent_asset_id: via || '' };
      seen[assetId] = line;
      lines.push(line);
    }

    var requested = dedupe(req.asset_ids || []);
    if (!requested.length) return err('BAD_REQUEST', 'No items were scanned.');

    for (var i = 0; i < requested.length; i++) {
      var id = requested[i];
      var item = byId[id];

      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');
      if (!item.active) {
        return err('ITEM_INACTIVE', label(item) + ' has been removed from inventory.');
      }

      // An explicitly scanned item that is unavailable is a hard error. Only
      // children pulled in by a parent get the skip-with-warning treatment (K2).
      if (item.status === 'checked_out') {
        return err('ITEM_CHECKED_OUT',
          label(item) + ' is already ' + whereabouts(openMovementFor(movements, id)) + '.');
      }
      if (item.status === 'maintenance') {
        return err('BAD_REQUEST', label(item) + ' is marked for maintenance and cannot go out.');
      }
      if (item.status === 'lost') {
        return err('BAD_REQUEST', label(item) + ' is marked lost and cannot go out.');
      }

      // --- Rule K5: a child may go out alone only if its parent is available.
      if (item.parent_asset_id) {
        var parent = byId[item.parent_asset_id];
        if (parent && parent.status !== 'available') {
          return err('PARENT_OUT',
            label(item) + ' belongs to ' + label(parent) + ', which is currently ' +
            plainStatus(parent.status) + '. Check the set in first.');
        }
      }

      addLine(id, '');

      // --- Rule K1: scanning a kit parent takes every child with it.
      if (item.is_kit) {
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var child = kids[k];
          if (child.status === 'available') {
            addLine(child.asset_id, id);
          } else if (child.status === 'checked_out') {
            // Rule K3 — out on its own. Block the whole set unless told otherwise.
            blockers.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: 'Already ' + whereabouts(openMovementFor(movements, child.asset_id)) + '.'
            });
          } else {
            // Rule K2 — in maintenance or lost. Skip it, say so plainly.
            warnings.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: child.status === 'maintenance'
                ? 'In maintenance — not included.'
                : 'Marked lost — not included.'
            });
          }
        }
      }
    }

    if (blockers.length && !allowPartial) {
      var names = blockers.map(function (b) { return b.asset_id + ' (' + b.name + ')'; });
      return {
        ok: false,
        error: {
          code: 'KIT_CHILD_OUT',
          message: 'Part of this set is already out on its own: ' + names.join(', ') +
                   '. Check it in first, or continue without it.'
        },
        blockers: blockers   // the client offers "continue without it" → allow_partial
      };
    }
    if (blockers.length) {
      for (var b = 0; b < blockers.length; b++) {
        warnings.push({
          asset_id: blockers[b].asset_id,
          name: blockers[b].name,
          reason: 'Out on its own — not included.'
        });
      }
    }

    return { ok: true, lines: lines, warnings: warnings };
  }

  /* ================================================================
   * CHECK-IN  (rules K6, K7, K8, K9)
   * ================================================================
   *
   * req = { items: [{ asset_id, condition_in, missing, damage_notes }] }
   *
   * Posting only the parent expands to every child out via that parent,
   * each defaulting to 'good'. Listing a child explicitly overrides its
   * default — that is exactly how "the hammer never came back" is recorded.
   */
  function planCheckin(state, req) {
    var byId = indexItems(state.items);
    var movements = state.movements || [];

    var explicit = {};
    var order = [];
    var reqItems = req.items || [];
    if (!reqItems.length) return err('BAD_REQUEST', 'No items to check in.');

    for (var i = 0; i < reqItems.length; i++) {
      var r = reqItems[i];
      if (!r || !r.asset_id) return err('BAD_REQUEST', 'An item was submitted without an ID.');
      explicit[r.asset_id] = r;
      order.push(r.asset_id);
    }

    var lines = [];
    var seen = {};
    var warnings = [];
    var photoRequired = [];

    function addLine(assetId, movement, spec) {
      if (seen[assetId]) return;
      var item = byId[assetId];
      var s = spec || {};
      var missing = !!s.missing;
      var condition = missing ? '' : (s.condition_in || 'good');

      // --- Rule K8: outcome and the item's resulting status.
      var outcome, newStatus, damage;
      if (missing) {
        outcome = 'missing';
        newStatus = 'lost';
        damage = s.damage_notes || 'Not returned';
      } else if (condition === 'needs_repair') {
        outcome = 'damaged';
        newStatus = 'maintenance';
        damage = s.damage_notes || '';
      } else {
        outcome = 'returned';
        newStatus = 'available';
        damage = s.damage_notes || '';
      }

      /*
       * A damaged return has to carry a photo.
       *
       * Six months later, "the skin was already split when we collected it"
       * is unanswerable without one. A photo settles it, and the moment to
       * take it is while the instrument is still on the table.
       *
       * Not required for a missing item — there is nothing to photograph.
       */
      if (outcome === 'damaged' && !String(s.photo_url || '').trim()) {
        photoRequired.push({ asset_id: assetId, name: item ? item.name : assetId });
      }

      var line = {
        asset_id: assetId,
        movement_id: movement.movement_id,
        condition_in: condition,
        damage_notes: damage,
        outcome: outcome,
        new_status: newStatus,
        new_condition: condition || (item ? item.current_condition : ''),
        photo_url: String(s.photo_url || '').trim(),
        via_parent_asset_id: movement.via_parent_asset_id || ''
      };
      seen[assetId] = line;
      lines.push(line);
    }

    for (var j = 0; j < order.length; j++) {
      var id = order[j];
      var item = byId[id];
      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');

      var mv = openMovementFor(movements, id);
      if (!mv) {
        // Tolerate a child listed on the parent's check-in screen that is
        // already back — that is a redundant submission, not a failure.
        if (item.parent_asset_id && explicit[item.parent_asset_id]) continue;
        return err('ITEM_NOT_OUT', label(item) + ' is not currently checked out.');
      }

      addLine(id, mv, explicit[id]);

      // --- Rule K6: checking in the parent closes every child out VIA this parent.
      if (item.is_kit) {
        var childMvs = openMovementsViaParent(movements, id);
        for (var c = 0; c < childMvs.length; c++) {
          addLine(childMvs[c].asset_id, childMvs[c], explicit[childMvs[c].asset_id]);
        }

        // --- Rule K7: children checked out on their own are NOT swept up.
        // Say so, rather than letting someone assume the whole set is back.
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var kid = kids[k];
          if (seen[kid.asset_id]) continue;
          var kidMv = openMovementFor(movements, kid.asset_id);
          if (kidMv && kidMv.via_parent_asset_id !== id) {
            warnings.push({
              asset_id: kid.asset_id,
              name: kid.name,
              reason: 'Out separately — check it in on its own.'
            });
          }
        }
      }
    }

    if (!lines.length) return err('ITEM_NOT_OUT', 'Nothing in this list is currently checked out.');

    if (photoRequired.length) {
      var names = photoRequired.map(function (p) { return p.name; });
      return {
        ok: false,
        error: {
          code: 'PHOTO_REQUIRED',
          message: (names.length === 1 ? names[0] + ' is' : names.join(', ') + ' are') +
                   ' marked as damaged, so a photo of the damage is needed before this ' +
                   'can be saved.'
        },
        photo_required: photoRequired
      };
    }

    return { ok: true, lines: lines, warnings: warnings };
  }

  /* ================================================================
   * ALLOCATION
   * ================================================================ */

  function planAllocate(state, req) {
    var byId = indexItems(state.items);
    var allocations = state.allocations || [];
    var movements = state.movements || [];

    var requested = dedupe(req.asset_ids || []);
    if (!requested.length) return err('BAD_REQUEST', 'No items were chosen.');
    if (!req.event_id) return err('BAD_REQUEST', 'Choose an event first.');
    if (!isValidDate(req.expected_return_date)) {
      return err('BAD_REQUEST', 'Set an expected return date.');
    }
    if (!req.allocated_by) return err('BAD_REQUEST', 'Enter the name of the person responsible.');

    // The window this request occupies. A blank needed_from means "from today".
    var from = isValidDate(req.needed_from) ? req.needed_from : (state.today || '');
    var to = req.expected_return_date;
    if (isValidDate(from) && daysBetween(from, to) < 0) {
      return err('BAD_REQUEST',
        'The return date is before the date the instruments are needed from.');
    }

    var lines = [];
    var seen = {};
    var warnings = [];

    function add(assetId) {
      if (seen[assetId]) return;
      seen[assetId] = true;
      lines.push(assetId);
    }

    for (var i = 0; i < requested.length; i++) {
      var id = requested[i];
      var item = byId[id];
      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');
      if (!item.active) return err('ITEM_INACTIVE', label(item) + ' has been removed from inventory.');

      // An explicitly chosen item that clashes is a hard error naming the clash,
      // so the karyakar can go back to the requesting centre with a real answer
      // rather than a shrug.
      var clashes = conflictsFor(state, id, from, to, req.ignore_allocation_ids);
      if (clashes.length) {
        return {
          ok: false,
          error: {
            code: 'NOT_AVAILABLE',
            message: label(item) + ' is not free ' + windowPhrase(from, to).trim() +
                     ': ' + clashes[0].reason + '.'
          },
          conflicts: clashes
        };
      }

      // Rule K5 again — a child cannot be promised elsewhere while its set is out.
      if (item.parent_asset_id) {
        var parent = byId[item.parent_asset_id];
        if (parent && parent.status !== 'available') {
          return err('PARENT_OUT',
            label(item) + ' belongs to ' + label(parent) + ', which is currently ' +
            plainStatus(parent.status) + '.');
        }
      }

      add(id);

      // Allocating a kit allocates the whole kit — but a piece that is spoken
      // for over these dates is left behind with a note, not silently included.
      if (item.is_kit) {
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var child = kids[k];
          var childClashes = conflictsFor(state, child.asset_id, from, to,
                                          req.ignore_allocation_ids);
          if (!childClashes.length) {
            add(child.asset_id);
          } else {
            warnings.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: childClashes[0].reason + ' — not included.'
            });
          }
        }
      }
    }

    return { ok: true, asset_ids: lines, warnings: warnings, needed_from: from };
  }

  /* ================================================================
   * DEACTIVATION  (rule K10)
   * ================================================================
   * Nothing is ever deleted — history has to survive. Removing a kit
   * parent removes its children with it, and anything currently out
   * cannot be removed at all.
   */
  function planDeactivate(state, assetId) {
    var byId = indexItems(state.items);
    var item = byId[assetId];
    if (!item) return err('NOT_FOUND', 'No item found with ID ' + assetId + '.');
    if (!item.active) return err('ITEM_INACTIVE', label(item) + ' has already been removed.');

    var cascade = [item];
    if (item.is_kit) cascade = cascade.concat(childrenOf(state.items, assetId));

    for (var i = 0; i < cascade.length; i++) {
      if (cascade[i].status === 'checked_out') {
        return err('ITEM_CHECKED_OUT',
          label(cascade[i]) + ' is still checked out. Check it in before removing it.');
      }
    }

    return {
      ok: true,
      asset_ids: cascade.map(function (it) { return it.asset_id; })
    };
  }

  /* ================================================================
   * Display helpers shared by server messages and the UI
   * ================================================================ */

  function plainStatus(status) {
    switch (status) {
      case 'available': return 'available';
      case 'checked_out': return 'checked out';
      case 'maintenance': return 'in maintenance';
      case 'lost': return 'lost';
      default: return status || 'unknown';
    }
  }

  /**
   * "Checked out to East London — Paris Mandir Mahotsav / Nagar Yatra — due 12 Aug — 3 days overdue."
   * Built here so the server and the client cannot drift apart on the wording.
   */
  function describeStatus(item, live, todayISO) {
    if (!item.active) return 'Removed from inventory';
    if (item.status === 'maintenance') return 'In maintenance';
    if (item.status === 'lost') return 'Marked lost';
    if (item.status !== 'checked_out' || !live) return 'Available';

    // Rule K4: a child out with its set leads with where it went, not just that it left.
    var head = live.via_parent_asset_id
      ? 'Out — via ' + live.via_parent_asset_id +
        (live.via_parent_name ? ' (' + live.via_parent_name + ')' : '')
      : 'Out';
    if (live.centre) head += ' with ' + live.centre;

    var parts = [head];

    var ev = [];
    if (live.event_name) ev.push(live.event_name);
    if (live.sub_event_name) ev.push(live.sub_event_name);
    if (ev.length) parts.push(ev.join(' / '));

    if (live.expected_return_date) parts.push('due ' + formatDayMonth(live.expected_return_date));

    var late = daysOverdue(live.expected_return_date, '', todayISO);
    if (late > 0) parts.push(daysLatePhrase(late));

    return parts.join(' — ');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-08-12' → '12 Aug'. Purely string work, no Date object, no timezone. */
  function formatDayMonth(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return iso || '';
    return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1];
  }

  function dedupe(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var v = String(arr[i] || '').trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    return out;
  }

  return {
    // dates / overdue
    daysBetween: daysBetween,
    isValidDate: isValidDate,
    isOverdue: isOverdue,
    daysOverdue: daysOverdue,
    daysLatePhrase: daysLatePhrase,
    formatDayMonth: formatDayMonth,
    // lookups
    indexItems: indexItems,
    childrenOf: childrenOf,
    openMovementFor: openMovementFor,
    openMovementsViaParent: openMovementsViaParent,
    openAllocationFor: openAllocationFor,
    // availability over a window
    rangesOverlap: rangesOverlap,
    conflictsFor: conflictsFor,
    isFreeBetween: isFreeBetween,
    windowPhrase: windowPhrase,
    // decisions
    planCheckout: planCheckout,
    planCheckin: planCheckin,
    planAllocate: planAllocate,
    planDeactivate: planDeactivate,
    // display
    plainStatus: plainStatus,
    describeStatus: describeStatus,
    dedupe: dedupe
  };
})();

/* ================================================================
 * 15-core.js
 * ================================================================ */

/**
 * Instrument Tracker — errors, responses and the shared access code.
 */

/**
 * An error with a code the client can branch on and a message a volunteer can read.
 * Anything thrown that is NOT an ApiError is a bug: it gets logged in full and
 * reported to the user as a generic failure, so a stack trace never lands on screen.
 */
function ApiError(code, message) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);

function fail(code, message) { throw new ApiError(code, message); }

/**
 * Every response is HTTP 200 with the real status inside the body.
 * ContentService cannot set status codes, so there is no alternative —
 * and it keeps the client's error handling in exactly one place.
 */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function okResponse(data) {
  return jsonOut({ ok: true, data: data, server_time: nowISO() });
}

function errResponse(code, message) {
  return jsonOut({ ok: false, error: { code: code, message: message } });
}

/* ---------------- access code ----------------------------------- */

function getAccessCode() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty(PROP_ACCESS_CODE);
  if (!code) {
    // First run before setupSheet() — fall back to the default rather than
    // locking everyone out of a freshly deployed script.
    code = DEFAULT_ACCESS_CODE;
    props.setProperty(PROP_ACCESS_CODE, code);
  }
  return code;
}

function setAccessCode(code) {
  PropertiesService.getScriptProperties().setProperty(PROP_ACCESS_CODE, code);
}

/**
 * Constant-time string comparison.
 *
 * A plain `a === b` returns as soon as it finds a differing character, and the
 * timing difference is measurable over a network. This compares every character
 * either way. Modest, but it costs nothing.
 */
function safeEquals(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Called at the top of every request, read and write alike. */
function requireAccess(code) {
  if (!safeEquals(code, getAccessCode())) {
    fail('BAD_CODE', 'That access code is not right. Ask another karyakar for the current one.');
  }
}

/* ---------------- small shared helpers -------------------------- */

function asBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v).trim().toUpperCase() === 'TRUE';
}

function requireField(payload, field, label) {
  var v = payload[field];
  if (v === undefined || v === null || String(v).trim() === '') {
    fail('BAD_REQUEST', 'Please fill in ' + (label || field.replace(/_/g, ' ')) + '.');
  }
  return String(v).trim();
}

/** Strips the internal _row bookkeeping before anything is sent to the browser. */
function publicCopy(obj) {
  var out = {};
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && k !== '_row') out[k] = obj[k];
  }
  return out;
}

/* ================================================================
 * 20-sheet.js
 * ================================================================ */

/**
 * Instrument Tracker — Sheet access layer.
 *
 * Everything that touches SpreadsheetApp lives here. Columns are resolved by
 * HEADER TEXT, never by position, so reordering columns in the Sheet is safe.
 *
 * Reads happen once per request and are cached; writes are buffered and
 * flushed a row at a time, so a six-piece kit check-out is a handful of
 * Sheets calls rather than sixty.
 */

/* ---------------- value coercion -------------------------------- */

var BOOL_FIELDS = { active: 1, is_kit: 1 };
var NUM_FIELDS = { rank: 1 };
var DATE_FIELDS = { start_date: 1, end_date: 1, expected_return_date: 1, needed_from: 1 };
var TS_FIELDS = { allocated_at: 1, checked_out_at: 1, checked_in_at: 1 };

/** A Sheets cell can come back as a Date even when a human typed text. Normalise. */
function cellToValue(field, raw) {
  if (raw === null || raw === undefined) return BOOL_FIELDS[field] ? false : '';

  if (BOOL_FIELDS[field]) {
    if (typeof raw === 'boolean') return raw;
    return String(raw).trim().toUpperCase() === 'TRUE';
  }
  if (NUM_FIELDS[field]) {
    var n = Number(raw);
    return isNaN(n) ? 0 : n;
  }
  if (DATE_FIELDS[field] && Object.prototype.toString.call(raw) === '[object Date]') {
    return Utilities.formatDate(raw, TIMEZONE, 'yyyy-MM-dd');
  }
  if (TS_FIELDS[field] && Object.prototype.toString.call(raw) === '[object Date]') {
    return Utilities.formatDate(raw, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(raw).trim();
}

function valueToCell(field, value) {
  if (BOOL_FIELDS[field]) return value ? 'TRUE' : 'FALSE';
  if (value === null || value === undefined) return '';
  return value;
}

/* ---------------- Table ----------------------------------------- */

function getSheet(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) {
    throw new ApiError('SERVER_ERROR',
      'The "' + name + '" tab is missing from the Sheet. Run setupSheet() from the Apps Script editor.');
  }
  return sheet;
}

/**
 * One tab, read into memory once.
 *
 * `obj._row` is the 1-based sheet row number, which is what makes targeted
 * writes possible without re-searching the sheet.
 */
function Table(name) {
  this.name = name;
  this.sheet = getSheet(name);

  var values = this.sheet.getDataRange().getValues();
  this.headers = (values[0] || []).map(function (h) { return String(h).trim(); });

  this.colOf = {};
  for (var c = 0; c < this.headers.length; c++) this.colOf[this.headers[c]] = c;

  this.rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    // Skip fully blank rows — a volunteer pressing Enter in the Sheet should
    // not create a phantom item.
    if (raw.join('').trim() === '') continue;

    var obj = { _row: r + 1 };
    for (var i = 0; i < this.headers.length; i++) {
      obj[this.headers[i]] = cellToValue(this.headers[i], raw[i]);
    }
    this.rows.push(obj);
  }

  this._dirty = {};   // rowNumber -> obj
  this._appends = [];
}

Table.prototype.all = function () { return this.rows; };

Table.prototype.findBy = function (field, value) {
  for (var i = 0; i < this.rows.length; i++) {
    if (this.rows[i][field] === value) return this.rows[i];
  }
  return null;
};

Table.prototype.filterBy = function (field, value) {
  return this.rows.filter(function (r) { return r[field] === value; });
};

/** Stage a change on an in-memory row. Nothing hits the Sheet until flush(). */
Table.prototype.update = function (row, changes) {
  for (var k in changes) {
    if (!Object.prototype.hasOwnProperty.call(changes, k)) continue;
    if (this.colOf[k] === undefined) continue;   // unknown column: ignore, do not crash
    row[k] = changes[k];
  }
  this._dirty[row._row] = row;
  return row;
};

/** Stage a new row. Its _row is assigned at flush time. */
Table.prototype.append = function (obj) {
  this._appends.push(obj);
  this.rows.push(obj);
  return obj;
};

Table.prototype.flush = function () {
  var self = this;
  var width = this.headers.length;

  // Updates: one setValues per changed row. Kit operations touch ~6 rows.
  Object.keys(this._dirty).forEach(function (rowNum) {
    var obj = self._dirty[rowNum];
    var line = self.headers.map(function (h) { return valueToCell(h, obj[h]); });
    self.sheet.getRange(Number(rowNum), 1, 1, width).setValues([line]);
  });
  this._dirty = {};

  // Appends: a single block write, whatever the count.
  if (this._appends.length) {
    var block = this._appends.map(function (obj) {
      return self.headers.map(function (h) { return valueToCell(h, obj[h]); });
    });
    var start = this.sheet.getLastRow() + 1;
    this.sheet.getRange(start, 1, block.length, width).setValues(block);
    for (var i = 0; i < this._appends.length; i++) this._appends[i]._row = start + i;
    this._appends = [];
  }
};

/* ---------------- request-scoped cache -------------------------- */

var _tableCache = {};

function table(name) {
  if (!_tableCache[name]) _tableCache[name] = new Table(name);
  return _tableCache[name];
}

function flushAll() {
  Object.keys(_tableCache).forEach(function (n) { _tableCache[n].flush(); });
}

function resetCache() { _tableCache = {}; }

/* ---------------- ids, tokens, time ----------------------------- */

/**
 * Next sequential id for a prefix, e.g. nextSequentialId('Movements','movement_id','MV-',6).
 * Scans existing rows rather than keeping a counter, so a hand-edited Sheet
 * cannot make the app reissue an id that is already in use.
 */
function nextSequentialId(tabName, field, prefix, pad) {
  var rows = table(tabName).all();
  var max = 0;
  var re = new RegExp('^' + prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d+)$');
  for (var i = 0; i < rows.length; i++) {
    var m = re.exec(String(rows[i][field] || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  var next = String(max + 1);
  while (next.length < pad) next = '0' + next;
  return prefix + next;
}

/**
 * Next free asset id for an instrument type, e.g. Tabla -> TAB-017.
 *
 * Deliberately scans inactive rows too: a retired asset id must never be
 * reused, or old movement history would appear to belong to the new item.
 */
function nextAssetId(prefix) {
  var rows = table('Items').all();
  var max = 0;
  var re = new RegExp('^' + prefix + '-(\\d+)$', 'i');
  for (var i = 0; i < rows.length; i++) {
    var m = re.exec(String(rows[i].asset_id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  var next = String(max + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + '-' + next;
}

/** Opaque token stored on every item. Not what the QR encodes today — see docs/SCHEMA.md. */
function newQrToken() {
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789';   // no l/o/0/1 — these get transcribed by hand
  var out = '';
  for (var i = 0; i < 16; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/** London-local 'YYYY-MM-DD'. The one place "today" is decided. */
function todayISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function nowISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ================================================================
 * 30-api-read.js
 * ================================================================ */

/**
 * Instrument Tracker — read endpoints (doGet).
 *
 * The heavy lifting is `live`: for every item currently out, the server
 * resolves the event, sub-event, centre and days-overdue once, so the browser
 * never has to join tables to render a status line.
 */

/* ---------------- shared derivation ------------------------------ */

function eventsById() {
  var map = {};
  table('Events').all().forEach(function (e) { map[e.event_id] = e; });
  return map;
}

/**
 * Top-level ancestor of an event.
 *
 * The data model is recursive but the UI shows exactly one level. If someone
 * hand-edits the Sheet into a three-deep chain, this walks up to the root
 * rather than crashing — and the depth guard stops a circular parent
 * reference from hanging the script.
 */
function rootEventId(evMap, eventId) {
  var current = evMap[eventId];
  var guard = 0;
  while (current && current.parent_event_id && evMap[current.parent_event_id] && guard++ < 10) {
    current = evMap[current.parent_event_id];
  }
  return current ? current.event_id : eventId;
}

function eventName(evMap, id) {
  return id && evMap[id] ? evMap[id].name : '';
}

/** Open movements (blank checked_in_at), keyed by asset_id. */
function openMovementsByAsset() {
  var map = {};
  table('Movements').all().forEach(function (m) {
    if (!m.checked_in_at) map[m.asset_id] = m;
  });
  return map;
}

/** The `live` block described in docs/API.md. Computed fresh, stored nowhere. */
function liveFor(movement, evMap, itemsById, today) {
  if (!movement) return null;
  var viaId = movement.via_parent_asset_id || '';
  return {
    movement_id: movement.movement_id,
    allocation_id: movement.allocation_id || '',
    event_id: movement.event_id || '',
    event_name: eventName(evMap, movement.event_id),
    sub_event_id: movement.sub_event_id || '',
    sub_event_name: eventName(evMap, movement.sub_event_id),
    centre: movement.centre || '',
    expected_return_date: movement.expected_return_date || '',
    days_overdue: Rules.daysOverdue(movement.expected_return_date, '', today),
    via_parent_asset_id: viaId,
    via_parent_name: viaId && itemsById[viaId] ? itemsById[viaId].name : '',
    checked_out_at: movement.checked_out_at || '',
    checked_out_by: movement.checked_out_by || ''
  };
}

/** Every item as the client wants it: public fields, children ids, live state. */
function decoratedItems() {
  var today = todayISO();
  var evMap = eventsById();
  var rows = table('Items').all();

  var byId = {};
  rows.forEach(function (r) { byId[r.asset_id] = r; });

  var openMv = openMovementsByAsset();

  var childrenOf = {};
  rows.forEach(function (r) {
    if (!r.parent_asset_id) return;
    (childrenOf[r.parent_asset_id] = childrenOf[r.parent_asset_id] || []).push(r.asset_id);
  });

  return rows.map(function (r) {
    var item = publicCopy(r);
    item.children = childrenOf[r.asset_id] || [];
    item.live = liveFor(openMv[r.asset_id], evMap, byId, today);
    return item;
  });
}

/* ---------------- endpoints -------------------------------------- */

function handlePing() {
  return { ok: true, version: APP_VERSION, today: todayISO() };
}

/**
 * The single call the app makes on load. One round trip, whole dataset.
 * At this scale that is simpler and faster than a dozen chatty endpoints.
 */
function handleBootstrap() {
  var today = todayISO();
  var evMap = eventsById();

  /*
   * has_history: has anything EVER been out to this event?
   *
   * The client cannot work this out for itself — bootstrap only carries open
   * movements, so a finished event with only returned loans looked empty and
   * the delete dialog promised a permanent deletion the server would refuse
   * to perform. One boolean per event settles it.
   */
  var eventHasHistory = {};
  table('Movements').all().forEach(function (m) {
    if (m.event_id) eventHasHistory[m.event_id] = true;
    if (m.sub_event_id) eventHasHistory[m.sub_event_id] = true;
  });

  var events = table('Events').all().map(function (e) {
    var ev = publicCopy(e);
    ev.children = [];
    ev.has_history = !!eventHasHistory[e.event_id];
    return ev;
  });
  var evOut = {};
  events.forEach(function (e) { evOut[e.event_id] = e; });
  events.forEach(function (e) {
    if (e.parent_event_id && evOut[e.parent_event_id]) {
      evOut[e.parent_event_id].children.push(e.event_id);
    }
  });

  // Open allocations go to the client in full, with their event names resolved,
  // so the Allocate screen can work out what is free on a given date without a
  // round trip every time someone changes the date picker.
  var itemNames = {};
  table('Items').all().forEach(function (i) { itemNames[i.asset_id] = i.name; });

  var openAllocations = table('Allocations').all()
    .filter(function (a) { return a.status === 'open'; })
    .map(function (a) {
      var al = publicCopy(a);
      al.event_name = eventName(evMap, a.event_id);
      al.parent_event_name = eventName(evMap, rootEventId(evMap, a.event_id));
      al.name = itemNames[a.asset_id] || a.asset_id;
      return al;
    });

  var openMovements = table('Movements').all()
    .filter(function (m) { return !m.checked_in_at; })
    .map(function (m) {
      var mv = publicCopy(m);
      mv.event_name = eventName(evMap, m.event_id);
      mv.sub_event_name = eventName(evMap, m.sub_event_id);
      mv.days_overdue = Rules.daysOverdue(m.expected_return_date, '', today);
      return mv;
    });

  return {
    today: today,
    version: APP_VERSION,
    // Built from the remembered ID alone, with no Drive call at all — bootstrap
    // is the one request the whole app depends on, and it must not start
    // failing for everyone just because photos were never authorised.
    photoFolderUrl: photoFolderUrl(),
    centres: table('Centres').all().map(publicCopy),
    instrumentTypes: table('InstrumentTypes').all().map(publicCopy),
    qualityGrades: table('QualityGrades').all().map(publicCopy),
    events: events,
    items: decoratedItems(),
    openAllocations: openAllocations,
    openMovements: openMovements
  };
}

/** One item in full: attributes, expanded children, complete movement history. */
function handleItem(params) {
  var assetId = String(params.asset_id || '').trim();
  if (!assetId) fail('BAD_REQUEST', 'No item was asked for.');

  var today = todayISO();
  var evMap = eventsById();
  var itemsTable = table('Items');
  var row = itemsTable.findBy('asset_id', assetId);
  if (!row) fail('NOT_FOUND', 'No item found with ID ' + assetId + '.');

  var all = decoratedItems();
  var byId = {};
  all.forEach(function (i) { byId[i.asset_id] = i; });

  var item = byId[assetId];
  var children = (item.children || []).map(function (id) { return byId[id]; })
                                      .filter(function (c) { return !!c; });

  var history = table('Movements').all()
    .filter(function (m) { return m.asset_id === assetId; })
    .map(function (m) {
      var mv = publicCopy(m);
      mv.event_name = eventName(evMap, m.event_id);
      mv.sub_event_name = eventName(evMap, m.sub_event_id);
      mv.days_overdue = Rules.daysOverdue(m.expected_return_date, m.checked_in_at, today);
      return mv;
    })
    .reverse();   // newest first

  var allocations = table('Allocations').all()
    .filter(function (a) { return a.asset_id === assetId; })
    .map(function (a) {
      var al = publicCopy(a);
      al.event_name = eventName(evMap, a.event_id);
      return al;
    })
    .reverse();

  item.children_expanded = children;
  item.movements = history;
  item.allocations = allocations;
  item.status_text = Rules.describeStatus(item, item.live, today);
  return item;
}

/**
 * Scan lookup. `q` is whatever the QR held or the volunteer typed.
 *
 * The QR encodes the asset_id in plain text, so `q` is normally an asset_id —
 * but a qr_token is accepted too, and matching is case-insensitive with
 * whitespace trimmed because this input is often typed on a phone.
 */
function handleResolve(params) {
  var q = String(params.q || params.token || '').trim();
  if (!q) fail('BAD_REQUEST', 'Nothing was scanned.');

  var needle = q.toUpperCase();
  var rows = table('Items').all();
  var found = null;

  for (var i = 0; i < rows.length && !found; i++) {
    if (String(rows[i].asset_id).toUpperCase() === needle) found = rows[i];
  }
  for (var j = 0; j < rows.length && !found; j++) {
    if (String(rows[j].qr_token).toUpperCase() === needle) found = rows[j];
  }
  if (!found) {
    fail('NOT_FOUND', 'No item found for "' + q + '". Check the ID printed under the QR code.');
  }

  var today = todayISO();
  var evMap = eventsById();
  var byId = {};
  rows.forEach(function (r) { byId[r.asset_id] = r; });

  var item = publicCopy(found);
  item.children = rows.filter(function (r) { return r.parent_asset_id === found.asset_id && r.active; })
                      .map(function (r) { return r.asset_id; });
  item.live = liveFor(openMovementsByAsset()[found.asset_id], evMap, byId, today);
  item.status_text = Rules.describeStatus(item, item.live, today);
  return item;
}

/**
 * One event, its sub-events, and everything allocated across the whole tree —
 * with the out / returned / overdue counts the event page shows.
 */
function handleEvent(params) {
  var eventId = String(params.event_id || '').trim();
  if (!eventId) fail('BAD_REQUEST', 'No event was asked for.');

  var today = todayISO();
  var evMap = eventsById();
  var root = evMap[eventId];
  if (!root) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var subEvents = table('Events').all().filter(function (e) {
    return e.parent_event_id === eventId;
  });
  var treeIds = {};
  treeIds[eventId] = true;
  subEvents.forEach(function (e) { treeIds[e.event_id] = true; });

  var itemsById = {};
  table('Items').all().forEach(function (i) { itemsById[i.asset_id] = i; });

  var movements = table('Movements').all().filter(function (m) {
    return treeIds[m.event_id] || treeIds[m.sub_event_id];
  });

  var lines = movements.map(function (m) {
    var item = itemsById[m.asset_id];
    return {
      movement_id: m.movement_id,
      asset_id: m.asset_id,
      name: item ? item.name : m.asset_id,
      instrument_type: item ? item.instrument_type : '',
      is_kit: item ? item.is_kit : false,
      via_parent_asset_id: m.via_parent_asset_id || '',
      centre: m.centre || '',
      event_id: m.event_id,
      sub_event_id: m.sub_event_id || '',
      sub_event_name: eventName(evMap, m.sub_event_id),
      expected_return_date: m.expected_return_date || '',
      checked_out_at: m.checked_out_at,
      checked_out_by: m.checked_out_by,
      checked_in_at: m.checked_in_at || '',
      outcome: m.outcome || '',
      is_out: !m.checked_in_at,
      days_overdue: Rules.daysOverdue(m.expected_return_date, m.checked_in_at, today)
    };
  }).reverse();

  function countFor(filterFn) {
    var subset = lines.filter(filterFn);
    return {
      out: subset.filter(function (l) { return l.is_out; }).length,
      returned: subset.filter(function (l) { return !l.is_out; }).length,
      overdue: subset.filter(function (l) { return l.days_overdue > 0; }).length
    };
  }

  var allocations = table('Allocations').all()
    .filter(function (a) { return treeIds[a.event_id]; })
    .map(function (a) {
      var al = publicCopy(a);
      var item = itemsById[a.asset_id];
      al.name = item ? item.name : a.asset_id;
      al.item_status = item ? item.status : '';
      al.event_name = eventName(evMap, a.event_id);
      return al;
    })
    .reverse();

  return {
    event: publicCopy(root),
    sub_events: subEvents.map(function (e) {
      var out = publicCopy(e);
      out.counts = countFor(function (l) { return l.sub_event_id === e.event_id; });
      return out;
    }),
    counts: countFor(function () { return true; }),
    movements: lines,
    allocations: allocations,
    today: today
  };
}

/* ================================================================
 * 40-api-write.js
 * ================================================================ */

/**
 * Instrument Tracker — write endpoints (doPost).
 *
 * Every handler here follows the same shape:
 *   1. validate the payload,
 *   2. ask Rules for a plan (pure, tested, no Sheets access),
 *   3. apply that plan to the tables.
 *
 * Step 2 is where all the kit logic lives. Nothing in this file re-implements
 * a rule — if a check is missing, it belongs in 10-rules.js where the tests
 * can reach it.
 */

/** The Rules-shaped view of the world, built from the tables. */
function rulesState() {
  var evMap = eventsById();
  return {
    today: todayISO(),
    items: table('Items').all(),
    movements: table('Movements').all().map(function (m) {
      // Rules only reads event_name for its error wording.
      m.event_name = eventName(evMap, m.sub_event_id || m.event_id);
      return m;
    }),
    allocations: table('Allocations').all().map(function (a) {
      a.event_name = eventName(evMap, a.event_id);
      return a;
    })
  };
}

/**
 * The centre for a booking. If the volunteer picked one, that wins; otherwise
 * fall back to whatever centre the event itself belongs to.
 *
 * Centre is deliberately NOT required once an event is chosen — for a mandir
 * event like Paris Mandir Mahotsav there often is no single centre, and making
 * someone pick one just to get past a form produces worse data than a blank.
 */
function resolveCentre(explicitCentre, eventId) {
  var given = String(explicitCentre || '').trim();
  if (given) return given;
  var ev = eventsById()[eventId];
  return ev ? String(ev.centre || '') : '';
}

/** Turns a plan failure from Rules into the thrown ApiError the router expects. */
function assertPlan(plan) {
  if (!plan.ok) {
    var e = new ApiError(plan.error.code, plan.error.message);
    if (plan.blockers) e.blockers = plan.blockers;
    if (plan.conflicts) e.conflicts = plan.conflicts;
    if (plan.photo_required) e.photo_required = plan.photo_required;
    throw e;
  }
  return plan;
}

/**
 * Splits a chosen event into the (top-level, sub-event) pair Movements stores.
 *
 * Allocations hold the LEAF event; Movements hold both. Deriving the pair in
 * one place is what stops the two columns ever disagreeing.
 */
function splitEvent(eventId) {
  var evMap = eventsById();
  if (!evMap[eventId]) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');
  var root = rootEventId(evMap, eventId);
  return {
    event_id: root,
    sub_event_id: root === eventId ? '' : eventId
  };
}

/* ================================================================
 * CHECK-OUT
 * ================================================================ */

function actionCheckout(p) {
  var eventId = requireField(p, 'event_id', 'an event');
  var due = requireField(p, 'expected_return_date', 'an expected return date');
  var by = requireField(p, 'checked_out_by', 'your name');
  var centre = resolveCentre(p.centre, eventId);   // optional — see resolveCentre

  if (!Rules.isValidDate(due)) fail('BAD_REQUEST', 'The expected return date is not a valid date.');

  var plan = assertPlan(Rules.planCheckout(rulesState(), {
    asset_ids: p.asset_ids || [],
    allow_partial: !!p.allow_partial
  }));

  var ev = splitEvent(eventId);
  var items = table('Items');
  var movements = table('Movements');
  var allocations = table('Allocations');
  var now = nowISO();
  var movementIds = [];

  plan.lines.forEach(function (line) {
    var item = items.findBy('asset_id', line.asset_id);

    // If this item was allocated in advance, close the loop: the movement
    // points back at the allocation, and the allocation stops showing as open.
    var alloc = null;
    for (var i = 0; i < allocations.all().length; i++) {
      var a = allocations.all()[i];
      if (a.asset_id === line.asset_id && a.status === 'open') { alloc = a; break; }
    }
    if (alloc) allocations.update(alloc, { status: 'fulfilled' });

    var id = nextSequentialId('Movements', 'movement_id', 'MV-', 6);
    movementIds.push(id);

    movements.append({
      movement_id: id,
      asset_id: line.asset_id,
      allocation_id: alloc ? alloc.allocation_id : '',
      event_id: ev.event_id,
      sub_event_id: ev.sub_event_id,
      centre: centre,
      checked_out_at: now,
      checked_out_by: by,
      condition_out: p.condition_out || item.current_condition || 'good',
      photo_out_url: (p.photos && p.photos[line.asset_id]) || p.photo_url || '',
      expected_return_date: due,
      checked_in_at: '',
      checked_in_by: '',
      condition_in: '',
      photo_in_url: '',
      damage_notes: '',
      via_parent_asset_id: line.via_parent_asset_id || '',
      outcome: ''
    });

    items.update(item, { status: 'checked_out' });
  });

  flushAll();

  return {
    checked_out: plan.lines.map(function (l) { return l.asset_id; }),
    movement_ids: movementIds,
    warnings: plan.warnings
  };
}

/* ================================================================
 * CHECK-IN
 * ================================================================ */

function actionCheckin(p) {
  var by = requireField(p, 'checked_in_by', 'your name');

  var plan = assertPlan(Rules.planCheckin(rulesState(), { items: p.items || [] }));

  var items = table('Items');
  var movements = table('Movements');
  var now = nowISO();

  plan.lines.forEach(function (line) {
    var mv = movements.findBy('movement_id', line.movement_id);
    if (!mv) fail('SERVER_ERROR', 'Could not find the check-out record for ' + line.asset_id + '.');

    movements.update(mv, {
      checked_in_at: now,
      checked_in_by: by,
      condition_in: line.condition_in,
      photo_in_url: line.photo_url || '',
      damage_notes: line.damage_notes,
      outcome: line.outcome
    });

    var item = items.findBy('asset_id', line.asset_id);
    if (item) {
      var changes = { status: line.new_status };
      // A missing item keeps its last known condition — we cannot judge the
      // condition of something nobody has seen.
      if (line.condition_in) changes.current_condition = line.condition_in;
      items.update(item, changes);
    }
  });

  flushAll();

  return {
    checked_in: plan.lines.map(function (l) {
      return { asset_id: l.asset_id, outcome: l.outcome, new_status: l.new_status };
    }),
    warnings: plan.warnings
  };
}

/* ================================================================
 * ALLOCATE  — the emailed request, logged in one step
 * ================================================================ */

function actionAllocate(p) {
  // If no start date was given, fall back to the event's own start date before
  // defaulting to today — an event three weeks out should reserve its window
  // three weeks out, not from this morning.
  var neededFrom = String(p.needed_from || '').trim();
  if (!neededFrom) {
    var ev = eventsById()[p.event_id];
    if (ev && ev.start_date) neededFrom = ev.start_date;
  }

  var plan = assertPlan(Rules.planAllocate(rulesState(), {
    asset_ids: p.asset_ids || [],
    event_id: p.event_id,
    centre: p.centre,
    needed_from: neededFrom,
    expected_return_date: p.expected_return_date,
    allocated_by: p.allocated_by,
    ignore_allocation_ids: p.ignore_allocation_ids || []
  }));

  var centre = resolveCentre(p.centre, p.event_id);   // optional
  var allocations = table('Allocations');
  var now = nowISO();
  var created = [];

  plan.asset_ids.forEach(function (assetId) {
    var id = nextSequentialId('Allocations', 'allocation_id', 'AL-', 6);
    allocations.append({
      allocation_id: id,
      asset_id: assetId,
      event_id: p.event_id,          // the LEAF event — see docs/SCHEMA.md
      centre: centre,
      needed_from: plan.needed_from,
      expected_return_date: p.expected_return_date,
      allocated_by: p.allocated_by,
      allocated_at: now,
      notes: p.notes || '',
      status: 'open'
    });
    created.push(id);
  });

  flushAll();
  return {
    allocation_ids: created,
    asset_ids: plan.asset_ids,
    needed_from: plan.needed_from,
    warnings: plan.warnings
  };
}

/**
 * "Is this item free between these dates?" for a list of items at once.
 *
 * A read-shaped question, but it goes through doPost because the item list can
 * be long enough to strain a query string.
 */
function actionCheckAvailability(p) {
  var state = rulesState();
  var from = String(p.needed_from || '').trim() || state.today;
  var to = String(p.expected_return_date || '').trim();
  var ignore = p.ignore_allocation_ids || [];

  var ids = p.asset_ids && p.asset_ids.length
    ? p.asset_ids
    : state.items.filter(function (i) { return i.active; })
                 .map(function (i) { return i.asset_id; });

  var out = {};
  ids.forEach(function (assetId) {
    var conflicts = Rules.conflictsFor(state, assetId, from, to, ignore);
    out[assetId] = { available: conflicts.length === 0, conflicts: conflicts };
  });

  return { needed_from: from, expected_return_date: to, availability: out };
}

/**
 * Change a booking that has not been collected yet — its dates, its event, or
 * who is responsible.
 *
 * Availability is re-checked against the NEW dates, excluding this booking
 * itself: moving a booking from the 10th to the 11th must not report the
 * instrument as clashing with its own old window.
 *
 * A booking is edited as a group. Every row created by one trip through the
 * Give out screen shares an allocation_id prefix only by accident, so instead
 * the client passes the ids it wants changed and they move together.
 */
function actionUpdateAllocation(p) {
  var ids = p.allocation_ids && p.allocation_ids.length
    ? p.allocation_ids
    : [requireField(p, 'allocation_id')];

  var allocations = table('Allocations');
  var rows = ids.map(function (id) {
    var row = allocations.findBy('allocation_id', id);
    if (!row) fail('NOT_FOUND', 'No booking found with ID ' + id + '.');
    if (row.status !== 'open') {
      fail('BAD_REQUEST', 'That booking has already been ' + row.status + '.');
    }
    return row;
  });

  var eventId = String(p.event_id || rows[0].event_id).trim();
  if (!eventsById()[eventId]) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var from = String(p.needed_from || rows[0].needed_from).trim();
  var to = String(p.expected_return_date || rows[0].expected_return_date).trim();
  if (!Rules.isValidDate(to)) fail('BAD_REQUEST', 'Set a date for them to come back.');
  if (Rules.isValidDate(from) && Rules.daysBetween(from, to) < 0) {
    fail('BAD_REQUEST', 'The return date is before the date they are needed from.');
  }

  // Re-check every instrument against the new window, ignoring these rows.
  var state = rulesState();
  rows.forEach(function (row) {
    var clashes = Rules.conflictsFor(state, row.asset_id, from, to, ids);
    if (clashes.length) {
      var item = state.items.filter(function (i) { return i.asset_id === row.asset_id; })[0];
      var e = new ApiError('NOT_AVAILABLE',
        (item ? item.name : row.asset_id) + ' is not free for those dates: ' +
        clashes[0].reason + '.');
      e.conflicts = clashes;
      throw e;
    }
  });

  var centre = resolveCentre(p.centre !== undefined ? p.centre : rows[0].centre, eventId);
  rows.forEach(function (row) {
    allocations.update(row, {
      event_id: eventId,
      centre: centre,
      needed_from: from,
      expected_return_date: to,
      allocated_by: p.allocated_by !== undefined
        ? String(p.allocated_by).trim() : row.allocated_by,
      notes: p.notes !== undefined ? String(p.notes) : row.notes
    });
  });

  flushAll();
  return {
    allocation_ids: ids,
    event_id: eventId,
    needed_from: from,
    expected_return_date: to
  };
}

function actionCancelAllocation(p) {
  // Accepts one id or a whole booking's worth, so cancelling a set of six
  // instruments is one action rather than six.
  var ids = p.allocation_ids && p.allocation_ids.length
    ? p.allocation_ids
    : [requireField(p, 'allocation_id')];

  var allocations = table('Allocations');
  var cancelled = [];

  ids.forEach(function (id) {
    var row = allocations.findBy('allocation_id', id);
    if (!row) fail('NOT_FOUND', 'No booking found with ID ' + id + '.');
    // Already cancelled is not an error worth stopping for — the outcome the
    // volunteer wanted is the outcome they have.
    if (row.status !== 'open') return;
    allocations.update(row, { status: 'cancelled' });
    cancelled.push(id);
  });

  flushAll();
  return { allocation_ids: cancelled };
}

/* ================================================================
 * PHOTOS
 * ================================================================
 *
 * Stored in Drive rather than in the Sheet. A Sheet cell cannot hold an
 * image usefully, and base64 in a cell would bloat every read of the whole
 * tab. The folder lives in the same Google account that owns the Sheet, so
 * there is still nothing extra to pay for and nothing to expire.
 */

/**
 * Turns Apps Script's scope error into something the mandir can act on.
 *
 * Apps Script works out which permissions a script needs by reading the code,
 * and it asks for them when a human runs it from the editor. Pasting in code
 * that uses DriveApp for the first time and deploying a New version does NOT
 * ask — so every photo upload throws "You do not have permission to call
 * DriveApp..." and the volunteer sees a generic "something went wrong".
 *
 * The cure is for the owner to run authorizePhotos() once from the editor and
 * accept the Google consent screen. Saying so beats a stack trace nobody sees.
 */
function isDrivePermissionError(err) {
  var text = String((err && err.message) || err || '');
  return text.indexOf('permission') !== -1 || text.indexOf('authoriz') !== -1 ||
         text.indexOf('authoris') !== -1 || text.indexOf('auth/drive') !== -1;
}

function drivePermissionFailure(err) {
  console.error('Drive refused: ' + ((err && err.stack) || err));
  fail('DRIVE_NOT_AUTHORISED',
    'Photos are not switched on yet. Whoever set this up needs to open the Apps Script ' +
    'editor, run the function authorizePhotos once, and allow access to Google Drive. ' +
    'Everything else in the app works normally in the meantime.');
}

/**
 * Wherever the Google Sheet lives — that is where the photos go too.
 *
 * The obvious implementation, DriveApp.createFolder(name), drops the folder at
 * the top of My Drive, mixed in with everything else the owner keeps there.
 * Putting it beside the Sheet instead means the whole app is one tidy thing:
 * move the Sheet into a folder and the photos follow it there.
 *
 * Returns null when the Sheet is loose at the top of My Drive, in which case
 * the photos folder goes there too — still right next to it.
 */
function sheetParentFolder() {
  var parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  return parents.hasNext() ? parents.next() : null;
}

/**
 * A link to the photos folder, or '' if photos have never been used.
 *
 * Deliberately does NOT touch DriveApp: it only reads the ID we already stored,
 * so it is safe to include in bootstrap, which every screen depends on.
 */
function photoFolderUrl() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_PHOTO_FOLDER);
  return id ? 'https://drive.google.com/drive/folders/' + id : '';
}

/**
 * The photos folder, made once and remembered by ID.
 *
 * Remembering the ID rather than the name is what lets the mandir move or
 * rename the folder afterwards without breaking anything — Drive keeps the ID
 * for the life of the folder.
 */
function photoFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_PHOTO_FOLDER);

  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (gone) {
      // A deleted folder is recoverable — we just make another below. A refused
      // scope is not, and must not be mistaken for one.
      if (isDrivePermissionError(gone)) drivePermissionFailure(gone);
    }
  }

  try {
    var parent = sheetParentFolder();

    // Look for an existing folder of the right name in that one place only.
    // DriveApp.getFoldersByName searches the whole of Drive, which could just
    // as easily return someone else's folder that happens to share the name.
    var existing = parent ? parent.getFoldersByName(PHOTO_FOLDER_NAME)
                          : DriveApp.getRootFolder().getFoldersByName(PHOTO_FOLDER_NAME);

    var folder = existing.hasNext()
      ? existing.next()
      : (parent ? parent.createFolder(PHOTO_FOLDER_NAME)
                : DriveApp.getRootFolder().createFolder(PHOTO_FOLDER_NAME));

    props.setProperty(PROP_PHOTO_FOLDER, folder.getId());
    return folder;
  } catch (err) {
    if (isDrivePermissionError(err)) drivePermissionFailure(err);
    throw err;
  }
}

/**
 * Saves one photo and returns a link that renders in an <img>.
 *
 * `data_url` is what a browser canvas produces: "data:image/jpeg;base64,...".
 */
function actionUploadPhoto(p) {
  var dataUrl = String(p.data_url || '');
  var match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) {
    fail('BAD_REQUEST', 'That did not look like a photo. Try taking it again.');
  }

  var mimeType = match[1];
  var base64 = match[2];
  // 4 base64 characters carry 3 bytes.
  if (base64.length * 3 / 4 > MAX_PHOTO_BYTES) {
    fail('BAD_REQUEST', 'That photo is too large. Take it again, or use a lower camera setting.');
  }

  var assetId = String(p.asset_id || 'unknown').trim();
  var kind = p.kind === 'out' ? 'out' : 'in';
  var stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd-HHmmss');
  var extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
  var name = assetId + '-' + kind + '-' + stamp + '.' + extension;

  var file;
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, name);
    file = photoFolder().createFile(blob);
  } catch (err) {
    if (err && err.name === 'ApiError') throw err;      // already explained
    if (isDrivePermissionError(err)) drivePermissionFailure(err);
    throw err;
  }

  // Anyone with the link can view. The link is only ever shown inside the app,
  // which is already behind the access code, and without this the photo will
  // not load for a volunteer who is not signed in to the mandir's Google
  // account — which is nearly all of them.
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingRefused) {
    // Some Workspace domains forbid link sharing. The file is still saved and
    // still reachable by the account that owns it, so this is not fatal.
    console.warn('Could not set link sharing on ' + name + ': ' + sharingRefused);
  }

  return {
    photo_url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200',
    file_id: file.getId(),
    name: name
  };
}

/**
 * Attach or replace the photo on a past movement.
 *
 * Retaking is deliberately allowed. The first photo is often taken in a hurry
 * in a badly lit store room, and a better one of the same damage is strictly
 * more useful. The old file stays in Drive — nothing is deleted, the row just
 * stops pointing at it — so a replacement can never destroy evidence.
 */
function actionSetMovementPhoto(p) {
  var movementId = requireField(p, 'movement_id');
  var kind = p.kind === 'out' ? 'out' : 'in';
  var url = String(p.photo_url || '').trim();

  var movements = table('Movements');
  var row = movements.findBy('movement_id', movementId);
  if (!row) fail('NOT_FOUND', 'No record found with ID ' + movementId + '.');

  // A damaged return is the one case where the photo may not simply be removed.
  if (!url && kind === 'in' && row.outcome === 'damaged') {
    fail('PHOTO_REQUIRED',
      'This was returned damaged, so it has to keep a photo. Take a new one to replace it.');
  }

  var changes = {};
  changes[kind === 'out' ? 'photo_out_url' : 'photo_in_url'] = url;
  movements.update(row, changes);

  flushAll();
  return { movement_id: movementId, kind: kind, photo_url: url };
}

/**
 * The Drive file ID inside a photo_url we wrote earlier.
 *
 * We only ever store the thumbnail form, but old rows or a hand-edited cell
 * could hold a /file/d/ID/view link, so both are read.
 */
function photoFileId(url) {
  var text = String(url || '');
  var match = /[?&]id=([A-Za-z0-9_-]+)/.exec(text) ||
              /\/file\/d\/([A-Za-z0-9_-]+)/.exec(text);
  return match ? match[1] : '';
}

/**
 * Removes a photo from a record, and puts the file in the Drive bin.
 *
 * Binned rather than destroyed: Drive keeps it for 30 days, so a photo deleted
 * by mistake in a noisy store room is recoverable, while the app stops showing
 * it immediately. Deleting the file is the point — unlinking alone would leave
 * a picture of somebody's living room sitting in the mandir's Drive for ever.
 *
 * A damaged return needs `confirm: true`. That photo is the only evidence of
 * what happened, so it should take a deliberate second tap, not a stray one.
 */
function actionDeletePhoto(p) {
  var movementId = requireField(p, 'movement_id');
  var kind = p.kind === 'out' ? 'out' : 'in';

  var movements = table('Movements');
  var row = movements.findBy('movement_id', movementId);
  if (!row) fail('NOT_FOUND', 'No record found with ID ' + movementId + '.');

  var field = kind === 'out' ? 'photo_out_url' : 'photo_in_url';
  var url = row[field];
  if (!url) fail('NOT_FOUND', 'There is no photo on that record to delete.');

  if (kind === 'in' && row.outcome === 'damaged' && p.confirm !== true) {
    fail('CONFIRM_REQUIRED',
      'This is the only photo of the damage. Confirm that you want it deleted.');
  }

  var changes = {};
  changes[field] = '';
  movements.update(row, changes);
  flushAll();

  // The row is already clean, so a Drive failure here must not fail the call:
  // the volunteer asked for the photo to go away, and it has.
  var binned = false;
  var fileId = photoFileId(url);
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      binned = true;
    } catch (err) {
      console.warn('Could not bin photo ' + fileId + ': ' + err);
    }
  }

  return { movement_id: movementId, kind: kind, deleted: true, binned: binned };
}

/* ================================================================
 * ITEMS — add, edit, remove
 * ================================================================ */

function prefixForType(typeName) {
  var t = table('InstrumentTypes').findBy('name', typeName);
  if (!t) fail('BAD_REQUEST', '"' + typeName + '" is not one of the instrument types.');
  return t.prefix || 'OTH';
}

function actionSuggestAssetId(p) {
  var type = requireField(p, 'instrument_type', 'an instrument type');
  return { asset_id: nextAssetId(prefixForType(type)) };
}

function validateAssetIdAvailable(items, assetId, exceptRow) {
  var existing = items.findBy('asset_id', assetId);
  if (existing && (!exceptRow || existing._row !== exceptRow._row)) {
    fail('DUPLICATE_ASSET_ID', assetId + ' is already in use by "' + existing.name + '".');
  }
}

function actionSaveItem(p) {
  var items = table('Items');
  var name = requireField(p, 'name', 'a name');
  var type = requireField(p, 'instrument_type', 'an instrument type');
  var grade = requireField(p, 'quality_grade', 'a quality grade');
  var isKit = asBool(p.is_kit);

  var assetId = String(p.asset_id || '').trim().toUpperCase();
  if (!assetId) assetId = nextAssetId(prefixForType(type));

  /*
   * A set with no pieces is not a set. Saving one produces an item that claims
   * to be a kit, shows no chevron, expands to nothing, and cascades over an
   * empty list at check-out — every symptom of a bug, from valid-looking data.
   *
   * Checked here as well as in the browser because this is the boundary that
   * actually protects the Sheet.
   */
  if (isKit) {
    var namedChildren = (p.children || []).filter(function (c) {
      return c && !c._delete && String(c.name || '').trim();
    });
    var existingChildren = p.original_asset_id
      ? table('Items').all().filter(function (i) {
          return i.parent_asset_id === String(p.original_asset_id).trim() && i.active;
        })
      : [];
    var keptExisting = existingChildren.filter(function (child) {
      return !(p.children || []).some(function (c) {
        return c && c._delete && String(c.asset_id || '').trim() === child.asset_id;
      });
    });

    if (!namedChildren.length && !keptExisting.length) {
      fail('BAD_REQUEST',
        'A set needs at least one piece with a name — for a tabla set that would be the ' +
        'dayyu, bayyu, hammer and so on. Add a piece, or untick "This is a set".');
    }
  }

  var existing = p.original_asset_id
    ? items.findBy('asset_id', String(p.original_asset_id).trim())
    : null;
  if (p.original_asset_id && !existing) {
    fail('NOT_FOUND', 'No item found with ID ' + p.original_asset_id + '.');
  }

  // Renaming the primary key would orphan every movement and allocation that
  // points at the old id, so it is only allowed while there is no history yet.
  if (existing && existing.asset_id !== assetId) {
    var hasHistory =
      table('Movements').filterBy('asset_id', existing.asset_id).length > 0 ||
      table('Allocations').filterBy('asset_id', existing.asset_id).length > 0;
    if (hasHistory) {
      fail('BAD_REQUEST',
        'This item already has movement history, so its ID cannot be changed. ' +
        'Remove it and add a new one if the ID is wrong.');
    }
  }
  validateAssetIdAvailable(items, assetId, existing);

  var saved = [];
  var row;

  if (existing) {
    if (existing.is_kit && !isKit) {
      var stillHasKids = table('Items').all().some(function (i) {
        return i.parent_asset_id === existing.asset_id && i.active;
      });
      if (stillHasKids) {
        fail('BAD_REQUEST',
          'Remove the pieces from this set before turning it back into a single item.');
      }
    }
    // An item that is out has a status owned by the check-in flow, not by this form.
    var newStatus = existing.status;
    if (existing.status !== 'checked_out' && p.status &&
        ['available', 'maintenance', 'lost'].indexOf(p.status) !== -1) {
      newStatus = p.status;
    }

    var oldId = existing.asset_id;
    items.update(existing, {
      asset_id: assetId,
      name: name,
      instrument_type: type,
      quality_grade: grade,
      is_kit: isKit,
      status: newStatus,
      current_condition: p.current_condition || existing.current_condition || 'good',
      storage_location: p.storage_location || '',
      notes: p.notes || '',
      qr_token: existing.qr_token || newQrToken()
    });
    if (oldId !== assetId) {
      table('Items').all().forEach(function (child) {
        if (child.parent_asset_id === oldId) items.update(child, { parent_asset_id: assetId });
      });
    }
    row = existing;
  } else {
    row = items.append({
      asset_id: assetId,
      qr_token: newQrToken(),
      name: name,
      instrument_type: type,
      quality_grade: grade,
      parent_asset_id: '',
      is_kit: isKit,
      status: 'available',
      current_condition: p.current_condition || 'good',
      storage_location: p.storage_location || '',
      notes: p.notes || '',
      photo_url: '',
      active: true
    });
  }
  saved.push(row);

  /* ---- kit children, saved on the same screen and the same round trip ---- */
  if (isKit && Array.isArray(p.children)) {
    p.children.forEach(function (c) {
      var childId = String(c.asset_id || '').trim().toUpperCase();
      var childRow = childId ? items.findBy('asset_id', childId) : null;

      if (c._delete) {
        if (!childRow) return;
        if (childRow.status === 'checked_out') {
          fail('ITEM_CHECKED_OUT',
            childRow.asset_id + ' (' + childRow.name + ') is still checked out and cannot be removed.');
        }
        items.update(childRow, { active: false });
        return;
      }

      var childName = String(c.name || '').trim();
      if (!childName) fail('BAD_REQUEST', 'Every piece in the set needs a name.');
      var childType = String(c.instrument_type || type).trim();

      if (childRow) {
        items.update(childRow, {
          name: childName,
          instrument_type: childType,
          quality_grade: c.quality_grade || grade,
          parent_asset_id: assetId,
          storage_location: c.storage_location || p.storage_location || '',
          notes: c.notes || '',
          active: true,
          qr_token: childRow.qr_token || newQrToken()
        });
        saved.push(childRow);
      } else {
        if (!childId) childId = nextAssetId(prefixForType(childType));
        validateAssetIdAvailable(items, childId, null);
        saved.push(items.append({
          asset_id: childId,
          qr_token: newQrToken(),
          name: childName,
          instrument_type: childType,
          quality_grade: c.quality_grade || grade,
          parent_asset_id: assetId,
          is_kit: false,               // one level of nesting only
          status: 'available',
          current_condition: c.current_condition || 'good',
          storage_location: c.storage_location || p.storage_location || '',
          notes: c.notes || '',
          photo_url: '',
          active: true
        }));
      }
    });
  }

  flushAll();

  // Returned with tokens so the label preview can render straight away.
  return { items: saved.map(publicCopy), asset_id: assetId };
}

function actionRemoveItem(p) {
  var assetId = requireField(p, 'asset_id');
  if (!p.confirm) fail('BAD_REQUEST', 'Removal was not confirmed.');

  var plan = assertPlan(Rules.planDeactivate(rulesState(), assetId));

  var items = table('Items');
  plan.asset_ids.forEach(function (id) {
    var row = items.findBy('asset_id', id);
    if (row) items.update(row, { active: false });
  });

  flushAll();
  // Nothing is deleted: the rows stay put so past movements still make sense.
  return { removed: plan.asset_ids };
}

/* ================================================================
 * EVENTS
 * ================================================================ */

function actionSaveEvent(p) {
  var events = table('Events');
  var name = requireField(p, 'name', 'an event name');
  var parentId = String(p.parent_event_id || '').trim();

  if (parentId) {
    var parent = events.findBy('event_id', parentId);
    if (!parent) fail('NOT_FOUND', 'No event found with ID ' + parentId + '.');
    // One level of nesting, enforced at the door rather than papered over later.
    if (parent.parent_event_id) {
      fail('BAD_REQUEST',
        '"' + parent.name + '" is already a sub-event. Sub-events cannot have sub-events of their own.');
    }
  }

  var existing = p.event_id ? events.findBy('event_id', String(p.event_id).trim()) : null;
  if (p.event_id && !existing) fail('NOT_FOUND', 'No event found with ID ' + p.event_id + '.');

  if (existing && parentId === existing.event_id) {
    fail('BAD_REQUEST', 'An event cannot be its own parent.');
  }
  // Turning a parent into a sub-event would orphan its children two levels down.
  if (existing && parentId && !existing.parent_event_id) {
    var hasKids = events.all().some(function (e) { return e.parent_event_id === existing.event_id; });
    if (hasKids) {
      fail('BAD_REQUEST', '"' + existing.name + '" has sub-events of its own, so it cannot become one.');
    }
  }

  // Dates: an end before a start is always a typo, and it quietly corrupts
  // every chronological list and every availability window built from it.
  var startDate = String(p.start_date || '').trim();
  var endDate = String(p.end_date || '').trim();
  if (startDate && !Rules.isValidDate(startDate)) {
    fail('BAD_REQUEST', 'The start date is not a valid date.');
  }
  if (endDate && !Rules.isValidDate(endDate)) {
    fail('BAD_REQUEST', 'The end date is not a valid date.');
  }
  if (startDate && endDate && Rules.daysBetween(startDate, endDate) < 0) {
    fail('BAD_REQUEST',
      'The end date (' + Rules.formatDayMonth(endDate) + ') is before the start date (' +
      Rules.formatDayMonth(startDate) + ').');
  }
  // A one-day event only needs a start date; fill the end in rather than
  // leaving a blank that sorts unpredictably.
  if (startDate && !endDate) endDate = startDate;

  var fields = {
    name: name,
    parent_event_id: parentId,
    start_date: startDate,
    end_date: endDate,
    location: p.location || '',
    centre: p.centre || '',
    status: p.status || 'planned'
  };

  var row;
  if (existing) {
    events.update(existing, fields);
    row = existing;
  } else {
    fields.event_id = nextSequentialId('Events', 'event_id', 'EV-', 3);
    row = events.append(fields);
  }

  flushAll();
  return { event: publicCopy(row) };
}

/**
 * Delete an event.
 *
 * Genuinely deletes the row, but only when nothing points at it. An event that
 * instruments have been out to is history — deleting it would leave movement
 * rows pointing at an id that no longer exists, and the item's own history page
 * would start showing blanks. Those get `cancelled` instead, which keeps the
 * record readable while taking the event out of every dropdown.
 */
function actionDeleteEvent(p) {
  var eventId = requireField(p, 'event_id');
  var events = table('Events');
  var row = events.findBy('event_id', eventId);
  if (!row) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var subEvents = events.all().filter(function (e) { return e.parent_event_id === eventId; });
  if (subEvents.length && !p.include_sub_events) {
    fail('BAD_REQUEST',
      '"' + row.name + '" has ' + subEvents.length + ' sub-event' +
      (subEvents.length === 1 ? '' : 's') + '. Deleting it would delete them too.');
  }

  var targets = [row].concat(p.include_sub_events ? subEvents : []);
  var ids = {};
  targets.forEach(function (e) { ids[e.event_id] = true; });

  // Anything still physically out for this event blocks the whole operation —
  // losing track of where an instrument went is the one thing this app exists
  // to prevent.
  var stillOut = table('Movements').all().filter(function (m) {
    return !m.checked_in_at && (ids[m.event_id] || ids[m.sub_event_id]);
  });
  if (stillOut.length) {
    fail('BAD_REQUEST',
      UI_plural(stillOut.length, 'instrument') + ' still out for this event. ' +
      'Take them back first.');
  }

  var hasHistory = table('Movements').all().some(function (m) {
    return ids[m.event_id] || ids[m.sub_event_id];
  });
  var openBookings = table('Allocations').all().filter(function (a) {
    return ids[a.event_id] && a.status === 'open';
  });

  if (hasHistory) {
    // Keep the row, take it out of circulation.
    targets.forEach(function (e) { events.update(e, { status: 'cancelled' }); });
    openBookings.forEach(function (a) {
      table('Allocations').update(a, { status: 'cancelled' });
    });
    flushAll();
    return {
      deleted: false,
      cancelled: targets.map(function (e) { return e.event_id; }),
      bookings_cancelled: openBookings.length,
      message: 'Instruments have been out to this event before, so it has been cancelled ' +
               'rather than deleted — that keeps the history readable. It no longer appears ' +
               'in any list.'
    };
  }

  // Nothing ever went out to it: safe to remove the row outright.
  openBookings.forEach(function (a) { table('Allocations').update(a, { status: 'cancelled' }); });
  flushAll();

  // Delete bottom-up so earlier deletions do not shift later row numbers.
  var sheet = getSheet('Events');
  targets.map(function (e) { return e._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (rowNum) { sheet.deleteRow(rowNum); });

  resetCache();
  return {
    deleted: true,
    event_ids: targets.map(function (e) { return e.event_id; }),
    bookings_cancelled: openBookings.length,
    message: 'Event deleted.'
  };
}

/** Tiny pluraliser for server-side messages. */
function UI_plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/** "Check in everything for this event", including its sub-events. */
function actionBulkCheckinEvent(p) {
  var eventId = requireField(p, 'event_id');
  var by = requireField(p, 'checked_in_by', 'your name');
  var includeSubs = p.include_sub_events !== false;

  var events = table('Events');
  if (!events.findBy('event_id', eventId)) {
    fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');
  }

  var treeIds = {};
  treeIds[eventId] = true;
  if (includeSubs) {
    events.all().forEach(function (e) {
      if (e.parent_event_id === eventId) treeIds[e.event_id] = true;
    });
  }

  var open = table('Movements').all().filter(function (m) {
    return !m.checked_in_at && (treeIds[m.event_id] || treeIds[m.sub_event_id]);
  });
  if (!open.length) fail('ITEM_NOT_OUT', 'Nothing is currently out for this event.');

  // Everything comes back "good" by default. Anything damaged or missing is
  // flagged one item at a time on the scan screen — a bulk button should not
  // be a way to record damage nobody has looked at.
  return actionCheckin({
    checked_in_by: by,
    items: open.map(function (m) { return { asset_id: m.asset_id }; })
  });
}

/* ================================================================
 * SETTINGS — reference lists and the shared access code
 * ================================================================ */

/**
 * Reference values are stored as TEXT in Items/Events/Allocations/Movements,
 * so renaming one has to rewrite every row that used the old name — otherwise
 * the history stops being readable. Done inside the same lock as the rename.
 */
function cascadeRename(oldName, newName, targets) {
  if (!oldName || oldName === newName) return;
  targets.forEach(function (t) {
    var tbl = table(t.tab);
    tbl.all().forEach(function (row) {
      if (row[t.field] === oldName) {
        var change = {};
        change[t.field] = newName;
        tbl.update(row, change);
      }
    });
  });
}

var RENAME_TARGETS = {
  Centres: [
    { tab: 'Events', field: 'centre' },
    { tab: 'Allocations', field: 'centre' },
    { tab: 'Movements', field: 'centre' }
  ],
  InstrumentTypes: [{ tab: 'Items', field: 'instrument_type' }],
  QualityGrades: [{ tab: 'Items', field: 'quality_grade' }]
};

function saveReferenceList(tabName, idPrefix, incoming, extraFields) {
  if (!Array.isArray(incoming)) return;
  var tbl = table(tabName);

  incoming.forEach(function (entry) {
    var name = String(entry.name || '').trim();
    if (!name) return;

    var row = entry.id ? tbl.findBy('id', String(entry.id).trim()) : null;
    var fields = { name: name, active: entry.active === false ? false : true };
    (extraFields || []).forEach(function (f) {
      if (entry[f] !== undefined) fields[f] = entry[f];
    });

    if (row) {
      cascadeRename(row.name, name, RENAME_TARGETS[tabName] || []);
      tbl.update(row, fields);
    } else {
      fields.id = nextSequentialId(tabName, 'id', idPrefix, 3);
      tbl.append(fields);
    }
  });
}

function actionSaveSettings(p) {
  saveReferenceList('Centres', 'C-', p.centres);
  saveReferenceList('InstrumentTypes', 'IT-', p.instrumentTypes, ['prefix']);
  saveReferenceList('QualityGrades', 'QG-', p.qualityGrades, ['rank']);

  var changed = false;
  if (p.new_access_code !== undefined && String(p.new_access_code).trim() !== '') {
    var next = String(p.new_access_code).trim();
    if (next.length < 6) {
      fail('BAD_REQUEST', 'The access code needs to be at least 6 characters.');
    }
    // The current code was already verified by requireAccess() before we got here.
    setAccessCode(next);
    changed = true;
  }

  flushAll();
  return { saved: true, access_code_changed: changed };
}

/* ================================================================
 * 50-entry.js
 * ================================================================ */

/**
 * Instrument Tracker — entry points and one-time setup.
 *
 * ===================================================================
 *  THE CORS RULE — do not "fix" this into something more standard.
 *
 *  Apps Script web apps do not answer CORS preflight (OPTIONS) requests.
 *  A browser sends a preflight for any POST whose Content-Type is
 *  application/json, or that carries a custom header. That preflight
 *  gets no valid response and the POST dies before it is ever sent —
 *  you see a CORS error in the browser console and NOTHING in the
 *  Apps Script logs, which is a genuinely confusing way to lose an hour.
 *
 *  So the frontend posts with Content-Type: text/plain;charset=utf-8,
 *  which is one of the three types the browser treats as a "simple
 *  request" and never preflights. The body is still JSON — it is just
 *  not labelled as JSON. That is why doPost parses e.postData.contents
 *  by hand below.
 *
 *  For the same reason the access code travels in the JSON body and
 *  never in an Authorization or X-Access-Code header: any custom header
 *  would trigger a preflight too.
 *
 *  The matching comment is in js/api.js. If you change one, change both.
 * ===================================================================
 */

/* ---------------- routing ---------------------------------------- */

var READ_ACTIONS = {
  ping: handlePing,
  bootstrap: handleBootstrap,
  item: handleItem,
  resolve: handleResolve,
  event: handleEvent
};

var WRITE_ACTIONS = {
  checkout: actionCheckout,
  checkin: actionCheckin,
  allocate: actionAllocate,
  cancelAllocation: actionCancelAllocation,
  updateAllocation: actionUpdateAllocation,
  checkAvailability: actionCheckAvailability,
  saveItem: actionSaveItem,
  removeItem: actionRemoveItem,
  suggestAssetId: actionSuggestAssetId,
  saveEvent: actionSaveEvent,
  deleteEvent: actionDeleteEvent,
  bulkCheckinEvent: actionBulkCheckinEvent,
  uploadPhoto: actionUploadPhoto,
  setMovementPhoto: actionSetMovementPhoto,
  deletePhoto: actionDeletePhoto,
  saveSettings: actionSaveSettings
};

function doGet(e) {
  resetCache();
  var params = (e && e.parameter) || {};
  try {
    requireAccess(params.code);
    var handler = READ_ACTIONS[params.action];
    if (!handler) fail('BAD_REQUEST', 'Unknown action "' + (params.action || '') + '".');
    return okResponse(handler(params));
  } catch (err) {
    return handleThrown(err);
  }
}

function doPost(e) {
  resetCache();
  var body;
  try {
    // The body arrives as text/plain to dodge the CORS preflight (see above),
    // so it has to be parsed by hand. It is still JSON.
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return errResponse('BAD_REQUEST', 'The request could not be read. Try again.');
  }

  var lock = LockService.getScriptLock();
  try {
    requireAccess(body.code);

    var handler = WRITE_ACTIONS[body.action];
    if (!handler) fail('BAD_REQUEST', 'Unknown action "' + (body.action || '') + '".');

    // A few milliseconds of serialisation so two volunteers scanning at the
    // same moment cannot both claim the same new row. This is NOT user-facing
    // locking — nobody is ever told "someone else is editing".
    if (!lock.tryLock(20000)) {
      fail('SERVER_ERROR', 'The app is busy saving someone else\'s change. Try again in a moment.');
    }

    resetCache();   // read fresh inside the lock, not from before it
    return okResponse(handler(body.payload || {}));
  } catch (err) {
    return handleThrown(err);
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/**
 * ApiErrors are for the volunteer. Anything else is a bug: log it in full,
 * show something plain. A stack trace on a phone screen helps nobody.
 */
function handleThrown(err) {
  if (err && err.name === 'ApiError') {
    var payload = { ok: false, error: { code: err.code, message: err.message } };
    if (err.blockers) payload.error.blockers = err.blockers;
    if (err.conflicts) payload.error.conflicts = err.conflicts;
    if (err.photo_required) payload.error.photo_required = err.photo_required;
    return jsonOut(payload);
  }
  console.error('Unhandled error: ' + (err && err.stack ? err.stack : err));
  return errResponse('SERVER_ERROR',
    'Something went wrong at our end. Try again — if it keeps happening, tell whoever set this up.');
}

/* ================================================================
 * ONE-TIME SETUP
 * ================================================================
 * Run setupSheet() once from the Apps Script editor. Safe to run again:
 * it creates only what is missing and never duplicates a seeded row.
 */

function setupSheet() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TIMEZONE);

  var created = [];
  TAB_ORDER.forEach(function (name) {
    var headers = TABS[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fdf3e3');
    sheet.setFrozenRows(1);
    // Trim the blank columns Google pads every new sheet with (26 of them),
    // but NEVER past something someone has typed. If a volunteer adds their own
    // column to the right of ours, getLastColumn() covers it and it survives —
    // setupSheet runs on every redeploy and must not eat anybody's notes.
    var keep = Math.max(headers.length, sheet.getLastColumn());
    if (sheet.getMaxColumns() > keep) {
      sheet.deleteColumns(keep + 1, sheet.getMaxColumns() - keep);
    }
    sheet.autoResizeColumns(1, headers.length);
  });

  // Google always creates a "Sheet1"; remove it once the real tabs exist.
  var stray = ss.getSheetByName('Sheet1');
  if (stray && ss.getSheets().length > 1) ss.deleteSheet(stray);

  resetCache();
  seedIfEmpty('Centres', SEED_CENTRES);
  seedIfEmpty('InstrumentTypes', SEED_INSTRUMENT_TYPES);
  seedIfEmpty('QualityGrades', SEED_QUALITY_GRADES);
  seedIfEmpty('Events', SEED_EVENTS);
  seedItemsIfEmpty();

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_ACCESS_CODE)) {
    props.setProperty(PROP_ACCESS_CODE, DEFAULT_ACCESS_CODE);
  }

  var code = props.getProperty(PROP_ACCESS_CODE);
  var message =
    'Instrument Tracker is set up.\n\n' +
    (created.length ? 'Created tabs: ' + created.join(', ') + '\n' : 'All tabs already existed.\n') +
    '\nYour access code is:  ' + code +
    '\n\nChange it any time on the Settings screen in the app.';
  console.log(message);

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (noUi) {
    // Running from a trigger or the editor with no UI attached — the log is enough.
  }
  return message;
}

/* ================================================================
 * TURNING PHOTOS ON
 * ================================================================
 * Run this ONCE from the Apps Script editor, the same way as setupSheet.
 *
 * Apps Script decides which permissions a script needs by reading its code,
 * and it only asks for them when a person runs a function from the editor.
 * Pasting in code that uses Drive and deploying a new version never triggers
 * that prompt — so the web app has no right to touch Drive and every photo
 * upload fails, while everything else keeps working perfectly. That mismatch
 * is exactly what makes it confusing to diagnose.
 *
 * Running this makes Google show the consent screen. Accept it and photos work
 * for everybody, on every device, immediately. There is nothing to redeploy.
 */
function authorizePhotos() {
  var folder = photoFolder();     // the first real Drive call — this is what prompts

  var message =
    'Photos are switched on.\n\n' +
    'They are saved in a folder called "' + folder.getName() + '",\n' +
    'created right next to this spreadsheet in Google Drive:\n\n' +
    folder.getUrl() + '\n\n' +
    'You can move or rename that folder whenever you like — the app remembers it\n' +
    'by its Drive ID, not by where it sits, so nothing breaks.\n\n' +
    'Nothing needs redeploying — try taking a photo in the app now.';
  console.log(message);

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (noUi) {
    // Editor with no UI attached; the log is enough.
  }
  return message;
}

/* ================================================================
 * POINTING PHOTOS AT A DIFFERENT FOLDER
 * ================================================================
 * Only needed if you want the photos somewhere other than where they are —
 * most usefully after moving this whole project to a different Google account.
 *
 * Paste the folder's address between the quotes and run it:
 *
 *   function myFolder() {
 *     setPhotoFolder('https://drive.google.com/drive/folders/1AbC...');
 *   }
 *
 * Existing photos are NOT moved. They keep working exactly where they are,
 * because each one is remembered by its own link; this only changes where the
 * NEXT photo is saved.
 */
function setPhotoFolder(folderUrlOrId) {
  var text = String(folderUrlOrId || '').trim();
  var match = /\/folders\/([A-Za-z0-9_-]+)/.exec(text);
  var id = match ? match[1] : text;

  if (!id) throw new Error('Give setPhotoFolder a Drive folder address or ID.');

  // Fail here rather than at the next photo, when a volunteer is holding a
  // damaged tabla and can do nothing about it.
  var folder = DriveApp.getFolderById(id);

  PropertiesService.getScriptProperties().setProperty(PROP_PHOTO_FOLDER, folder.getId());

  var message = 'New photos will now be saved in "' + folder.getName() + '".\n' +
                folder.getUrl() + '\n\n' +
                'Photos taken before now are untouched and still work.';
  console.log(message);
  return message;
}

/** Writes seed rows only when the tab has nothing but its header. */
function seedIfEmpty(tabName, rows) {
  var sheet = getSheet(tabName);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedItemsIfEmpty() {
  var sheet = getSheet('Items');
  if (sheet.getLastRow() > 1) return;

  var headers = TABS.Items;
  var rows = SEED_ITEMS.map(function (s) {
    var obj = {
      asset_id: s[0],
      qr_token: newQrToken(),
      name: s[1],
      instrument_type: s[2],
      quality_grade: s[3],
      parent_asset_id: s[4],
      is_kit: s[5],
      status: s[6],
      current_condition: s[7],
      storage_location: s[8],
      notes: s[9],
      photo_url: '',
      active: 'TRUE'
    };
    return headers.map(function (h) { return obj[h]; });
  });

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/* ---------------------------------------------------------------- *
 * OPTIONAL demo data
 * ---------------------------------------------------------------- *
 * Run seedDemoMovements() if you want the Dashboard to have something
 * in it while you are learning the app — it puts the tabla set out to
 * Nagar Yatra with a return date in the past, so the overdue tile and
 * the red overdue table both light up.
 *
 * Run clearDemoMovements() to wipe it before real use. Neither function
 * is reachable from the app; both only exist in the editor.
 */

function seedDemoMovements() {
  resetCache();
  var due = Utilities.formatDate(
    new Date(Date.now() - 3 * 86400000), TIMEZONE, 'yyyy-MM-dd');   // 3 days ago

  var result = actionCheckout({
    asset_ids: ['TAB-014', 'HAR-003'],
    event_id: 'EV-003',              // Nagar Yatra, a sub-event of Paris Mandir Mahotsav
    centre: 'East London',
    expected_return_date: due,
    checked_out_by: 'Demo Karyakar',
    condition_out: 'good'
  });
  console.log('Demo data added — ' + result.checked_out.length +
              ' items are now out and 3 days overdue: ' + result.checked_out.join(', '));
  return result;
}

function clearDemoMovements() {
  var ss = SpreadsheetApp.getActive();
  var mv = ss.getSheetByName('Movements');
  var al = ss.getSheetByName('Allocations');
  if (mv && mv.getLastRow() > 1) mv.deleteRows(2, mv.getLastRow() - 1);
  if (al && al.getLastRow() > 1) al.deleteRows(2, al.getLastRow() - 1);

  resetCache();
  var items = table('Items');
  items.all().forEach(function (row) {
    if (row.status === 'checked_out') items.update(row, { status: 'available' });
  });
  flushAll();
  console.log('Demo movements cleared and every item put back to available.');
}

/* ================================================================
 * 60-demo.js
 * ================================================================ */

/**
 * Instrument Tracker — TRIAL DATA.
 *
 * ===================================================================
 *  This is for trying the app out, not for running it. None of it is
 *  written by setupSheet(). Run seedDemoData() from the Apps Script
 *  editor to fill the Sheet with a mandir-sized store and a few weeks
 *  of plausible history, and clearDemoData() to wipe it back to empty
 *  before real use.
 * ===================================================================
 *
 * Two things it is careful about:
 *
 * 1. Every loan and booking is created by calling the REAL actions
 *    (actionCheckout, actionCheckin, actionAllocate). Hand-writing rows
 *    into Movements would let the demo drift out of step with the rules
 *    — an item marked out with no movement row, or a kit half checked
 *    out — and then the app would look broken when it is not.
 *
 * 2. Every date is relative to today. Whenever you seed it, the same
 *    things are overdue by the same number of days, so the dashboard
 *    always looks alive rather than like a museum piece.
 */

/**
 * Stand-in for a real photo in the trial data. Deliberately a data URL rather
 * than a Drive link: it renders offline, needs no permissions, and cannot be
 * mistaken for a real record of damage.
 */
var DEMO_PHOTO_URL =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">' +
    '<rect width="480" height="320" fill="#f5f0e8"/>' +
    '<text x="240" y="150" text-anchor="middle" font-family="sans-serif" ' +
    'font-size="20" fill="#8a4111">Example damage photo</text>' +
    '<text x="240" y="180" text-anchor="middle" font-family="sans-serif" ' +
    'font-size="14" fill="#a8a29e">trial data only</text></svg>');

/** Today plus (or minus) n days, as 'YYYY-MM-DD'. */
function demoDay(offset) {
  return Utilities.formatDate(
    new Date(Date.now() + offset * 86400000), TIMEZONE, 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ *
 * Events — three mahotsavs with sub-events, plus regular sabhas
 * ------------------------------------------------------------------ */

function demoEvents() {
  return [
    // A mahotsav happening right now, with two sub-events.
    ['EV-001', 'Paris Mandir Mahotsav', '', demoDay(-2), demoDay(6), 'Paris', '', 'active'],
    ['EV-002', 'Bal Din', 'EV-001', demoDay(2), demoDay(2), 'Paris', '', 'active'],
    ['EV-003', 'Nagar Yatra', 'EV-001', demoDay(5), demoDay(5), 'Paris', '', 'planned'],

    // A big one later in the year, so there is something to book ahead for.
    ['EV-004', 'Diwali Annakut', '', demoDay(80), demoDay(83), 'Neasden', '', 'planned'],
    ['EV-005', 'Chopda Pujan', 'EV-004', demoDay(80), demoDay(80), 'Neasden', '', 'planned'],
    ['EV-006', 'Annakut Darshan', 'EV-004', demoDay(82), demoDay(83), 'Neasden', '', 'planned'],

    // Regular weekly things, which is where most instruments actually go.
    ['EV-007', 'Weekly Sabha — Ruislip', '', demoDay(0), demoDay(0), 'Ruislip', 'Ruislip', 'active'],
    ['EV-008', 'Bal Sabha — East London', '', demoDay(-1), demoDay(-1), 'East London', 'East London', 'active'],
    ['EV-009', 'Yuva Sabha — Central London', '', demoDay(3), demoDay(3), 'Central London', 'Central London', 'planned'],

    // Finished, so the history pages have something in them.
    ['EV-010', 'Summer Shibir', '', demoDay(-40), demoDay(-37), 'Bhaktinagar', '', 'completed'],
    ['EV-011', 'Guru Purnima Sabha', '', demoDay(-20), demoDay(-20), 'Neasden', '', 'completed']
  ];
}

/* ------------------------------------------------------------------ *
 * Instruments — a store room, not a sample
 * ------------------------------------------------------------------ */

/** [asset_id, name, type, grade, parent, is_kit, status, condition, location, notes] */
function demoItems() {
  var rows = [];

  function add(id, name, type, grade, location, opts) {
    opts = opts || {};
    rows.push([
      id, name, type, grade, opts.parent || '', opts.is_kit ? 'TRUE' : 'FALSE',
      opts.status || 'available', opts.condition || 'good', location, opts.notes || ''
    ]);
  }

  /* ---- Tabla: four full sets, each with five pieces ---- */
  var TABLA_SETS = [
    ['TAB-001', 'Tabla Set A', 'Aradhana', 'Store Room 2, Shelf B', 'excellent'],
    ['TAB-002', 'Tabla Set B', 'Aradhana', 'Store Room 2, Shelf B', 'good'],
    ['TAB-003', 'Tabla Set C', 'Normal Sabha', 'Store Room 2, Shelf C', 'good'],
    ['TAB-004', 'Tabla Set D', 'Practice Use', 'Store Room 1, Cupboard', 'fair']
  ];
  var childSeq = 1;
  TABLA_SETS.forEach(function (set, index) {
    var id = set[0], name = set[1], grade = set[2], loc = set[3], cond = set[4];
    add(id, name, 'Tabla', grade, loc,
        { is_kit: true, condition: cond, notes: 'Dayyu, bayyu, hammer, powder, bag' });

    // Pieces carry their own type-sequence ids; the set link is parent_asset_id.
    var pieceNumber = 100 + index * 2;
    add('TAB-' + pad3(pieceNumber), name + ' — Dayyu', 'Tabla', grade, loc,
        { parent: id, condition: cond });
    add('TAB-' + pad3(pieceNumber + 1), name + ' — Bayyu', 'Tabla', grade, loc,
        { parent: id, condition: cond });
    add('OTH-' + pad3(childSeq++), name + ' — Hammer', 'Other', grade, loc,
        { parent: id, notes: 'Small — easily lost' });
    add('OTH-' + pad3(childSeq++), name + ' — Powder Bottle', 'Other', grade, loc,
        { parent: id });
    add('OTH-' + pad3(childSeq++), name + ' — Bag', 'Other', grade, loc,
        { parent: id, notes: '40mm tag on the handle' });
  });

  /* ---- Harmoniums ---- */
  add('HAR-001', 'Harmonium — Bina 23B (3.5 octave)', 'Harmonium', 'Aradhana', 'Store Room 2, Shelf A', { condition: 'excellent' });
  add('HAR-002', 'Harmonium — Bina 17B scale changer', 'Harmonium', 'Aradhana', 'Store Room 2, Shelf A', { condition: 'excellent', notes: 'Scale changer — handle with care' });
  add('HAR-003', 'Harmonium — Paul & Co, teak', 'Harmonium', 'Aradhana', 'Store Room 2, Shelf A');
  add('HAR-004', 'Harmonium — Monoj Kumar Sardar', 'Harmonium', 'Normal Sabha', 'Store Room 2, Shelf A');
  add('HAR-005', 'Harmonium — portable, folding', 'Harmonium', 'Normal Sabha', 'Store Room 1, Cupboard', { notes: 'Lightweight — good for outdoor nagar yatra' });
  add('HAR-006', 'Harmonium — practice, small', 'Harmonium', 'Practice Use', 'Bal Room', { condition: 'fair', notes: 'Two keys sticking' });
  // Seeded as available on purpose. Story 3 in seedDemoHistory() takes it out
  // and brings it back needing repair, and THAT is what puts it into
  // maintenance. Asserting the end state here as well would let the two drift
  // apart — and a status with no movement behind it is exactly the kind of
  // inconsistency this app exists to prevent.
  add('HAR-007', 'Harmonium — Delhi make, old', 'Harmonium', 'Practice Use', 'Store Room 1, Floor');

  /* ---- Keyboards ---- */
  add('KEY-001', 'Yamaha PSR-E473', 'Keyboard', 'Aradhana', 'Store Room 1, Cupboard', { condition: 'excellent', notes: 'Stand and adaptor in the same case' });
  add('KEY-002', 'Yamaha PSR-E373', 'Keyboard', 'Normal Sabha', 'Store Room 1, Cupboard', { notes: 'Stand and adaptor in the same case' });
  add('KEY-003', 'Casio CT-S1000V', 'Keyboard', 'Normal Sabha', 'Store Room 1, Cupboard');
  add('KEY-004', 'Roland E-X50', 'Keyboard', 'Normal Sabha', 'Sound Desk Store');
  add('KEY-005', 'Yamaha PSR-E273 (practice)', 'Keyboard', 'Practice Use', 'Bal Room', { condition: 'fair' });

  /* ---- Dholak and other percussion ---- */
  add('DHO-001', 'Dholak — brass shell, tuneable', 'Dholak', 'Aradhana', 'Store Room 2, Floor', { condition: 'excellent' });
  add('DHO-002', 'Dholak — sheesham, rope tuned', 'Dholak', 'Normal Sabha', 'Store Room 2, Floor');
  add('DHO-003', 'Dholak — mango wood', 'Dholak', 'Normal Sabha', 'Store Room 2, Floor', { condition: 'fair', notes: 'Left skin worn — still usable' });
  add('DHO-004', 'Dholak — practice', 'Dholak', 'Practice Use', 'Bal Room', { condition: 'fair' });

  add('MAN-001', 'Manjira — heavy brass, large', 'Manjira', 'Aradhana', 'Store Room 2, Drawer 1', { condition: 'excellent' });
  add('MAN-002', 'Manjira — heavy brass, large', 'Manjira', 'Aradhana', 'Store Room 2, Drawer 1', { condition: 'excellent' });
  add('MAN-003', 'Manjira — medium', 'Manjira', 'Normal Sabha', 'Store Room 2, Drawer 1');
  add('MAN-004', 'Manjira — medium', 'Manjira', 'Normal Sabha', 'Store Room 2, Drawer 1');
  add('MAN-005', 'Manjira — small, bal', 'Manjira', 'Practice Use', 'Bal Room');
  add('MAN-006', 'Manjira — small, bal', 'Manjira', 'Practice Use', 'Bal Room');
  // Also seeded available — story 2 is what loses it.
  add('MAN-007', 'Manjira — small, bal', 'Manjira', 'Practice Use', 'Bal Room');

  add('KAR-001', 'Kartal — sheesham, jingles', 'Kartal', 'Aradhana', 'Store Room 2, Drawer 2');
  add('KAR-002', 'Kartal — sheesham, jingles', 'Kartal', 'Aradhana', 'Store Room 2, Drawer 2');
  add('KAR-003', 'Kartal — plain wood', 'Kartal', 'Normal Sabha', 'Store Room 2, Drawer 2');
  add('KAR-004', 'Kartal — plain wood', 'Kartal', 'Normal Sabha', 'Store Room 2, Drawer 2');
  add('KAR-005', 'Kartal — bal size', 'Kartal', 'Practice Use', 'Bal Room');

  add('JHA-001', 'Jhanjh — large brass', 'Jhanjh', 'Aradhana', 'Store Room 2, Shelf D', { condition: 'excellent' });
  add('JHA-002', 'Jhanjh — medium', 'Jhanjh', 'Normal Sabha', 'Store Room 2, Shelf D');
  add('JHA-003', 'Jhanjh — small', 'Jhanjh', 'Normal Sabha', 'Store Room 2, Shelf D');

  /* ---- Strings ---- */
  add('VIO-001', 'Violin — full size, with bow', 'Violin', 'Aradhana', 'Store Room 2, Shelf E', { condition: 'excellent', notes: 'Rosin and spare strings in the case' });
  add('VIO-002', 'Violin — 3/4 size', 'Violin', 'Normal Sabha', 'Store Room 2, Shelf E');
  add('SIT-001', 'Sitar — Rikhi Ram, full', 'Sitar', 'Aradhana', 'Store Room 2, Shelf E', { condition: 'excellent', notes: 'Fragile — do not lay flat in a van' });
  add('SIT-002', 'Sitar — student', 'Sitar', 'Practice Use', 'Store Room 2, Shelf E', { condition: 'fair' });

  /* ---- Sound ---- */
  add('AMP-001', 'Amplifier — Yamaha StagePas 600', 'Amplifier', 'Aradhana', 'Sound Desk Store', { condition: 'excellent' });
  add('AMP-002', 'Amplifier — Behringer Europort', 'Amplifier', 'Normal Sabha', 'Sound Desk Store');
  add('AMP-003', 'Amplifier — small practice combo', 'Amplifier', 'Practice Use', 'Bal Room', { condition: 'fair' });

  add('MIC-001', 'Shure SM58 — vocal', 'Microphone', 'Aradhana', 'Sound Desk Drawer', { condition: 'excellent' });
  add('MIC-002', 'Shure SM58 — vocal', 'Microphone', 'Aradhana', 'Sound Desk Drawer', { condition: 'excellent' });
  add('MIC-003', 'Shure SM58 — vocal', 'Microphone', 'Normal Sabha', 'Sound Desk Drawer');
  add('MIC-004', 'Sennheiser e835', 'Microphone', 'Normal Sabha', 'Sound Desk Drawer');
  add('MIC-005', 'Radio mic — handheld, channel 1', 'Microphone', 'Aradhana', 'Sound Desk Store', { notes: 'Needs 2 x AA batteries' });
  add('MIC-006', 'Radio mic — headset, channel 2', 'Microphone', 'Aradhana', 'Sound Desk Store', { notes: 'Needs 2 x AA batteries' });
  add('MIC-007', 'Instrument mic — for tabla', 'Microphone', 'Normal Sabha', 'Sound Desk Drawer', { condition: 'fair' });

  add('CAB-001', 'XLR cable bag — 6 x 5m', 'Cables', 'Normal Sabha', 'Sound Desk Store');
  add('CAB-002', 'XLR cable bag — 4 x 10m', 'Cables', 'Normal Sabha', 'Sound Desk Store');
  add('CAB-003', 'Extension reel — 25m', 'Cables', 'Normal Sabha', 'Sound Desk Store');
  add('CAB-004', 'Jack lead bag — assorted', 'Cables', 'Practice Use', 'Sound Desk Store', { condition: 'fair' });

  return rows;
}

function pad3(n) {
  var s = String(n);
  while (s.length < 3) s = '0' + s;
  return s;
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * Fills the Sheet with a full store and a few weeks of history.
 *
 * Wipes whatever is there first, so it is safe to run repeatedly while you
 * are trying things out.
 */
function seedDemoData() {
  var ss = SpreadsheetApp.getActive();

  // Start from a clean slate — otherwise ids collide with whatever is there.
  ['Movements', 'Allocations', 'Items', 'Events'].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  });
  resetCache();

  // --- events and items, written directly ---
  var events = demoEvents();
  getSheet('Events').getRange(2, 1, events.length, TABS.Events.length).setValues(events);

  var items = demoItems();
  var headers = TABS.Items;
  var itemRows = items.map(function (s) {
    var obj = {
      asset_id: s[0], qr_token: newQrToken(), name: s[1], instrument_type: s[2],
      quality_grade: s[3], parent_asset_id: s[4], is_kit: s[5], status: s[6],
      current_condition: s[7], storage_location: s[8], notes: s[9],
      photo_url: '', active: 'TRUE'
    };
    return headers.map(function (h) { return obj[h]; });
  });
  getSheet('Items').getRange(2, 1, itemRows.length, headers.length).setValues(itemRows);
  resetCache();

  // --- history, driven through the real actions ---
  var counts = seedDemoHistory();

  var message =
    'Trial data loaded.\n\n' +
    items.length + ' instruments (including ' + 4 + ' tabla sets)\n' +
    events.length + ' events\n' +
    counts.loans + ' past and present loans\n' +
    counts.bookings + ' bookings for later\n\n' +
    'Run clearDemoData() to empty it all out before real use.';
  console.log(message);
  try { SpreadsheetApp.getUi().alert(message); } catch (noUi) {}
  return message;
}

/**
 * The interesting part: a spread of situations a karyakar will actually meet.
 * Each block is one story, and they are ordered oldest first so the history
 * reads sensibly.
 */
function seedDemoHistory() {
  var loans = 0, bookings = 0;

  function giveOut(assetIds, eventId, centre, dueOffset, by, outOffset) {
    resetCache();
    actionCheckout({
      asset_ids: assetIds,
      event_id: eventId,
      centre: centre,
      expected_return_date: demoDay(dueOffset),
      checked_out_by: by,
      allow_partial: true
    });
    loans++;
  }

  function takeBack(items, by) {
    resetCache();
    actionCheckin({ checked_in_by: by, items: items });
  }

  function book(assetIds, eventId, centre, fromOffset, toOffset, by, notes) {
    resetCache();
    actionAllocate({
      asset_ids: assetIds,
      event_id: eventId,
      centre: centre,
      needed_from: demoDay(fromOffset),
      expected_return_date: demoDay(toOffset),
      allocated_by: by,
      notes: notes || ''
    });
    bookings++;
  }

  /* --- 1. Summer Shibir, six weeks ago: went out, came back fine --- */
  giveOut(['TAB-003', 'HAR-004', 'DHO-002', 'MAN-003', 'MAN-004'],
          'EV-010', 'Central London', -37, 'Bhavesh');
  takeBack([
    { asset_id: 'TAB-003' }, { asset_id: 'HAR-004' }, { asset_id: 'DHO-002' },
    { asset_id: 'MAN-003' }, { asset_id: 'MAN-004' }
  ], 'Bhavesh');

  /* --- 2. Guru Purnima, three weeks ago: a manjira never came back --- */
  giveOut(['HAR-005', 'MAN-005', 'MAN-006', 'MAN-007', 'KAR-005'],
          'EV-011', 'Neasden', -20, 'Priya');
  takeBack([
    { asset_id: 'HAR-005' }, { asset_id: 'MAN-005' }, { asset_id: 'MAN-006' },
    { asset_id: 'MAN-007', missing: true, damage_notes: 'Not returned after Guru Purnima' },
    { asset_id: 'KAR-005' }
  ], 'Priya');

  /* --- 3. An older loan that came back damaged, hence HAR-007 in maintenance --- */
  giveOut(['HAR-007', 'MIC-007'], 'EV-011', 'Neasden', -20, 'Priya');
  // A damaged return needs a photo, so the trial data carries one too —
  // otherwise the seeder would be exercising a path real users cannot take.
  takeBack([
    { asset_id: 'HAR-007', condition_in: 'needs_repair',
      damage_notes: 'Bellows leaking after the sabha — sent to the repairer',
      photo_url: DEMO_PHOTO_URL },
    { asset_id: 'MIC-007', condition_in: 'fair' }
  ], 'Priya');

  /* --- 4. OUT NOW AND LATE: a whole tabla set for Nagar Yatra, 3 days over --- */
  giveOut(['TAB-001', 'HAR-001', 'MIC-005'], 'EV-003', 'East London', -3, 'Nilesh');

  /* --- 5. OUT NOW AND LATE: Bal Sabha kit, 1 day over --- */
  giveOut(['DHO-004', 'MAN-005', 'KAR-005', 'HAR-006'], 'EV-008', 'East London', -1, 'Ramesh');

  /* --- 6. OUT NOW, due today — the boundary case, must NOT read as late --- */
  giveOut(['TAB-002', 'KEY-002'], 'EV-007', 'Ruislip', 0, 'Jignesh');

  /* --- 7. OUT NOW, comfortably in date --- */
  giveOut(['KEY-001', 'AMP-001', 'MIC-001', 'MIC-002', 'CAB-001'],
          'EV-002', 'Paris', 4, 'Nilesh');
  giveOut(['VIO-001', 'SIT-001'], 'EV-002', 'Paris', 4, 'Nilesh');

  /* --- 8. BOOKED AHEAD for Diwali, months out --- */
  book(['TAB-004', 'HAR-002', 'KEY-003'], 'EV-005', 'Neasden', 79, 81, 'Meera',
       'Requested by email — Chopda Pujan sound and sangeet');
  book(['AMP-002', 'MIC-003', 'MIC-004', 'CAB-002', 'CAB-003'], 'EV-006', 'Neasden',
       81, 84, 'Meera', 'Full PA for Annakut darshan');

  /* --- 9. BOOKED AHEAD, near-term, for Yuva Sabha --- */
  book(['DHO-001', 'JHA-001', 'KAR-001', 'KAR-002'], 'EV-009', 'Central London',
       2, 4, 'Ashish', 'Yuva sabha kirtan');

  /* --- 10. THE OVERLAP CASE ---
   * HAR-003 is booked for two different weeks by two different centres.
   * Nothing clashes, because the windows do not touch — but try booking it
   * for a day in between and the app will refuse and say who has it. This is
   * the case worth playing with. */
  book(['HAR-003'], 'EV-007', 'Ruislip', 10, 12, 'Jignesh', 'Weekly sabha, next week');
  book(['MAN-001', 'MAN-002'], 'EV-007', 'Ruislip', 10, 12, 'Jignesh');
  book(['HAR-003'], 'EV-009', 'Central London', 20, 22, 'Ashish',
       'Same harmonium, a different week — this is allowed');

  return { loans: loans, bookings: bookings };
}

/** Empties everything the trial data put in, ready for real use. */
function clearDemoData() {
  var ss = SpreadsheetApp.getActive();
  ['Movements', 'Allocations', 'Items', 'Events'].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  });
  resetCache();

  var message = 'Trial data cleared. Items, Events, Allocations and Movements are now empty.\n\n' +
                'Add your real instruments from the app, or run setupSheet() to put the small ' +
                'starter sample back.';
  console.log(message);
  try { SpreadsheetApp.getUi().alert(message); } catch (noUi) {}
  return message;
}

