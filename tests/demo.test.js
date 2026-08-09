/**
 * The trial dataset.
 *
 * seedDemoData() is what anyone new sees first, so if it throws or produces a
 * store that contradicts itself, the app looks broken before it has been used.
 * These tests run the real seeder against the fake Apps Script runtime.
 *
 * The important property: every status in the trial data is DERIVED from the
 * loans, never asserted alongside them. A harmonium reads "maintenance"
 * because a check-in said it needed repair — not because a seed row said so.
 */

var GAS = require('./gas-mock.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

function demoApp() {
  var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  app.sandbox.setupSheet();
  app.sandbox.seedDemoData();
  return app;
}

function expectOk(res) {
  if (!res.ok) fail('expected success, got ' + res.error.code + ': ' + res.error.message);
  return res.data;
}

module.exports = function () {

  suite('Trial data — it loads at all', function () {

    test('seeding does not throw, and fills the store', function () {
      var app = demoApp();
      ok(app.rows('Items').length > 60, 'a store, not a sample');
      eq(app.rows('Events').length, 11);
    });

    test('seeding twice does not double up', function () {
      var app = demoApp();
      var first = app.rows('Items').length;
      app.sandbox.seedDemoData();
      eq(app.rows('Items').length, first);
    });

    test('clearDemoData empties everything', function () {
      var app = demoApp();
      app.sandbox.clearDemoData();
      eq(app.rows('Items').length, 0);
      eq(app.rows('Events').length, 0);
      eq(app.rows('Movements').length, 0);
      eq(app.rows('Allocations').length, 0);
    });
  });

  suite('Trial data — enough of each instrument to be worth trialling', function () {

    test('several of every common type', function () {
      var app = demoApp();
      var counts = {};
      app.rows('Items').forEach(function (i) {
        counts[i.instrument_type] = (counts[i.instrument_type] || 0) + 1;
      });
      ok(counts.Harmonium >= 6, 'harmoniums: ' + counts.Harmonium);
      ok(counts.Keyboard >= 4, 'keyboards: ' + counts.Keyboard);
      ok(counts.Tabla >= 8, 'tablas: ' + counts.Tabla);
      ok(counts.Microphone >= 6, 'microphones: ' + counts.Microphone);
      ok(counts.Manjira >= 6, 'manjira: ' + counts.Manjira);
    });

    test('four complete tabla sets, five pieces each', function () {
      var app = demoApp();
      var kits = app.rows('Items').filter(function (i) { return i.is_kit === 'TRUE'; });
      eq(kits.length, 4);
      kits.forEach(function (kit) {
        var pieces = app.rows('Items').filter(function (i) {
          return i.parent_asset_id === kit.asset_id;
        });
        eq(pieces.length, 5, kit.asset_id + ' should have five pieces');
      });
    });

    test('every asset id is unique', function () {
      var app = demoApp();
      var ids = app.rows('Items').map(function (i) { return i.asset_id; });
      eq(new Set(ids).size, ids.length);
    });

    test('every item has a QR token, so labels print straight away', function () {
      var app = demoApp();
      eq(app.rows('Items').filter(function (i) { return !i.qr_token; }).length, 0);
    });

    test('two levels of events, never three', function () {
      var app = demoApp();
      var events = app.rows('Events');
      var byId = {};
      events.forEach(function (e) { byId[e.event_id] = e; });
      events.forEach(function (e) {
        if (!e.parent_event_id) return;
        var parent = byId[e.parent_event_id];
        ok(parent, e.event_id + ' points at a real parent');
        eq(parent.parent_event_id, '', e.event_id + '\'s parent is top-level');
      });
    });
  });

  suite('Trial data — a spread of situations to try', function () {

    test('things are out, and some of them are late', function () {
      var app = demoApp();
      var d = expectOk(app.get('bootstrap'));
      ok(d.openMovements.length >= 20, 'out now: ' + d.openMovements.length);
      var late = d.openMovements.filter(function (m) { return m.days_overdue > 0; });
      ok(late.length >= 8, 'overdue: ' + late.length);
    });

    test('something is due back TODAY and does not read as late', function () {
      var app = demoApp();
      var d = expectOk(app.get('bootstrap'));
      var dueToday = d.openMovements.filter(function (m) {
        return m.expected_return_date === d.today;
      });
      ok(dueToday.length > 0, 'the boundary case is present to try');
      dueToday.forEach(function (m) { eq(m.days_overdue, 0, m.asset_id); });
    });

    test('there are bookings for later, not just things already out', function () {
      var app = demoApp();
      var d = expectOk(app.get('bootstrap'));
      ok(d.openAllocations.length >= 15, 'bookings: ' + d.openAllocations.length);
      d.openAllocations.forEach(function (a) {
        ok(a.needed_from, a.allocation_id + ' has a start date');
        ok(a.expected_return_date, a.allocation_id + ' has an end date');
      });
    });

    test('returned history exists, so item pages are not empty', function () {
      var app = demoApp();
      var returned = app.rows('Movements').filter(function (m) { return m.checked_in_at; });
      ok(returned.length >= 10, 'returned loans: ' + returned.length);
    });
  });

  suite('Trial data — statuses are derived, never asserted', function () {

    test('the maintenance harmonium got there via a damaged return', function () {
      var app = demoApp();
      var har = app.rows('Items').filter(function (i) { return i.asset_id === 'HAR-007'; })[0];
      eq(har.status, 'maintenance');
      eq(har.current_condition, 'needs_repair');

      var mv = app.rows('Movements').filter(function (m) {
        return m.asset_id === 'HAR-007' && m.outcome === 'damaged';
      });
      eq(mv.length, 1, 'and there is a movement row that says so');
      ok(mv[0].damage_notes.length > 0, 'with a note explaining it');
    });

    test('the lost manjira got there via a missing return', function () {
      var app = demoApp();
      var man = app.rows('Items').filter(function (i) { return i.asset_id === 'MAN-007'; })[0];
      eq(man.status, 'lost');

      var mv = app.rows('Movements').filter(function (m) {
        return m.asset_id === 'MAN-007' && m.outcome === 'missing';
      });
      eq(mv.length, 1);
      eq(mv[0].condition_in, '', 'nobody can judge the condition of a missing item');
    });

    test('every checked_out item has exactly one open movement behind it', function () {
      var app = demoApp();
      var open = {};
      app.rows('Movements').forEach(function (m) {
        if (!m.checked_in_at) open[m.asset_id] = (open[m.asset_id] || 0) + 1;
      });
      app.rows('Items').forEach(function (i) {
        if (i.status === 'checked_out') {
          eq(open[i.asset_id], 1, i.asset_id + ' is out but has ' +
             (open[i.asset_id] || 0) + ' open movements');
        } else {
          notOk(open[i.asset_id], i.asset_id + ' is ' + i.status + ' but has an open movement');
        }
      });
    });

    test('no kit is left half out', function () {
      var app = demoApp();
      var items = app.rows('Items');
      items.filter(function (i) { return i.is_kit === 'TRUE'; }).forEach(function (kit) {
        var pieces = items.filter(function (i) { return i.parent_asset_id === kit.asset_id; });
        if (kit.status !== 'checked_out') return;
        var out = pieces.filter(function (p) { return p.status === 'checked_out'; });
        eq(out.length, pieces.length,
           kit.asset_id + ' is out but only ' + out.length + ' of ' + pieces.length +
           ' pieces went with it');
      });
    });
  });

  suite('Trial data — the date-clash case is set up to play with', function () {

    test('one harmonium is booked twice, for windows that do not touch', function () {
      var app = demoApp();
      var d = expectOk(app.get('bootstrap'));
      var bookings = d.openAllocations.filter(function (a) { return a.asset_id === 'HAR-003'; });
      eq(bookings.length, 2, 'two separate bookings on the same instrument');

      var windows = bookings.map(function (b) {
        return [b.needed_from, b.expected_return_date];
      }).sort();
      notOk(windows[0][1] >= windows[1][0], 'and they do not overlap, so both were allowed');
    });

    test('a date in between is free', function () {
      var app = demoApp();
      var mid = expectOk(app.post('checkAvailability', {
        asset_ids: ['HAR-003'],
        needed_from: '2026-08-24', expected_return_date: '2026-08-25'
      }));
      eq(mid.availability['HAR-003'].available, true);
    });

    test('a date inside one of them is refused, and names who has it', function () {
      var app = demoApp();
      var clash = expectOk(app.post('checkAvailability', {
        asset_ids: ['HAR-003'],
        needed_from: '2026-08-19', expected_return_date: '2026-08-19'
      }));
      eq(clash.availability['HAR-003'].available, false);
      ok(clash.availability['HAR-003'].conflicts[0].reason.indexOf('Ruislip') !== -1,
         'the message says which event has it');
    });
  });
};
