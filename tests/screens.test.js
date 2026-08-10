/**
 * Every screen, rendered.
 *
 * This suite exists because of a specific failure: the Events page called a
 * helper that a refactor had deleted, and nothing noticed until it was opened
 * on a phone. Two hundred and fifty backend tests were passing at the time.
 * The rules were right; nobody had ever checked that the screens could draw.
 *
 * So this loads the real browser files in a small DOM stub (tests/dom-stub.js)
 * and renders every screen against the full trial dataset. It does not model
 * clicks, layout or the camera — those stay manual. What it does catch is the
 * whole class of "a screen throws and the volunteer gets a blank page".
 */

var GAS = require('./gas-mock.js');
var DOM = require('./dom-stub.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

/** The trial dataset, exactly as the browser receives it. */
var fixtures = (function () {
  var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  app.sandbox.setupSheet();
  app.sandbox.seedDemoData();

  function call(action, params) {
    var res = JSON.parse(app.sandbox.doGet({
      parameter: Object.assign(
        { action: action, code: app.properties.ACCESS_CODE }, params || {})
    })._text);
    if (!res.ok) throw new Error('fixture "' + action + '" failed: ' + res.error.message);
    return res.data;
  }

  var byEvent = {};
  call('bootstrap').events.forEach(function (e) {
    byEvent[e.event_id] = call('event', { event_id: e.event_id });
  });

  return { bootstrap: call('bootstrap'), events: byEvent };
})();
var bootstrapPayload = fixtures.bootstrap;

/**
 * A loaded browser app with data in place, ready to render.
 *
 * refresh() pulls the stubbed bootstrap through the REAL code path, so App's
 * internal state ends up exactly as it is in a browser — rather than a
 * hand-built object that could quietly diverge from the real shape.
 */
var sandbox = null;
async function app() {
  if (sandbox) return sandbox;
  sandbox = DOM.loadBrowserApp(bootstrapPayload);
  await sandbox.App.refresh({ showSpinner: false });
  sandbox.Api.event = function (id) {
    return Promise.resolve(fixtures.events[id]);
  };
  return sandbox;
}

/**
 * Draws an event page for real: run its own mount so the detail lands in the
 * cache, then render. Rendering without this only ever produces the spinner,
 * which is how a missing helper in the event BODY once passed a green run.
 */
async function renderEventBody(s, eventId) {
  s.location.hash = '#/event/' + eventId;
  s.App.screens.event([eventId]);                 // first pass: header + spinner
  await s.__realEventMount([eventId]);            // fetches and caches the detail
  return render(s, 'event', [eventId]);           // second pass: the real body
}

/** Renders one screen and returns its HTML, failing loudly if it throws. */
function render(s, name, params) {
  var screen = s.App.screens[name];
  ok(screen, 'no such screen: ' + name);
  try {
    return screen(params || []) || '';
  } catch (e) {
    fail('screen "' + name + '" threw while rendering:\n      ' +
         (e && e.message ? e.message : String(e)));
  }
}

/** A second app with an entirely empty store, for the empty-state paths. */
var emptySandbox = null;
async function emptyApp() {
  if (emptySandbox) return emptySandbox;
  emptySandbox = DOM.loadBrowserApp({
    today: '2026-08-08', version: '1.0.0',
    centres: [], instrumentTypes: [], qualityGrades: [],
    events: [], items: [], openAllocations: [], openMovements: []
  });
  await emptySandbox.App.refresh({ showSpinner: false });
  return emptySandbox;
}

// The list is deliberately explicit rather than derived from App.screens: a
// screen that stops being registered should fail here, not quietly vanish
// from the sweep.
var SCREENS = [
  ['dashboard', []],
  ['inventory', []],
  ['give', []],
  ['back', []],
  ['events', []],
  ['event', ['EV-001']],
  ['labels', []],
  ['settings', []],
  ['add', []],
  ['edit', ['HAR-001']],
  ['item', ['TAB-001']],
  ['scan', []],
  ['more', []]
];

module.exports = async function () {
  var full, empty, loadError = null;
  try {
    full = await app();
    empty = await emptyApp();
  } catch (e) {
    loadError = e;
  }

  /*
   * If the browser files cannot even be loaded — one missing from the
   * repository, say — report that as a single clear failure rather than
   * letting a stack trace abort the whole run before anything else has
   * had a chance to report.
   */
  if (loadError) {
    suite('Every screen renders', function () {
      test('the browser files load at all', function () {
        fail('could not load the browser code:\n      ' +
             (loadError.code === 'ENOENT'
               ? 'missing file — ' + loadError.path
               : (loadError.message || String(loadError))));
      });
    });
    return;
  }

  suite('Every screen renders', function () {

    SCREENS.forEach(function (entry) {
      test(entry[0], function () {
        var html = render(full, entry[0], entry[1]);
        ok(html.length > 100,
           entry[0] + ' rendered only ' + html.length + ' characters');
        notOk(/undefined|\[object Object\]|NaN/.test(html),
              entry[0] + ' rendered a placeholder value into the page');
      });
    });

    test('no screen prints a raw null into the page', function () {
      SCREENS.forEach(function (entry) {
        var html = render(full, entry[0], entry[1]);
        notOk(html.indexOf('>null<') !== -1, entry[0] + ' printed a raw null');
      });
    });
  });

  suite('Screens show the data they are given', function () {

    test('the dashboard leads with the two things anyone does', function () {
      var html = render(full, 'dashboard');
      ok(html.indexOf('Give out instruments') !== -1);
      ok(html.indexOf('Take instruments back') !== -1);
    });

    test('the dashboard counts what is actually out', function () {
      var out = full.App.itemsOut().length;
      ok(out > 0, 'the fixture has instruments out');
      ok(render(full, 'dashboard').indexOf(out + ' instruments out now') !== -1,
         'the real out count (' + out + ') appears on the dashboard');
    });

    test('the dashboard shows a Late back section when things are late', function () {
      ok(full.App.overdueItems().length > 0, 'the fixture has late items');
      ok(render(full, 'dashboard').indexOf('Late back') !== -1);
    });

    test('inventory offers search and a way to add', function () {
      var html = render(full, 'inventory');
      ok(html.indexOf('Search name, ID, location') !== -1, 'the search box is there');
      ok(html.indexOf('Add instrument') !== -1);
    });

    test('the events screen lists events and archives finished ones', function () {
      var html = render(full, 'events');
      ok(html.indexOf('Paris Mandir Mahotsav') !== -1);
      ok(html.indexOf('Finished') !== -1, 'the archive section is present');
    });

    test('an item page names the item', function () {
      ok(render(full, 'item', ['TAB-001']).indexOf('Tabla Set A') !== -1);
    });

    test('the give-out flow starts at step 1 of 3', function () {
      var html = render(full, 'give');
      ok(html.indexOf('Step 1 of 3') !== -1);
      ok(html.indexOf('Taking them now') !== -1);
      ok(html.indexOf('Booking ahead') !== -1);
    });

    test('the take-back flow starts at step 1 of 2', function () {
      var html = render(full, 'back');
      ok(html.indexOf('Step 1 of 2') !== -1);
      ok(html.indexOf('What is coming back?') !== -1);
    });

    test('settings offers the reference lists and the access code', function () {
      var html = render(full, 'settings').toLowerCase();
      ['centres', 'instrument type', 'quality grade', 'access code'].forEach(function (t) {
        ok(html.indexOf(t) !== -1, 'settings mentions ' + t);
      });
    });
  });

  suite('Event pages render their body, not just the spinner', function () {

    // Regression: the event body called a helper a refactor had deleted.
    // Every backend test passed; the page was blank on a phone.
    Object.keys(fixtures.events).forEach(function (eventId) {
      test(eventId + ' — ' + (full.App.eventById(eventId) || {}).name, async function () {
        var html = await renderEventBody(full, eventId);
        ok(html.indexOf('Loading event') === -1,
           'still showing the spinner — the body never rendered');
        ok(html.length > 400, 'body rendered only ' + html.length + ' characters');
      });
    });

    test('the body shows the counts it is given', async function () {
      var html = await renderEventBody(full, 'EV-001');
      ok(html.indexOf('Out now') !== -1);
      ok(html.indexOf('Returned') !== -1);
      ok(html.indexOf('Overdue') !== -1);
    });
  });

  suite('Screens survive an empty store', function () {

    // What a real mandir sees the moment after clearDemoData(): nothing at
    // all. Empty-state paths are the least exercised and the likeliest to
    // read [0] of an empty list.
    ['dashboard', 'inventory', 'events', 'labels', 'settings', 'give', 'back', 'more']
      .forEach(function (name) {
        test(name + ' with nothing in the store', function () {
          var html = render(empty, name, name === 'edit' ? [''] : []);
          ok(html.length > 50, name + ' rendered almost nothing');
        });
      });
  });
};
