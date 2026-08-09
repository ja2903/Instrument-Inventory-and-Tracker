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
    if (sheet.getMaxColumns() > headers.length) {
      sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
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
