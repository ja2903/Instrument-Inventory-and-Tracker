/**
 * Regressions from real use.
 *
 * Each suite here is a bug someone hit while trialling the app. They are kept
 * separate from the feature tests so it stays obvious what was learned the
 * hard way and must not come back.
 */

var GAS = require('./gas-mock.js');
var Rules = require('../apps-script/src/10-rules.js');
var F = require('./fixtures.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

function freshApp() {
  var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  app.sandbox.setupSheet();
  return app;
}

function expectOk(res) {
  if (!res.ok) fail('expected success, got ' + res.error.code + ': ' + res.error.message);
  return res.data;
}

function expectErr(res, code) {
  if (res.ok) fail('expected error ' + code + ', but the call succeeded');
  if (res.error.code !== code) {
    fail('expected error ' + code + ', got ' + res.error.code + ': ' + res.error.message);
  }
  return res.error;
}

/** The seeded tabla set, out as one set. */
function kitOut(app) {
  app.post('checkout', {
    asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
    expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
  });
  return app;
}

module.exports = function () {

  /* ---------------------------------------------------------------- */
  suite('The website can actually be uploaded and work', function () {

    var fs = require('fs');
    var path = require('path');
    var ROOT = path.join(__dirname, '..');
    var indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    function localScripts() {
      var out = [];
      var re = /<script src="(?!https?:)([^"?]+)/g;
      var m;
      while ((m = re.exec(indexHtml))) out.push(m[1]);
      return out;
    }

    test('every file index.html asks for actually exists', function () {
      localScripts().forEach(function (src) {
        ok(fs.existsSync(path.join(ROOT, src)), 'missing: ' + src);
      });
      var css = (indexHtml.match(/<link rel="stylesheet" href="([^"?]+)/) || [])[1];
      ok(css && fs.existsSync(path.join(ROOT, css)), 'missing stylesheet: ' + css);
    });

    test('the page loads nothing from outside css/ and js/', function () {
      // index.html once pulled the rules module out of apps-script/src/. It
      // worked locally and broke on GitHub Pages for anyone who uploaded only
      // the website folders — the page rendered completely blank.
      localScripts().forEach(function (src) {
        ok(/^(js\/|config\.js$)/.test(src),
           src + ' is outside js/ — a partial upload would break the page');
      });
    });

    test('js/rules.js is an exact copy of the rules the server runs', function () {
      var source = fs.readFileSync(
        path.join(ROOT, 'apps-script', 'src', '10-rules.js'), 'utf8');
      var copy = fs.readFileSync(path.join(ROOT, 'js', 'rules.js'), 'utf8');
      ok(copy.indexOf(source) !== -1,
         'js/rules.js has drifted — run: node tools/build-gs.js');
    });

    test('the browser copy defines Rules and nothing server-only', function () {
      var copy = fs.readFileSync(path.join(ROOT, 'js', 'rules.js'), 'utf8');
      ok(copy.indexOf('var Rules = (function ()') !== -1);

      // Strip comments first — the file's own documentation names these
      // globals precisely to warn people off them, which is not a violation.
      var code = copy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      notOk(/SpreadsheetApp|PropertiesService|LockService|Utilities\./.test(code),
            'the rules module must stay free of Apps Script globals');
    });

    test('a blank page is impossible — the guard names the missing file', function () {
      // The failure mode this replaces: one script 404s, both panels stay
      // hidden, and the volunteer sees an empty coloured rectangle.
      ok(indexHtml.indexOf('This page did not load properly') !== -1);
      localScripts().forEach(function (src) {
        ok(indexHtml.indexOf("name: '" + src + "'") !== -1,
           src + ' is loaded but not covered by the missing-file guard');
      });
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Returning single pieces of a set (without the parent)', function () {

    test('two pieces can come back while the set stays out', function () {
      var app = kitOut(freshApp());
      var d = expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-015' }, { asset_id: 'TAB-016' }]
      }));
      eq(d.checked_in.length, 2);

      var items = app.rows('Items');
      function status(id) {
        return items.filter(function (i) { return i.asset_id === id; })[0].status;
      }
      eq(status('TAB-015'), 'available');
      eq(status('TAB-016'), 'available');
      eq(status('TAB-014'), 'checked_out', 'the set is still out');
      eq(status('OTH-001'), 'checked_out', 'the untouched pieces are still out');
    });

    test('their movements close, and only theirs', function () {
      var app = kitOut(freshApp());
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-015' }] });

      var open = app.rows('Movements').filter(function (m) { return !m.checked_in_at; });
      eq(open.length, 5, 'six went out, one came back');
      notOk(open.some(function (m) { return m.asset_id === 'TAB-015'; }));
    });

    test('the returned piece disappears from what is still out', function () {
      var app = kitOut(freshApp());
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-015' }] });

      var d = expectOk(app.get('bootstrap'));
      var stillOut = d.openMovements.map(function (m) { return m.asset_id; });
      notOk(stillOut.indexOf('TAB-015') !== -1);
      ok(stillOut.indexOf('TAB-014') !== -1);
    });

    test('a piece returned early can go out again on its own straight away', function () {
      var app = kitOut(freshApp());
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-015' }] });
      // Its parent is still out, so rule K5 blocks it — with a clear reason.
      var e = expectErr(app.post('checkout', {
        asset_ids: ['TAB-015'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Jignesh'
      }), 'PARENT_OUT');
      ok(e.message.indexOf('Tabla Set A') !== -1);
    });

    test('checking the set in afterwards closes what is left, not what came back', function () {
      var app = kitOut(freshApp());
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-015' }] });
      var d = expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-014' }]
      }));
      eq(d.checked_in.length, 5, 'the parent plus its four remaining pieces');
      eq(app.rows('Movements').filter(function (m) { return !m.checked_in_at; }).length, 0);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Editing a booking', function () {

    function booked(app) {
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12',
        allocated_by: 'Nilesh'
      });
      return app.rows('Allocations')[0].allocation_id;
    }

    test('its dates can be moved', function () {
      var app = freshApp();
      var id = booked(app);
      expectOk(app.post('updateAllocation', {
        allocation_id: id, needed_from: '2026-08-14', expected_return_date: '2026-08-16'
      }));
      var row = app.rows('Allocations')[0];
      eq(row.needed_from, '2026-08-14');
      eq(row.expected_return_date, '2026-08-16');
    });

    test('moving it does not clash with its own old window', function () {
      // The bug this guards: excluding the booking being edited from the
      // availability check. Without it, nudging a date by one day is refused
      // because the instrument "already has a booking" — its own.
      var app = freshApp();
      var id = booked(app);
      expectOk(app.post('updateAllocation', {
        allocation_id: id, needed_from: '2026-08-11', expected_return_date: '2026-08-13'
      }));
    });

    test('but moving it onto SOMEONE ELSE\'s window is refused', function () {
      var app = freshApp();
      var mine = booked(app);
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        needed_from: '2026-08-20', expected_return_date: '2026-08-22',
        allocated_by: 'Jignesh'
      });
      var e = expectErr(app.post('updateAllocation', {
        allocation_id: mine, needed_from: '2026-08-21', expected_return_date: '2026-08-23'
      }), 'NOT_AVAILABLE');
      ok(e.conflicts && e.conflicts.length);
      eq(app.rows('Allocations')[0].needed_from, '2026-08-10', 'nothing was written');
    });

    test('a return date before the needed-from date is refused', function () {
      var app = freshApp();
      var id = booked(app);
      expectErr(app.post('updateAllocation', {
        allocation_id: id, needed_from: '2026-08-20', expected_return_date: '2026-08-18'
      }), 'BAD_REQUEST');
    });

    test('a whole set of bookings moves together', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['TAB-014'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12',
        allocated_by: 'Nilesh'
      });
      var ids = app.rows('Allocations').map(function (a) { return a.allocation_id; });
      eq(ids.length, 6);

      expectOk(app.post('updateAllocation', {
        allocation_ids: ids, needed_from: '2026-08-20', expected_return_date: '2026-08-22'
      }));
      app.rows('Allocations').forEach(function (a) {
        eq(a.needed_from, '2026-08-20', a.asset_id);
      });
    });

    test('cancelling takes the whole set in one go and frees the instruments', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['TAB-014'], event_id: 'EV-002', centre: 'Ruislip',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12',
        allocated_by: 'Nilesh'
      });
      var ids = app.rows('Allocations').map(function (a) { return a.allocation_id; });
      var d = expectOk(app.post('cancelAllocation', { allocation_ids: ids }));
      eq(d.allocation_ids.length, 6);

      var free = expectOk(app.post('checkAvailability', {
        asset_ids: ['TAB-014'],
        needed_from: '2026-08-10', expected_return_date: '2026-08-12'
      }));
      eq(free.availability['TAB-014'].available, true);
    });

    test('a collected booking can no longer be edited', function () {
      var app = freshApp();
      var id = booked(app);
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      expectErr(app.post('updateAllocation', {
        allocation_id: id, needed_from: '2026-08-14', expected_return_date: '2026-08-16'
      }), 'BAD_REQUEST');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Event dates are validated', function () {

    test('an end date before the start date is refused on create', function () {
      var app = freshApp();
      var e = expectErr(app.post('saveEvent', {
        name: 'Backwards', start_date: '2026-09-10', end_date: '2026-09-01'
      }), 'BAD_REQUEST');
      ok(e.message.indexOf('before the start date') !== -1);
      eq(app.rows('Events').length, 3, 'nothing was written');
    });

    test('and on edit', function () {
      var app = freshApp();
      expectErr(app.post('saveEvent', {
        event_id: 'EV-001', name: 'Paris Mandir Mahotsav',
        start_date: '2026-08-16', end_date: '2026-08-10'
      }), 'BAD_REQUEST');
      eq(app.rows('Events')[0].start_date, '2026-08-10', 'the original is untouched');
    });

    test('the same start and end date is fine — a one-day event', function () {
      var app = freshApp();
      expectOk(app.post('saveEvent', {
        name: 'Bal Sabha', start_date: '2026-09-01', end_date: '2026-09-01'
      }));
    });

    test('a start date with no end date fills the end in rather than leaving a blank', function () {
      var app = freshApp();
      var d = expectOk(app.post('saveEvent', { name: 'One day', start_date: '2026-09-01' }));
      eq(d.event.end_date, '2026-09-01');
    });

    test('a nonsense date is refused rather than stored', function () {
      var app = freshApp();
      expectErr(app.post('saveEvent', { name: 'Bad', start_date: '01/09/2026' }), 'BAD_REQUEST');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('A set must have pieces', function () {

    test('saving a kit with no children is refused, not silently downgraded', function () {
      // The bug: the tick was accepted, the children dropped, and the result
      // was an item claiming to be a set with nothing in it.
      var app = freshApp();
      var e = expectErr(app.post('saveItem', {
        name: 'Empty set', instrument_type: 'Tabla', quality_grade: 'Aradhana',
        is_kit: true, children: []
      }), 'BAD_REQUEST');
      ok(e.message.indexOf('at least one piece') !== -1);
      ok(e.message.indexOf('untick') !== -1, 'and says how to proceed');
    });

    test('children with no name do not count', function () {
      var app = freshApp();
      expectErr(app.post('saveItem', {
        name: 'Empty set', instrument_type: 'Tabla', quality_grade: 'Aradhana',
        is_kit: true, children: [{ name: '   ' }, { name: '' }]
      }), 'BAD_REQUEST');
    });

    test('one named piece is enough', function () {
      var app = freshApp();
      expectOk(app.post('saveItem', {
        name: 'Small set', instrument_type: 'Tabla', quality_grade: 'Aradhana',
        is_kit: true, children: [{ name: 'Dayyu', instrument_type: 'Tabla' }]
      }));
    });

    test('editing a kit down to zero pieces is refused too', function () {
      var app = freshApp();
      var e = expectErr(app.post('saveItem', {
        original_asset_id: 'TAB-014', asset_id: 'TAB-014', name: 'Tabla Set A',
        instrument_type: 'Tabla', quality_grade: 'Aradhana', is_kit: true,
        children: ['TAB-015', 'TAB-016', 'OTH-001', 'OTH-002', 'OTH-003']
          .map(function (id) { return { asset_id: id, _delete: true }; })
      }), 'BAD_REQUEST');
      ok(e.message.indexOf('at least one piece') !== -1);
    });

    test('keeping existing pieces without re-listing them is still valid', function () {
      var app = freshApp();
      expectOk(app.post('saveItem', {
        original_asset_id: 'TAB-014', asset_id: 'TAB-014', name: 'Tabla Set A (renamed)',
        instrument_type: 'Tabla', quality_grade: 'Aradhana', is_kit: true,
        children: [{ asset_id: 'TAB-015', name: 'Dayyu', instrument_type: 'Tabla' }]
      }));
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Events are ordered and archived, not hidden', function () {

    test('bootstrap says whether an event has any history', function () {
      var app = freshApp();
      var before = expectOk(app.get('bootstrap')).events
        .filter(function (e) { return e.event_id === 'EV-003'; })[0];
      eq(before.has_history, false);

      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'HAR-003' }] });

      var after = expectOk(app.get('bootstrap')).events
        .filter(function (e) { return e.event_id === 'EV-003'; })[0];
      eq(after.has_history, true, 'a RETURNED loan still counts as history');
    });

    test('has_history is what tells the UI deletion will archive instead', function () {
      // Without it the client only sees open movements, so a finished event
      // looked untouched and the dialog promised a deletion that could not
      // happen.
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'HAR-003' }] });

      var d = expectOk(app.post('deleteEvent', { event_id: 'EV-003' }));
      eq(d.deleted, false, 'the server archives it');
      eq(expectOk(app.get('bootstrap')).events
         .filter(function (e) { return e.event_id === 'EV-003'; })[0].status, 'cancelled');
    });
  });
};
