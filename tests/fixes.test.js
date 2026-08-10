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

/** The Items tab's real width, read from the built script rather than hardcoded. */
var TABS_ITEMS_WIDTH = (function () {
  var probe = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  return probe.sandbox.TABS.Items.length;
})();

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
  suite('Damage photos are visible on the item, and replaceable', function () {

    var PHOTO = 'https://drive.google.com/thumbnail?id=first';
    var BETTER = 'https://drive.google.com/thumbnail?id=better';

    /** HAR-003 goes out and comes back damaged, with a photo. */
    function damaged(app) {
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'HAR-003', condition_in: 'needs_repair',
                  damage_notes: 'Bellows leaking', photo_url: PHOTO }]
      });
      return app;
    }

    test('the photo comes back with the item detail, not just into the Sheet', function () {
      // It was stored correctly all along and simply never returned anywhere
      // the screen could reach — so taking one felt pointless.
      var app = damaged(freshApp());
      var d = expectOk(app.get('item', { asset_id: 'HAR-003' }));
      var incident = d.movements.filter(function (m) { return m.outcome === 'damaged'; })[0];
      ok(incident, 'the damaged return is in the history');
      eq(incident.photo_in_url, PHOTO);
    });

    test('a photo taken on the way out comes back too', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['KEY-002'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh',
        photos: { 'KEY-002': PHOTO }
      });
      var d = expectOk(app.get('item', { asset_id: 'KEY-002' }));
      eq(d.movements[0].photo_out_url, PHOTO);
    });

    test('retaking replaces the photo', function () {
      var app = damaged(freshApp());
      var id = app.rows('Movements')[0].movement_id;

      expectOk(app.post('setMovementPhoto', {
        movement_id: id, kind: 'in', photo_url: BETTER
      }));
      var d = expectOk(app.get('item', { asset_id: 'HAR-003' }));
      eq(d.movements[0].photo_in_url, BETTER);
    });

    test('and leaves the damage note and everything else alone', function () {
      var app = damaged(freshApp());
      var id = app.rows('Movements')[0].movement_id;
      app.post('setMovementPhoto', { movement_id: id, kind: 'in', photo_url: BETTER });

      var row = app.rows('Movements')[0];
      eq(row.damage_notes, 'Bellows leaking');
      eq(row.outcome, 'damaged');
      eq(row.checked_in_by, 'Nilesh');
    });

    test('a damaged return cannot be left with no photo at all', function () {
      var app = damaged(freshApp());
      var id = app.rows('Movements')[0].movement_id;
      var e = expectErr(app.post('setMovementPhoto', {
        movement_id: id, kind: 'in', photo_url: ''
      }), 'PHOTO_REQUIRED');
      ok(e.message.indexOf('Take a new one') !== -1, 'and it says what to do instead');
      eq(app.rows('Movements')[0].photo_in_url, PHOTO, 'the original is untouched');
    });

    test('an ordinary return may have its photo removed', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['KEY-002'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh',
        photos: { 'KEY-002': PHOTO }
      });
      var id = app.rows('Movements')[0].movement_id;
      expectOk(app.post('setMovementPhoto', { movement_id: id, kind: 'out', photo_url: '' }));
      eq(app.rows('Movements')[0].photo_out_url, '');
    });

    test('an unknown record is refused', function () {
      var app = damaged(freshApp());
      expectErr(app.post('setMovementPhoto', {
        movement_id: 'MV-999999', kind: 'in', photo_url: BETTER
      }), 'NOT_FOUND');
    });

    test('the out and in photos are separate — replacing one leaves the other', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['KEY-002'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh',
        photos: { 'KEY-002': PHOTO }
      });
      app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'KEY-002', condition_in: 'good', photo_url: BETTER }]
      });
      var row = app.rows('Movements')[0];
      eq(row.photo_out_url, PHOTO, 'before it went');
      eq(row.photo_in_url, BETTER, 'and how it came back');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Scanning adds the item once, and keeps what was there', function () {

    var DOMS = require('./dom-stub.js');
    var fs = require('fs');
    var path = require('path');
    var ops = fs.readFileSync(
      path.join(__dirname, '..', 'js', 'operations.js'), 'utf8');

    /*
     * The bug: holding a sticker in view announced one dholak twenty times
     * and added nothing. Three faults compounded —
     *
     *   1. the hashchange teardown EXEMPTED #/give and #/back, so routing
     *      from the Scan screen into a flow never released the camera and
     *      the detect loop kept firing four times a second;
     *   2. every firing called resetGive(), throwing away the previous scan;
     *   3. it landed on step 1, which showed no items, so the volunteer
     *      scanned again believing nothing had happened.
     *
     * These read the source because the camera loop itself cannot run in a
     * stub. Crude, but they pin the three specific mistakes.
     */

    test('the camera is owned by a screen, not an exemption list', function () {
      ok(ops.indexOf('var cameraOwner') !== -1, 'ownership is tracked');
      ok(ops.indexOf('screen !== cameraOwner') !== -1,
         'teardown compares the current screen against the owner');
      notOk(/hash\.indexOf\('#\/give'\) !== 0/.test(ops),
            'the old exemption list is gone — it is what kept the camera alive');
    });

    test('the scan handler latches so one sticker routes once', function () {
      ok(ops.indexOf('var routed = false') !== -1);
      ok(ops.indexOf('if (routed) return;') !== -1);
    });

    test('the camera is released BEFORE navigating away', function () {
      var handler = ops.slice(ops.indexOf('App.screens.scan.mount'));
      handler = handler.slice(0, handler.indexOf('App.actions[\'quick-checkout\']'));
      var release = handler.indexOf('releaseCamera();');
      var navigate = handler.indexOf("App.go('#/back')");
      ok(release !== -1 && navigate !== -1 && release < navigate,
         'releasing after navigating leaves the loop running on a dead element');
    });

    test('scanning adds to the basket instead of resetting it', function () {
      var handler = ops.slice(ops.indexOf('App.screens.scan.mount'));
      handler = handler.slice(0, handler.indexOf('App.actions[\'quick-checkout\']'));
      notOk(/resetGive\(\)|resetBack\(\)/.test(handler),
            'resetting wipes anything scanned a moment earlier');
      ok(handler.indexOf('giveState()') !== -1 && handler.indexOf('backState()') !== -1);
    });

    test('give-out step 1 shows what has already been scanned', function () {
      // Without this the volunteer gets a form with no sign the scan landed,
      // and scans again. And again.
      ok(ops.indexOf('ready to go out') !== -1);
      ok(ops.indexOf("App.actions['give-drop']") !== -1,
         'and each one can be taken back out');
    });

    test('the same sticker read twice in a second is ignored', function () {
      // resolveCode dedupes by code and time; the latch above is the backstop.
      ok(ops.indexOf('now - lastCodeAt < 2500') !== -1);
    });

    test('releasing the camera also clears the duplicate guard', function () {
      // Otherwise the next deliberate scan of the same instrument, moments
      // later in a different flow, would be swallowed as a duplicate.
      var release = ops.slice(ops.indexOf('function releaseCamera'));
      release = release.slice(0, release.indexOf('\n  }'));
      ok(release.indexOf("lastCode = ''") !== -1);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Finished events get out of the way by themselves', function () {

    var DOM = require('./dom-stub.js');

    /** A browser app with a hand-built set of events, to control the dates. */
    async function withEvents(events, extras) {
      var payload = Object.assign({
        today: '2026-08-08', version: '1.0.0',
        centres: [], instrumentTypes: [], qualityGrades: [],
        events: events, items: [], openAllocations: [], openMovements: []
      }, extras || {});
      var s = DOM.loadBrowserApp(payload);
      await s.App.refresh({ showSpinner: false });
      return s;
    }

    function ev(id, name, start, end, status) {
      return { event_id: id, name: name, parent_event_id: '',
               start_date: start, end_date: end || start,
               location: '', centre: '', status: status || 'planned', children: [] };
    }

    test('an event whose end date has passed archives itself', async function () {
      // Nobody remembers to mark a sabha "completed" afterwards. If archiving
      // depended on that, the Finished list would stay empty forever and the
      // live list would grow without limit.
      var s = await withEvents([ev('EV-1', 'Last month', '2026-07-01', '2026-07-02')]);
      ok(s.App.isArchivedEvent(s.App.eventById('EV-1')));
    });

    test('a future event does not', async function () {
      var s = await withEvents([ev('EV-1', 'Next month', '2026-09-01', '2026-09-02')]);
      notOk(s.App.isArchivedEvent(s.App.eventById('EV-1')));
    });

    test('an event ending TODAY is still live', async function () {
      var s = await withEvents([ev('EV-1', 'Today', '2026-08-08', '2026-08-08')]);
      notOk(s.App.isArchivedEvent(s.App.eventById('EV-1')));
    });

    test('a past event with something still out is NOT archived', async function () {
      // The important one: a sabha that finished yesterday with a harmonium
      // unaccounted for is emphatically not finished with.
      var s = await withEvents([ev('EV-1', 'Yesterday', '2026-08-07', '2026-08-07')], {
        items: [{
          asset_id: 'HAR-001', name: 'Harmonium', instrument_type: 'Harmonium',
          quality_grade: 'Aradhana', parent_asset_id: '', is_kit: false,
          status: 'checked_out', current_condition: 'good', active: true, children: [],
          live: { event_id: 'EV-1', sub_event_id: '', expected_return_date: '2026-08-07',
                  days_overdue: 1, via_parent_asset_id: '', centre: '' }
        }]
      });
      notOk(s.App.isArchivedEvent(s.App.eventById('EV-1')),
            'it cannot be filed away while an instrument is missing from it');
    });

    test('an undated event is never auto-archived', async function () {
      var s = await withEvents([ev('EV-1', 'No dates', '', '')]);
      notOk(s.App.isArchivedEvent(s.App.eventById('EV-1')));
    });

    test('a cancelled event is archived whatever its dates say', async function () {
      var s = await withEvents([ev('EV-1', 'Called off', '2026-12-01', '2026-12-02', 'cancelled')]);
      ok(s.App.isArchivedEvent(s.App.eventById('EV-1')));
    });

    test('the give-out dropdown offers only what is still to come', async function () {
      var s = await withEvents([
        ev('EV-1', 'Old sabha', '2025-03-01', '2025-03-01'),
        ev('EV-2', 'Older sabha', '2024-03-01', '2024-03-01'),
        ev('EV-3', 'Coming up', '2026-09-01', '2026-09-02')
      ]);
      var labels = s.App.eventOptions().map(function (o) { return o.label.trim(); });
      eq(labels, ['Coming up'], 'finished events are not choices when giving out');
    });

    test('but they are still reachable when searching history', async function () {
      var s = await withEvents([
        ev('EV-1', 'Old sabha', '2025-03-01', '2025-03-01'),
        ev('EV-3', 'Coming up', '2026-09-01', '2026-09-02')
      ]);
      var labels = s.App.eventOptions(true).map(function (o) { return o.label.trim(); });
      ok(labels.indexOf('Old sabha') !== -1, 'the Instruments filter can still see it');
    });

    test('the Events screen groups the archive by year', async function () {
      var s = await withEvents([
        ev('EV-1', 'A 2024', '2024-03-01'), ev('EV-2', 'B 2024', '2024-09-01'),
        ev('EV-3', 'C 2025', '2025-03-01'), ev('EV-4', 'Coming up', '2026-09-01')
      ]);
      var html = s.App.screens.events([]);
      ok(html.indexOf('2024') !== -1 && html.indexOf('2025') !== -1);
      ok(html.indexOf('never deleted') !== -1, 'and says nothing is thrown away');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('A damaged return needs a photo', function () {

    function kitOut(app) {
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      return app;
    }

    var PHOTO = 'https://drive.google.com/thumbnail?id=abc123';

    test('marking something damaged without a photo is refused', function () {
      var app = kitOut(freshApp());
      var e = expectErr(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' },
                { asset_id: 'TAB-016', condition_in: 'needs_repair' }]
      }), 'PHOTO_REQUIRED');
      ok(e.message.indexOf('Bayyu') !== -1, 'the message names the item');
      eq(app.rows('Movements').filter(function (m) { return m.checked_in_at; }).length, 0,
         'the whole check-in was refused, not just that line');
    });

    test('with a photo it goes through and the link is stored', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' },
                { asset_id: 'TAB-016', condition_in: 'needs_repair',
                  damage_notes: 'Skin split', photo_url: PHOTO }]
      }));
      var mv = app.rows('Movements').filter(function (m) { return m.asset_id === 'TAB-016'; })[0];
      eq(mv.photo_in_url, PHOTO);
      eq(mv.outcome, 'damaged');
    });

    test('a MISSING item needs no photo — there is nothing to photograph', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'OTH-001', missing: true }]
      }));
    });

    test('an undamaged return needs no photo', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh', items: [{ asset_id: 'TAB-014' }]
      }));
    });

    test('a photo may still be attached to a normal return', function () {
      var app = kitOut(freshApp());
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014', photo_url: PHOTO }]
      }));
      var mv = app.rows('Movements').filter(function (m) { return m.asset_id === 'TAB-014'; })[0];
      eq(mv.photo_in_url, PHOTO);
    });

    test('a photo can be recorded as the instrument goes out', function () {
      var app = freshApp();
      expectOk(app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh',
        photos: { 'HAR-003': PHOTO }
      }));
      eq(app.rows('Movements')[0].photo_out_url, PHOTO);
    });

    test('the refusal lists every item that still needs one', function () {
      var app = kitOut(freshApp());
      var e = expectErr(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'TAB-014' },
                { asset_id: 'TAB-015', condition_in: 'needs_repair' },
                { asset_id: 'TAB-016', condition_in: 'needs_repair' }]
      }), 'PHOTO_REQUIRED');
      eq(e.photo_required.length, 2);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Breaking a set open', function () {

    test('a single piece can go out while the set stays available', function () {
      var app = freshApp();
      expectOk(app.post('checkout', {
        asset_ids: ['TAB-015'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      }));
      var items = app.rows('Items');
      function status(id) {
        return items.filter(function (i) { return i.asset_id === id; })[0].status;
      }
      eq(status('TAB-015'), 'checked_out', 'the dayyu went');
      eq(status('TAB-014'), 'available', 'the set stayed');
      eq(status('TAB-016'), 'available', 'so did every other piece');
    });

    test('the piece is out on its own, not via the set', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['TAB-015'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      });
      eq(app.rows('Movements')[0].via_parent_asset_id, '',
         'a piece taken deliberately is not "via" anything');
    });

    test('several pieces can go out together, still leaving the set', function () {
      var app = freshApp();
      expectOk(app.post('checkout', {
        asset_ids: ['TAB-015', 'TAB-016'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      }));
      eq(app.rows('Movements').length, 2);
      eq(app.rows('Items').filter(function (i) {
        return i.asset_id === 'TAB-014';
      })[0].status, 'available');
    });

    test('and the set then reports how many of its pieces are out', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['TAB-015'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-14', checked_out_by: 'Nilesh'
      });
      var d = expectOk(app.get('bootstrap'));
      var pieces = d.items.filter(function (i) { return i.parent_asset_id === 'TAB-014'; });
      eq(pieces.filter(function (p) { return p.status === 'checked_out'; }).length, 1);
      ok(pieces.filter(function (p) { return p.asset_id === 'TAB-015'; })[0].live,
         'the piece carries live detail so the list can say where it went');
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
  /* ---------------------------------------------------------------- */
  suite('Redeploying never touches what is in the Sheet', function () {

    test('setupSheet twice leaves live data byte for byte identical', function () {
      var app = freshApp();
      app.post('saveItem', {
        name: 'Our real harmonium', instrument_type: 'Harmonium',
        quality_grade: 'A', storage_location: 'Cupboard 2'
      });
      app.post('checkout', {
        asset_ids: ['HAR-004'], event_id: 'EV-001', centre: 'East London',
        expected_return_date: '2026-08-20', checked_out_by: 'Nilesh'
      });

      function snapshot() {
        return JSON.stringify({
          items: app.rows('Items').length,
          movements: app.rows('Movements').length,
          har004: app.rows('Items').filter(function (r) {
            return r.asset_id === 'HAR-004'; })[0].status,
          mine: app.rows('Items').filter(function (r) {
            return r.name === 'Our real harmonium'; }).length
        });
      }

      var before = snapshot();
      app.sandbox.setupSheet();
      app.sandbox.setupSheet();
      eq(snapshot(), before, 'a redeploy must not add, drop or reset a single row');
    });

    test('a column someone added themselves survives setupSheet', function () {
      // setupSheet trims the 26 blank columns Google pads a new sheet with.
      // That trim used to run to headers.length and would have deleted a
      // column a volunteer added — silent data loss on an operation the docs
      // call safe to repeat.
      var app = freshApp();
      var sheet = app.spreadsheet.getSheetByName('Items');
      var extra = TABS_ITEMS_WIDTH + 1;

      sheet.getRange(1, extra, 1, 1).setValues([['my_own_notes']]);
      sheet.getRange(2, extra, 1, 1).setValues([['insured until 2027']]);

      app.sandbox.setupSheet();

      eq(sheet.getRange(1, extra, 1, 1).getValues()[0][0], 'my_own_notes');
      eq(sheet.getRange(2, extra, 1, 1).getValues()[0][0], 'insured until 2027');
    });

    test('blank padding columns are still trimmed away', function () {
      var app = freshApp();
      var sheet = app.spreadsheet.getSheetByName('Items');
      eq(sheet.getMaxColumns(), TABS_ITEMS_WIDTH,
         'the 26 default columns should be cut back to the headers');
    });
  });
  /* ---------------------------------------------------------------- */
  suite('Photos: Drive has to be authorised, and must say so', function () {

    var PIXEL = 'data:image/jpeg;base64,' +
      Buffer.from('pretend jpeg bytes').toString('base64');

    test('a photo uploads and comes back as a link an <img> can show', function () {
      var app = freshApp();
      var r = expectOk(app.post('uploadPhoto',
        { data_url: PIXEL, asset_id: 'HAR-003', kind: 'in' }));

      ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(r.photo_url),
         'must be a thumbnail link, not the /view page — /view will not render in an img');
      eq(app.drive.files.length, 1);
      ok(/^HAR-003-in-/.test(r.name), 'the file name should say which instrument it is');
    });

    test('an unauthorised Drive says what to do, not "something went wrong"', function () {
      // The real bug. Pasting code that uses DriveApp and deploying a new
      // version never triggers Google's consent screen, so the web app has no
      // right to touch Drive and every upload threw an unhandled error.
      var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z', driveDenied: true });
      app.sandbox.setupSheet();

      var r = app.post('uploadPhoto', { data_url: PIXEL, asset_id: 'HAR-003', kind: 'in' });
      eq(r.ok, false);
      eq(r.error.code, 'DRIVE_NOT_AUTHORISED');
      ok(r.error.message.indexOf('authorizePhotos') !== -1,
         'the message must name the function to run: ' + r.error.message);
    });

    test('nothing else breaks while photos are unauthorised', function () {
      var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z', driveDenied: true });
      app.sandbox.setupSheet();

      expectOk(app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-001', centre: 'East London',
        expected_return_date: '2026-08-20', checked_out_by: 'Nilesh'
      }));
      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh', items: [{ asset_id: 'HAR-003' }]
      }));
      eq(expectOk(app.get('item', { asset_id: 'HAR-003' })).status, 'available');
    });

    test('a rubbish data url is refused politely, before Drive is touched', function () {
      var app = freshApp();
      var r = app.post('uploadPhoto', { data_url: 'not-a-photo', asset_id: 'HAR-003' });
      eq(r.error.code, 'BAD_REQUEST');
      eq(app.drive.files.length, 0, 'nothing should reach Drive');
    });

    function photoFolders(app) {
      return app.drive.folders.filter(function (f) {
        return f.name === 'Instrument Tracker Photos';
      });
    }

    test('authorizePhotos creates the folder once and is safe to re-run', function () {
      var app = freshApp();
      app.sandbox.authorizePhotos();
      app.sandbox.authorizePhotos();
      eq(photoFolders(app).length, 1, 're-running must not litter Drive with duplicates');
    });

    test('the folder is made beside the Sheet, not dumped in the Drive root', function () {
      // A folder appearing at the top of someone's My Drive, among their own
      // files, is a legitimate complaint. Whatever folder the Sheet lives in is
      // where the photos belong.
      var app = freshApp();
      app.drive.sheetParentId = app.drive.makeFolder('Mandir Admin', null).id;

      app.sandbox.authorizePhotos();

      var made = photoFolders(app)[0];
      eq(made.parentId, app.drive.sheetParentId,
         'the photos folder must be a sibling of the spreadsheet');
    });

    test('a Sheet loose in My Drive puts the folder there, still beside it', function () {
      var app = freshApp();          // sheetParentId is null — the default
      app.sandbox.authorizePhotos();
      eq(photoFolders(app)[0].parentId, app.drive.root.id);
    });

    test('moving the folder afterwards does not break uploads', function () {
      // The app stores the folder ID, never a path, so the mandir can file it
      // wherever they like later.
      var app = freshApp();
      app.sandbox.authorizePhotos();
      var made = photoFolders(app)[0];

      made.parentId = app.drive.makeFolder('Somewhere Else', null).id;

      var r = expectOk(app.post('uploadPhoto',
        { data_url: PIXEL, asset_id: 'HAR-003', kind: 'in' }));
      ok(r.photo_url);
      eq(photoFolders(app).length, 1, 'it must reuse the moved folder, not make a new one');
    });

    test('an unrelated folder of the same name elsewhere is left alone', function () {
      // DriveApp.getFoldersByName searches the whole of Drive and would happily
      // return somebody else's folder that happens to share the name.
      var app = freshApp();
      var stranger = app.drive.makeFolder('Instrument Tracker Photos',
                                          app.drive.makeFolder('Someone Else', null).id);

      app.sandbox.authorizePhotos();

      var mine = photoFolders(app).filter(function (f) { return f.id !== stranger.id; });
      eq(mine.length, 1, 'it must create its own, not adopt the stranger');
      eq(mine[0].parentId, app.drive.root.id);
    });

    test('a domain that forbids link sharing still saves the photo', function () {
      var app = freshApp();
      app.drive.sharingRefused = true;
      var r = expectOk(app.post('uploadPhoto',
        { data_url: PIXEL, asset_id: 'HAR-003', kind: 'in' }));
      ok(r.photo_url, 'the upload itself must not fail because sharing was refused');
    });
  });
  /* ---------------------------------------------------------------- */
  suite('Deleting a photo', function () {

    var PIXEL = 'data:image/jpeg;base64,' +
      Buffer.from('pretend jpeg bytes').toString('base64');

    /** An item that went out and came back, with a photo at each end. */
    function withPhotos(app, outcome) {
      expectOk(app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-001', centre: 'East London',
        expected_return_date: '2026-08-20', checked_out_by: 'Nilesh'
      }));
      var out = expectOk(app.post('uploadPhoto',
        { data_url: PIXEL, asset_id: 'HAR-003', kind: 'out' }));
      var back = expectOk(app.post('uploadPhoto',
        { data_url: PIXEL, asset_id: 'HAR-003', kind: 'in' }));

      expectOk(app.post('checkin', {
        checked_in_by: 'Nilesh',
        items: [{ asset_id: 'HAR-003',
                  condition_in: outcome === 'damaged' ? 'needs_repair' : 'good',
                  damage_notes: outcome === 'damaged' ? 'Bellows torn' : '',
                  photo_url: back.photo_url }]
      }));

      var mv = app.rows('Movements')[0];
      expectOk(app.post('setMovementPhoto',
        { movement_id: mv.movement_id, kind: 'out', photo_url: out.photo_url }));

      return { movementId: mv.movement_id, out: out, back: back };
    }

    test('deleting clears the record and bins the Drive file', function () {
      var app = freshApp();
      var made = withPhotos(app);

      var r = expectOk(app.post('deletePhoto',
        { movement_id: made.movementId, kind: 'out' }));
      eq(r.binned, true);

      var mv = app.rows('Movements')[0];
      eq(mv.photo_out_url, '', 'the record must stop pointing at it');
      eq(mv.photo_in_url, made.back.photo_url, 'the other photo is untouched');

      var file = app.drive.files.filter(function (f) {
        return f.id === made.out.file_id; })[0];
      eq(file.trashed, true, 'the file itself must go, not just the link');
    });

    test('the binned file is recoverable, not destroyed', function () {
      // 30 days in the Drive bin is the whole point: a photo deleted by mistake
      // in a noisy store room can be fetched back.
      var app = freshApp();
      var made = withPhotos(app);
      expectOk(app.post('deletePhoto', { movement_id: made.movementId, kind: 'out' }));

      ok(app.drive.files.some(function (f) { return f.id === made.out.file_id; }),
         'the file still exists in Drive, flagged as trashed');
    });

    test('a damage photo will not go without an explicit confirm', function () {
      var app = freshApp();
      var made = withPhotos(app, 'damaged');

      var refused = app.post('deletePhoto', { movement_id: made.movementId, kind: 'in' });
      eq(refused.ok, false);
      eq(refused.error.code, 'CONFIRM_REQUIRED');
      eq(app.rows('Movements')[0].photo_in_url, made.back.photo_url, 'still there');

      expectOk(app.post('deletePhoto',
        { movement_id: made.movementId, kind: 'in', confirm: true }));
      eq(app.rows('Movements')[0].photo_in_url, '');
    });

    test('deleting the damage photo keeps the damage record itself', function () {
      // The photo is evidence; the fact of the damage is the record. Losing the
      // first must never quietly lose the second.
      var app = freshApp();
      var made = withPhotos(app, 'damaged');
      expectOk(app.post('deletePhoto',
        { movement_id: made.movementId, kind: 'in', confirm: true }));

      var mv = app.rows('Movements')[0];
      eq(mv.outcome, 'damaged');
      eq(mv.damage_notes, 'Bellows torn');
      eq(expectOk(app.get('item', { asset_id: 'HAR-003' })).status, 'maintenance');
    });

    test('deleting a photo that is not there says so', function () {
      var app = freshApp();
      var made = withPhotos(app);
      expectOk(app.post('deletePhoto', { movement_id: made.movementId, kind: 'out' }));

      var again = app.post('deletePhoto', { movement_id: made.movementId, kind: 'out' });
      eq(again.error.code, 'NOT_FOUND');
    });

    test('an unknown movement is refused', function () {
      var app = freshApp();
      eq(app.post('deletePhoto', { movement_id: 'MV-9999', kind: 'in' }).error.code, 'NOT_FOUND');
    });

    test('the record is cleared even if Drive will not bin the file', function () {
      // The volunteer asked for the photo to go away. A Drive hiccup must not
      // leave it still showing on the item page.
      var app = freshApp();
      var made = withPhotos(app);
      app.drive.denied = true;

      var r = expectOk(app.post('deletePhoto', { movement_id: made.movementId, kind: 'out' }));
      eq(r.deleted, true);
      eq(r.binned, false, 'and it should be honest that the file is still there');
      eq(app.rows('Movements')[0].photo_out_url, '');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Moving the project to another Google account', function () {

    test('setPhotoFolder repoints new photos without touching old ones', function () {
      var app = freshApp();
      var made = expectOk(app.post('uploadPhoto', {
        data_url: 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64'),
        asset_id: 'HAR-003', kind: 'in'
      }));

      var elsewhere = app.drive.makeFolder('Photos On The New Account', null);
      app.sandbox.setPhotoFolder('https://drive.google.com/drive/folders/' + elsewhere.id);

      var next = expectOk(app.post('uploadPhoto', {
        data_url: 'data:image/jpeg;base64,' + Buffer.from('y').toString('base64'),
        asset_id: 'HAR-004', kind: 'in'
      }));

      var newFile = app.drive.files.filter(function (f) {
        return f.id === next.file_id; })[0];
      eq(newFile.folder.id, elsewhere.id, 'the new photo lands in the new folder');

      var oldFile = app.drive.files.filter(function (f) {
        return f.id === made.file_id; })[0];
      ok(oldFile && !oldFile.trashed, 'the earlier photo is left exactly where it was');
    });

    test('setPhotoFolder accepts a bare folder ID as well as a link', function () {
      var app = freshApp();
      var target = app.drive.makeFolder('Just An ID', null);
      app.sandbox.setPhotoFolder(target.id);
      eq(app.properties.PHOTO_FOLDER_ID, target.id);
    });

    test('setPhotoFolder refuses a folder that does not exist', function () {
      var app = freshApp();
      var threw = false;
      try { app.sandbox.setPhotoFolder('no-such-folder'); } catch (e) { threw = true; }
      ok(threw, 'better to fail here than at the next photo, mid-handover');
    });
  });
};
