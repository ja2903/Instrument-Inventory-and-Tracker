/**
 * End-to-end tests against the real generated apps-script/Code.gs, running in
 * a fake Apps Script runtime (tests/gas-mock.js).
 *
 * The unit tests in kit.test.js prove the RULES are right. These prove the
 * rules are actually wired up — that setupSheet writes the right headers, that
 * a check-out lands six rows in Movements, that the access code is enforced on
 * every endpoint, and that the CORS-shaped POST body parses.
 */

var GAS = require('./gas-mock.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

/** A freshly set-up app with the clock pinned to 8 Aug 2026, 14:00 London. */
function freshApp() {
  var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  app.sandbox.setupSheet();
  return app;
}

function expectOk(res, msg) {
  if (!res.ok) fail((msg ? msg + '\n' : '') + 'expected success, got ' +
                    res.error.code + ': ' + res.error.message);
  return res.data;
}

function expectErr(res, code) {
  if (res.ok) fail('expected error ' + code + ', but the call succeeded');
  if (res.error.code !== code) {
    fail('expected error ' + code + ', got ' + res.error.code + ': ' + res.error.message);
  }
  return res.error;
}

module.exports = function () {

  /* ---------------------------------------------------------------- */
  suite('Setup script', function () {

    test('creates all seven tabs with the documented headers', function () {
      var app = freshApp();
      ['Items', 'Events', 'Allocations', 'Movements',
       'Centres', 'InstrumentTypes', 'QualityGrades'].forEach(function (name) {
        var sheet = app.spreadsheet.getSheetByName(name);
        ok(sheet, 'missing tab: ' + name);
      });
      eq(app.spreadsheet.getSheetByName('Items').getRange(1, 1, 1, 13).getValues()[0],
         ['asset_id', 'qr_token', 'name', 'instrument_type', 'quality_grade',
          'parent_asset_id', 'is_kit', 'status', 'current_condition',
          'storage_location', 'notes', 'photo_url', 'active']);
    });

    test('removes the default Sheet1', function () {
      var app = freshApp();
      notOk(app.spreadsheet.getSheetByName('Sheet1'));
    });

    test('seeds ten items including the full six-piece tabla kit', function () {
      var app = freshApp();
      var items = app.rows('Items');
      eq(items.length, 10);
      eq(items.filter(function (i) { return i.parent_asset_id === 'TAB-014'; }).length, 5);
      eq(items.filter(function (i) { return i.is_kit === 'TRUE'; }).length, 1);
    });

    test('gives every seeded item a distinct QR token', function () {
      var app = freshApp();
      var tokens = app.rows('Items').map(function (i) { return i.qr_token; });
      eq(tokens.filter(function (t) { return !t; }).length, 0, 'every item has a token');
      eq(new Set(tokens).size, tokens.length, 'no two items share a token');
    });

    test('seeds two sub-events under one parent event', function () {
      var app = freshApp();
      var events = app.rows('Events');
      eq(events.length, 3);
      eq(events.filter(function (e) { return e.parent_event_id === 'EV-001'; }).length, 2);
    });

    test('is idempotent — running it twice does not duplicate anything', function () {
      var app = freshApp();
      app.sandbox.setupSheet();
      eq(app.rows('Items').length, 10);
      eq(app.rows('Centres').length, 6);
      eq(app.rows('Events').length, 3);
    });

    test('sets the spreadsheet timezone to Europe/London', function () {
      var app = freshApp();
      eq(app.spreadsheet.timezone, 'Europe/London');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Access code', function () {

    test('a wrong code is refused on reads', function () {
      var app = freshApp();
      var res = JSON.parse(app.sandbox.doGet({
        parameter: { action: 'bootstrap', code: 'wrong' }
      })._text);
      expectErr(res, 'BAD_CODE');
    });

    test('a wrong code is refused on writes, before anything is saved', function () {
      var app = freshApp();
      expectErr(app.post('checkout', { asset_ids: ['HAR-003'] }, 'wrong'), 'BAD_CODE');
      eq(app.rows('Movements').length, 0, 'nothing was written');
    });

    test('a missing code is refused', function () {
      var app = freshApp();
      expectErr(app.post('checkout', { asset_ids: ['HAR-003'] }, ''), 'BAD_CODE');
    });

    test('the seeded code works', function () {
      var app = freshApp();
      var data = expectOk(app.get('ping'));
      ok(/^\d+\.\d+\.\d+$/.test(data.version), 'ping reports a version: ' + data.version);
    });

    test('the server version matches the cache stamp in index.html', function () {
      // These two drifting apart is how a phone ends up running last week's
      // JavaScript against this week's backend. tools/bump-version.js keeps
      // them in step; this catches a hand-edit that only changed one of them.
      var fs = require('fs');
      var path = require('path');
      var indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

      var stamps = indexHtml.match(/\?v=(\d+\.\d+\.\d+)/g) || [];
      ok(stamps.length >= 5, 'index.html carries cache stamps, found ' + stamps.length);
      eq(new Set(stamps).size, 1, 'every stamp in index.html is the same version');

      eq(expectOk(freshApp().get('ping')).version, stamps[0].replace('?v=', ''));
    });

    test('changing it in Settings takes effect immediately', function () {
      var app = freshApp();
      expectOk(app.post('saveSettings', { new_access_code: 'newcode2026' }));
      expectErr(app.post('saveSettings', {}, 'mandir2026'), 'BAD_CODE');
      expectOk(app.post('saveSettings', {}, 'newcode2026'));
    });

    test('a too-short new code is refused and the old one still works', function () {
      var app = freshApp();
      expectErr(app.post('saveSettings', { new_access_code: 'abc' }), 'BAD_REQUEST');
      expectOk(app.get('ping'));
    });
  });

  /* ---------------------------------------------------------------- */
  suite('POST body parsing — the CORS-shaped request', function () {

    test('a JSON string body sent as text/plain parses correctly', function () {
      // This is exactly what fetch(url, {method:'POST', body: JSON.stringify(...)})
      // with Content-Type text/plain delivers to doPost.
      var app = freshApp();
      var res = JSON.parse(app.sandbox.doPost({
        postData: {
          contents: JSON.stringify({
            action: 'suggestAssetId',
            code: app.properties.ACCESS_CODE,
            payload: { instrument_type: 'Tabla' }
          })
        }
      })._text);
      eq(expectOk(res).asset_id, 'TAB-017');
    });

    test('an unreadable body fails politely instead of throwing', function () {
      var app = freshApp();
      var res = JSON.parse(app.sandbox.doPost({ postData: { contents: 'not json' } })._text);
      expectErr(res, 'BAD_REQUEST');
    });

    test('an unknown action is refused', function () {
      var app = freshApp();
      expectErr(app.post('deleteEverything', {}), 'BAD_REQUEST');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Bootstrap', function () {

    test('returns every reference list, the events tree and all items', function () {
      var app = freshApp();
      var d = expectOk(app.get('bootstrap'));
      eq(d.centres.length, 6);
      eq(d.instrumentTypes.length, 13);
      eq(d.qualityGrades.length, 3);
      eq(d.items.length, 10);
      eq(d.today, '2026-08-08');
    });

    test('nests sub-event ids under their parent', function () {
      var app = freshApp();
      var d = expectOk(app.get('bootstrap'));
      var parent = d.events.filter(function (e) { return e.event_id === 'EV-001'; })[0];
      eq(parent.children, ['EV-002', 'EV-003']);
    });

    test('lists a kit parent\'s children', function () {
      var app = freshApp();
      var d = expectOk(app.get('bootstrap'));
      var kit = d.items.filter(function (i) { return i.asset_id === 'TAB-014'; })[0];
      eq(kit.is_kit, true);
      eq(kit.children.sort(), ['OTH-001', 'OTH-002', 'OTH-003', 'TAB-015', 'TAB-016']);
    });

    test('live is null while everything is on the shelf', function () {
      var app = freshApp();
      var d = expectOk(app.get('bootstrap'));
      d.items.forEach(function (i) { eq(i.live, null, i.asset_id); });
      eq(d.openMovements.length, 0);
    });

    test('booleans survive the round trip to the Sheet and back', function () {
      var app = freshApp();
      var d = expectOk(app.get('bootstrap'));
      var child = d.items.filter(function (i) { return i.asset_id === 'OTH-001'; })[0];
      eq(child.is_kit, false, 'is_kit is a real boolean, not the string "FALSE"');
      eq(child.active, true);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Check-out writes what it says it writes', function () {

    function checkoutKit(app, extra) {
      return app.post('checkout', Object.assign({
        asset_ids: ['TAB-014'],
        event_id: 'EV-003',                 // Nagar Yatra — a sub-event
        centre: 'East London',
        expected_return_date: '2026-08-12',
        checked_out_by: 'Nilesh'
      }, extra || {}));
    }

    test('one scan of the kit writes six movement rows', function () {
      var app = freshApp();
      var d = expectOk(checkoutKit(app));
      eq(d.checked_out.length, 6);
      eq(app.rows('Movements').length, 6);
    });

    test('the sub-event is stored separately from its parent event', function () {
      var app = freshApp();
      checkoutKit(app);
      app.rows('Movements').forEach(function (m) {
        eq(m.event_id, 'EV-001', 'top-level event');
        eq(m.sub_event_id, 'EV-003', 'leaf sub-event');
      });
    });

    test('children carry via_parent_asset_id, the parent does not', function () {
      var app = freshApp();
      checkoutKit(app);
      app.rows('Movements').forEach(function (m) {
        eq(m.via_parent_asset_id, m.asset_id === 'TAB-014' ? '' : 'TAB-014', m.asset_id);
      });
    });

    test('every item in the set is marked checked_out in Items', function () {
      var app = freshApp();
      checkoutKit(app);
      var out = app.rows('Items').filter(function (i) { return i.status === 'checked_out'; });
      eq(out.length, 6);
    });

    test('movement ids are sequential and unique across a batch', function () {
      var app = freshApp();
      checkoutKit(app);
      var ids = app.rows('Movements').map(function (m) { return m.movement_id; });
      eq(ids, ['MV-000001', 'MV-000002', 'MV-000003', 'MV-000004', 'MV-000005', 'MV-000006']);
    });

    test('checked_out_at is a London timestamp with the BST offset', function () {
      var app = freshApp();
      checkoutKit(app);
      var m = app.rows('Movements')[0];
      eq(m.checked_out_at, '2026-08-08T14:00:00+01:00');
    });

    test('an event and a return date are required', function () {
      var app = freshApp();
      expectErr(app.post('checkout', {
        asset_ids: ['HAR-003'], centre: 'East London', checked_out_by: 'Nilesh'
      }), 'BAD_REQUEST');
      eq(app.rows('Movements').length, 0);
    });

    test('a top-level event leaves sub_event_id blank', function () {
      var app = freshApp();
      expectOk(checkoutKit(app, { asset_ids: ['HAR-003'], event_id: 'EV-001' }));
      var m = app.rows('Movements')[0];
      eq(m.event_id, 'EV-001');
      eq(m.sub_event_id, '');
    });

    test('a failed check-out leaves the Sheet completely untouched', function () {
      var app = freshApp();
      expectErr(checkoutKit(app, { asset_ids: ['TAB-999'] }), 'NOT_FOUND');
      eq(app.rows('Movements').length, 0);
      eq(app.rows('Items').filter(function (i) { return i.status !== 'available'; }).length, 0);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Live state and overdue, computed on read', function () {

    function putKitOut(app, due) {
      return app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: due, checked_out_by: 'Nilesh'
      });
    }

    test('an item out reads back with its event, sub-event and centre', function () {
      var app = freshApp();
      putKitOut(app, '2026-08-12');
      var d = expectOk(app.get('bootstrap'));
      var kit = d.items.filter(function (i) { return i.asset_id === 'TAB-014'; })[0];
      eq(kit.live.event_name, 'Paris Mandir Mahotsav');
      eq(kit.live.sub_event_name, 'Nagar Yatra');
      eq(kit.live.centre, 'East London');
      eq(kit.live.days_overdue, 0);
    });

    test('a child names the parent it went out with (rule K4)', function () {
      var app = freshApp();
      putKitOut(app, '2026-08-12');
      var d = expectOk(app.get('bootstrap'));
      var hammer = d.items.filter(function (i) { return i.asset_id === 'OTH-001'; })[0];
      eq(hammer.live.via_parent_asset_id, 'TAB-014');
      eq(hammer.live.via_parent_name, 'Tabla Set A');
    });

    test('overdue is counted from the London date, not stored anywhere', function () {
      var app = freshApp();
      putKitOut(app, '2026-08-05');            // three days before the pinned clock
      var d = expectOk(app.get('bootstrap'));
      var kit = d.items.filter(function (i) { return i.asset_id === 'TAB-014'; })[0];
      eq(kit.live.days_overdue, 3);

      var headers = app.spreadsheet.getSheetByName('Movements').getRange(1, 1, 1, 16).getValues()[0];
      notOk(headers.indexOf('overdue') !== -1, 'there is no overdue column, by design');
      notOk(headers.indexOf('days_overdue') !== -1);
    });

    test('due today is not overdue', function () {
      var app = freshApp();
      putKitOut(app, '2026-08-08');
      var d = expectOk(app.get('bootstrap'));
      eq(d.items.filter(function (i) { return i.asset_id === 'TAB-014'; })[0].live.days_overdue, 0);
    });

    test('the item detail page states it in plain English', function () {
      var app = freshApp();
      putKitOut(app, '2026-08-05');
      var d = expectOk(app.get('item', { asset_id: 'TAB-014' }));
      eq(d.status_text,
         'Out with East London — Paris Mandir Mahotsav / Nagar Yatra — due 5 Aug — 3 days overdue');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Check-in, including the hammer that never came back', function () {

    function kitOut(app) {
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      return app;
    }

    test('scanning the parent closes all six movements', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-014' }] }));
      var open = app.rows('Movements').filter(function (m) { return !m.checked_in_at; });
      eq(open.length, 0);
      eq(app.rows('Items').filter(function (i) { return i.status === 'checked_out'; }).length, 0);
    });

    test('a missing child is recorded as lost, with a note, while the rest come back', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'OTH-001', missing: true }]
      }));

      var hammer = app.rows('Items').filter(function (i) { return i.asset_id === 'OTH-001'; })[0];
      eq(hammer.status, 'lost');

      var mv = app.rows('Movements').filter(function (m) { return m.asset_id === 'OTH-001'; })[0];
      eq(mv.outcome, 'missing');
      eq(mv.damage_notes, 'Not returned');
      eq(mv.condition_in, '');
      ok(mv.checked_in_at, 'the movement is still closed — the trip is over');

      eq(app.rows('Items').filter(function (i) { return i.status === 'available'; }).length, 9);
    });

    test('a damaged child goes to maintenance with its condition recorded', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [
          { asset_id: 'TAB-014' },
          { asset_id: 'TAB-016', condition_in: 'needs_repair', damage_notes: 'Skin split',
            photo_url: 'https://drive.google.com/thumbnail?id=demo' }
        ]
      }));
      var bayyu = app.rows('Items').filter(function (i) { return i.asset_id === 'TAB-016'; })[0];
      eq(bayyu.status, 'maintenance');
      eq(bayyu.current_condition, 'needs_repair');
      var mv = app.rows('Movements').filter(function (m) { return m.asset_id === 'TAB-016'; })[0];
      eq(mv.outcome, 'damaged');
      eq(mv.damage_notes, 'Skin split');
    });

    test('the maintenance item is then skipped next time the set goes out (K2)', function () {
      var app = kitOut(freshApp());
      app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' },
                { asset_id: 'TAB-016', condition_in: 'needs_repair', photo_url: 'https://drive.google.com/thumbnail?id=demo' }]
      });
      var d = expectOk(app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      }));
      eq(d.checked_out.length, 5);
      eq(d.warnings.length, 1);
      eq(d.warnings[0].asset_id, 'TAB-016');
      ok(d.warnings[0].reason.indexOf('maintenance') !== -1);
    });

    test('a child out alone blocks the set, and allow_partial gets past it (K3)', function () {
      var app = freshApp();
      expectOk(app.post('checkout', {
        asset_ids: ['OTH-001'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      }));

      var blocked = expectErr(app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      }), 'KIT_CHILD_OUT');
      ok(blocked.message.indexOf('OTH-001') !== -1);
      eq(app.rows('Movements').length, 1, 'the blocked attempt wrote nothing');

      var d = expectOk(app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh', allow_partial: true
      }));
      eq(d.checked_out.length, 5);
      eq(app.rows('Movements').length, 6);
    });

    test('a child out alone is not swept up by the parent check-in (K7)', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['OTH-001'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      });
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh', allow_partial: true
      });

      var d = expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-014' }]
      }));
      eq(d.checked_in.length, 5);
      eq(d.warnings.length, 1);
      eq(d.warnings[0].asset_id, 'OTH-001');

      var hammer = app.rows('Items').filter(function (i) { return i.asset_id === 'OTH-001'; })[0];
      eq(hammer.status, 'checked_out', 'still out on its own trip');
    });

    test('the full history survives on the item detail page', function () {
      var app = kitOut(freshApp());
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-014' }] });
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Jignesh'
      });

      var d = expectOk(app.get('item', { asset_id: 'TAB-014' }));
      eq(d.movements.length, 2);
      eq(d.movements[0].checked_out_by, 'Jignesh', 'newest first');
      eq(d.movements[1].outcome, 'returned');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Allocation, then collection', function () {

    test('allocating a kit writes one open row per piece', function () {
      var app = freshApp();
      expectOk(app.post('allocate', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh',
        notes: 'Requested by email 6 Aug'
      }));
      var rows = app.rows('Allocations');
      eq(rows.length, 6);
      rows.forEach(function (a) {
        eq(a.status, 'open');
        eq(a.event_id, 'EV-003', 'allocations store the LEAF event');
      });
    });

    test('checking the item out later fulfils its allocation and links the movement', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      });
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-16', checked_out_by: 'Nilesh'
      });

      eq(app.rows('Allocations')[0].status, 'fulfilled');
      eq(app.rows('Movements')[0].allocation_id, 'AL-000001');
    });

    test('needed_from defaults to the event start date, not to today', function () {
      // Bal Din is on the 12th. Reserving from today would block the harmonium
      // for four days it is not actually wanted.
      var app = freshApp();
      expectOk(app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', allocated_by: 'Nilesh'
      }));
      eq(app.rows('Allocations')[0].needed_from, '2026-08-12');
    });

    test('the same item cannot be promised to two events over the same days', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-14',
        allocated_by: 'Nilesh'
      });
      var e = expectErr(app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        needed_from: '2026-08-13', expected_return_date: '2026-08-16',
        allocated_by: 'Jignesh'
      }), 'NOT_AVAILABLE');
      ok(e.message.indexOf('Bal Din') !== -1, 'the message names who already has it');
      ok(e.conflicts && e.conflicts.length === 1, 'the clash comes back for the UI');
      eq(app.rows('Allocations').length, 1, 'nothing was written');
    });

    test('but it CAN be promised to both once the dates stop overlapping', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12',
        allocated_by: 'Nilesh'
      });
      expectOk(app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        needed_from: '2026-08-14', expected_return_date: '2026-08-16',
        allocated_by: 'Jignesh'
      }));
      eq(app.rows('Allocations').length, 2);
    });

    test('checkAvailability answers for a whole list at once', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12',
        allocated_by: 'Nilesh'
      });

      var clashing = expectOk(app.post('checkAvailability', {
        asset_ids: ['HAR-003', 'KEY-002'],
        needed_from: '2026-08-11', expected_return_date: '2026-08-11'
      }));
      eq(clashing.availability['HAR-003'].available, false);
      eq(clashing.availability['KEY-002'].available, true);
      ok(clashing.availability['HAR-003'].conflicts[0].reason.indexOf('Bal Din') !== -1);

      var clear = expectOk(app.post('checkAvailability', {
        asset_ids: ['HAR-003'],
        needed_from: '2026-08-20', expected_return_date: '2026-08-21'
      }));
      eq(clear.availability['HAR-003'].available, true);
    });

    test('a centre is not required once an event is chosen', function () {
      var app = freshApp();
      expectOk(app.post('allocate', {
        asset_ids: ['KEY-002'], event_id: 'EV-003',
        expected_return_date: '2026-08-16', allocated_by: 'Jignesh'
      }));
      expectOk(app.post('checkout', {
        asset_ids: ['DHO-007'], event_id: 'EV-003',
        expected_return_date: '2026-08-16', checked_out_by: 'Jignesh'
      }));
    });

    test('cancelling an allocation frees the item again', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', allocated_by: 'Nilesh'
      });
      expectOk(app.post('cancelAllocation', { allocation_id: 'AL-000001' }));
      expectOk(app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-16', allocated_by: 'Jignesh'
      }));
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Events page and bulk check-in', function () {

    test('a parent event totals everything across its sub-events', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-05', checked_out_by: 'Nilesh'
      });
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      });

      var d = expectOk(app.get('event', { event_id: 'EV-001' }));
      eq(d.counts.out, 7);
      eq(d.counts.returned, 0);
      eq(d.counts.overdue, 6, 'the whole tabla set is three days late');
      eq(d.sub_events.length, 2);

      var nagarYatra = d.sub_events.filter(function (e) { return e.event_id === 'EV-003'; })[0];
      eq(nagarYatra.counts.out, 6);
    });

    test('"check in everything for this event" closes the whole tree', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      });

      var d = expectOk(app.post('bulkCheckinEvent', {
        event_id: 'EV-001', checked_in_by: 'Nilesh'
      }));
      eq(d.checked_in.length, 7);
      eq(app.rows('Movements').filter(function (m) { return !m.checked_in_at; }).length, 0);
    });

    test('bulk check-in on an event with nothing out says so', function () {
      var app = freshApp();
      expectErr(app.post('bulkCheckinEvent', { event_id: 'EV-001', checked_in_by: 'Nilesh' }),
                'ITEM_NOT_OUT');
    });

    test('sub-events cannot be nested a second level deep', function () {
      var app = freshApp();
      var e = expectErr(app.post('saveEvent', {
        name: 'Deeper still', parent_event_id: 'EV-002'
      }), 'BAD_REQUEST');
      ok(e.message.indexOf('already a sub-event') !== -1);
    });

    test('a new top-level event gets the next id', function () {
      var app = freshApp();
      var d = expectOk(app.post('saveEvent', {
        name: 'Diwali Annakut', start_date: '2026-11-08', end_date: '2026-11-09',
        location: 'Neasden', status: 'planned'
      }));
      eq(d.event.event_id, 'EV-004');
      eq(d.event.parent_event_id, '');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Adding, editing and removing instruments', function () {

    test('the suggested asset id continues the sequence for that type', function () {
      var app = freshApp();
      eq(expectOk(app.post('suggestAssetId', { instrument_type: 'Tabla' })).asset_id, 'TAB-017');
      eq(expectOk(app.post('suggestAssetId', { instrument_type: 'Violin' })).asset_id, 'VIO-001');
    });

    test('a new item gets a QR token and lands available', function () {
      var app = freshApp();
      var d = expectOk(app.post('saveItem', {
        name: 'Dholak — small', instrument_type: 'Dholak', quality_grade: 'Practice Use',
        storage_location: 'Store Room 1'
      }));
      eq(d.asset_id, 'DHO-008');
      var row = app.rows('Items').filter(function (i) { return i.asset_id === 'DHO-008'; })[0];
      eq(row.status, 'available');
      eq(row.active, 'TRUE');
      ok(row.qr_token.length === 16, 'a 16-character token was generated');
    });

    test('a kit and its children save in a single call', function () {
      var app = freshApp();
      var d = expectOk(app.post('saveItem', {
        name: 'Tabla Set B', instrument_type: 'Tabla', quality_grade: 'Normal Sabha',
        is_kit: true, storage_location: 'Store Room 2, Shelf C',
        children: [
          { name: 'Tabla Set B — Dayyu', instrument_type: 'Tabla' },
          { name: 'Tabla Set B — Bayyu', instrument_type: 'Tabla' },
          { name: 'Tabla Set B — Hammer', instrument_type: 'Other' }
        ]
      }));
      eq(d.items.length, 4);
      eq(d.asset_id, 'TAB-017');

      var kids = app.rows('Items').filter(function (i) { return i.parent_asset_id === 'TAB-017'; });
      eq(kids.length, 3);
      eq(kids.map(function (k) { return k.asset_id; }), ['TAB-018', 'TAB-019', 'OTH-004']);
      kids.forEach(function (k) {
        eq(k.is_kit, 'FALSE', 'one level of nesting only');
        ok(k.qr_token, 'every child gets its own label token');
      });
    });

    test('editing a kit can add a piece and remove another', function () {
      var app = freshApp();
      expectOk(app.post('saveItem', {
        original_asset_id: 'TAB-014', asset_id: 'TAB-014', name: 'Tabla Set A',
        instrument_type: 'Tabla', quality_grade: 'Aradhana', is_kit: true,
        children: [
          { asset_id: 'OTH-001', _delete: true },
          { name: 'Tabla Set A — Spare Skin', instrument_type: 'Other' }
        ]
      }));
      var hammer = app.rows('Items').filter(function (i) { return i.asset_id === 'OTH-001'; })[0];
      eq(hammer.active, 'FALSE', 'removed, not deleted');
      eq(app.rows('Items').length, 11, 'the row is still there for the history');

      var spare = app.rows('Items').filter(function (i) { return i.name.indexOf('Spare Skin') !== -1; })[0];
      eq(spare.parent_asset_id, 'TAB-014');
    });

    test('a duplicate asset id is refused', function () {
      var app = freshApp();
      expectErr(app.post('saveItem', {
        name: 'Another harmonium', asset_id: 'HAR-003',
        instrument_type: 'Harmonium', quality_grade: 'Aradhana'
      }), 'DUPLICATE_ASSET_ID');
    });

    test('removing a kit deactivates every piece but deletes no rows', function () {
      var app = freshApp();
      expectOk(app.post('removeItem', { asset_id: 'TAB-014', confirm: true }));
      eq(app.rows('Items').length, 10);
      eq(app.rows('Items').filter(function (i) { return i.active === 'FALSE'; }).length, 6);
    });

    test('nothing checked out can be removed', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      expectErr(app.post('removeItem', { asset_id: 'HAR-003', confirm: true }), 'ITEM_CHECKED_OUT');
      eq(app.rows('Items').filter(function (i) { return i.active === 'FALSE'; }).length, 0);
    });

    test('removal must be confirmed', function () {
      var app = freshApp();
      expectErr(app.post('removeItem', { asset_id: 'HAR-003' }), 'BAD_REQUEST');
    });

    test('an id with history cannot be renamed out from under its movements', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'HAR-003' }] });

      var e = expectErr(app.post('saveItem', {
        original_asset_id: 'HAR-003', asset_id: 'HAR-099', name: 'Harmonium',
        instrument_type: 'Harmonium', quality_grade: 'Aradhana'
      }), 'BAD_REQUEST');
      ok(e.message.indexOf('movement history') !== -1);
    });

    test('a removed item drops out of nothing it is already recorded in', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['MIC-011'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'MIC-011' }] });
      app.post('removeItem', { asset_id: 'MIC-011', confirm: true });

      var d = expectOk(app.get('item', { asset_id: 'MIC-011' }));
      eq(d.active, false);
      eq(d.movements.length, 1, 'history survives the removal');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Settings', function () {

    test('a new centre can be added', function () {
      var app = freshApp();
      expectOk(app.post('saveSettings', {
        centres: [{ name: 'Brentford', active: true }]
      }));
      var rows = app.rows('Centres');
      eq(rows.length, 7);
      eq(rows[6].id, 'C-007');
    });

    test('renaming a centre rewrites the history so it still reads correctly', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      expectOk(app.post('saveSettings', {
        centres: [{ id: 'C-001', name: 'East London Centre', active: true }]
      }));
      eq(app.rows('Movements')[0].centre, 'East London Centre');
    });

    test('renaming an instrument type rewrites it on every item', function () {
      var app = freshApp();
      expectOk(app.post('saveSettings', {
        instrumentTypes: [{ id: 'IT-001', name: 'Tabla (pair)', prefix: 'TAB', active: true }]
      }));
      var tablas = app.rows('Items').filter(function (i) { return i.instrument_type === 'Tabla (pair)'; });
      eq(tablas.length, 3, 'the parent and both tabla children');
    });

    test('deactivating a centre keeps the row for history', function () {
      var app = freshApp();
      expectOk(app.post('saveSettings', {
        centres: [{ id: 'C-002', name: 'Ruislip', active: false }]
      }));
      eq(app.rows('Centres').length, 6);
      eq(app.rows('Centres').filter(function (c) { return c.id === 'C-002'; })[0].active, 'FALSE');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Scan resolution', function () {

    test('finds an item by the asset id printed under the QR', function () {
      var app = freshApp();
      eq(expectOk(app.get('resolve', { q: 'TAB-014' })).name, 'Tabla Set A');
    });

    test('is forgiving about case and stray whitespace from typed input', function () {
      var app = freshApp();
      eq(expectOk(app.get('resolve', { q: '  tab-014 ' })).asset_id, 'TAB-014');
    });

    test('also accepts a qr_token, so opaque labels remain an option later', function () {
      var app = freshApp();
      var token = app.rows('Items').filter(function (i) { return i.asset_id === 'HAR-003'; })[0].qr_token;
      eq(expectOk(app.get('resolve', { q: token })).asset_id, 'HAR-003');
    });

    test('an unknown code points the volunteer at the printed id', function () {
      var app = freshApp();
      var e = expectErr(app.get('resolve', { q: 'TAB-999' }), 'NOT_FOUND');
      ok(e.message.indexOf('printed under the QR') !== -1);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Optional demo data', function () {

    test('seedDemoMovements puts the kit out and overdue', function () {
      var app = freshApp();
      app.sandbox.seedDemoMovements();
      var d = expectOk(app.get('bootstrap'));
      var kit = d.items.filter(function (i) { return i.asset_id === 'TAB-014'; })[0];
      eq(kit.status, 'checked_out');
      eq(kit.live.days_overdue, 3);
      eq(d.openMovements.length, 7);
    });

    test('clearDemoMovements puts everything back', function () {
      var app = freshApp();
      app.sandbox.seedDemoMovements();
      app.sandbox.clearDemoMovements();
      eq(app.rows('Movements').length, 0);
      eq(app.rows('Items').filter(function (i) { return i.status !== 'available'; }).length, 0);
    });
  });
};
