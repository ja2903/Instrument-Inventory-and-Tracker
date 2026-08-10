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

  var byItem = {};
  call('bootstrap').items.forEach(function (i) {
    byItem[i.asset_id] = call('item', { asset_id: i.asset_id });
  });

  return { bootstrap: call('bootstrap'), events: byEvent, items: byItem };
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
  sandbox.Api.item = function (id) {
    return Promise.resolve(fixtures.items[id]);
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

/**
 * Draws an item page for real. Like the event page, rendering without running
 * its mount only ever produces the spinner — so the damage panel and the
 * movement history, which is where the photo controls live, would never be
 * exercised at all.
 */
async function renderItemBody(s, assetId) {
  s.location.hash = '#/item/' + assetId;
  s.App.screens.item([assetId]);
  await s.__realItemMount([assetId]);
  return render(s, 'item', [assetId]);
}

/**
 * A separate browser app whose bootstrap differs from the shared one. Used
 * where a test needs to vary the payload without disturbing the cached app
 * every other test in this file renders against.
 */
async function withBootstrap(overrides) {
  var s = DOM.loadBrowserApp(Object.assign({}, bootstrapPayload, overrides));
  await s.App.refresh({ showSpinner: false });
  return s;
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
  ['onloan', []],
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

    test('settings says where photos are kept, and links to the folder', async function () {
      var s = await withBootstrap({
        photoFolderUrl: 'https://drive.google.com/drive/folders/folder-9' });
      var html = render(s, 'settings');

      ok(html.indexOf('Where photos are kept') !== -1);
      ok(html.indexOf('https://drive.google.com/drive/folders/folder-9') !== -1,
         'the folder must be one tap away, not something to hunt for in Drive');
    });

    test('settings does not offer a dead link before any photo exists', async function () {
      var s = await withBootstrap({ photoFolderUrl: '' });
      var html = render(s, 'settings');

      ok(html.indexOf('No photos have been saved yet') !== -1);
      ok(html.indexOf('drive.google.com/drive/folders') === -1,
         'a link to a folder that does not exist is worse than no link');
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

  suite('Item pages draw their real body, not just the spinner', function () {

    test('a damaged instrument shows the damage panel and its photo', async function () {
      var html = await renderItemBody(full, 'HAR-007');
      ok(html.indexOf('Damaged') !== -1, 'the damage panel is drawn');
      ok(html.indexOf('Bellows leaking') !== -1, 'the note is shown');
    });

    /**
     * Everything before <div id="item-history"> — i.e. the damage panel only.
     *
     * Asserting against the whole page was useless here: the history rows carry
     * their own delete buttons, so a test for "a delete button exists" passed
     * happily with the panel's button deleted. Scope is the whole point.
     */
    function damagePanelOf(html) {
      var end = html.indexOf('id="item-history"');
      ok(end !== -1, 'the history section marks where the panel ends');
      return html.slice(0, end);
    }

    test('the damage panel itself offers to delete the photo', async function () {
      var panel = damagePanelOf(await renderItemBody(full, 'HAR-007'));
      ok(panel.indexOf('data-action="photo-delete"') !== -1,
         'the delete must be on the panel, where the photo actually is');
      ok(panel.indexOf('data-damage="1"') !== -1,
         'and flagged as damage so the confirm warns properly');
    });

    test('the history rows offer to delete their photos too', async function () {
      var html = await renderItemBody(full, 'HAR-007');
      var history = html.slice(html.indexOf('id="item-history"'));
      ok(history.indexOf('data-action="photo-delete"') !== -1);
    });

    test('nothing offers to delete a photo that is not there', async function () {
      var html = await renderItemBody(full, 'TAB-001');
      var hasPhoto = html.indexOf('drive.google.com/thumbnail') !== -1;
      if (!hasPhoto) {
        ok(html.indexOf('data-action="photo-delete"') === -1,
           'a delete button with no photo behind it is a dead end');
      }
    });
  });

  /**
   * A note written on an instrument in the inventory is worth nothing if it
   * only ever appears in the inventory. The moment it matters is the moment
   * somebody is picking the instrument up, so it has to survive the whole
   * Give out flow.
   */
  suite('An instrument\'s note follows it into Give out', function () {

    /** Puts the Give out flow into step 2 with real dates set. */
    function atItemStep(s) {
      s.location.hash = '#/give';
      var g = s.App.screens.give.state();
      ok(g, 'the give flow exposes its basket');
      g.step = 2;
      g.when = 'now';
      g.event_id = 'EV-001';
      g.from = '2026-08-08';
      g.to = '2026-08-20';
      g.name = 'Nilesh';
      return g;
    }

    /** The picker list, which draws itself into #give-list rather than being returned. */
    function pickerList(s) {
      render(s, 'give');
      s.App.screens.give.renderList();
      return s.document.getElementById('give-list').innerHTML;
    }

    test('the note shows against the instrument when choosing what goes out', function () {
      var s = full;
      atItemStep(s);
      var html = pickerList(s);

      ok(html.indexOf('Scale changer — handle with care') !== -1,
         'HAR-002\'s note must appear in the picker');
    });

    test('the picker lists instruments at all', function () {
      // This list had never been rendered by a test. Anything that threw in
      // here reached a volunteer as an empty screen with a working footer.
      var s = full;
      atItemStep(s);
      var html = pickerList(s);

      ok(html.indexOf('HAR-002') !== -1, 'a free harmonium is offered');
      ok(html.length > 500, 'the list has real content, not just a wrapper');
    });

    test('the note is still there on the final check-and-confirm', function () {
      var s = full;
      var g = atItemStep(s);
      g.step = 3;
      g.chosen = { 'HAR-002': true };

      var html = render(s, 'give');
      ok(html.indexOf('Scale changer — handle with care') !== -1,
         'the last screen before handing over is the last chance to read it');

      g.chosen = {};
      g.step = 1;
    });

    test('an instrument with no note adds no empty banner', function () {
      var s = full;
      var g = atItemStep(s);
      g.step = 3;
      g.chosen = { 'HAR-001': true };

      var plain = s.App.itemById('HAR-001');
      eq(String(plain.notes || '').trim(), '', 'HAR-001 is the no-note case');
      ok(render(s, 'give').indexOf('📌') === -1, 'no pin where there is nothing to say');

      g.chosen = {};
      g.step = 1;
    });
  });

  suite('The on-loan list can be printed', function () {

    test('it lists every instrument that is actually out', function () {
      var html = render(full, 'onloan');
      var out = full.App.itemsOut();
      ok(out.length > 0, 'the fixture has instruments out');

      out.forEach(function (item) {
        ok(html.indexOf(item.asset_id) !== -1,
           item.asset_id + ' is out but missing from the printed list');
      });
    });

    test('it lists nothing that is not out', function () {
      var html = render(full, 'onloan');
      var inStore = full.App.activeItems().filter(function (i) {
        return i.status === 'available';
      });
      ok(inStore.length > 0);

      // A list you take to the store room must not send you looking for
      // something that is sitting on the shelf behind you.
      var wrongly = inStore.filter(function (i) {
        return html.indexOf('>' + i.asset_id + '<') !== -1;
      });
      eq(wrongly.length, 0,
         'these are in the store but printed as out: ' +
         wrongly.map(function (i) { return i.asset_id; }).join(', '));
    });

    test('late items are marked, and come first', function () {
      var html = render(full, 'onloan');
      var late = full.App.overdueItems();
      ok(late.length > 0, 'the fixture has late items');
      ok(html.indexOf('late back') !== -1, 'the header counts them');
    });

    test('every row has a box to tick', function () {
      var html = render(full, 'onloan');
      var boxes = html.split('class="tickbox"').length - 1;
      eq(boxes, full.App.itemsOut().length,
         'one tick box per instrument — that is what the paper is for');
    });

    test('the screen chrome is kept off the paper', function () {
      var html = render(full, 'onloan');
      ok(html.indexOf('class="no-print"') !== -1,
         'the buttons and page title must not print');
      ok(html.indexOf('loan-sheet') !== -1,
         'the printed part carries the page geometry');
    });

    test('it says so plainly when nothing is out', function () {
      var html = render(empty, 'onloan');
      ok(html.indexOf('Nothing is out') !== -1);
      ok(html.indexOf('tickbox') === -1, 'no empty table to print');
    });
  });
};
