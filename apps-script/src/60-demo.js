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
