/**
 * Instrument Tracker — shell, routing and shared state.
 *
 * The whole dataset arrives in one bootstrap call and lives in App.data.
 * Screens read from it synchronously and re-render after any write. At this
 * scale that is far simpler than incremental cache updates, and it means the
 * screen can never disagree with the Sheet for longer than one round trip.
 */

var App = (function () {
  'use strict';

  var screens = {};        // name -> function(params) returning HTML
  var data = null;         // the bootstrap payload
  var current = { name: '', params: [] };

  var NAME_KEY = 'instrument_tracker_last_name';

  /* ---------------- routing ---------------------------------------- */

  function parseHash() {
    var raw = (window.location.hash || '#/').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || 'dashboard', params: parts.slice(1) };
  }

  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  function highlightNav(name) {
    // Sub-screens light up their parent tab: an item page still reads as Inventory.
    // Scan is deliberately absent: it is reached from the floating button and
    // belongs to no tab, so nothing should look selected while it is open.
    var group = ({
      item: 'inventory', add: 'inventory', edit: 'inventory',
      event: 'events',
      labels: 'more', settings: 'more', more: 'more', onloan: 'more'
    })[name] || name;

    document.querySelectorAll('[data-nav]').forEach(function (link) {
      var nav = link.dataset.nav;
      // The desktop bar has its own Labels and Settings links; the mobile bar
      // rolls both into "More". Match whichever exists.
      var isCurrent = nav === group || nav === name;
      if (isCurrent) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  /**
   * Screens that need to know where the user came from register here — the
   * Instruments list uses it to decide whether to keep its filters.
   * Called before the new screen is built, so a listener can still change
   * state that the render will pick up.
   */
  var navigateListeners = [];
  function onNavigate(fn) { navigateListeners.push(fn); }

  function render() {
    var previous = current ? current.name : '';
    var route = parseHash();

    if (route.name !== previous) {
      navigateListeners.forEach(function (fn) {
        try { fn(previous, route.name); } catch (e) { console.error(e); }
      });
    }
    current = route;

    var screen = screens[route.name];
    var host = document.getElementById('screen');

    if (!screen) {
      host.innerHTML = UI.pageTitle('Page not found') +
        UI.emptyState('🤷', 'That page does not exist',
          'It may have been a stale link.',
          UI.button('Back to dashboard', { href: '#/' }));
      highlightNav('');
      return;
    }

    try {
      host.innerHTML = screen(route.params) || '';
      // Screens that need live controls (a search box that must not lose focus,
      // a camera, a form) attach them in a `mount` function rather than relying
      // on delegated clicks.
      if (typeof screen.mount === 'function') screen.mount(route.params);
    } catch (e) {
      console.error(e);
      host.innerHTML = UI.errorPanel('This screen could not be drawn', String(e && e.message || e),
        UI.button('Reload', { action: 'hard-reload' }));
    }

    highlightNav(route.name);
    UI.scrollTop();
    host.focus({ preventScroll: true });
  }

  /* ---------------- data ------------------------------------------- */

  /*
   * Last known good data, kept on the device.
   *
   * Apps Script is not fast: a cold start is several seconds before it has even
   * begun reading the Sheet. Waiting for that on every single open, just to
   * show a shelf that has not changed since this morning, is most of what makes
   * the app feel slow.
   *
   * So the last payload is kept and drawn immediately, and the real one is
   * fetched behind it. The screen is usable at once and quietly corrects itself
   * a second later. Writes never come from here — every save still goes
   * straight to the Sheet and is confirmed by it.
   */
  var SNAPSHOT_KEY = 'instrument_tracker_snapshot';
  var SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function readSnapshot() {
    try {
      var raw = window.localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || !saved.at || !saved.data) return null;
      if (Date.now() - saved.at > SNAPSHOT_MAX_AGE_MS) return null;

      // Overdue counts are worked out against the server's idea of today, so a
      // snapshot from yesterday would quietly mis-state what is late.
      if (saved.data.today !== todayLocalISO()) return null;

      return saved.data;
    } catch (e) {
      return null;
    }
  }

  function clearSnapshot() {
    try { window.localStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
  }

  function writeSnapshot(payload) {
    try {
      window.localStorage.setItem(SNAPSHOT_KEY,
        JSON.stringify({ at: Date.now(), data: payload }));
    } catch (e) {
      // Storage full or blocked: the app simply loses the head start.
    }
  }

  /** The device's date, only ever used to decide if a snapshot is too old. */
  function todayLocalISO() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  async function loadData() {
    data = await Api.bootstrap();
    writeSnapshot(data);
    return data;
  }

  /**
   * Screens that hold their own fetched detail (item history, event pages)
   * register a reset here, so a refresh can never leave a stale page on screen.
   */
  var cacheResets = [];
  function onRefresh(fn) { cacheResets.push(fn); }

  /** Re-fetch everything, then redraw whatever screen is open. */
  async function refresh(options) {
    options = options || {};
    var host = document.getElementById('screen');
    if (options.showSpinner !== false) host.innerHTML = UI.spinner('Loading…');
    try {
      cacheResets.forEach(function (reset) { reset(); });
      await loadData();
      render();
    } catch (e) {
      handleError(e, { silent: true });
      host.innerHTML = UI.errorPanel('Could not load your data', e.message,
        UI.button('Try again', { action: 'hard-reload' }));
    }
  }

  /**
   * One place for every failed request.
   * A wrong or changed access code drops the user back to the unlock screen
   * rather than showing a confusing error on a half-drawn page.
   */
  function handleError(error, options) {
    options = options || {};
    console.error(error);

    if (error && error.code === 'BAD_CODE') {
      Api.clearCode();
      showUnlock('That access code is no longer valid. Please enter the current one.');
      return;
    }
    if (!options.silent) {
      UI.toast(error && error.message ? error.message : 'Something went wrong.', 'error');
    }
  }

  /* ---------------- lookups screens rely on ------------------------ */

  function items() { return (data && data.items) || []; }

  function itemById(assetId) {
    return items().filter(function (i) { return i.asset_id === assetId; })[0] || null;
  }

  /** Active items only — removed ones stay in history but drop out of lists. */
  function activeItems() {
    return items().filter(function (i) { return i.active; });
  }

  /** Top-level items: standalone items and kit parents, not kit children. */
  function topLevelItems() {
    return activeItems().filter(function (i) { return !i.parent_asset_id; });
  }

  function childrenOf(assetId) {
    return activeItems().filter(function (i) { return i.parent_asset_id === assetId; });
  }

  function events() { return (data && data.events) || []; }

  function eventById(id) {
    return events().filter(function (e) { return e.event_id === id; })[0] || null;
  }

  function topLevelEvents() {
    return events().filter(function (e) { return !e.parent_event_id; });
  }

  function subEventsOf(eventId) {
    return events().filter(function (e) { return e.parent_event_id === eventId; });
  }

  /** Event names as "Parent / Sub-event", for dropdowns and status lines. */
  function eventPath(eventId) {
    var ev = eventById(eventId);
    if (!ev) return '';
    if (!ev.parent_event_id) return ev.name;
    var parent = eventById(ev.parent_event_id);
    return (parent ? parent.name + ' / ' : '') + ev.name;
  }

  /** Soonest first, undated last. Used everywhere events are listed. */
  function byEventDate(a, b) {
    var da = a.start_date || a.end_date || '';
    var db = b.start_date || b.end_date || '';
    if (!da && !db) return String(a.name).localeCompare(String(b.name));
    if (!da) return 1;
    if (!db) return -1;
    if (da !== db) return da < db ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  }

  function topLevelEventsSorted() {
    return topLevelEvents().slice().sort(byEventDate);
  }

  function subEventsSorted(eventId) {
    return subEventsOf(eventId).slice().sort(byEventDate);
  }

  /**
   * Is this event finished with?
   *
   * Derived, not manually marked — in practice nobody remembers to go back and
   * set an event to "completed" after the mahotsav, so relying on the status
   * alone means the Finished list stays empty and the live list grows forever.
   *
   * An event is done when its end date has passed AND nothing is still out for
   * it. The second half matters: a sabha that ended yesterday with a harmonium
   * unaccounted for is emphatically not finished.
   */
  function isArchivedEvent(event) {
    if (!event) return false;
    if (event.status === 'completed' || event.status === 'cancelled') return true;

    var end = event.end_date || event.start_date;
    if (!end) return false;                                  // undated: never auto-archived
    if (!data || !data.today || end >= data.today) return false;

    return !eventHasItemsOut(event.event_id);
  }

  /** Anything still out against this event or one of its sub-events. */
  function eventHasItemsOut(eventId) {
    var ids = {};
    ids[eventId] = true;
    subEventsOf(eventId).forEach(function (s) { ids[s.event_id] = true; });

    return itemsOut().some(function (i) {
      return ids[i.live.event_id] || ids[i.live.sub_event_id];
    });
  }

  /**
   * Every event as a flat dropdown list, sub-events indented under their
   * parent, soonest first. One level of nesting, exactly as the brief asks.
   *
   * A sub-event is judged on ITS OWN status, never its parent's. The previous
   * version skipped a finished parent and took its sub-events down with it,
   * which is how events went missing from this list.
   *
   * Finished events are still offered, below a divider, because instruments do
   * genuinely come back against an event that has already ended.
   */
  /**
   * Events for a dropdown, soonest first, sub-events indented under their
   * parent. One level of nesting, exactly as the brief asks.
   *
   * Finished events are LEFT OUT. Nobody gives instruments out to an event
   * that has already happened, and once a few years of sabhas have gone by
   * they would drown the handful of dates anyone is actually choosing between.
   * Amending something after the fact is done from the Events archive, where
   * that event can be opened directly.
   *
   * Pass true to include them anyway — the Instruments filter does, because
   * there you are searching history rather than planning.
   */
  function eventOptions(includeArchived) {
    var live = [];
    var archived = [];

    topLevelEventsSorted().forEach(function (parent) {
      var subs = subEventsSorted(parent.event_id);
      var entry = { value: parent.event_id, label: parent.name };
      if (isArchivedEvent(parent)) archived.push(entry);
      else live.push(entry);

      subs.forEach(function (sub) {
        var subEntry = { value: sub.event_id, label: '   \u21b3 ' + sub.name };
        if (isArchivedEvent(sub)) archived.push(subEntry);
        else live.push(subEntry);
      });
    });

    if (!includeArchived || !archived.length) return live;
    return live
      .concat([{ value: '', label: '\u2500\u2500 finished \u2500\u2500', disabled: true }])
      .concat(archived);
  }

  function activeCentres() {
    return ((data && data.centres) || []).filter(function (c) { return c.active; })
      .map(function (c) { return c.name; });
  }

  function activeTypes() {
    return ((data && data.instrumentTypes) || []).filter(function (t) { return t.active; });
  }

  function activeGrades() {
    return ((data && data.qualityGrades) || []).filter(function (g) { return g.active; })
      .sort(function (a, b) { return a.rank - b.rank; });
  }

  /** Everything currently out, newest first. */
  function itemsOut() {
    return activeItems().filter(function (i) { return i.status === 'checked_out' && i.live; });
  }

  function overdueItems() {
    return itemsOut().filter(function (i) { return i.live.days_overdue > 0; })
      .sort(function (a, b) { return b.live.days_overdue - a.live.days_overdue; });
  }

  /* ---------------- availability over a date window ---------------- */

  /**
   * The world as the shared Rules module wants to see it, assembled from the
   * bootstrap payload. Nothing is fetched — this is why the Allocate screen
   * can re-evaluate every instrument the instant a date changes.
   */
  function availabilityState() {
    return {
      today: (data && data.today) || '',
      items: items(),
      movements: (data && data.openMovements) || [],
      allocations: (data && data.openAllocations) || []
    };
  }

  /**
   * Why an instrument cannot be used between two dates — an empty array means
   * it is free. Same function the server runs before it saves anything.
   */
  function conflictsFor(assetId, from, to, ignoreAllocationIds) {
    return Rules.conflictsFor(availabilityState(), assetId, from, to, ignoreAllocationIds);
  }

  function isFreeBetween(assetId, from, to, ignoreAllocationIds) {
    return conflictsFor(assetId, from, to, ignoreAllocationIds).length === 0;
  }

  /**
   * A kit is only fully free if every piece is. Returns the parent's own
   * clashes plus, separately, the pieces that are spoken for — so the UI can
   * say "available, without the hammer" rather than a flat yes or no.
   */
  function kitAvailability(assetId, from, to, ignoreAllocationIds) {
    var own = conflictsFor(assetId, from, to, ignoreAllocationIds);
    var busyChildren = [];
    childrenOf(assetId).forEach(function (child) {
      var c = conflictsFor(child.asset_id, from, to, ignoreAllocationIds);
      if (c.length) busyChildren.push({ item: child, conflicts: c });
    });
    return { conflicts: own, busyChildren: busyChildren, available: own.length === 0 };
  }

  /* ---------------- remembering the karyakar's name ---------------- */
  /* Minimal typing: the name field pre-fills with whoever used this device last. */

  function lastName() {
    try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function rememberName(name) {
    if (!name) return;
    try { window.localStorage.setItem(NAME_KEY, name); } catch (e) {}
  }

  /* ---------------- unlock screen ---------------------------------- */

  function showUnlock(message) {
    document.getElementById('shell').classList.add('hidden');
    var unlock = document.getElementById('unlock');
    unlock.classList.remove('hidden');
    unlock.classList.add('flex');

    var error = document.getElementById('unlock-error');
    if (message) {
      error.textContent = message;
      error.classList.remove('hidden');
    } else {
      error.classList.add('hidden');
    }
    document.getElementById('unlock-code').focus();
  }

  function hideUnlock() {
    var unlock = document.getElementById('unlock');
    unlock.classList.add('hidden');
    unlock.classList.remove('flex');
    document.getElementById('shell').classList.remove('hidden');
  }

  async function attemptUnlock(code) {
    Api.setCode(code);
    await loadData();
    hideUnlock();
    render();
  }

  /* ---------------- start-up --------------------------------------- */

  async function start() {
    // Set synchronously, before anything that can wait. The missing-file guard
    // in index.html reads this to tell "the app never started" apart from
    // "the app started and is waiting for a slow server".
    window.__instrumentTrackerStarted = true;

    document.getElementById('unlock-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var button = document.getElementById('unlock-submit');
      var restore = UI.busy(button, 'Checking…');
      var errorBox = document.getElementById('unlock-error');
      errorBox.classList.add('hidden');

      try {
        await attemptUnlock(document.getElementById('unlock-code').value.trim());
      } catch (err) {
        Api.clearCode();
        errorBox.textContent = err.message || 'That did not work.';
        errorBox.classList.remove('hidden');
      } finally {
        restore();
      }
    });

    window.addEventListener('hashchange', render);

    document.getElementById('refresh-btn').addEventListener('click', async function () {
      var button = this;
      var icon = document.getElementById('refresh-icon');
      var label = document.getElementById('refresh-label');

      button.disabled = true;
      icon.classList.add('animate-spin');
      label.textContent = 'Refreshing…';
      try {
        await refresh({ showSpinner: false });
        label.textContent = 'Up to date';
        setTimeout(function () { label.textContent = 'Refresh'; }, 1600);
      } finally {
        button.disabled = false;
        icon.classList.remove('animate-spin');
      }
    });

    document.getElementById('scan-fab').addEventListener('click', function () {
      go('#/scan');
    });

    // One delegated listener for the whole app. Screens declare data-action
    // in their HTML instead of wiring up listeners after every re-render.
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;
      var action = target.dataset.action;

      if (action === 'hard-reload') { window.location.reload(); return; }

      var handler = App.actions[action];
      if (handler) {
        e.preventDefault();
        handler(target, e);
      }
    });

    if (!Api.getCode()) {
      showUnlock();
      return;
    }

    /*
     * Show the shell and a spinner BEFORE waiting for the Sheet.
     *
     * Apps Script cold-starts can take several seconds. Waiting first and
     * revealing afterwards left the window completely blank for that whole
     * time — indistinguishable, to anyone looking at it, from a broken page.
     */
    hideUnlock();

    // Draw last time's data straight away if we have it, so the app is usable
    // while the fetch is still in flight. Falls back to the spinner on a first
    // ever open, or when the snapshot has gone stale.
    var snapshot = readSnapshot();
    if (snapshot) {
      data = snapshot;
      try { render(); } catch (e) { data = null; }
    }
    if (!data) {
      document.getElementById('screen').innerHTML =
        UI.spinner('Loading your instruments…');
    }

    try {
      await loadData();
      render();
    } catch (e) {
      if (e.code === 'BAD_CODE') {
        Api.clearCode();
        showUnlock('Please enter the access code.');
      } else if (e.code === 'NOT_CONFIGURED' || e.code === 'BAD_DEPLOYMENT') {
        hideUnlock();
        document.getElementById('screen').innerHTML = connectScreen(e.message);
      } else if (snapshot) {
        // There is already a usable screen up from the snapshot. Replacing it
        // with an error page would take working information away from someone
        // who can see it — say the update failed and leave the app alone.
        UI.toast('Showing what was here last time — could not reach the Sheet just now.',
                 'error');
      } else {
        hideUnlock();
        document.getElementById('screen').innerHTML =
          UI.errorPanel('Could not load your data', e.message,
            UI.button('Try again', { action: 'hard-reload' }));
      }
    }
  }

  /**
   * "Not connected" with a way out of it.
   *
   * This used to be a dead end: a paragraph telling you to edit config.js on
   * GitHub, shown on the phone of somebody standing in a store room. The most
   * common cause is also the most avoidable — re-uploading every file puts the
   * placeholder config.js back — so the screen now takes the address directly
   * and remembers it on the device.
   */
  function connectScreen(message) {
    return UI.pageTitle('Connect to your Google Sheet') +
      UI.errorPanel('This app is not connected yet', message) +

      UI.card(
        '<label for="api-url" class="block text-sm font-medium text-stone-900">' +
          'Apps Script web app address</label>' +
        '<p class="mt-0.5 mb-3 text-sm text-stone-500">' +
          'In the Apps Script editor: <strong>Deploy → Manage deployments</strong>, and copy ' +
          'the Web app URL. It ends in <code>/exec</code>.</p>' +

        UI.input('api-url', Api.apiUrl().indexOf('PASTE_YOUR') === 0 ? '' : Api.apiUrl(),
          { id: 'api-url', type: 'url', autocomplete: 'off',
            placeholder: 'https://script.google.com/macros/s/…/exec' }) +

        '<div class="mt-3 flex flex-wrap gap-2">' +
          UI.button('Connect', { action: 'save-api-url', id: 'save-api-url' }) +
        '</div>' +

        '<p class="mt-3 text-xs text-stone-500">' +
          'Saved on this device only. Anyone else opening the app uses whatever is in ' +
          'config.js, so put it there too when you get to a computer.</p>');
  }

  return {
    screens: screens,
    actions: {},                  // filled in by the screen files

    get data() { return data; },
    get route() { return current; },

    start: start, go: go, render: render, refresh: refresh, handleError: handleError,
    showUnlock: showUnlock, onRefresh: onRefresh, onNavigate: onNavigate,
    clearSnapshot: clearSnapshot,

    items: items, itemById: itemById, activeItems: activeItems,
    topLevelItems: topLevelItems, childrenOf: childrenOf,
    events: events, eventById: eventById, topLevelEvents: topLevelEvents,
    subEventsOf: subEventsOf, eventPath: eventPath, eventOptions: eventOptions,
    topLevelEventsSorted: topLevelEventsSorted, subEventsSorted: subEventsSorted,
    isArchivedEvent: isArchivedEvent, byEventDate: byEventDate,
    eventHasItemsOut: eventHasItemsOut,
    activeCentres: activeCentres, activeTypes: activeTypes, activeGrades: activeGrades,
    itemsOut: itemsOut, overdueItems: overdueItems,
    availabilityState: availabilityState, conflictsFor: conflictsFor,
    isFreeBetween: isFreeBetween, kitAvailability: kitAvailability,
    lastName: lastName, rememberName: rememberName
  };
})();

/**
 * Save the web app address typed on the "not connected" screen.
 *
 * Registered out here rather than inside the module because App.actions only
 * exists once the module has returned.
 */
App.actions['save-api-url'] = function (button) {
  var field = document.getElementById('api-url');
  var restore = UI.busy(button, 'Connecting…');

  try {
    Api.setApiUrl(field ? field.value : '');
  } catch (e) {
    restore();
    UI.toast(e.message, 'error');
    return;
  }

  // A full reload rather than a re-render: the app has already failed to
  // start, and restarting it cleanly is more predictable than patching it
  // back to life from the middle.
  window.location.reload();
};

/* ---------------- the "More" screen (mobile only) ------------------ */

App.screens.more = function () {
  var links = [
    { href: '#/events', icon: '📅', title: 'Events',
      text: 'Mahotsavs, sabhas and their sub-events.' },
    { href: '#/onloan', icon: '📋', title: 'Out on loan',
      text: 'Everything that is out, as a list you can print.' },
    { href: '#/labels', icon: '🏷', title: 'Print labels',
      text: 'Make a sheet of QR stickers for new instruments.' },
    { href: '#/scan', icon: '📷', title: 'Scan a sticker',
      text: 'Point the camera at any instrument to see what to do with it.' },
    { href: '#/settings', icon: '⚙️', title: 'Settings',
      text: 'Centres, instrument types, quality grades and the access code.' }
  ];

  return UI.pageTitle('More') +
    '<div class="space-y-3">' +
    links.map(function (l) {
      return '<a href="' + l.href + '" class="flex items-center gap-4 rounded-2xl bg-white p-5 ' +
        'shadow-sm ring-1 ring-stone-900/5 transition hover:bg-stone-50">' +
        '<span class="text-2xl" aria-hidden="true">' + l.icon + '</span>' +
        '<span class="min-w-0"><span class="block font-semibold text-stone-900">' +
        UI.esc(l.title) + '</span>' +
        '<span class="block text-sm text-stone-500">' + UI.esc(l.text) + '</span></span>' +
        '<span class="ml-auto text-stone-300" aria-hidden="true">›</span></a>';
    }).join('') +
    '</div>' +
    '<p class="mt-8 text-center text-xs text-stone-400">' +
    UI.esc(CONFIG.APP_NAME) + ' · ' + UI.esc(CONFIG.ORGANISATION) + '</p>';
};

document.addEventListener('DOMContentLoaded', function () { App.start(); });
