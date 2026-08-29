/**
 * Instrument Tracker — Home, Give out, Take back, Events, Settings.
 */

(function () {
  'use strict';

  /** Date maths on 'YYYY-MM-DD' strings via UTC — no clocks, no BST surprises. */
  function addDays(iso, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /* ================================================================
   * Creating an event without leaving the screen you are on
   * ================================================================
   *
   * A request often arrives for something that is not in the app yet. Making
   * someone abandon a half-filled check-out, go to Events, create it, and come
   * back is how instruments end up logged against the wrong event — so both
   * the check-out and allocate screens can create one in place.
   */

  var NEW_EVENT = '__new__';

  /**
   * Returns a complaint about a pair of event dates, or '' if they are fine.
   *
   * Checked in the browser as well as on the server so the volunteer finds out
   * while the dialog is still open, rather than after a round trip.
   */
  function checkEventDates(start, end) {
    start = String(start || '').trim();
    end = String(end || '').trim();
    if (!start || !end) return '';
    if (end < start) {
      return 'The end date (' + UI.dayMonth(end) + ') is before the start date (' +
             UI.dayMonth(start) + ')';
    }
    return '';
  }

  /**
   * Keeps a start/end date pair honest as it is typed: the end picker can never
   * be set earlier than the start, and moving the start forward drags the end
   * with it.
   */
  function linkDatePair(startEl, endEl) {
    if (!startEl || !endEl) return;
    function sync() {
      if (startEl.value) endEl.min = startEl.value;
      if (startEl.value && endEl.value && endEl.value < startEl.value) {
        endEl.value = startEl.value;
      }
    }
    startEl.addEventListener('change', sync);
    endEl.addEventListener('change', sync);
    sync();
  }

  /** Event dropdown options with a "create one" entry pinned to the bottom. */
  function eventOptionsWithNew() {
    return App.eventOptions().concat([
      { value: NEW_EVENT, label: '＋ Create a new event or sub-event…' }
    ]);
  }

  /**
   * Opens the create-event dialog. Resolves to the new event_id, or null if
   * the volunteer backed out.
   */
  async function createEventInline() {
    var parents = App.topLevelEvents()
      .filter(function (e) { return e.status !== 'cancelled'; })
      .map(function (e) { return { value: e.event_id, label: e.name }; });

    var result = await UI.dialog({
      title: 'New event',
      message: 'Add it now and it will be selected for you.',
      html:
        '<div class="mt-4 space-y-3 text-left">' +
          UI.field('Event name',
            '<input type="text" data-dialog-field="name" autofocus ' +
              'placeholder="e.g. Diwali Annakut" class="' + UI.INPUT_CLASS + '">') +

          UI.field('Part of a bigger event?',
            UI.select('parent', parents, '', {
              placeholder: 'No — this is a top-level event',
              attrs: 'data-dialog-field="parent_event_id"'
            }),
            'Choose a parent to make this a sub-event, like Nagar Yatra under ' +
            'Paris Mandir Mahotsav.') +

          '<div class="grid grid-cols-2 gap-3">' +
            UI.field('Starts',
              '<input type="date" data-dialog-field="start_date" value="' +
                UI.esc(App.data.today) + '" class="' + UI.INPUT_CLASS + '">') +
            UI.field('Ends',
              '<input type="date" data-dialog-field="end_date" value="' +
                UI.esc(App.data.today) + '" class="' + UI.INPUT_CLASS + '">') +
          '</div>' +

          UI.field('Location',
            '<input type="text" data-dialog-field="location" ' +
              'placeholder="Optional" class="' + UI.INPUT_CLASS + '">') +

          UI.field('Centre',
            UI.select('centre', App.activeCentres(), '', {
              placeholder: 'Optional',
              attrs: 'data-dialog-field="centre"'
            }),
            'Leave blank for a mandir-wide event that is not tied to one centre.') +
        '</div>',
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: 'Create event', value: 'create', variant: 'primary' }
      ],
      onOpen: function (host) {
        linkDatePair(host.querySelector('[data-dialog-field="start_date"]'),
                     host.querySelector('[data-dialog-field="end_date"]'));
      }
    });

    if (result.value !== 'create') return null;

    var name = (result.fields.name || '').trim();
    if (!name) {
      UI.toast('The event needs a name', 'error');
      return null;
    }
    var dateProblem = checkEventDates(result.fields.start_date, result.fields.end_date);
    if (dateProblem) {
      UI.toast(dateProblem, 'error');
      return null;
    }

    try {
      var saved = await Api.saveEvent({
        name: name,
        parent_event_id: result.fields.parent_event_id || '',
        start_date: result.fields.start_date || '',
        end_date: result.fields.end_date || result.fields.start_date || '',
        location: result.fields.location || '',
        centre: result.fields.centre || '',
        status: 'planned'
      });
      await App.refresh({ showSpinner: false });
      UI.toast('Created ' + name, 'success');
      return saved.event.event_id;
    } catch (e) {
      App.handleError(e);
      return null;
    }
  }

  /**
   * Wires an event <select> so picking "create a new one" opens the dialog and
   * then selects whatever was created. `onChange` fires for real selections too.
   */
  function bindEventSelect(selectId, onChange) {
    var el = document.getElementById(selectId);
    if (!el) return;

    var previous = el.value;
    el.addEventListener('change', async function () {
      if (el.value !== NEW_EVENT) {
        previous = el.value;
        if (onChange) onChange(el.value);
        return;
      }

      el.value = previous;                       // don't leave the sentinel selected
      var newId = await createEventInline();
      if (!newId) return;

      // App.refresh() re-rendered the screen, so re-find the element.
      var fresh = document.getElementById(selectId);
      if (fresh) {
        fresh.value = newId;
        fresh.dispatchEvent(new Event('change'));
      }
    });
  }

  /* ================================================================
   * Shared list building
   * ================================================================ */

  /**
   * Rolls a flat list of items into one row per set.
   *
   * Six rows for a tabla set is six rows of noise — a volunteer wants to see
   * "Tabla Set A, 6 pieces" and open it only if something looks wrong. Pieces
   * that went out on their own stay as their own rows, because that genuinely
   * is a separate thing being out.
   */
  function groupKits(list) {
    var byId = {};
    list.forEach(function (i) { byId[i.asset_id] = true; });

    var rows = [];
    var index = {};

    list.forEach(function (item) {
      var via = item.live && item.live.via_parent_asset_id;

      if (via && byId[via]) {
        if (!index[via]) {
          index[via] = { parent: null, children: [], key: via };
          rows.push(index[via]);
        }
        index[via].children.push(item);
        return;
      }

      if (!index[item.asset_id]) {
        index[item.asset_id] = { parent: item, children: [], key: item.asset_id };
        rows.push(index[item.asset_id]);
      } else {
        index[item.asset_id].parent = item;
      }
    });

    return rows.filter(function (r) { return r.parent || r.children.length; });
  }

  function whereLine(live) {
    return [live.centre, [live.event_name, live.sub_event_name].filter(Boolean).join(' / ')]
      .filter(Boolean).join(' — ');
  }

  /** A small number-and-label card. Used on the event page. */
  function tile(label, value, opts) {
    opts = opts || {};
    return '<div class="flex flex-col rounded-2xl p-4 text-left shadow-sm ring-1 ' +
      (opts.cardClass || 'bg-white ring-stone-900/5') + '">' +
      '<span class="text-3xl font-bold tracking-tight ' +
        (opts.valueClass || 'text-stone-900') + '">' + value + '</span>' +
      '<span class="mt-1 flex items-center gap-1.5 text-sm font-medium text-stone-500">' +
        (opts.dot ? '<span class="h-2 w-2 rounded-full ' + opts.dot + '"></span>' : '') +
        UI.esc(label) + '</span>' +
    '</div>';
  }

  /** One instrument, as a tappable row. */
  function outRow(item, opts) {
    opts = opts || {};
    var live = item.live;
    var late = live.days_overdue > 0;

    return '<a href="#/item/' + encodeURIComponent(item.asset_id) + '" ' +
      'class="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-stone-50 ' +
      (opts.nested ? 'pl-9 ' : '') + '">' +
      '<span class="min-w-0 flex-1">' +
        '<span class="block truncate text-sm font-medium text-stone-800">' +
          UI.esc(item.name) + '</span>' +
        '<span class="block truncate font-mono text-xs text-stone-400">' +
          UI.esc(item.asset_id) +
          (opts.showWhere ? ' · ' + UI.esc(whereLine(live)) : '') + '</span>' +
      '</span>' +
      (late
        ? '<span class="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold ' +
          'text-red-800">' + UI.esc(UI.daysLate(live.days_overdue)) + '</span>'
        : '<span class="shrink-0 text-xs text-stone-500">back by ' +
          UI.esc(UI.dayMonth(live.expected_return_date)) + '</span>') +
    '</a>';
  }

  /** A set as one collapsible row with its pieces nested inside. */
  function kitRow(row, opts) {
    if (!row.children.length) return outRow(row.parent, opts);

    var parent = row.parent;
    var late = row.children.filter(function (c) { return c.live.days_overdue > 0; }).length +
               (parent && parent.live.days_overdue > 0 ? 1 : 0);
    var total = row.children.length + (parent ? 1 : 0);
    var live = parent ? parent.live : row.children[0].live;

    return '<details class="rounded-xl">' +
      '<summary class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ' +
        'transition hover:bg-stone-50">' +
        '<span class="text-base" aria-hidden="true">🎒</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block truncate text-sm font-medium text-stone-800">' +
            UI.esc(parent ? parent.name : row.key) + '</span>' +
          '<span class="block truncate text-xs text-stone-400">' +
            UI.plural(total, 'piece') +
            (late ? ' · ' + late + ' late' : '') +
            (opts && opts.showWhere ? ' · ' + UI.esc(whereLine(live)) : '') + '</span>' +
        '</span>' +
        (live.days_overdue > 0
          ? '<span class="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold ' +
            'text-red-800">' + UI.esc(UI.daysLate(live.days_overdue)) + '</span>'
          : '<span class="shrink-0 text-xs text-stone-500">back by ' +
            UI.esc(UI.dayMonth(live.expected_return_date)) + '</span>') +
        '<svg class="chevron h-4 w-4 shrink-0 text-stone-400 transition-transform" fill="none" ' +
          'viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>' +
        '</svg>' +
      '</summary>' +
      '<div class="border-l-2 border-stone-100 pb-1">' +
        (parent ? outRow(parent, { nested: true }) : '') +
        row.children.map(function (c) { return outRow(c, { nested: true }); }).join('') +
      '</div>' +
    '</details>';
  }

  /**
   * A collapsible section with its own scroll area.
   *
   * The scroll cap matters: with sixty instruments out for a mahotsav, an
   * uncapped list buries everything below it and the page never ends.
   */
  function collapsibleSection(opts) {
    return '<details id="' + opts.id + '" class="mb-4 overflow-hidden rounded-2xl bg-white ' +
      'shadow-sm ring-1 ' + (opts.ring || 'ring-stone-900/5') + '"' +
      (opts.open ? ' open' : '') + '>' +
      '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5 ' +
        (opts.summaryClass || '') + '">' +
        (opts.dot ? '<span class="h-2.5 w-2.5 shrink-0 rounded-full ' + opts.dot +
                    '" aria-hidden="true"></span>' : '') +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-base font-semibold ' + (opts.titleClass || 'text-stone-900') +
            '">' + UI.esc(opts.title) + '</span>' +
          (opts.subtitle
            ? '<span class="block text-sm ' + (opts.subtitleClass || 'text-stone-500') + '">' +
              UI.esc(opts.subtitle) + '</span>'
            : '') +
        '</span>' +
        '<span class="shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ' +
          (opts.countClass || 'bg-stone-100 text-stone-700') + '">' + opts.count + '</span>' +
        '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" fill="none" ' +
          'viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>' +
        '</svg>' +
      '</summary>' +
      '<div class="max-h-[26rem] overflow-y-auto overscroll-contain border-t ' +
        (opts.divider || 'border-stone-100') + ' px-2 py-1.5">' +
        opts.body +
      '</div>' +
    '</details>';
  }

  /* ================================================================
   * Camera
   * ================================================================ */

  var lastCode = '', lastCodeAt = 0, stopCamera = null;

  /*
   * Which screen the running camera belongs to.
   *
   * This used to be an exemption list of hashes that were allowed to keep the
   * camera — and #/give was on it, for the scanner panel inside the flow. So
   * routing from the Scan screen to #/give matched the exemption, the detect
   * loop was never stopped, and it kept firing four times a second into a
   * video element that was no longer on the page. Owning it by screen is
   * unambiguous: a different screen means release it.
   */
  var cameraOwner = null;

  function releaseCamera() {
    if (stopCamera) stopCamera();
    stopCamera = null;
    cameraOwner = null;
    // Let the next scan of the same sticker through immediately.
    lastCode = '';
    lastCodeAt = 0;
  }

  function scanFeedback(ok) {
    if (navigator.vibrate) navigator.vibrate(ok ? 40 : [40, 60, 40]);
  }

  /**
   * Camera start-up, in preference order:
   *   1. BarcodeDetector — built into Chrome/Edge/Android, nothing to download.
   *   2. html5-qrcode from a CDN — covers iOS Safari and Firefox.
   * If both fail the typing box is still there, and it is the same code path,
   * so scanning is never the only way in.
   */
  async function startCamera(onCode) {
    var video = document.getElementById('scan-video');
    var fallbackHost = document.getElementById('qr-reader');
    var statusEl = document.getElementById('scan-status');
    if (!video) return function () {};

    function setStatus(text) { if (statusEl) statusEl.textContent = text; }

    if (window.BarcodeDetector) {
      try {
        var formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.indexOf('qr_code') !== -1) {
          var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          var stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }
          });
          video.srcObject = stream;
          video.classList.remove('hidden');
          await video.play();
          setStatus('Point the camera at the QR sticker');

          var running = true;
          (function loop() {
            if (!running) return;
            detector.detect(video)
              .then(function (codes) {
                if (codes && codes.length) onCode(codes[0].rawValue);
              })
              .catch(function () { /* a frame that could not be read is normal */ })
              .then(function () { if (running) setTimeout(loop, 250); });
          })();

          return function () {
            running = false;
            stream.getTracks().forEach(function (t) { t.stop(); });
            video.srcObject = null;
          };
        }
      } catch (e) {
        console.warn('BarcodeDetector unavailable:', e);
      }
    }

    try {
      setStatus('Starting camera…');
      await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
      fallbackHost.classList.remove('hidden');

      var scanner = new window.Html5Qrcode('qr-reader', { verbose: false });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        function (text) { onCode(text); },
        function () { /* per-frame misses are not worth reporting */ }
      );
      setStatus('Point the camera at the QR sticker');

      return function () {
        scanner.stop().then(function () { scanner.clear(); }).catch(function () {});
      };
    } catch (e) {
      console.warn('Camera unavailable:', e);
      setStatus('');
      var panel = document.getElementById('scan-camera-panel');
      if (panel) {
        panel.innerHTML =
          '<div class="p-6 text-center text-sm text-stone-300">' +
            '<p class="text-2xl" aria-hidden="true">📷</p>' +
            '<p class="mt-2 font-medium text-white">The camera could not start</p>' +
            '<p class="mt-1">Allow camera access, or type the ID below — it works the same.</p>' +
          '</div>';
      }
      return function () {};
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the scanner.')); };
      document.head.appendChild(s);
    });
  }

  /** Turn whatever was scanned or typed into an item, or explain why not. */
  async function resolveCode(rawCode) {
    var code = String(rawCode || '').trim();
    if (!code) return null;

    // The camera fires many times a second at the same sticker.
    var now = Date.now();
    if (code === lastCode && now - lastCodeAt < 2500) return null;
    lastCode = code;
    lastCodeAt = now;

    var item = App.itemById(code.toUpperCase());
    if (item) return item;

    try {
      var resolved = await Api.resolve(code);
      return App.itemById(resolved.asset_id);
    } catch (e) {
      scanFeedback(false);
      UI.toast(e.message || 'That sticker was not recognised.', 'error');
      return null;
    }
  }

  /** Release the camera the moment we are on a different screen than started it. */
  window.addEventListener('hashchange', function () {
    if (!stopCamera) return;
    var screen = (window.location.hash || '#/').replace(/^#\//, '').split('/')[0] || 'dashboard';
    if (screen !== cameraOwner) releaseCamera();
  });

  /** The camera panel plus its typing box — shared by both flows. */
  function scannerPanel(placeholder) {
    return '<details class="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm ' +
      'ring-1 ring-stone-900/5">' +
      '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
        '<span class="text-lg" aria-hidden="true">📷</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-semibold text-stone-900">Scan a sticker</span>' +
          '<span class="block text-xs text-stone-500">Or type the ID printed under it</span>' +
        '</span>' +
        '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" fill="none" ' +
          'viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/>' +
        '</svg>' +
      '</summary>' +
      '<div class="border-t border-stone-100 p-3">' +
        '<div id="scan-camera-panel" class="relative mb-3 aspect-[4/3] overflow-hidden ' +
          'rounded-xl bg-stone-900">' +
          '<video id="scan-video" class="scanner-video hidden" playsinline muted></video>' +
          '<div id="qr-reader" class="hidden h-full w-full"></div>' +
          '<div class="scanner-reticle"></div>' +
        '</div>' +
        '<p id="scan-status" class="mb-3 text-center text-xs text-stone-500"></p>' +
        '<form id="manual-form" class="flex gap-2">' +
          '<input type="text" id="manual-code" placeholder="' + UI.esc(placeholder) + '" ' +
            'autocapitalize="characters" autocomplete="off" spellcheck="false" ' +
            'class="' + UI.INPUT_CLASS + ' py-2.5 font-mono text-sm">' +
          UI.button('Add', { type: 'submit', variant: 'secondary' }) +
        '</form>' +
      '</div>' +
    '</details>';
  }

  /** Starts the camera if the volunteer opened the scanner panel. */
  function wireScanner(onItem) {
    var form = document.getElementById('manual-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var input = document.getElementById('manual-code');
      var item = await resolveCode(input.value);
      input.value = '';
      input.focus();
      if (item) onItem(item);
    });

    var panel = form.closest('details');
    panel.addEventListener('toggle', async function () {
      if (panel.open && !stopCamera) {
        cameraOwner = App.route.name;
        stopCamera = await startCamera(async function (code) {
          var item = await resolveCode(code);
          if (item) onItem(item);
        });
      } else if (!panel.open && stopCamera) {
        releaseCamera();
      }
    });
  }

  /* ================================================================
   * Step header, shared by both flows
   * ================================================================ */

  function stepHeader(title, step, total, backAction) {
    return '<div class="mb-4">' +
      '<div class="mb-3 flex items-center gap-3">' +
        (backAction
          ? '<button type="button" data-action="' + backAction + '" ' +
            'class="rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 ' +
            'hover:bg-stone-100 hover:text-stone-900">← Back</button>'
          : '<a href="#/" class="rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 ' +
            'hover:bg-stone-100 hover:text-stone-900">← Home</a>') +
        '<span class="ml-auto text-xs font-medium text-stone-400">Step ' + step +
          ' of ' + total + '</span>' +
      '</div>' +
      '<div class="mb-4 flex gap-1.5">' +
        [1, 2, 3].slice(0, total).map(function (n) {
          return '<span class="h-1.5 flex-1 rounded-full ' +
            (n <= step ? 'bg-saffron-500' : 'bg-stone-200') + '"></span>';
        }).join('') +
      '</div>' +
      '<h1 class="text-2xl font-bold tracking-tight text-stone-900">' + UI.esc(title) + '</h1>' +
    '</div>';
  }

  /* ================================================================
   * HOME
   * ================================================================
   * Two things a volunteer does, as two buttons. Everything else is
   * what needs attention today, and nothing else.
   */

  function actionButton(opts) {
    return '<a href="' + opts.href + '" class="flex items-center gap-4 rounded-2xl ' +
      opts.classes + ' p-5 shadow-sm transition hover:shadow-md active:scale-[.99]">' +
      '<span class="text-3xl" aria-hidden="true">' + opts.icon + '</span>' +
      '<span class="min-w-0 flex-1">' +
        '<span class="block text-lg font-bold">' + UI.esc(opts.title) + '</span>' +
        '<span class="block text-sm opacity-80">' + UI.esc(opts.subtitle) + '</span>' +
      '</span>' +
      '<svg class="h-5 w-5 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" ' +
        'stroke-width="2.5" stroke="currentColor" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/>' +
      '</svg>' +
    '</a>';
  }

  /* ================================================================
   * What is on loan, as a sheet of paper
   * ================================================================
   *
   * The app is the record; this is for the situations where a screen is not
   * enough — walking the store room counting what is missing, handing a list
   * to someone driving to Paris, or putting a copy in the file after a
   * mahotsav. So it is deliberately a plain table with a tick column, not a
   * prettier version of the dashboard.
   */

  /** One row per instrument out, flattened and sorted the way you read it. */
  function loanRows() {
    return App.itemsOut().map(function (item) {
      var live = item.live || {};
      return {
        item: item,
        name: item.name,
        asset_id: item.asset_id,
        event: [live.event_name, live.sub_event_name].filter(Boolean).join(' / ') || 'No event',
        centre: live.centre || '',
        who: live.checked_out_by || '',
        due: live.expected_return_date || '',
        late: live.days_overdue || 0,
        via: live.via_parent_asset_id || ''
      };
    }).sort(function (a, b) {
      // Late first, then by when it is due, then by name — the order you would
      // work down the page chasing things.
      if ((b.late > 0) !== (a.late > 0)) return b.late - a.late;
      if (a.due !== b.due) return (a.due || '9999').localeCompare(b.due || '9999');
      return a.name.localeCompare(b.name);
    });
  }

  App.screens.onloan = function () {
    var rows = loanRows();
    var late = rows.filter(function (r) { return r.late > 0; }).length;

    if (!rows.length) {
      return UI.pageTitle('Out on loan', 'Everything is in the store.') +
        UI.emptyState('📦', 'Nothing is out',
          'When instruments are given out they will be listed here, ready to print.',
          UI.button('Give out instruments', { href: '#/give' }));
    }

    // Grouped by event, because that is how anything gets chased or returned.
    var byEvent = {};
    rows.forEach(function (r) {
      if (!byEvent[r.event]) byEvent[r.event] = [];
      byEvent[r.event].push(r);
    });
    var events = Object.keys(byEvent).sort();

    var tables = events.map(function (name) {
      return '<section class="loan-group mb-6">' +
        '<h2 class="mb-2 text-sm font-semibold text-stone-900">' + UI.esc(name) +
          ' <span class="font-normal text-stone-500">· ' +
          UI.plural(byEvent[name].length, 'instrument') + '</span></h2>' +

        '<table class="loan-table w-full border-collapse text-sm">' +
          '<thead>' +
            '<tr class="border-b border-stone-300 text-left text-xs uppercase ' +
              'tracking-wide text-stone-500">' +
              '<th class="w-8 py-1.5 pr-2">✓</th>' +
              '<th class="py-1.5 pr-2">Instrument</th>' +
              '<th class="py-1.5 pr-2">ID</th>' +
              '<th class="py-1.5 pr-2">Centre</th>' +
              '<th class="py-1.5 pr-2">Responsible</th>' +
              '<th class="py-1.5 pr-2">Back by</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            byEvent[name].map(function (r) {
              return '<tr class="border-b border-stone-100 align-top">' +
                '<td class="py-1.5 pr-2"><span class="tickbox"></span></td>' +
                '<td class="py-1.5 pr-2 font-medium text-stone-900">' + UI.esc(r.name) +
                  (r.via ? ' <span class="text-xs text-stone-500">(with ' +
                    UI.esc(r.via) + ')</span>' : '') + '</td>' +
                '<td class="py-1.5 pr-2 font-mono text-xs text-stone-500">' +
                  UI.esc(r.asset_id) + '</td>' +
                '<td class="py-1.5 pr-2 text-stone-600">' + UI.esc(r.centre || '—') + '</td>' +
                '<td class="py-1.5 pr-2 text-stone-600">' + UI.esc(r.who || '—') + '</td>' +
                '<td class="py-1.5 pr-2 ' +
                  (r.late > 0 ? 'font-semibold text-red-700' : 'text-stone-600') + '">' +
                  UI.esc(UI.dayMonth(r.due) || '—') +
                  (r.late > 0 ? ' · ' + UI.esc(UI.daysLate(r.late)) : '') + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>' +
      '</section>';
    }).join('');

    return '<div class="no-print">' +
        UI.pageTitle('Out on loan',
          UI.plural(rows.length, 'instrument') + ' out across ' +
          UI.plural(events.length, 'event') +
          (late ? ' · ' + late + ' late back' : '')) +
        '<div class="mb-5 flex flex-wrap gap-2">' +
          UI.button('🖨 Print this list', { action: 'onloan-print' }) +
          UI.button('Back to home', { href: '#/', variant: 'secondary' }) +
        '</div>' +
      '</div>' +

      // Everything below is what actually lands on paper. The wrapper carries
      // the named page and the fallback padding — see css/app.css.
      '<div class="loan-sheet">' +

        // Hidden on screen: the page title above already says all of it.
        '<div class="print-only mb-4">' +
          '<h1 class="text-lg font-bold">Instruments on loan</h1>' +
          '<p class="text-xs">' + UI.esc(UI.fullDate(App.data.today)) + ' · ' +
            UI.plural(rows.length, 'instrument') + ' out' +
            (late ? ' · ' + late + ' late back' : '') + '</p>' +
        '</div>' +

        tables +

        '<p class="print-only mt-4 text-xs">' +
          'Printed from Instrument Tracker. The app is the record — mark this sheet up, ' +
          'then put the returns through Take back.</p>' +
      '</div>';
  };

  App.actions['onloan-print'] = function () { window.print(); };

  /* ================================================================
   * Tidy up old records
   * ================================================================
   *
   * Deliberately here rather than in the Apps Script editor. Asking a karyakar
   * to open a code editor to keep their own app quick is not a real option, and
   * it is the sort of thing that then never gets done.
   *
   * It is also deliberately not automatic. Moving hundreds of rows is the kind
   * of thing somebody should press a button for, having read what it will do.
   */
  var tidyPreview = null;      // { live, eligible, remaining, keep_days }

  App.onRefresh(function () { tidyPreview = null; });

  App.screens.tidy = function () {
    return UI.pageTitle('Tidy up old records',
        'The app reads every loan ever made each time it opens. Moving finished ones out ' +
        'of the way keeps it quick as the years go by.') +

      UI.card(
        '<p class="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">' +
          '<strong>This happens on its own.</strong> Loans that finished over a year ago are ' +
          'moved out of the way automatically, a little at a time, while the app is used. ' +
          'You do not need to come here at all — this page is only if you want to see it or ' +
          'get it over with now.</p>' +

        '<h2 class="mt-4 text-base font-semibold text-stone-900">What it does</h2>' +
        '<ul class="mt-2 space-y-1.5 text-sm text-stone-600">' +
          '<li>✓ Moves loans that <strong>finished over a year ago</strong> into a separate ' +
            'list.</li>' +
          '<li>✓ <strong>Nothing is deleted.</strong> Every instrument still shows its full ' +
            'history, and every event still shows what went to it.</li>' +
          '<li>✓ Anything <strong>still out</strong> stays put, however old it is.</li>' +
        '</ul>' +

        (tidyPreview
          ? '<div class="mt-4 rounded-xl bg-stone-50 p-3 text-sm">' +
              (tidyPreview.eligible
                ? '<p class="font-semibold text-stone-900">' +
                    UI.plural(tidyPreview.eligible, 'finished loan') + ' can be moved.</p>' +
                  '<p class="mt-0.5 text-stone-600">' +
                    tidyPreview.remaining + ' of ' + tidyPreview.live +
                    ' would stay — everything from the last year, and everything still out.</p>'
                : '<p class="font-semibold text-stone-900">Nothing needs moving yet.</p>' +
                  '<p class="mt-0.5 text-stone-600">All ' + tidyPreview.live +
                    ' loans are either recent or still out. Come back in a year or so.</p>') +
            '</div>'
          : '') +

        '<div class="mt-4 flex flex-wrap gap-2">' +
          (tidyPreview && tidyPreview.eligible
            ? UI.button('Move ' + tidyPreview.eligible + ' old loans', { action: 'tidy-run' })
            : UI.button('Check what can be moved',
                { action: 'tidy-check', id: 'tidy-check' })) +
          UI.button('Back', { href: '#/more', variant: 'secondary' }) +
        '</div>') +

      '<p class="mt-4 px-1 text-xs text-stone-400">' +
        'Old records are moved into a MovementsArchive tab in the same Google Sheet. That tab ' +
        'is only created once there is something to put in it.</p>';
  };

  App.actions['tidy-check'] = async function (button) {
    var restore = UI.busy(button, 'Checking…');
    try {
      tidyPreview = await Api.archiveMovements({ preview: true });
      App.render();
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  App.actions['tidy-run'] = async function (button) {
    var count = tidyPreview ? tidyPreview.eligible : 0;

    var yes = await UI.confirm(
      'Move ' + UI.plural(count, 'old loan') + '?',
      'They go into a separate list in the same Google Sheet. Nothing is deleted, and every ' +
      'instrument keeps showing its full history in the app.',
      'Move them');
    if (!yes) return;

    var restore = UI.busy(button, 'Moving…');
    try {
      var result = await Api.archiveMovements({});
      tidyPreview = null;
      UI.toast('Moved ' + UI.plural(result.archived, 'old loan') + ' out of the way', 'success');
      await App.refresh({ showSpinner: false });
      App.go('#/more');
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  App.screens.dashboard = function () {
    var items = App.activeItems();
    var out = App.itemsOut();
    var overdue = App.overdueItems();
    var available = items.filter(function (i) { return i.status === 'available'; }).length;
    var maintenance = items.filter(function (i) { return i.status === 'maintenance'; }).length;

    // Everything out, grouped by the event it went to.
    var byEvent = {};
    out.forEach(function (item) {
      var key = item.live.sub_event_id || item.live.event_id || '';
      if (!byEvent[key]) {
        byEvent[key] = {
          name: [item.live.event_name, item.live.sub_event_name].filter(Boolean).join(' / ') ||
                'No event',
          top_event_id: item.live.event_id,
          items: []
        };
      }
      byEvent[key].items.push(item);
    });
    var groups = Object.keys(byEvent).map(function (k) { return byEvent[k]; })
      .sort(function (a, b) { return b.items.length - a.items.length; });

    var booked = (App.data.openAllocations || []).length;

    return '<div class="mb-6">' +
        '<h1 class="text-2xl font-bold tracking-tight text-stone-900">Instrument Tracker</h1>' +
        '<p class="mt-1 text-sm text-stone-500">' + UI.esc(UI.fullDate(App.data.today)) + '</p>' +
      '</div>' +

      // --- the two things anyone actually comes here to do ---
      '<div class="mb-6 grid gap-3 sm:grid-cols-2">' +
        actionButton({
          href: '#/give', icon: '📤', title: 'Give out instruments',
          subtitle: 'Someone is taking them, or booking ahead',
          classes: 'bg-saffron-600 text-white'
        }) +
        actionButton({
          href: '#/back', icon: '📥', title: 'Take instruments back',
          subtitle: out.length ? UI.plural(out.length, 'instrument') + ' out now' : 'Nothing is out',
          classes: 'bg-white text-stone-900 ring-1 ring-stone-900/5'
        }) +
      '</div>' +

      // --- what is on the shelf right now, for the three types anyone asks
      //     about. Three, not thirteen: a glance, not a report. ---
      availabilityStrip() +

      // --- one quiet line instead of five tiles ---
      '<p class="mb-5 px-1 text-sm text-stone-500">' +
        '<a href="#/inventory" class="font-semibold text-stone-700 underline-offset-2 ' +
          'hover:underline">' + available + ' in the store</a>' +
        ' · ' + (out.length
          ? '<a href="#/onloan" class="underline-offset-2 hover:underline">' +
            out.length + ' out</a>'
          : '0 out') +
        (booked ? ' · ' + booked + ' booked ahead' : '') +
        (maintenance
          ? ' · <a href="#/inventory" data-action="show-maintenance" ' +
            'class="underline-offset-2 hover:underline">' + maintenance + ' needing repair</a>'
          : '') +
      '</p>' +

      // --- late things, first, because that is what needs doing ---
      (overdue.length
        ? collapsibleSection({
            id: 'overdue-section',
            open: true,
            title: 'Late back',
            subtitle: 'Should have been returned by now',
            count: overdue.length,
            dot: 'bg-red-500',
            ring: 'ring-red-600/20',
            summaryClass: 'bg-red-50/60 hover:bg-red-50',
            titleClass: 'text-red-900',
            subtitleClass: 'text-red-700/80',
            countClass: 'bg-red-600 text-white',
            divider: 'border-red-100',
            body: groupKits(overdue).map(function (row) {
              return kitRow(row, { showWhere: true });
            }).join('')
          })
        : '') +

      // --- everything out, by event ---
      (out.length
        ? collapsibleSection({
            id: 'out-section',
            open: !overdue.length,
            title: 'Out now',
            subtitle: UI.plural(groups.length, 'event'),
            count: out.length,
            dot: 'bg-blue-500',
            countClass: 'bg-blue-100 text-blue-800',
            body: groups.map(function (g) {
              var late = g.items.filter(function (i) { return i.live.days_overdue > 0; }).length;
              return '<details class="mb-1 rounded-xl" open>' +
                '<summary class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ' +
                  'transition hover:bg-stone-50">' +
                  '<span class="min-w-0 flex-1">' +
                    '<span class="block truncate text-sm font-semibold text-stone-900">' +
                      UI.esc(g.name) + '</span>' +
                    '<span class="block text-xs text-stone-500">' +
                      UI.plural(g.items.length, 'instrument') +
                      (late ? ' · ' + late + ' late' : '') + '</span>' +
                  '</span>' +
                  (g.top_event_id
                    ? '<a href="#/event/' + encodeURIComponent(g.top_event_id) + '" ' +
                      'class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ' +
                      'text-saffron-700 hover:bg-saffron-50">Open</a>'
                    : '') +
                '</summary>' +
                '<div class="border-l-2 border-stone-100 pb-1 pl-1">' +
                  groupKits(g.items).map(function (row) { return kitRow(row); }).join('') +
                '</div>' +
              '</details>';
            }).join('')
          })
        : UI.emptyState('✅', 'Everything is in the store',
            'Nothing is out at the moment.')) +

      // --- booked ahead, if any ---
      (booked ? bookedAheadSection() : '');
  };

  /**
   * "3 tablas, 5 harmoniums, 2 keyboards free."
   *
   * Deliberately only these three. They are what centres actually ring up
   * about, and a strip of thirteen numbers is a report rather than a glance.
   * Sets count as one — nobody asks for half a tabla set.
   */
  var HEADLINE_TYPES = [
    { type: 'Tabla', label: 'Tablas', icon: '🥁' },
    { type: 'Harmonium', label: 'Harmoniums', icon: '🪗' },
    { type: 'Keyboard', label: 'Keyboards', icon: '🎹' }
  ];

  function availabilityStrip() {
    var cells = HEADLINE_TYPES.map(function (entry) {
      var all = App.topLevelItems().filter(function (i) {
        return i.instrument_type === entry.type;
      });
      var free = all.filter(function (i) { return i.status === 'available'; }).length;
      if (!all.length) return '';

      return '<a href="#/inventory" data-action="show-type" data-value="' + entry.type + '" ' +
        'class="flex flex-1 flex-col items-center rounded-2xl bg-white px-2 py-3 shadow-sm ' +
        'ring-1 ring-stone-900/5 transition hover:shadow-md">' +
        '<span class="text-xl" aria-hidden="true">' + entry.icon + '</span>' +
        '<span class="mt-1 text-2xl font-bold tracking-tight ' +
          (free ? 'text-emerald-700' : 'text-stone-400') + '">' + free + '</span>' +
        '<span class="text-xs font-medium text-stone-500">' + entry.label + ' free</span>' +
        '<span class="text-[0.65rem] text-stone-400">of ' + all.length + '</span>' +
      '</a>';
    }).filter(Boolean).join('');

    return cells ? '<div class="mb-4 flex gap-2">' + cells + '</div>' : '';
  }

  App.actions['show-type'] = function (button) {
    App.setInventoryFilter({ type: button.dataset.value });
    App.go('#/inventory');
  };

  App.actions['show-maintenance'] = function () {
    App.setInventoryFilter({ status: 'maintenance' });
    App.go('#/inventory');
  };

  /** Things promised to an event but not yet collected. */
  function bookedAheadSection() {
    var rows = (App.data.openAllocations || []).slice().sort(function (a, b) {
      return String(a.needed_from).localeCompare(String(b.needed_from));
    });

    var byEvent = {};
    var order = [];
    rows.forEach(function (a) {
      if (!byEvent[a.event_id]) {
        byEvent[a.event_id] = { name: a.event_name || 'No event', rows: [], from: a.needed_from };
        order.push(a.event_id);
      }
      byEvent[a.event_id].rows.push(a);
    });

    return collapsibleSection({
      id: 'booked-section',
      open: false,
      title: 'Booked ahead',
      subtitle: 'Promised, but not collected yet',
      count: rows.length,
      dot: 'bg-amber-500',
      countClass: 'bg-amber-100 text-amber-800',
      body: order.map(function (id) {
        var g = byEvent[id];
        var ids = g.rows.map(function (r) { return r.allocation_id; }).join(',');
        var window = g.rows[0];

        return '<div class="mb-1 rounded-xl px-3 py-2.5">' +
          '<div class="flex items-center gap-3">' +
            '<span class="min-w-0 flex-1">' +
              '<span class="block truncate text-sm font-semibold text-stone-900">' +
                UI.esc(g.name) + '</span>' +
              '<span class="block text-xs text-stone-500">' +
                UI.plural(g.rows.length, 'instrument') +
                (window.needed_from
                  ? ' · ' + UI.esc(UI.dayMonth(window.needed_from)) +
                    (window.expected_return_date &&
                     window.expected_return_date !== window.needed_from
                      ? ' – ' + UI.esc(UI.dayMonth(window.expected_return_date)) : '')
                  : '') +
                (window.allocated_by ? ' · ' + UI.esc(window.allocated_by) : '') +
              '</span>' +
            '</span>' +
          '</div>' +

          '<p class="mt-1 truncate text-xs text-stone-400">' +
            UI.esc(g.rows.map(function (r) { return r.name || r.asset_id; }).join(', ')) +
          '</p>' +

          '<div class="mt-2 flex flex-wrap gap-1.5">' +
            '<button type="button" data-action="booking-hand-over" ' +
              'data-value="' + UI.esc(ids) + '" ' +
              'class="rounded-lg bg-saffron-50 px-2.5 py-1.5 text-xs ' +
              'font-semibold text-saffron-800 hover:bg-saffron-100">Hand over</button>' +
            '<button type="button" data-action="booking-edit" data-value="' + UI.esc(ids) + '" ' +
              'class="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 ' +
              'hover:bg-stone-100">Change dates</button>' +
            '<button type="button" data-action="booking-cancel" data-value="' + UI.esc(ids) + '" ' +
              'class="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 ' +
              'hover:bg-red-50">Cancel</button>' +
          '</div>' +
        '</div>';
      }).join('')
    });
  }

  /* ---------------- editing and cancelling a booking --------------- */

  function bookingRows(idsCsv) {
    var wanted = {};
    idsCsv.split(',').forEach(function (id) { wanted[id] = true; });
    return (App.data.openAllocations || []).filter(function (a) {
      return wanted[a.allocation_id];
    });
  }

  /**
   * Hand over: drop the booking straight into the Give out flow.
   *
   * Everything the booking already knows — instruments, event, dates, who is
   * responsible — is carried across, so collecting a booking is a confirm
   * rather than a re-entry. Re-typing it invites a typo that silently detaches
   * the collection from the booking it settles.
   */
  App.actions['booking-hand-over'] = function (button) {
    var rows = bookingRows(button.dataset.value);
    if (!rows.length) return;
    var first = rows[0];

    var g = resetGive();
    g.when = 'now';                       // they are here, collecting
    g.event_id = first.event_id || '';
    g.centre = first.centre || '';
    g.to = first.expected_return_date || g.to;
    g.name = first.allocated_by || g.name;
    g.notes = first.notes || '';
    g.fromBooking = rows.map(function (r) { return r.allocation_id; });

    // Only the top-level items are ticked: pieces of a set come with the set,
    // and ticking both would double-count on the confirm screen.
    rows.forEach(function (r) {
      var item = App.itemById(r.asset_id);
      if (item && !item.parent_asset_id) g.chosen[r.asset_id] = true;
    });
    // A booking made up only of pieces still has to select something.
    if (!Object.keys(g.chosen).length) {
      rows.forEach(function (r) { g.chosen[r.asset_id] = true; });
    }

    g.step = 3;                           // straight to the summary
    App.go('#/give');
    UI.toast('Booking loaded — check and confirm', 'success');
  };

  App.actions['booking-edit'] = async function (button) {
    var rows = bookingRows(button.dataset.value);
    if (!rows.length) return;
    var first = rows[0];

    var result = await UI.dialog({
      title: 'Change this booking',
      message: UI.plural(rows.length, 'instrument') + ' for ' +
               (first.event_name || 'this event') + '.',
      html:
        '<div class="mt-4 space-y-3 text-left">' +
          '<div class="grid grid-cols-2 gap-3">' +
            UI.field('Needed from',
              '<input type="date" data-dialog-field="needed_from" value="' +
                UI.esc(first.needed_from || '') + '" class="' + UI.INPUT_CLASS + '">') +
            UI.field('Back by',
              '<input type="date" data-dialog-field="expected_return_date" value="' +
                UI.esc(first.expected_return_date || '') + '" class="' + UI.INPUT_CLASS + '">') +
          '</div>' +
          UI.field('Event',
            UI.select('event', App.eventOptions(), first.event_id,
              { attrs: 'data-dialog-field="event_id"' })) +
          UI.field('Person responsible',
            '<input type="text" data-dialog-field="allocated_by" value="' +
              UI.esc(first.allocated_by || '') + '" class="' + UI.INPUT_CLASS + '">') +
          UI.field('Notes',
            '<input type="text" data-dialog-field="notes" value="' +
              UI.esc(first.notes || '') + '" class="' + UI.INPUT_CLASS + '">') +
          '<p class="text-xs text-stone-500">Moving the dates re-checks that every ' +
            'instrument is still free — you will be told if one is not.</p>' +
        '</div>',
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: 'Save changes', value: 'save', variant: 'primary' }
      ],
      onOpen: function (host) {
        linkDatePair(host.querySelector('[data-dialog-field="needed_from"]'),
                     host.querySelector('[data-dialog-field="expected_return_date"]'));
      }
    });
    if (result.value !== 'save') return;

    var problem = checkEventDates(result.fields.needed_from,
                                  result.fields.expected_return_date);
    if (problem) { UI.toast(problem.replace('end date', 'return date'), 'error'); return; }

    try {
      await Api.updateAllocation({
        allocation_ids: rows.map(function (r) { return r.allocation_id; }),
        event_id: result.fields.event_id || first.event_id,
        needed_from: result.fields.needed_from,
        expected_return_date: result.fields.expected_return_date,
        allocated_by: result.fields.allocated_by,
        notes: result.fields.notes
      });
      eventCache = { id: null, data: null };
      UI.toast('Booking updated', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      if (e.code === 'NOT_AVAILABLE') {
        UI.dialog({
          title: 'Not free for those dates',
          message: e.message,
          buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
        });
      } else {
        App.handleError(e);
      }
    }
  };

  App.actions['booking-cancel'] = async function (button) {
    var rows = bookingRows(button.dataset.value);
    if (!rows.length) return;

    var confirmed = await UI.confirm(
      'Cancel this booking?',
      UI.plural(rows.length, 'instrument') + ' held for ' +
      (rows[0].event_name || 'this event') + ' will be freed up for anyone else to use. ' +
      'Nothing has gone out yet, so there is no history to keep.',
      'Cancel booking', true);
    if (!confirmed) return;

    var restore = UI.busy(button, 'Cancelling…');
    try {
      await Api.cancelAllocation({
        allocation_ids: rows.map(function (r) { return r.allocation_id; })
      });
      eventCache = { id: null, data: null };
      UI.toast('Booking cancelled', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  /* ================================================================
   * GIVE OUT — one flow for "taking them now" and "booking ahead"
   * ================================================================
   *
   * These used to be two screens, Allocate and Check out, which asked
   * almost identical questions. A volunteer does not think in those
   * terms — they think "someone wants instruments". So it is one flow,
   * and the only difference is one question near the start.
   *
   * Order matters: WHEN comes before WHICH, because whether an
   * instrument is free depends entirely on the dates.
   */

  var give = null;

  function resetGive() {
    give = {
      step: 1,
      when: 'now',              // 'now' = taking them today, 'later' = booking ahead
      event_id: '',
      centre: '',
      from: App.data.today,
      to: addDays(App.data.today, 7),
      name: App.lastName(),
      notes: '',
      chosen: {},
      q: '',
      showUnavailable: false,
      photos: {},          // asset_id -> Drive link, all optional on the way out
      fromBooking: null    // allocation ids this give-out settles, if any
    };
    return give;
  }

  function giveState() { return give || resetGive(); }

  function giveChosenIds() {
    var g = giveState();
    return Object.keys(g.chosen).filter(function (k) { return g.chosen[k]; });
  }

  App.screens.give = function () {
    var g = giveState();
    if (g.step === 2) return giveStepItems();
    if (g.step === 3) return giveStepConfirm();
    return giveStepWhen();
  };

  /*
   * The basket, reachable from outside.
   *
   * The flow keeps its state in a closure, which is right — nothing else
   * should be writing to it. But that also made the middle of the flow
   * untestable: every screen test could only ever render step 1. This is the
   * one seam, deliberately read/write and deliberately named, so a test can
   * put the flow at step 2 or 3 and check what a volunteer would actually see.
   */
  App.screens.give.state = giveState;

  /*
   * The instrument picker draws itself into #give-list rather than being
   * returned by the screen, so rendering the screen alone only ever produced
   * the empty shell — the list every volunteer actually reads was never once
   * exercised by a test. Exposing the renderer closes that hole.
   */
  App.screens.give.renderList = renderGiveList;

  App.screens.give.mount = function () {
    var g = giveState();
    if (g.step === 1) return mountGiveWhen();
    if (g.step === 2) return mountGiveItems();
    return mountGiveConfirm();
  };

  /* ---------------- step 1: when and where ------------------------ */

  function giveStepWhen() {
    var g = giveState();
    var takingNow = g.when === 'now';

    var alreadyChosen = giveChosenIds().map(App.itemById).filter(Boolean);

    return stepHeader('Who is taking them?', 1, 3) +

      /*
       * Anything already scanned or picked, shown here on step 1.
       *
       * Without this a volunteer who scanned a sticker landed on a form with
       * no sign the scan had registered — so they scanned again, and again.
       * Step 1 asks about the event, but it still has to acknowledge what is
       * in the basket.
       */
      (alreadyChosen.length
        ? '<div class="mb-4 rounded-2xl bg-saffron-50 p-3 ring-1 ring-saffron-200">' +
            '<p class="mb-2 text-sm font-semibold text-saffron-900">' +
              UI.plural(alreadyChosen.length, 'instrument') + ' ready to go out</p>' +
            '<div class="flex flex-wrap gap-1.5">' +
              alreadyChosen.map(function (item) {
                return '<span class="inline-flex items-center gap-1.5 rounded-lg bg-white ' +
                  'px-2.5 py-1 text-xs font-medium text-stone-700 ring-1 ring-stone-200">' +
                  UI.esc(item.name) +
                  '<button type="button" data-action="give-drop" ' +
                    'data-value="' + UI.esc(item.asset_id) + '" ' +
                    'class="text-stone-400 hover:text-red-600" ' +
                    'aria-label="Remove ' + UI.esc(item.name) + '">\u00d7</button>' +
                '</span>';
              }).join('') +
            '</div>' +
            '<p class="mt-2 text-xs text-saffron-800">' +
              'Answer the questions below, then you can add more on the next step.</p>' +
          '</div>'
        : '') +

      UI.card(
        '<div class="space-y-5">' +

          // The one question that used to be two whole screens.
          '<fieldset>' +
            '<legend class="mb-2 text-sm font-medium text-stone-700">When are they going?</legend>' +
            '<div class="grid gap-2 sm:grid-cols-2">' +
              [['now', '📤', 'Taking them now', 'They are here to collect'],
               ['later', '📅', 'Booking ahead', 'Collecting on a later date']
              ].map(function (o) {
                var active = g.when === o[0];
                return '<button type="button" data-action="give-when" data-value="' + o[0] + '" ' +
                  'class="flex items-start gap-3 rounded-xl p-3.5 text-left transition ' +
                  (active
                    ? 'bg-saffron-50 ring-2 ring-saffron-500'
                    : 'bg-white ring-1 ring-stone-200 hover:bg-stone-50') + '">' +
                  '<span class="text-xl" aria-hidden="true">' + o[1] + '</span>' +
                  '<span class="min-w-0">' +
                    '<span class="block text-sm font-semibold ' +
                      (active ? 'text-saffron-900' : 'text-stone-900') + '">' + o[2] + '</span>' +
                    '<span class="block text-xs text-stone-500">' + o[3] + '</span>' +
                  '</span>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</fieldset>' +

          UI.field('Which event?',
            UI.select('give-event', eventOptionsWithNew(), g.event_id,
              { placeholder: 'Choose an event', id: 'give-event' })) +

          (takingNow
            ? UI.field('When should they come back?',
                UI.input('give-to', g.to, { type: 'date', id: 'give-to' }))
            : '<div class="grid grid-cols-2 gap-3">' +
                UI.field('Needed from',
                  UI.input('give-from', g.from, { type: 'date', id: 'give-from' })) +
                UI.field('Back by',
                  UI.input('give-to', g.to, { type: 'date', id: 'give-to' })) +
              '</div>') +

          UI.field('Who is responsible?',
            UI.input('give-name', g.name, { id: 'give-name', placeholder: 'Your name' }),
            'The karyakar answerable for getting these back.') +

          '<details class="rounded-xl bg-stone-50 p-3">' +
            '<summary class="cursor-pointer text-sm font-medium text-stone-600">' +
              'Centre and notes (optional)</summary>' +
            '<div class="mt-3 space-y-3">' +
              UI.field('Centre',
                UI.select('give-centre', App.activeCentres(), g.centre,
                  { placeholder: 'Taken from the event', id: 'give-centre' })) +
              UI.field('Notes',
                UI.textarea('give-notes', g.notes,
                  { id: 'give-notes', rows: 2, placeholder: 'e.g. requested by email 6 Aug' })) +
            '</div>' +
          '</details>' +
        '</div>') +

      '<div class="mt-4 pb-8">' +
        UI.button('Next — choose instruments',
          { action: 'give-next-1', id: 'give-next', class: 'w-full' }) +
      '</div>';
  }

  function mountGiveWhen() {
    var g = giveState();

    // "Booking ahead" shows both dates; keep them in order as they are picked.
    linkDatePair(document.getElementById('give-from'), document.getElementById('give-to'));

    bindEventSelect('give-event', function (eventId) {
      g.event_id = eventId;
      var ev = App.eventById(eventId);
      if (!ev) return;
      // An event with its own dates fills the window in for you.
      if (g.when === 'later' && ev.start_date) {
        g.from = ev.start_date;
        var el = document.getElementById('give-from');
        if (el) el.value = ev.start_date;
      }
      if (ev.end_date) {
        g.to = ev.end_date;
        document.getElementById('give-to').value = ev.end_date;
      }
      if (!g.centre && ev.centre) {
        g.centre = ev.centre;
        document.getElementById('give-centre').value = ev.centre;
      }
    });
  }

  App.actions['give-drop'] = function (button) {
    delete giveState().chosen[button.dataset.value];
    readGiveForm();
    App.render();
  };

  App.actions['give-when'] = function (button) {
    var g = giveState();
    g.when = button.dataset.value;
    if (g.when === 'now') g.from = App.data.today;
    readGiveForm();
    App.render();
  };

  /** Pulls whatever is on screen into state, so nothing is lost on re-render. */
  function readGiveForm() {
    var g = giveState();
    var pick = function (id) {
      var el = document.getElementById(id);
      return el ? el.value : null;
    };
    var v;
    if ((v = pick('give-event')) !== null && v !== '__new__') g.event_id = v;
    if ((v = pick('give-centre')) !== null) g.centre = v;
    if ((v = pick('give-from')) !== null) g.from = v;
    if ((v = pick('give-to')) !== null) g.to = v;
    if ((v = pick('give-name')) !== null) g.name = v;
    if ((v = pick('give-notes')) !== null) g.notes = v;
  }

  App.actions['give-next-1'] = function () {
    readGiveForm();
    var g = giveState();

    if (!g.event_id) { UI.toast('Choose an event', 'error'); return; }
    if (!g.to) { UI.toast('Set the date they should come back', 'error'); return; }
    if (!g.name.trim()) { UI.toast('Enter who is responsible', 'error'); return; }
    if (g.when === 'now') g.from = App.data.today;
    if (g.from && g.to && g.to < g.from) {
      UI.toast('The return date is before the date they are needed', 'error');
      return;
    }

    g.step = 2;
    App.render();
    window.scrollTo(0, 0);
  };

  /* ---------------- step 2: which instruments --------------------- */

  /**
   * Instruments grouped by type — harmoniums, tablas, keyboards — because
   * that is how a volunteer searches a store room. Each category collapses,
   * and each set counts as one line inside its category.
   */
  function giveCategories() {
    var g = giveState();
    var needle = g.q.toLowerCase();

    var rows = App.topLevelItems()
      .filter(function (i) {
        if (!needle) return true;
        return (i.name + ' ' + i.asset_id + ' ' + i.instrument_type)
          .toLowerCase().indexOf(needle) !== -1;
      })
      .map(function (item) {
        // g.event_id so a set already out to this mahotsav shows as usable
        // for its sub-events, instead of demanding a pointless return trip.
        var avail = App.kitAvailability(item.asset_id, g.from, g.to, null, g.event_id);
        return {
          item: item,
          available: avail.available,
          conflicts: avail.conflicts,
          busyChildren: avail.busyChildren
        };
      });

    var byType = {};
    var order = [];
    rows.forEach(function (row) {
      var type = row.item.instrument_type || 'Other';
      if (!byType[type]) { byType[type] = []; order.push(type); }
      byType[type].push(row);
    });

    // Categories in the order Settings lists them, so it is stable and
    // matches the order of the dropdowns everywhere else.
    var typeOrder = App.activeTypes().map(function (t) { return t.name; });
    order.sort(function (a, b) {
      var ia = typeOrder.indexOf(a), ib = typeOrder.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    return order.map(function (type) { return { type: type, rows: byType[type] }; });
  }

  /**
   * The instrument's own note, shown wherever it is about to be handed over.
   *
   * A note like "tabla skin is thin — no hard playing" or "belongs to Ramesh"
   * is written once in the inventory and is worth nothing if it only lives
   * there. The moment it matters is the moment somebody is picking the
   * instrument up, so it follows the instrument through the whole Give out
   * flow: the picker, the set pieces, and the final summary.
   *
   * `size` is 'full' in the list and 'tight' where space is short.
   */
  function itemNote(item, size) {
    var note = item && String(item.notes || '').trim();
    if (!note) return '';

    if (size === 'tight') {
      return '<span class="ml-1 text-amber-700" title="' + UI.esc(note) + '">📌</span>';
    }
    return '<span class="mt-1 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1 ' +
      'text-xs text-amber-900">' +
      '<span class="shrink-0" aria-hidden="true">📌</span>' +
      '<span class="min-w-0">' + UI.esc(note) + '</span>' +
    '</span>';
  }

  function giveStepItems() {
    var g = giveState();
    var ev = App.eventById(g.event_id);

    return stepHeader('Which instruments?', 2, 3, 'give-back-1') +

      '<p class="mb-4 rounded-xl bg-stone-100 px-3.5 py-2.5 text-sm text-stone-600">' +
        UI.esc(ev ? App.eventPath(g.event_id) : 'No event') + ' · ' +
        (g.when === 'now'
          ? 'going out today, back by ' + UI.esc(UI.dayMonth(g.to))
          : UI.esc(UI.dayMonth(g.from)) + ' to ' + UI.esc(UI.dayMonth(g.to))) +
      '</p>' +

      scannerPanel('Type an ID, e.g. TAB-014') +

      '<input type="search" id="give-q" value="' + UI.esc(g.q) + '" ' +
        'placeholder="Search instruments…" class="' + UI.INPUT_CLASS + ' mb-3">' +

      '<div id="give-list" class="space-y-2"></div>' +

      // Sticky footer so the count and the next step are always reachable.
      '<div class="sticky bottom-20 z-20 mt-4 rounded-2xl bg-white/95 p-3 shadow-lg ' +
        'ring-1 ring-stone-900/5 backdrop-blur md:bottom-4">' +
        '<p id="give-count" class="mb-2 text-center text-sm text-stone-500"></p>' +
        UI.button('Next', { action: 'give-next-2', id: 'give-next-2', class: 'w-full',
                            disabled: true }) +
      '</div>' +
      '<div class="pb-8"></div>';
  }

  function renderGiveList() {
    var host = document.getElementById('give-list');
    if (!host) return;
    var g = giveState();

    var categories = giveCategories();
    var allRows = categories.reduce(function (n, c) { return n.concat(c.rows); }, []);
    var free = allRows.filter(function (r) { return r.available; });
    var taken = allRows.filter(function (r) { return !r.available; });

    // Drop anything the dates have just made impossible.
    var dropped = [];
    taken.forEach(function (r) {
      if (g.chosen[r.item.asset_id]) {
        delete g.chosen[r.item.asset_id];
        dropped.push(r.item.name);
      }
    });
    if (dropped.length) UI.toast(dropped.join(', ') + ' is no longer free', 'error');

    if (!allRows.length) {
      host.innerHTML = '<p class="rounded-2xl border-2 border-dashed border-stone-200 px-4 ' +
        'py-10 text-center text-sm text-stone-500">Nothing matches that search.</p>';
      updateGiveCount();
      return;
    }

    host.innerHTML = categories.map(function (cat) {
      var catFree = cat.rows.filter(function (r) { return r.available; });
      var shown = g.showUnavailable ? cat.rows : catFree;
      if (!shown.length) return '';

      var chosenHere = cat.rows.filter(function (r) {
        return g.chosen[r.item.asset_id];
      }).length;

      // Open the category when it has a selection or when a search narrowed
      // things down — otherwise start closed so the page stays short.
      var open = chosenHere > 0 || !!g.q || categories.length === 1;

      return '<details class="overflow-hidden rounded-2xl bg-white shadow-sm ' +
        'ring-1 ring-stone-900/5"' + (open ? ' open' : '') + '>' +
        '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-sm font-semibold text-stone-900">' +
              UI.esc(cat.type) + '</span>' +
            '<span class="block text-xs text-stone-500">' +
              catFree.length + ' available' +
              (chosenHere ? ' · ' + chosenHere + ' chosen' : '') + '</span>' +
          '</span>' +
          (chosenHere
            ? '<span class="shrink-0 rounded-full bg-saffron-600 px-2.5 py-1 text-xs ' +
              'font-bold text-white">' + chosenHere + '</span>'
            : '') +
          '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" ' +
            'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
            'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
            'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
        '</summary>' +
        '<div class="border-t border-stone-100">' +
          shown.map(giveItemRow).join('') +
        '</div>' +
      '</details>';
    }).join('') +

    (taken.length
      ? '<button type="button" data-action="give-toggle-unavailable" ' +
        'class="w-full rounded-xl px-3 py-2.5 text-sm font-medium text-stone-500 ' +
        'hover:bg-stone-100">' +
        (g.showUnavailable ? 'Hide' : 'Show') + ' ' + taken.length +
        ' unavailable</button>'
      : '');

    updateGiveCount();
  }

  function giveItemRow(row) {
    var g = giveState();
    var item = row.item;
    var kids = item.is_kit ? App.childrenOf(item.asset_id) : [];
    var picked = !!g.chosen[item.asset_id];

    if (!row.available) {
      return '<div class="flex items-start gap-3 border-b border-stone-100 px-4 py-3 ' +
        'last:border-0 opacity-70">' +
        '<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ' +
          'bg-stone-100 text-stone-400" aria-hidden="true">✕</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-medium text-stone-500 line-through">' +
            UI.esc(item.name) + '</span>' +
          '<span class="mt-0.5 block text-xs font-medium text-red-700">' +
            UI.esc(row.conflicts[0].reason) + '</span>' +
        '</span>' +
      '</div>';
    }

    var g = giveState();
    var piecesChosen = kids.filter(function (k) { return g.chosen[k.asset_id]; }).length;

    return '<div class="border-b border-stone-100 last:border-0">' +
      '<label class="flex cursor-pointer items-start gap-3 px-4 py-3 transition ' +
        (picked ? 'bg-saffron-50' : 'hover:bg-stone-50') + '">' +

        '<input type="checkbox" data-action="give-toggle" ' +
          'data-value="' + UI.esc(item.asset_id) + '" ' + (picked ? 'checked ' : '') +
          'class="mt-0.5 h-6 w-6 shrink-0 rounded-md border-stone-300 text-saffron-600 ' +
          'focus:ring-saffron-500">' +

        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-medium ' +
            (picked ? 'text-saffron-900' : 'text-stone-900') + '">' +
            UI.esc(item.name) + '</span>' +
          '<span class="block font-mono text-xs text-stone-400">' + UI.esc(item.asset_id) +
            (kids.length ? ' · whole set of ' + (kids.length + 1) : '') + '</span>' +

          (row.busyChildren.length
            ? '<span class="mt-1 block rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">' +
              'Without ' +
              UI.esc(row.busyChildren.map(function (b) { return b.item.name; }).join(', ')) +
              '</span>'
            : '') +

          itemNote(item) +
        '</span>' +

        (picked
          ? '<span class="shrink-0 self-center text-xs font-semibold text-saffron-700">✓</span>'
          : '') +
      '</label>' +

      /*
       * Breaking a set open.
       *
       * Sometimes only the dayyu is wanted. Ticking the set sends everything;
       * this lets single pieces go instead, leaving the rest on the shelf.
       * Hidden behind a summary because taking the whole set is the normal
       * case and should stay the one-tap one.
       */
      (kids.length && !picked
        ? '<details class="bg-stone-50/60"' + (piecesChosen ? ' open' : '') + '>' +
            '<summary class="flex cursor-pointer items-center gap-2 py-2 pl-12 pr-4 ' +
              'text-xs font-medium text-stone-500 hover:text-stone-800">' +
              '<span>' +
                (piecesChosen
                  ? piecesChosen + ' of ' + kids.length + ' pieces chosen'
                  : 'Or take single pieces') + '</span>' +
              '<svg class="chevron h-3.5 w-3.5 transition-transform" fill="none" ' +
                'viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" ' +
                'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
                'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
            '</summary>' +
            '<div>' + kids.map(function (kid) {
              var free = App.isFreeBetween(kid.asset_id, g.from, g.to, null, g.event_id);
              var kidPicked = !!g.chosen[kid.asset_id];

              if (!free) {
                var why = App.conflictsFor(kid.asset_id, g.from, g.to, null, g.event_id)[0];
                return '<div class="flex items-center gap-3 py-2 pl-14 pr-4 opacity-60">' +
                  '<span class="text-xs text-stone-400" aria-hidden="true">✕</span>' +
                  '<span class="min-w-0 flex-1 text-xs text-stone-500 line-through">' +
                    UI.esc(kid.name) + '</span>' +
                  '<span class="shrink-0 text-xs text-red-700">' +
                    UI.esc(why ? why.reason : 'Not free') + '</span>' +
                '</div>';
              }

              return '<label class="flex cursor-pointer items-center gap-3 py-2 pl-14 pr-4 ' +
                (kidPicked ? 'bg-saffron-50' : 'hover:bg-stone-100') + '">' +
                '<input type="checkbox" data-action="give-toggle" ' +
                  'data-value="' + UI.esc(kid.asset_id) + '" ' + (kidPicked ? 'checked ' : '') +
                  'class="h-5 w-5 shrink-0 rounded-md border-stone-300 text-saffron-600 ' +
                  'focus:ring-saffron-500">' +
                '<span class="min-w-0 flex-1">' +
                  '<span class="block truncate text-xs font-medium ' +
                    (kidPicked ? 'text-saffron-900' : 'text-stone-700') + '">' +
                    UI.esc(kid.name) + itemNote(kid, 'tight') + '</span>' +
                  '<span class="block font-mono text-[0.65rem] text-stone-400">' +
                    UI.esc(kid.asset_id) + '</span>' +
                '</span>' +
              '</label>';
            }).join('') + '</div>' +
          '</details>'
        : '') +
    '</div>';
  }

  function updateGiveCount() {
    var chosen = giveChosenIds();
    var pieces = 0;
    chosen.forEach(function (id) {
      pieces += 1;
      var item = App.itemById(id);
      if (item && item.is_kit) pieces += App.childrenOf(id).length;
    });

    var el = document.getElementById('give-count');
    if (el) {
      el.textContent = chosen.length
        ? UI.plural(chosen.length, 'item') + ' chosen' +
          (pieces !== chosen.length ? ' · ' + pieces + ' pieces in total' : '')
        : 'Nothing chosen yet';
      el.className = chosen.length
        ? 'mb-2 text-center text-sm font-semibold text-saffron-800'
        : 'mb-2 text-center text-sm text-stone-500';
    }
    var next = document.getElementById('give-next-2');
    if (next) next.disabled = !chosen.length;
  }

  function mountGiveItems() {
    var g = giveState();

    var search = document.getElementById('give-q');
    search.addEventListener('input', function () {
      g.q = search.value;
      renderGiveList();
    });

    wireScanner(function (item) {
      // Scanning a piece of a set selects the set — that is what is going out.
      var target = item.parent_asset_id ? App.itemById(item.parent_asset_id) : item;
      if (!target) return;

      if (!App.isFreeBetween(target.asset_id, g.from, g.to, null, g.event_id)) {
        scanFeedback(false);
        UI.toast(target.name + ' is not free for these dates', 'error');
        return;
      }
      g.chosen[target.asset_id] = true;
      scanFeedback(true);
      UI.toast('Added ' + target.name, 'success');

      // Scanning is the one moment the volunteer is holding the instrument and
      // not reading the list, so a note has to come to them. Given longer on
      // screen than an ordinary confirmation, because it is the whole point.
      var note = String((target.notes || '')).trim();
      if (note) UI.toast('📌 ' + target.name + ': ' + note, 'info', 9000);

      renderGiveList();
    });

    renderGiveList();
  }

  App.actions['give-toggle'] = function (input) {
    giveState().chosen[input.dataset.value] = input.checked;
    renderGiveList();
  };

  App.actions['give-toggle-unavailable'] = function () {
    var g = giveState();
    g.showUnavailable = !g.showUnavailable;
    renderGiveList();
  };

  App.actions['give-back-1'] = function () {
    giveState().step = 1;
    App.render();
    window.scrollTo(0, 0);
  };

  App.actions['give-next-2'] = function () {
    if (!giveChosenIds().length) { UI.toast('Choose at least one instrument', 'error'); return; }
    giveState().step = 3;
    App.render();
    window.scrollTo(0, 0);
  };

  /* ---------------- step 3: check and confirm --------------------- */

  function giveStepConfirm() {
    var g = giveState();
    var chosen = giveChosenIds().map(App.itemById).filter(Boolean);
    var takingNow = g.when === 'now';

    var lines = chosen.map(function (item) {
      var kids = item.is_kit ? App.childrenOf(item.asset_id) : [];
      var going = kids.filter(function (k) {
        return App.isFreeBetween(k.asset_id, g.from, g.to, null, g.event_id);
      });

      if (!kids.length) {
        return '<li class="flex items-start gap-3 border-b border-stone-100 px-4 py-3 ' +
          'last:border-0">' +
          '<span class="text-base" aria-hidden="true">🎵</span>' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-sm font-medium text-stone-800">' +
              UI.esc(item.name) + '</span>' +
            itemNote(item) +
          '</span>' +
          '<span class="shrink-0 font-mono text-xs text-stone-400">' +
            UI.esc(item.asset_id) + '</span>' +
        '</li>';
      }

      return '<li class="border-b border-stone-100 last:border-0">' +
        '<details>' +
          '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3">' +
            '<span class="text-base" aria-hidden="true">🎒</span>' +
            '<span class="min-w-0 flex-1">' +
              '<span class="block text-sm font-medium text-stone-800">' +
                UI.esc(item.name) + '</span>' +
              '<span class="block text-xs text-stone-500">' +
                UI.plural(going.length + 1, 'piece') + ' going' +
                (going.length < kids.length
                  ? ' · ' + (kids.length - going.length) + ' left behind'
                  : '') + '</span>' +
              itemNote(item) +
            '</span>' +
            '<svg class="chevron h-4 w-4 shrink-0 text-stone-400 transition-transform" ' +
              'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
              'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
              'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
          '</summary>' +
          '<ul class="border-l-2 border-stone-100 pb-2 pl-4">' +
            kids.map(function (k) {
              var ok = going.indexOf(k) !== -1;
              return '<li class="flex items-center gap-2 py-1 text-xs ' +
                (ok ? 'text-stone-600' : 'text-stone-400 line-through') + '">' +
                '<span aria-hidden="true">' + (ok ? '•' : '✕') + '</span>' +
                UI.esc(k.name) + (ok ? itemNote(k, 'tight') : '') + '</li>';
            }).join('') +
          '</ul>' +
        '</details>' +
      '</li>';
    }).join('');

    return stepHeader('Check and confirm', 3, 3, 'give-back-2') +

      UI.card(
        '<dl class="space-y-2.5 text-sm">' +
          confirmRow('Event', App.eventPath(g.event_id)) +
          confirmRow('Centre', g.centre || '—') +
          confirmRow(takingNow ? 'Going out' : 'Needed from',
            takingNow ? 'Today' : UI.dayMonth(g.from)) +
          confirmRow('Back by', UI.dayMonth(g.to)) +
          confirmRow('Responsible', g.name) +
          (g.notes ? confirmRow('Notes', g.notes) : '') +
        '</dl>') +

      '<h2 class="mb-2 mt-5 px-1 text-sm font-semibold text-stone-900">' +
        UI.plural(chosen.length, 'instrument') + '</h2>' +
      '<ul class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">' +
        lines +
      '</ul>' +

      /*
       * Photos on the way out are always optional. They are worth taking for
       * anything valuable or already marked, because a picture of how an
       * instrument left is the other half of the damaged-return argument —
       * but insisting on one for every microphone would make handing over a
       * PA rig unbearable.
       */
      '<details class="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ' +
        'ring-1 ring-stone-900/5"' + (Object.keys(g.photos).length ? ' open' : '') + '>' +
        '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
          '<span class="text-lg" aria-hidden="true">\ud83d\udcf7</span>' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-sm font-semibold text-stone-900">' +
              'Photos before they go (optional)</span>' +
            '<span class="block text-xs text-stone-500">' +
              (Object.keys(g.photos).length
                ? UI.plural(Object.keys(g.photos).length, 'photo') + ' taken'
                : 'Worth doing for anything valuable or already marked') + '</span>' +
          '</span>' +
          '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" ' +
            'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
            'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
            'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
        '</summary>' +
        '<div id="give-photos" class="border-t border-stone-100 p-3">' +
          chosen.map(function (item) {
            return photoField(item, { photo_url: g.photos[item.asset_id] || '' }, {
              kind: 'out',
              required: false,
              hint: 'How ' + item.name + ' looks right now.'
            });
          }).join('') +
        '</div>' +
      '</details>' +

      '<div class="mt-5 pb-8">' +
        UI.button(takingNow ? 'Hand them over' : 'Save the booking',
          { action: 'give-confirm', id: 'give-confirm', class: 'w-full' }) +
        '<p class="mt-2 text-center text-xs text-stone-500">' +
          (takingNow
            ? 'This records them as out, from today.'
            : 'This holds them for these dates. Hand them over from the home screen when ' +
              'they are collected.') +
        '</p>' +
      '</div>';
  }

  function confirmRow(label, value) {
    return '<div class="flex justify-between gap-4">' +
      '<dt class="text-stone-500">' + UI.esc(label) + '</dt>' +
      '<dd class="text-right font-medium text-stone-900">' + UI.esc(value || '—') + '</dd>' +
    '</div>';
  }

  function mountGiveConfirm() {
    var host = document.getElementById('give-photos');
    if (!host) return;
    wirePhotoFields(host, function (assetId, photoUrl) {
      giveState().photos[assetId] = photoUrl;
      App.render();
    });
  }

  App.actions['give-back-2'] = function () {
    giveState().step = 2;
    App.render();
    window.scrollTo(0, 0);
  };

  App.actions['give-confirm'] = async function (button) {
    var g = giveState();
    var ids = giveChosenIds();
    if (!ids.length) return;

    var restore = UI.busy(button, 'Saving…');
    try {
      var result;
      if (g.when === 'now') {
        result = await submitGiveOut({
          asset_ids: ids,
          event_id: g.event_id,
          centre: g.centre,
          expected_return_date: g.to,
          checked_out_by: g.name.trim(),
          photos: g.photos
        });
        if (!result) { restore(); return; }
      } else {
        result = await Api.allocate({
          asset_ids: ids,
          event_id: g.event_id,
          centre: g.centre,
          needed_from: g.from,
          expected_return_date: g.to,
          allocated_by: g.name.trim(),
          notes: g.notes
        });
      }

      App.rememberName(g.name.trim());
      var count = (result.checked_out || result.asset_ids || []).length;
      UI.toast(g.when === 'now'
        ? UI.plural(count, 'instrument') + ' handed over'
        : UI.plural(count, 'instrument') + ' booked', 'success');

      resetGive();
      App.go('#/');
      await App.refresh({ showSpinner: false });

      if (result.warnings && result.warnings.length) {
        UI.dialog({
          title: 'Done, with a note',
          message: 'Some pieces were left behind:',
          html: UI.warningList(result.warnings),
          buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
        });
      }
    } catch (e) {
      if (e.code === 'NOT_AVAILABLE') {
        await UI.dialog({
          title: 'No longer free',
          message: e.message,
          buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
        });
        await App.refresh({ showSpinner: false });
        giveState().step = 2;
        App.render();
      } else {
        App.handleError(e);
      }
      restore();
    }
  };

  /**
   * Handing over, with the rule K3 escape hatch: if a piece of the set is
   * already out on its own the server refuses, and we offer to send the rest.
   */
  async function submitGiveOut(payload) {
    try {
      return await Api.checkout(payload);
    } catch (e) {
      if (e.code !== 'KIT_CHILD_OUT') throw e;
      var go = await UI.confirm('Part of the set is already out', e.message,
                                'Send the rest anyway');
      if (!go) return null;
      return await Api.checkout(Object.assign({}, payload, { allow_partial: true }));
    }
  }

  /* ================================================================
   * TAKE BACK
   * ================================================================ */

  var back = null;

  function resetBack() {
    back = { step: 1, chosen: {}, perItem: {}, q: '', name: App.lastName() };
    return back;
  }

  function backState() { return back || resetBack(); }

  function backChosenIds() {
    var b = backState();
    return Object.keys(b.chosen).filter(function (k) { return b.chosen[k]; });
  }

  /**
   * Everything that can be handed back, grouped by event, with sets kept
   * together as a parent plus its pieces.
   *
   * Pieces are listed individually and can be ticked on their own — a hammer
   * coming back early, or three of six pieces returned while the bag stays at
   * the centre, are both ordinary. Ticking the parent takes the whole set.
   */
  function backGroups() {
    var b = backState();
    var needle = b.q.toLowerCase();

    function matches(item) {
      if (!needle) return true;
      return (item.name + ' ' + item.asset_id).toLowerCase().indexOf(needle) !== -1;
    }

    var out = App.itemsOut();
    var outIds = {};
    out.forEach(function (i) { outIds[i.asset_id] = true; });

    // Build one row per top-level thing; pieces hang off their parent when the
    // parent is out too, and stand alone when it is not.
    var rows = [];
    var byParent = {};

    out.forEach(function (item) {
      var via = item.live.via_parent_asset_id;
      if (via && outIds[via]) {
        (byParent[via] = byParent[via] || []).push(item);
      }
    });

    out.forEach(function (item) {
      var via = item.live.via_parent_asset_id;
      if (via && outIds[via]) return;               // listed under its parent below
      var pieces = byParent[item.asset_id] || [];

      // A set survives the search if the set or any of its pieces matches.
      var keptPieces = pieces.filter(matches);
      if (!matches(item) && !keptPieces.length) return;

      rows.push({
        item: item,
        pieces: matches(item) ? pieces : keptPieces,
        key: item.asset_id
      });
    });

    var byEvent = {};
    var order = [];
    rows.forEach(function (row) {
      var live = row.item.live;
      var key = live.sub_event_id || live.event_id || '';
      var title = [live.event_name, live.sub_event_name].filter(Boolean).join(' / ') ||
                  'No event';
      if (!byEvent[key]) { byEvent[key] = { title: title, rows: [] }; order.push(key); }
      byEvent[key].rows.push(row);
    });
    return order.map(function (k) { return byEvent[k]; });
  }

  /** Every asset id offered by the picker right now, sets and pieces alike. */
  function backSelectableIds() {
    var ids = [];
    backGroups().forEach(function (g) {
      g.rows.forEach(function (row) {
        ids.push(row.item.asset_id);
        row.pieces.forEach(function (p) { ids.push(p.asset_id); });
      });
    });
    return ids;
  }

  App.screens.back = function () {
    return backState().step === 2 ? backStepCheck() : backStepPick();
  };

  App.screens.back.mount = function () {
    return backState().step === 2 ? mountBackCheck() : mountBackPick();
  };

  /* ---------------- step 1: what is coming back ------------------- */

  function backStepPick() {
    var groups = backGroups();

    if (!groups.length && !backState().q) {
      return stepHeader('What is coming back?', 1, 2) +
        UI.emptyState('✅', 'Nothing is out',
          'Everything is in the store right now.',
          UI.button('Back to home', { href: '#/', variant: 'secondary' }));
    }

    return stepHeader('What is coming back?', 1, 2) +

      scannerPanel('Type an ID, e.g. TAB-014') +

      '<input type="search" id="back-q" value="' + UI.esc(backState().q) + '" ' +
        'placeholder="Search what is out…" class="' + UI.INPUT_CLASS + ' mb-3">' +

      '<div id="back-list" class="space-y-2"></div>' +

      '<div class="sticky bottom-20 z-20 mt-4 rounded-2xl bg-white/95 p-3 shadow-lg ' +
        'ring-1 ring-stone-900/5 backdrop-blur md:bottom-4">' +
        '<p id="back-count" class="mb-2 text-center text-sm text-stone-500"></p>' +
        UI.button('Next', { action: 'back-next-1', id: 'back-next-1', class: 'w-full',
                            disabled: true }) +
      '</div>' +
      '<div class="pb-8"></div>';
  }

  function renderBackList() {
    var host = document.getElementById('back-list');
    if (!host) return;
    var b = backState();
    var groups = backGroups();

    if (!groups.length) {
      host.innerHTML = '<p class="rounded-2xl border-2 border-dashed border-stone-200 px-4 ' +
        'py-10 text-center text-sm text-stone-500">Nothing matches that search.</p>';
      updateBackCount();
      return;
    }

    /** One tickable line. Pieces are indented under their set. */
    function line(item, opts) {
      opts = opts || {};
      var picked = !!b.chosen[item.asset_id];
      var late = item.live.days_overdue > 0;

      return '<label class="flex cursor-pointer items-start gap-3 border-b ' +
        'border-stone-100 py-3 pr-4 transition last:border-0 ' +
        (opts.piece ? 'pl-10 ' : 'pl-4 ') +
        (picked ? 'bg-emerald-50' : 'hover:bg-stone-50') + '">' +
        '<input type="checkbox" data-action="back-toggle" ' +
          'data-value="' + UI.esc(item.asset_id) + '" ' + (picked ? 'checked ' : '') +
          'class="mt-0.5 shrink-0 rounded-md border-stone-300 text-emerald-600 ' +
          'focus:ring-emerald-500 ' + (opts.piece ? 'h-5 w-5' : 'h-6 w-6') + '">' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block ' + (opts.piece ? 'text-sm' : 'text-sm font-medium') + ' ' +
            (picked ? 'text-emerald-900' : 'text-stone-900') + '">' +
            UI.esc(item.name) + '</span>' +
          '<span class="block font-mono text-xs text-stone-400">' +
            UI.esc(item.asset_id) + UI.esc(opts.note || '') + '</span>' +
        '</span>' +
        (late
          ? '<span class="shrink-0 self-center rounded-full bg-red-100 px-2 py-0.5 ' +
            'text-xs font-semibold text-red-800">' +
            UI.esc(UI.daysLate(item.live.days_overdue)) + '</span>'
          : '') +
      '</label>';
    }

    host.innerHTML = groups.map(function (group) {
      var ids = [];
      group.rows.forEach(function (row) {
        ids.push(row.item.asset_id);
        row.pieces.forEach(function (p) { ids.push(p.asset_id); });
      });
      var chosenHere = ids.filter(function (id) { return b.chosen[id]; }).length;

      return '<details class="overflow-hidden rounded-2xl bg-white shadow-sm ' +
        'ring-1 ring-stone-900/5" open>' +
        '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-sm font-semibold text-stone-900">' +
              UI.esc(group.title) + '</span>' +
            '<span class="block text-xs text-stone-500">' +
              UI.plural(ids.length, 'instrument') + ' out' +
              (chosenHere ? ' · ' + chosenHere + ' chosen' : '') + '</span>' +
          '</span>' +
          '<button type="button" data-action="back-all-event" ' +
            'data-value="' + UI.esc(ids.join(',')) + '" ' +
            'class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-saffron-700 ' +
            'hover:bg-saffron-50">' +
            (chosenHere === ids.length ? 'Clear' : 'All back') + '</button>' +
          '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" ' +
            'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
            'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
            'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
        '</summary>' +

        '<div class="border-t border-stone-100">' +
          group.rows.map(function (row) {
            if (!row.pieces.length) return line(row.item);

            // A set: the parent line takes everything, and each piece can also
            // be ticked on its own.
            var piecesChosen = row.pieces.filter(function (p) {
              return b.chosen[p.asset_id];
            }).length;

            return '<div class="border-b border-stone-100 last:border-0">' +
              line(row.item, { note: ' · takes all ' + (row.pieces.length + 1) }) +
              '<details class="bg-stone-50/60"' +
                (piecesChosen ? ' open' : '') + '>' +
                '<summary class="flex cursor-pointer items-center gap-2 py-2 pl-10 pr-4 ' +
                  'text-xs font-medium text-stone-500 hover:text-stone-800">' +
                  '<span>' +
                    (piecesChosen
                      ? piecesChosen + ' of ' + row.pieces.length + ' pieces chosen'
                      : 'Or return single pieces') + '</span>' +
                  '<svg class="chevron h-3.5 w-3.5 transition-transform" fill="none" ' +
                    'viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" ' +
                    'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
                    'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
                '</summary>' +
                '<div>' +
                  row.pieces.map(function (p) { return line(p, { piece: true }); }).join('') +
                '</div>' +
              '</details>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</details>';
    }).join('');

    updateBackCount();
  }

  function updateBackCount() {
    var chosen = backChosenIds();
    var el = document.getElementById('back-count');
    if (el) {
      el.textContent = chosen.length
        ? UI.plural(chosen.length, 'item') + ' coming back'
        : 'Nothing chosen yet';
      el.className = chosen.length
        ? 'mb-2 text-center text-sm font-semibold text-emerald-800'
        : 'mb-2 text-center text-sm text-stone-500';
    }
    var next = document.getElementById('back-next-1');
    if (next) next.disabled = !chosen.length;
  }

  function mountBackPick() {
    var b = backState();
    var search = document.getElementById('back-q');
    if (!search) return;

    search.addEventListener('input', function () {
      b.q = search.value;
      renderBackList();
    });

    wireScanner(function (item) {
      // Scan exactly what is in your hand. Scanning the hammer returns the
      // hammer; scanning the bag's own label returns the whole set. Guessing
      // "they must mean the set" is how a single piece coming back early ends
      // up marking five other things as returned.
      if (item.status !== 'checked_out') {
        scanFeedback(false);
        UI.toast(item.name + ' is not out', 'error');
        return;
      }
      b.chosen[item.asset_id] = true;
      scanFeedback(true);

      var parentId = item.live && item.live.via_parent_asset_id;
      var parent = parentId ? App.itemById(parentId) : null;
      UI.toast(parent && parent.status === 'checked_out'
        ? 'Added ' + item.name + ' — just this piece'
        : 'Added ' + item.name, 'success');
      renderBackList();
    });

    renderBackList();
  }

  App.actions['back-toggle'] = function (input) {
    backState().chosen[input.dataset.value] = input.checked;
    renderBackList();
  };

  App.actions['back-all-event'] = function (button) {
    var b = backState();
    var ids = button.dataset.value.split(',');
    var allChosen = ids.every(function (id) { return b.chosen[id]; });
    ids.forEach(function (id) {
      if (allChosen) delete b.chosen[id];
      else b.chosen[id] = true;
    });
    renderBackList();
  };

  App.actions['back-next-1'] = function () {
    if (!backChosenIds().length) { UI.toast('Choose what is coming back', 'error'); return; }
    backState().step = 2;
    App.render();
    window.scrollTo(0, 0);
  };

  /* ---------------- step 2: anything wrong? ----------------------- */

  /** Every piece that is actually coming back, sets expanded. */
  function backLines() {
    var lines = [];
    var seen = {};

    backChosenIds().forEach(function (assetId) {
      var item = App.itemById(assetId);
      if (!item || seen[assetId]) return;
      seen[assetId] = true;
      lines.push({ item: item, viaParent: false });

      if (item.is_kit) {
        App.childrenOf(assetId).forEach(function (child) {
          if (seen[child.asset_id]) return;
          if (child.status !== 'checked_out' || !child.live) return;
          if (child.live.via_parent_asset_id !== assetId) return;   // rule K7
          seen[child.asset_id] = true;
          lines.push({ item: child, viaParent: true });
        });
      }
    });
    return lines;
  }

  /**
   * " · part of Tabla Set A" for a piece that came back with its set, and
   * " · on its own, the set is still out" for one returned by itself — which
   * is the case worth being explicit about.
   */
  function partOfSetNote(line) {
    var parentId = line.item.parent_asset_id;
    if (!parentId) return '';
    var parent = App.itemById(parentId);
    if (!parent) return '';
    if (line.viaParent) return ' · part of ' + parent.name;
    return parent.status === 'checked_out'
      ? ' · on its own — the rest of the set stays out'
      : ' · from ' + parent.name;
  }

  function backStepCheck() {
    var b = backState();
    var lines = backLines();
    var flagged = lines.filter(function (l) {
      var s = b.perItem[l.item.asset_id] || {};
      return s.missing || (s.condition_in && s.condition_in !== 'good');
    }).length;

    return stepHeader('Is everything alright?', 2, 2, 'back-back-1') +

      '<p class="mb-4 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">' +
        UI.plural(lines.length, 'piece') + ' coming back. ' +
        'If anything is missing or damaged, tap it below — otherwise just confirm.' +
      '</p>' +

      UI.card(
        UI.field('Who is taking them back in?',
          UI.input('back-name', b.name, { id: 'back-name', placeholder: 'Your name' }))) +

      '<div id="back-check-list" class="mt-4 space-y-2"></div>' +

      '<div class="sticky bottom-20 z-20 mt-4 rounded-2xl bg-white/95 p-3 shadow-lg ' +
        'ring-1 ring-stone-900/5 backdrop-blur md:bottom-4">' +
        (flagged
          ? '<p class="mb-2 text-center text-sm font-semibold text-amber-800">' +
            UI.plural(flagged, 'problem') + ' flagged</p>'
          : '<p class="mb-2 text-center text-sm text-stone-500">All fine</p>') +
        UI.button('Take them back in',
          { action: 'back-confirm', id: 'back-confirm', class: 'w-full' }) +
      '</div>' +
      '<div class="pb-8"></div>';
  }

  function renderBackCheckList() {
    var host = document.getElementById('back-check-list');
    if (!host) return;
    var b = backState();

    host.innerHTML = backLines().map(function (line) {
      var item = line.item;
      var state = b.perItem[item.asset_id] || {};
      var missing = !!state.missing;
      var damaged = state.condition_in === 'needs_repair';
      var flagged = missing || damaged;

      return '<details class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ' +
        (missing ? 'ring-rose-300' : damaged ? 'ring-amber-300' : 'ring-stone-900/5') + '"' +
        (flagged ? ' open' : '') + '>' +

        '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3">' +
          '<span class="text-base" aria-hidden="true">' +
            (missing ? '❗' : damaged ? '🔧' : '✓') + '</span>' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-sm font-medium text-stone-900">' +
              UI.esc(item.name) + (line.viaParent ? '' : '') + '</span>' +
            '<span class="block text-xs ' +
              (missing ? 'font-semibold text-rose-700'
                       : damaged ? 'font-semibold text-amber-700' : 'text-stone-400') + '">' +
              (missing ? 'Not returned'
                       : damaged ? 'Needs repair'
                       : 'Back and fine' + partOfSetNote(line)) + '</span>' +
          '</span>' +
          '<span class="shrink-0 text-xs font-medium text-stone-400">Change</span>' +
        '</summary>' +

        '<div class="border-t border-stone-100 p-4">' +
          '<div class="grid gap-2 sm:grid-cols-3">' +
            [['ok', '✓', 'Back and fine'],
             ['damaged', '🔧', 'Damaged'],
             ['missing', '❗', 'Not returned']
            ].map(function (o) {
              var active = o[0] === 'missing' ? missing
                         : o[0] === 'damaged' ? damaged
                         : !missing && !damaged;
              return '<button type="button" data-action="back-mark" ' +
                'data-value="' + UI.esc(item.asset_id) + '" data-mark="' + o[0] + '" ' +
                'class="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 ' +
                'text-sm font-medium transition ' +
                (active
                  ? (o[0] === 'missing' ? 'bg-rose-600 text-white'
                     : o[0] === 'damaged' ? 'bg-amber-500 text-white'
                     : 'bg-emerald-600 text-white')
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200') + '">' +
                '<span aria-hidden="true">' + o[1] + '</span>' + o[2] + '</button>';
            }).join('') +
          '</div>' +

          (flagged
            ? '<input type="text" data-back-notes="' + UI.esc(item.asset_id) + '" ' +
              'value="' + UI.esc(state.damage_notes || '') + '" ' +
              'placeholder="' + (missing ? 'Where was it last seen?' : 'What is wrong with it?') +
              '" class="' + UI.INPUT_CLASS + ' mt-3 py-2.5 text-sm">'
            : '') +

          photoField(item, state, {
            required: damaged,
            kind: 'in',
            hint: damaged
              ? 'A photo of the damage is required. Six months from now it is the only ' +
                'thing that can settle whether it left the store that way.'
              : 'Optional — useful if you want a record of how it came back.'
          }) +
        '</div>' +
      '</details>';
    }).join('');

    host.querySelectorAll('[data-back-notes]').forEach(function (el) {
      var id = el.dataset.backNotes;
      el.addEventListener('input', function () {
        b.perItem[id] = Object.assign({}, b.perItem[id], { damage_notes: el.value });
      });
    });

    wirePhotoFields(host, function (assetId, photoUrl) {
      b.perItem[assetId] = Object.assign({}, b.perItem[assetId], { photo_url: photoUrl });
      renderBackCheckList();
      updateBackConfirm();
    });
  }

  /**
   * The camera control that appears under an item.
   *
   * `capture="environment"` asks a phone for the rear camera and the camera
   * app directly, rather than the photo library — the picture is nearly
   * always being taken right now, of the thing on the table.
   */
  function photoField(item, state, opts) {
    var url = state.photo_url || '';
    var required = !!opts.required;
    var missingIt = required && !url;

    return '<div class="mt-3 rounded-xl p-3 ' +
      (missingIt ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-stone-50') + '">' +

      '<div class="flex items-center gap-3">' +
        '<span class="text-lg" aria-hidden="true">📷</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-medium ' +
            (missingIt ? 'text-amber-900' : 'text-stone-700') + '">' +
            (url ? 'Photo taken' : required ? 'Photo required' : 'Add a photo') + '</span>' +
          '<span class="block text-xs ' +
            (missingIt ? 'text-amber-800' : 'text-stone-500') + '">' +
            UI.esc(opts.hint || '') + '</span>' +
        '</span>' +

        (url
          ? '<button type="button" data-action="photo-clear" ' +
            'data-value="' + UI.esc(item.asset_id) + '" ' +
            'class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 ' +
            'hover:bg-red-50">Remove</button>'
          : '') +

        '<button type="button" data-photo-take="' + UI.esc(item.asset_id) + '" ' +
          'data-photo-kind="' + (opts.kind || 'in') + '" ' +
          'class="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ' +
          (missingIt ? 'bg-amber-500 text-white' : 'bg-white text-stone-700 ring-1 ' +
           'ring-inset ring-stone-300') + '">' +
          (url ? 'Retake' : '\ud83d\udcf7 Take photo') +
        '</button>' +
      '</div>' +

      (url
        ? '<img src="' + UI.esc(url) + '" alt="Photo of ' + UI.esc(item.name) + '" ' +
          'class="mt-3 max-h-48 w-full rounded-lg object-contain bg-white">'
        : '') +

      '<p data-photo-status="' + UI.esc(item.asset_id) + '" ' +
        'class="mt-2 hidden text-xs text-stone-500"></p>' +
    '</div>';
  }

  /* ---------------- taking a photo in the app ---------------------- */

  /**
   * A full-screen camera, the same shape as the QR scanner.
   *
   * Deliberately not a file picker. On a phone a picker opens the photo
   * library first and the camera second, which is backwards — the picture is
   * always of the thing on the table right now. A viewfinder and a shutter is
   * one tap; a picker is three and a wrong turn.
   *
   * Resolves to a data URL, or null if the volunteer backed out. Falls back to
   * the file input when there is no camera (a desktop, or permission refused).
   */
  function takePhoto(title) {
    return new Promise(function (resolve) {
      var host = document.getElementById('scanner-host');
      var stream = null;
      var settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        host.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }

      function onKey(e) { if (e.key === 'Escape') finish(null); }
      document.addEventListener('keydown', onKey);

      host.innerHTML =
        '<div class="fixed inset-0 z-[70] flex flex-col bg-stone-900">' +
          '<div class="flex items-center gap-3 px-4 py-3 text-white">' +
            '<button type="button" data-photo-cancel ' +
              'class="rounded-lg px-3 py-2 text-sm font-medium text-white/80 ' +
              'hover:bg-white/10">Cancel</button>' +
            '<span class="min-w-0 flex-1 truncate text-center text-sm font-semibold">' +
              UI.esc(title || 'Take a photo') + '</span>' +
            '<span class="w-16"></span>' +
          '</div>' +

          '<div class="relative flex-1 overflow-hidden bg-black">' +
            '<video data-photo-video class="h-full w-full object-contain" ' +
              'playsinline muted autoplay></video>' +
            '<img data-photo-preview class="absolute inset-0 hidden h-full w-full ' +
              'object-contain" alt="">' +
          '</div>' +

          '<p data-photo-msg class="px-4 py-2 text-center text-sm text-white/70">' +
            'Starting the camera\u2026</p>' +

          '<div data-photo-controls class="flex items-center justify-center gap-6 ' +
            'px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">' +
            '<button type="button" data-photo-shutter ' +
              'class="h-20 w-20 rounded-full border-4 border-white bg-white/20 ' +
              'active:scale-95 disabled:opacity-30" aria-label="Take the photo"></button>' +
          '</div>' +

          '<div data-photo-confirm class="hidden items-center justify-center gap-3 ' +
            'px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">' +
            '<button type="button" data-photo-retake ' +
              'class="rounded-xl bg-white/10 px-5 py-3 text-base font-semibold text-white">' +
              'Retake</button>' +
            '<button type="button" data-photo-use ' +
              'class="rounded-xl bg-saffron-600 px-6 py-3 text-base font-semibold text-white">' +
              'Use this photo</button>' +
          '</div>' +

          // Always present: the way out when there is no usable camera.
          '<div class="px-4 pb-4 text-center">' +
            '<label class="cursor-pointer text-xs text-white/60 underline">' +
              'Choose a photo instead' +
              '<input type="file" accept="image/*" class="hidden" data-photo-fallback>' +
            '</label>' +
          '</div>' +
        '</div>';

      var video = host.querySelector('[data-photo-video]');
      var preview = host.querySelector('[data-photo-preview]');
      var msg = host.querySelector('[data-photo-msg]');
      var controls = host.querySelector('[data-photo-controls]');
      var confirm = host.querySelector('[data-photo-confirm]');
      var shutter = host.querySelector('[data-photo-shutter]');
      var captured = null;

      function say(text) { msg.textContent = text || ''; }

      function showPreview(dataUrl) {
        captured = dataUrl;
        preview.src = dataUrl;
        preview.classList.remove('hidden');
        video.classList.add('hidden');
        controls.classList.add('hidden');
        confirm.classList.remove('hidden');
        confirm.classList.add('flex');
        say('About ' + UI.dataUrlKb(dataUrl) + ' KB');
      }

      function backToLive() {
        captured = null;
        preview.classList.add('hidden');
        video.classList.remove('hidden');
        confirm.classList.add('hidden');
        confirm.classList.remove('flex');
        controls.classList.remove('hidden');
        say('');
      }

      host.querySelector('[data-photo-cancel]').addEventListener('click', function () {
        finish(null);
      });
      host.querySelector('[data-photo-retake]').addEventListener('click', backToLive);
      host.querySelector('[data-photo-use]').addEventListener('click', function () {
        finish(captured);
      });

      // Same downscale as the file path, so uploads stay small either way.
      shutter.addEventListener('click', function () {
        if (!video.videoWidth) return;
        var maxEdge = 1280;
        var scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        scanFeedback(true);
        showPreview(canvas.toDataURL('image/jpeg', 0.7));
      });

      host.querySelector('[data-photo-fallback]').addEventListener('change', async function () {
        var file = this.files && this.files[0];
        if (!file) return;
        try {
          showPreview(await UI.shrinkImage(file));
        } catch (e) {
          say(e.message || 'That file could not be used.');
        }
      });

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      }).then(function (s) {
        if (settled) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        say('');
      }).catch(function () {
        // No camera, or refused. The picker below is still there.
        shutter.disabled = true;
        say('The camera could not start. Use "Choose a photo instead" below.');
      });
    });
  }

  /*
   * The camera sheet is defined here with the rest of the scanning code, but
   * the item page needs it too — for retaking a damage photo months later.
   */
  App.takePhoto = takePhoto;

  /** Takes a photo, uploads it, and hands the resulting Drive link back. */
  function wirePhotoFields(host, onUploaded) {
    function upload(assetId, kind, dataUrl) {
      var status = host.querySelector('[data-photo-status="' + assetId + '"]');
      function say(text) {
        if (!status) return;
        status.textContent = text;
        status.classList.toggle('hidden', !text);
      }

      say('Uploading ' + UI.dataUrlKb(dataUrl) + ' KB\u2026');
      return Api.uploadPhoto({ data_url: dataUrl, asset_id: assetId, kind: kind })
        .then(function (result) { onUploaded(assetId, result.photo_url); })
        .catch(function (e) { say(''); App.handleError(e); });
    }

    host.querySelectorAll('[data-photo-take]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var assetId = button.dataset.photoTake;
        var item = App.itemById(assetId);
        var dataUrl = await takePhoto(item ? item.name : assetId);
        if (dataUrl) await upload(assetId, button.dataset.photoKind || 'in', dataUrl);
      });
    });
  }

  /** Used by both flows, so it has to know which one is on screen. */
  App.actions['photo-clear'] = function (button) {
    var id = button.dataset.value;

    if (App.route.name === 'give') {
      delete giveState().photos[id];
      App.render();
      return;
    }

    var b = backState();
    b.perItem[id] = Object.assign({}, b.perItem[id], { photo_url: '' });
    renderBackCheckList();
    updateBackConfirm();
  };

  /** Blocks the confirm button while a damaged item still has no photo. */
  function updateBackConfirm() {
    var b = backState();
    var outstanding = backLines().filter(function (line) {
      var st = b.perItem[line.item.asset_id] || {};
      return st.condition_in === 'needs_repair' && !st.photo_url;
    });

    var button = document.getElementById('back-confirm');
    if (button) {
      button.disabled = outstanding.length > 0;
      button.textContent = outstanding.length
        ? 'Photo needed for ' + UI.plural(outstanding.length, 'item')
        : 'Take them back in';
    }
  }

  function mountBackCheck() {
    renderBackCheckList();
    updateBackConfirm();
  }

  App.actions['back-mark'] = function (button) {
    var b = backState();
    var id = button.dataset.value;
    var mark = button.dataset.mark;

    b.perItem[id] = Object.assign({}, b.perItem[id], {
      missing: mark === 'missing',
      condition_in: mark === 'damaged' ? 'needs_repair' : 'good'
    });
    App.render();
  };

  App.actions['back-back-1'] = function () {
    backState().step = 1;
    App.render();
    window.scrollTo(0, 0);
  };

  App.actions['back-confirm'] = async function (button) {
    var b = backState();
    var name = (document.getElementById('back-name').value || '').trim();
    if (!name) {
      UI.toast('Enter your name', 'error');
      document.getElementById('back-name').focus();
      return;
    }

    var restore = UI.busy(button, 'Saving…');
    try {
      var result = await Api.checkin({
        checked_in_by: name,
        items: backLines().map(function (line) {
          var state = b.perItem[line.item.asset_id] || {};
          return {
            asset_id: line.item.asset_id,
            condition_in: state.condition_in || 'good',
            missing: !!state.missing,
            damage_notes: state.damage_notes || '',
            photo_url: state.photo_url || ''
          };
        })
      });

      App.rememberName(name);
      UI.toast(UI.plural(result.checked_in.length, 'instrument') + ' back in the store', 'success');

      resetBack();
      App.go('#/');
      await App.refresh({ showSpinner: false });

      if (result.warnings && result.warnings.length) {
        UI.dialog({
          title: 'Done, with a note',
          html: UI.warningList(result.warnings),
          buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
        });
      }
    } catch (e) {
      if (e.code === 'PHOTO_REQUIRED') {
        // The browser blocks this already; this is the server saying no to a
        // stale page or a request that skipped the form.
        await UI.dialog({
          title: 'A photo is needed',
          message: e.message,
          buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
        });
        renderBackCheckList();
        updateBackConfirm();
      } else {
        App.handleError(e);
      }
      restore();
    }
  };

  /* ================================================================
   * Scan button — works out what you probably want to do
   * ================================================================ */

  App.screens.scan = function () {
    return '<div class="mb-4 flex items-center gap-3">' +
        '<a href="#/" class="text-sm font-medium text-stone-500 hover:text-stone-800">← Home</a>' +
        '<h1 class="text-xl font-bold tracking-tight text-stone-900">Scan</h1>' +
      '</div>' +

      '<p class="mb-4 text-sm text-stone-500">' +
        'Scan any sticker and this will take you to the right place.</p>' +

      '<div id="scan-camera-panel" class="relative mb-3 aspect-[4/3] overflow-hidden ' +
        'rounded-2xl bg-stone-900">' +
        '<video id="scan-video" class="scanner-video hidden" playsinline muted></video>' +
        '<div id="qr-reader" class="hidden h-full w-full"></div>' +
        '<div class="scanner-reticle"></div>' +
      '</div>' +
      '<p id="scan-status" class="mb-4 text-center text-sm text-stone-500">Starting camera…</p>' +

      '<form id="manual-form" class="mb-6 flex gap-2">' +
        '<input type="text" id="manual-code" placeholder="Or type the ID, e.g. TAB-014" ' +
          'autocapitalize="characters" autocomplete="off" spellcheck="false" ' +
          'class="' + UI.INPUT_CLASS + ' font-mono">' +
        UI.button('Go', { type: 'submit', variant: 'secondary' }) +
      '</form>' +

      '<div class="grid gap-3 sm:grid-cols-2">' +
        actionButton({
          href: '#/give', icon: '📤', title: 'Give out instruments',
          subtitle: 'Start from a list instead',
          classes: 'bg-white text-stone-900 ring-1 ring-stone-900/5'
        }) +
        actionButton({
          href: '#/back', icon: '📥', title: 'Take instruments back',
          subtitle: 'Start from a list instead',
          classes: 'bg-white text-stone-900 ring-1 ring-stone-900/5'
        }) +
      '</div>';
  };

  App.screens.scan.mount = async function () {
    /*
     * One scan, one route.
     *
     * The camera fires four times a second, so without this latch a sticker
     * held in view produces a stream of hits. Each one used to reset the
     * basket and toast again — which is how a single dholak announced itself
     * twenty times and added nothing.
     */
    var routed = false;

    async function handle(code) {
      if (routed) return;
      var item = await resolveCode(code);
      if (!item) return;

      routed = true;
      scanFeedback(true);
      releaseCamera();          // before navigating, not after

      // Route by what the item is actually doing right now. Both flows use
      // their live state rather than resetting it, so anything already in the
      // basket survives — including a previous scan.
      if (item.status === 'checked_out') {
        var target = item;
        if (item.live && item.live.via_parent_asset_id) {
          var parent = App.itemById(item.live.via_parent_asset_id);
          if (parent && parent.status === 'checked_out') target = parent;
        }
        backState().chosen[target.asset_id] = true;
        backState().step = 1;
        UI.toast('Added ' + target.name + ' to take back', 'success');
        App.go('#/back');
        return;
      }

      if (item.status === 'available') {
        var whole = item.parent_asset_id ? App.itemById(item.parent_asset_id) : item;
        var target2 = whole || item;
        var g = giveState();
        g.chosen[target2.asset_id] = true;
        UI.toast('Added ' + target2.name + ' to give out', 'success');
        App.go('#/give');
        return;
      }

      // In maintenance or lost: nothing sensible to start, so show the item.
      App.go('#/item/' + encodeURIComponent(item.asset_id));
    }

    document.getElementById('manual-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('manual-code');
      handle(input.value);
      input.value = '';
    });

    releaseCamera();
    cameraOwner = 'scan';
    stopCamera = await startCamera(handle);
  };

  /** Item detail's buttons drop straight into the right flow. */
  App.actions['quick-checkout'] = function (button) {
    var g = giveState();
    g.chosen[button.dataset.value] = true;
    App.go('#/give');
  };

  App.actions['quick-checkin'] = function (button) {
    var b = backState();
    b.chosen[button.dataset.value] = true;
    b.step = 1;
    App.go('#/back');
  };

  // Leaving either flow half-finished should not leave a stale basket behind
  // the next time it is opened from the home screen.
  App.onRefresh(function () {
    if ((window.location.hash || '').indexOf('#/give') !== 0) give = null;
    if ((window.location.hash || '').indexOf('#/back') !== 0) back = null;
  });


  /* ================================================================
   * Events
   * ================================================================ */

  /** Out and overdue counts, straight from the bootstrap payload. */
  function liveCountsFor(eventIds) {
    var set = {};
    eventIds.forEach(function (id) { set[id] = true; });
    var out = 0, overdue = 0;
    ((App.data && App.data.openMovements) || []).forEach(function (m) {
      if (!set[m.event_id] && !set[m.sub_event_id]) return;
      out++;
      if (m.days_overdue > 0) overdue++;
    });
    return { out: out, overdue: overdue };
  }

  /** One top-level event and its sub-events, as a collapsible card. */
  function eventCard(parent) {
    var subs = App.subEventsSorted(parent.event_id);
    var counts = liveCountsFor([parent.event_id].concat(
      subs.map(function (s) { return s.event_id; })));

    return '<details class="rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5"' +
      (counts.out ? ' open' : '') + '>' +
      '<summary class="flex cursor-pointer items-center gap-3 px-4 py-4">' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block font-semibold text-stone-900">' +
            UI.esc(parent.name) + '</span>' +
          '<span class="block text-sm text-stone-500">' +
            UI.esc(dateRange(parent)) +
            (parent.location ? ' · ' + UI.esc(parent.location) : '') +
            (subs.length ? ' · ' + UI.plural(subs.length, 'sub-event') : '') +
          '</span>' +
        '</span>' +
        (counts.out
          ? '<span class="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs ' +
            'font-semibold text-blue-800">' + counts.out + ' out</span>'
          : '') +
        (counts.overdue
          ? '<span class="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs ' +
            'font-semibold text-red-800">' + counts.overdue + ' overdue</span>'
          : '') +
      '</summary>' +

      '<div class="border-t border-stone-100 px-2 py-2">' +
        '<a href="#/event/' + encodeURIComponent(parent.event_id) + '" ' +
          'class="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ' +
          'font-medium text-saffron-700 hover:bg-saffron-50">' +
          'Open event →</a>' +
        subs.map(function (sub) {
          var c = liveCountsFor([sub.event_id]);
          return '<a href="#/event/' + encodeURIComponent(sub.event_id) + '" ' +
            'class="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-stone-50">' +
            '<span class="text-stone-300" aria-hidden="true">↳</span>' +
            '<span class="min-w-0 flex-1">' +
              '<span class="block text-sm font-medium text-stone-800">' +
                UI.esc(sub.name) + '</span>' +
              '<span class="block text-xs text-stone-500">' +
                UI.esc(dateRange(sub)) + '</span>' +
            '</span>' +
            (c.out
              ? '<span class="text-xs font-semibold text-blue-700">' + c.out + ' out</span>'
              : '') +
          '</a>';
        }).join('') +
        '<button type="button" data-action="event-new" ' +
          'data-value="' + UI.esc(parent.event_id) + '" ' +
          'class="mt-1 w-full rounded-xl px-3 py-2.5 text-left text-sm ' +
          'font-medium text-stone-500 hover:bg-stone-50">+ Add a sub-event</button>' +
      '</div>' +
    '</details>';
  }

  /**
   * Events, soonest first.
   *
   * Finished and cancelled ones drop into a collapsed "Finished" section
   * rather than disappearing — their loan history still has to be reachable,
   * but they should not be the first thing you scroll past on the way to next
   * weekend's sabha.
   */
  var eventSearch = '';

  /** The year an event belongs to, for grouping the archive. */
  function eventYear(event) {
    var d = event.end_date || event.start_date || '';
    return /^\d{4}/.test(d) ? d.slice(0, 4) : 'No date';
  }

  /**
   * Events, soonest first.
   *
   * Finished ones drop into a collapsed "Finished" section grouped by year.
   * Nothing is ever deleted — an event from 2024 still has to explain a
   * movement record from 2024 — but three years of weekly sabhas is several
   * hundred rows, so they collapse to one line per year and only the current
   * year opens by default. That scales indefinitely without anyone having to
   * tidy up.
   */
  App.screens.events = function () {
    var all = App.topLevelEventsSorted();

    var needle = eventSearch.toLowerCase();
    function matches(e) {
      if (!needle) return true;
      var hay = (e.name + ' ' + (e.location || '') + ' ' + (e.centre || '')).toLowerCase();
      if (hay.indexOf(needle) !== -1) return true;
      return App.subEventsSorted(e.event_id).some(function (sub) {
        return sub.name.toLowerCase().indexOf(needle) !== -1;
      });
    }

    var live = all.filter(function (e) {
      if (!matches(e)) return false;
      if (!App.isArchivedEvent(e)) return true;
      // A finished parent still shows up top while a sub-event is running.
      return App.subEventsSorted(e.event_id).some(function (sub) {
        return !App.isArchivedEvent(sub);
      });
    });
    var archived = all.filter(function (e) {
      return matches(e) && live.indexOf(e) === -1;
    });

    if (!all.length) {
      return UI.pageTitle('Events', null,
          UI.button('+ New event', { action: 'event-new', variant: 'secondary' })) +
        UI.emptyState('\ud83d\udcc5', 'No events yet',
          'Add an event before you give any instruments out to it.',
          UI.button('+ New event', { action: 'event-new' }));
    }

    // Newest year first — last year's Diwali is looked up far more often than
    // something from four years ago.
    var byYear = {};
    var years = [];
    archived.forEach(function (e) {
      var y = eventYear(e);
      if (!byYear[y]) { byYear[y] = []; years.push(y); }
      byYear[y].push(e);
    });
    years.sort(function (a, b) { return b.localeCompare(a); });
    var thisYear = String(App.data.today).slice(0, 4);

    return UI.pageTitle('Events', 'Coming up first. Finished ones are kept below.',
        UI.button('+ New event', { action: 'event-new', variant: 'secondary' })) +

      '<div class="relative mb-4">' +
        '<input type="search" id="event-q" value="' + UI.esc(eventSearch) + '" ' +
          'placeholder="Search events\u2026" autocomplete="off" ' +
          'class="' + UI.INPUT_CLASS + ' pr-20">' +
        '<button type="button" id="event-clear" data-action="events-clear-search" ' +
          (eventSearch ? '' : 'hidden ') +
          'class="absolute inset-y-0 right-0 my-1.5 mr-1.5 rounded-lg bg-stone-100 px-3 ' +
          'text-sm font-medium text-stone-600 hover:bg-stone-200">Clear</button>' +
      '</div>' +

      (live.length
        ? '<div class="space-y-3">' + live.map(eventCard).join('') + '</div>'
        : '<p class="rounded-2xl border-2 border-dashed border-stone-200 px-4 py-8 ' +
          'text-center text-sm text-stone-500">' +
          (eventSearch ? 'Nothing coming up matches that search.'
                       : 'Nothing coming up. Everything is in Finished below.') + '</p>') +

      (archived.length
        ? '<details class="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm ' +
            'ring-1 ring-stone-900/5"' + (eventSearch ? ' open' : '') + '>' +
            '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
              '<span class="text-lg" aria-hidden="true">\ud83d\uddc4\ufe0f</span>' +
              '<span class="min-w-0 flex-1">' +
                '<span class="block text-sm font-semibold text-stone-700">Finished</span>' +
                '<span class="block text-xs text-stone-500">' +
                  'Kept for their history \u2014 still searchable, never deleted</span>' +
              '</span>' +
              '<span class="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-sm ' +
                'font-semibold text-stone-600">' + archived.length + '</span>' +
              '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" ' +
                'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
                'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
                'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
            '</summary>' +

            '<div class="border-t border-stone-100 p-2">' +
              years.map(function (year) {
                var open = eventSearch || year === thisYear;
                return '<details class="rounded-xl"' + (open ? ' open' : '') + '>' +
                  '<summary class="flex cursor-pointer items-center gap-3 rounded-xl px-3 ' +
                    'py-2.5 hover:bg-stone-50">' +
                    '<span class="min-w-0 flex-1 text-sm font-semibold text-stone-700">' +
                      UI.esc(year) + '</span>' +
                    '<span class="shrink-0 text-xs text-stone-400">' +
                      UI.plural(byYear[year].length, 'event') + '</span>' +
                    '<svg class="chevron h-4 w-4 shrink-0 text-stone-400 transition-transform" ' +
                      'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
                      'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
                      'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
                  '</summary>' +
                  '<div class="space-y-2 pb-2 pl-2">' +
                    byYear[year].map(eventCard).join('') +
                  '</div>' +
                '</details>';
              }).join('') +
            '</div>' +
          '</details>'
        : '');
  };

  App.screens.events.mount = function () {
    var box = document.getElementById('event-q');
    if (!box) return;
    box.addEventListener('input', function () {
      eventSearch = box.value;
      var clear = document.getElementById('event-clear');
      if (clear) clear.hidden = !eventSearch;
      App.render();
      var again = document.getElementById('event-q');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    });
  };

  App.actions['events-clear-search'] = function () {
    eventSearch = '';
    App.render();
  };

  function dateRange(event) {
    if (!event.start_date) return 'No dates set';
    if (!event.end_date || event.end_date === event.start_date) {
      return UI.fullDate(event.start_date);
    }
    return UI.dayMonth(event.start_date) + ' – ' + UI.fullDate(event.end_date);
  }

  /** Editing reuses the create dialog, prefilled. */
  App.actions['event-edit'] = async function (button) {
    var event = App.eventById(button.dataset.value);
    if (!event) return;

    var result = await UI.dialog({
      title: 'Edit event',
      html:
        '<div class="mt-4 space-y-3 text-left">' +
          UI.field('Name',
            '<input type="text" data-dialog-field="name" value="' + UI.esc(event.name) + '" ' +
              'class="' + UI.INPUT_CLASS + '">') +
          '<div class="grid grid-cols-2 gap-3">' +
            UI.field('Starts',
              '<input type="date" data-dialog-field="start_date" value="' +
                UI.esc(event.start_date) + '" class="' + UI.INPUT_CLASS + '">') +
            UI.field('Ends',
              '<input type="date" data-dialog-field="end_date" value="' +
                UI.esc(event.end_date) + '" class="' + UI.INPUT_CLASS + '">') +
          '</div>' +
          UI.field('Location',
            '<input type="text" data-dialog-field="location" value="' +
              UI.esc(event.location || '') + '" class="' + UI.INPUT_CLASS + '">') +
          UI.field('Centre',
            UI.select('centre', App.activeCentres(), event.centre || '',
              { placeholder: 'None', attrs: 'data-dialog-field="centre"' })) +
          UI.field('Status',
            UI.select('status', [
              { value: 'planned', label: 'Planned' },
              { value: 'active', label: 'Happening now' },
              { value: 'completed', label: 'Finished' },
              { value: 'cancelled', label: 'Cancelled' }
            ], event.status, { attrs: 'data-dialog-field="status"' })) +
        '</div>',
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: 'Save', value: 'save', variant: 'primary' }
      ],
      onOpen: function (host) {
        linkDatePair(host.querySelector('[data-dialog-field="start_date"]'),
                     host.querySelector('[data-dialog-field="end_date"]'));
      }
    });
    if (result.value !== 'save') return;

    var dateProblem = checkEventDates(result.fields.start_date, result.fields.end_date);
    if (dateProblem) { UI.toast(dateProblem, 'error'); return; }

    try {
      await Api.saveEvent({
        event_id: event.event_id,
        name: (result.fields.name || '').trim() || event.name,
        parent_event_id: event.parent_event_id || '',
        start_date: result.fields.start_date || '',
        end_date: result.fields.end_date || '',
        location: result.fields.location || '',
        centre: result.fields.centre || '',
        status: result.fields.status || event.status
      });
      eventCache = { id: null, data: null };
      UI.toast('Event saved', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
    }
  };

  /**
   * Deleting an event.
   *
   * The server decides whether this is a real deletion or a cancellation —
   * an event instruments have actually been out to has to survive, or its
   * movement history would point at nothing. All the UI does is explain
   * which of the two just happened.
   */
  App.actions['event-delete'] = async function (button) {
    var eventId = button.dataset.value;
    var event = App.eventById(eventId);
    if (!event) return;

    var subs = App.subEventsOf(eventId);
    var treeIds = {};
    treeIds[eventId] = true;
    subs.forEach(function (s) { treeIds[s.event_id] = true; });

    // Work out what the server is going to do, so the dialog can say it up
    // front. Telling someone "this cannot be undone" and then quietly archiving
    // instead is the kind of mismatch that makes people distrust the whole app.
    var stillOut = App.itemsOut().filter(function (i) {
      return treeIds[i.live.event_id] || treeIds[i.live.sub_event_id];
    });
    var openBookings = (App.data.openAllocations || []).filter(function (a) {
      return treeIds[a.event_id];
    });
    // has_history comes from the server — it counts returned loans too, which
    // the bootstrap payload does not carry.
    var hasHistory = [event].concat(subs).some(function (e) { return e.has_history; }) ||
                     stillOut.length > 0;

    if (stillOut.length) {
      await UI.dialog({
        title: 'Take the instruments back first',
        message: UI.plural(stillOut.length, 'instrument') + ' from "' + event.name +
                 '" ' + (stillOut.length === 1 ? 'is' : 'are') + ' still out. ' +
                 'An event cannot be removed while anything is unaccounted for.',
        buttons: [{ label: 'OK', value: 'ok', variant: 'primary' }]
      });
      return;
    }

    var parts = [];
    if (subs.length) {
      parts.push('Its ' + UI.plural(subs.length, 'sub-event') + ' (' +
                 subs.map(function (s) { return s.name; }).join(', ') + ') will go too.');
    }
    if (openBookings.length) {
      parts.push(UI.plural(openBookings.length, 'booking') +
                 ' against it will be cancelled, freeing those instruments up again.');
    }
    // The honest headline: deletion is only real when there is no history.
    parts.push(hasHistory
      ? 'Instruments have been out to this event before, so it will be ARCHIVED rather ' +
        'than deleted — the loan records have to keep pointing somewhere. It will ' +
        'disappear from every list except Finished.'
      : 'Nothing has ever been given out to this event, so it will be deleted outright. ' +
        'This cannot be undone.');

    var confirmed = await UI.confirm(
      (hasHistory ? 'Archive' : 'Delete') + ' "' + event.name + '"?',
      parts.join(' '),
      hasHistory ? 'Archive it' : 'Delete it',
      true);
    if (!confirmed) return;

    var restore = UI.busy(button, 'Deleting…');
    try {
      var result = await Api.deleteEvent({
        event_id: eventId,
        include_sub_events: true
      });

      eventCache = { id: null, data: null };
      App.go('#/events');
      await App.refresh({ showSpinner: false });

      UI.toast(result.deleted
        ? 'Event deleted'
        : 'Event archived — find it under Finished', 'success');
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  /**
   * New event or sub-event. This is a real form rather than a UI.dialog because
   * it needs submit-on-Enter and its own busy state on the Create button.
   */
  App.actions['event-new'] = function (button) {
    var parentId = button.dataset.value || '';
    var parent = parentId ? App.eventById(parentId) : null;

    var host = document.getElementById('dialog-host');
    host.innerHTML =
      '<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-0 ' +
      'backdrop-blur-[2px] sm:items-center sm:p-4">' +
        '<form id="event-form" role="dialog" aria-modal="true" ' +
        'class="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">' +
          '<h2 class="text-lg font-semibold text-stone-900">' +
            (parent ? 'New sub-event of ' + UI.esc(parent.name) : 'New event') + '</h2>' +
          (parent
            ? '<p class="mt-1 text-sm text-stone-500">One level of nesting — a sub-event ' +
              'cannot have sub-events of its own.</p>'
            : '') +
          '<div class="mt-4 space-y-3">' +
            UI.field('Name', UI.input('name', '', { required: true,
              placeholder: parent ? 'e.g. Nagar Yatra' : 'e.g. Diwali Annakut' })) +
            '<div class="grid grid-cols-2 gap-3">' +
              UI.field('Starts', UI.input('start_date', App.data.today, { type: 'date' })) +
              UI.field('Ends', UI.input('end_date', App.data.today, { type: 'date' })) +
            '</div>' +
            UI.field('Location', UI.input('location', '', { placeholder: 'e.g. Neasden' })) +
            UI.field('Centre', UI.select('centre', App.activeCentres(), '',
              { placeholder: 'No particular centre' })) +
          '</div>' +
          '<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">' +
            UI.button('Cancel', { variant: 'secondary', action: 'event-cancel' }) +
            UI.button('Create', { type: 'submit', id: 'event-create' }) +
          '</div>' +
        '</form>' +
      '</div>';

    document.getElementById('event-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var restore = UI.busy(document.getElementById('event-create'), 'Creating…');
      try {
        await Api.saveEvent({
          name: form.name.value.trim(),
          parent_event_id: parentId,
          start_date: form.start_date.value,
          end_date: form.end_date.value,
          location: form.location.value.trim(),
          centre: form.centre.value,
          status: 'planned'
        });
        host.innerHTML = '';
        UI.toast('Event created', 'success');
        await App.refresh({ showSpinner: false });
      } catch (err) {
        App.handleError(err);
        restore();
      }
    });
  };

  App.actions['event-cancel'] = function () {
    document.getElementById('dialog-host').innerHTML = '';
  };

  /* ---------------- one event -------------------------------------- */

  var eventCache = { id: null, data: null };

  App.onRefresh(function () { eventCache = { id: null, data: null }; });

  App.screens.event = function (params) {
    var eventId = params[0];
    var event = App.eventById(eventId);
    if (!event) {
      return UI.pageTitle('Event not found') +
        UI.emptyState('🤷', 'No event with ID ' + eventId, '',
          UI.button('Back to events', { href: '#/events' }));
    }

    var detail = eventCache.id === eventId ? eventCache.data : null;
    var parent = event.parent_event_id ? App.eventById(event.parent_event_id) : null;

    return '<a href="#/events" class="mb-4 inline-flex items-center gap-1 text-sm ' +
      'font-medium text-stone-500 hover:text-stone-800">← Events</a>' +

      '<div class="mb-5 flex flex-wrap items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          (parent
            ? '<p class="text-sm text-stone-500">' + UI.esc(parent.name) + '</p>'
            : '') +
          '<h1 class="text-2xl font-bold tracking-tight text-stone-900">' +
            UI.esc(event.name) + '</h1>' +
          '<p class="mt-1 text-sm text-stone-500">' + UI.esc(dateRange(event)) +
            (event.location ? ' · ' + UI.esc(event.location) : '') +
            (event.status === 'cancelled' ? ' · cancelled' : '') + '</p>' +
        '</div>' +
        '<div class="flex shrink-0 gap-2">' +
          UI.button('Edit', { action: 'event-edit', value: eventId, variant: 'secondary' }) +
          UI.button('Delete', { action: 'event-delete', value: eventId, variant: 'quiet' }) +
        '</div>' +
      '</div>' +

      '<div id="event-body">' +
        (detail ? eventBody(event, detail) : UI.spinner('Loading event…')) +
      '</div>';
  };

  function eventBody(event, detail) {
    var out = detail.movements.filter(function (m) { return m.is_out; });
    var returned = detail.movements.filter(function (m) { return !m.is_out; });
    var openAllocations = detail.allocations.filter(function (a) { return a.status === 'open'; });

    return '<div class="mb-5 grid grid-cols-3 gap-3">' +
        tile('Out now', detail.counts.out, { dot: 'bg-blue-500' }) +
        tile('Returned', detail.counts.returned, { dot: 'bg-emerald-500' }) +
        tile('Overdue', detail.counts.overdue, {
          dot: 'bg-red-500',
          cardClass: detail.counts.overdue ? 'bg-red-50 ring-red-600/20' : 'bg-white ring-stone-900/5',
          valueClass: detail.counts.overdue ? 'text-red-700' : 'text-stone-900'
        }) +
      '</div>' +

      (detail.sub_events.length
        ? '<section class="mb-5">' +
            '<h2 class="mb-2 text-base font-semibold text-stone-900">Sub-events</h2>' +
            '<div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">' +
              detail.sub_events.map(function (sub) {
                return '<a href="#/event/' + encodeURIComponent(sub.event_id) + '" ' +
                  'class="flex items-center gap-3 border-b border-stone-100 px-4 py-3 ' +
                  'last:border-0 hover:bg-stone-50">' +
                  '<span class="min-w-0 flex-1">' +
                    '<span class="block font-medium text-stone-900">' + UI.esc(sub.name) + '</span>' +
                    '<span class="block text-xs text-stone-500">' +
                      UI.esc(dateRange(sub)) + '</span>' +
                  '</span>' +
                  '<span class="shrink-0 text-sm text-stone-500">' +
                    sub.counts.out + ' out · ' + sub.counts.returned + ' back' +
                    (sub.counts.overdue
                      ? ' · <span class="font-semibold text-red-700">' +
                        sub.counts.overdue + ' overdue</span>'
                      : '') +
                  '</span>' +
                '</a>';
              }).join('') +
            '</div>' +
          '</section>'
        : '') +

      (out.length
        ? '<section class="mb-5">' +
            '<div class="mb-2 flex flex-wrap items-center justify-between gap-2">' +
              '<h2 class="text-base font-semibold text-stone-900">Still out (' + out.length + ')</h2>' +
              UI.button('Take everything back for this event', {
                action: 'event-bulk-checkin', value: event.event_id, variant: 'secondary'
              }) +
            '</div>' +
            '<div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">' +
              out.map(movementLine).join('') +
            '</div>' +
          '</section>'
        : '') +

      (openAllocations.length
        ? '<section class="mb-5">' +
            '<h2 class="mb-2 text-base font-semibold text-stone-900">' +
              'Booked but not collected yet (' + openAllocations.length + ')</h2>' +
            '<div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">' +
              openAllocations.map(function (a) {
                return '<div class="flex items-center gap-3 border-b border-stone-100 px-4 py-3 ' +
                  'last:border-0">' +
                  '<a href="#/item/' + encodeURIComponent(a.asset_id) + '" ' +
                    'class="min-w-0 flex-1">' +
                    '<span class="block font-medium text-stone-900">' + UI.esc(a.name) + '</span>' +
                    '<span class="block text-xs text-stone-500">' + UI.esc(a.asset_id) +
                      ' · due back ' + UI.esc(UI.dayMonth(a.expected_return_date)) +
                      ' · ' + UI.esc(a.allocated_by) + '</span>' +
                  '</a>' +
                  '<span class="flex shrink-0 gap-1">' +
                    '<button type="button" data-action="booking-edit" ' +
                      'data-value="' + UI.esc(a.allocation_id) + '" ' +
                      'class="rounded-lg px-2.5 py-2 text-sm font-medium text-stone-600 ' +
                      'hover:bg-stone-100">Change</button>' +
                    '<button type="button" data-action="booking-cancel" ' +
                      'data-value="' + UI.esc(a.allocation_id) + '" ' +
                      'class="rounded-lg px-2.5 py-2 text-sm font-medium text-red-600 ' +
                      'hover:bg-red-50">Cancel</button>' +
                  '</span>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</section>'
        : '') +

      (returned.length
        ? '<section>' +
            '<h2 class="mb-2 text-base font-semibold text-stone-900">' +
              'Returned (' + returned.length + ')</h2>' +
            '<div class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5">' +
              returned.map(movementLine).join('') +
            '</div>' +
          '</section>'
        : '') +

      (!detail.movements.length && !openAllocations.length
        ? UI.emptyState('📦', 'Nothing given out for this event yet',
            'Use "Give out instruments" on the home screen to log a request.',
            UI.button('Give out instruments', { href: '#/give' }))
        : '');
  }

  function movementLine(m) {
    return '<a href="#/item/' + encodeURIComponent(m.asset_id) + '" ' +
      'class="flex items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0 ' +
      'hover:bg-stone-50">' +
      '<span class="min-w-0 flex-1">' +
        '<span class="block font-medium text-stone-900">' + UI.esc(m.name) + '</span>' +
        '<span class="block text-xs text-stone-500">' + UI.esc(m.asset_id) +
          (m.via_parent_asset_id ? ' · with ' + UI.esc(m.via_parent_asset_id) : '') +
          (m.sub_event_name ? ' · ' + UI.esc(m.sub_event_name) : '') +
          ' · ' + UI.esc(m.centre) + '</span>' +
      '</span>' +
      '<span class="shrink-0 text-right text-xs">' +
        (m.is_out
          ? (m.days_overdue > 0
              ? '<span class="font-semibold text-red-700">' +
                UI.esc(UI.daysLate(m.days_overdue)) + '</span>'
              : '<span class="text-stone-500">due ' +
                UI.esc(UI.dayMonth(m.expected_return_date)) + '</span>')
          : m.outcome === 'missing'
            ? '<span class="font-semibold text-rose-700">Not returned</span>'
            : m.outcome === 'damaged'
              ? '<span class="font-semibold text-amber-700">Damaged</span>'
              : '<span class="text-emerald-700">Returned</span>') +
      '</span>' +
    '</a>';
  }

  App.screens.event.mount = async function (params) {
    var eventId = params[0];
    if (!App.eventById(eventId)) return;
    if (eventCache.id === eventId && eventCache.data) return;

    try {
      var detail = await Api.event(eventId);
      eventCache = { id: eventId, data: detail };
      if (App.route.name === 'event' && App.route.params[0] === eventId) App.render();
    } catch (e) {
      var host = document.getElementById('event-body');
      if (host) host.innerHTML = UI.errorPanel('Could not load this event', e.message);
    }
  };

  App.actions['event-bulk-checkin'] = async function (button) {
    var eventId = button.dataset.value;
    var event = App.eventById(eventId);
    var name = App.lastName();

    var result_ = await UI.dialog({
      title: 'Take everything back for ' + event.name + '?',
      message: 'Every item still out for this event and its sub-events will be marked returned ' +
               'in good condition. If anything is damaged or missing, check those items in ' +
               'individually on the Scan screen instead.',
      html: '<div class="mt-4 text-left">' +
            UI.field('Your name',
              '<input type="text" data-dialog-field="name" value="' + UI.esc(name) + '" ' +
              'placeholder="e.g. Nilesh" class="' + UI.INPUT_CLASS + '">') +
            '</div>',
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: 'Take it all back', value: 'ok', variant: 'primary' }
      ]
    });
    if (result_.value !== 'ok') return;

    var enteredName = (result_.fields.name || '').trim();
    if (!enteredName) { UI.toast('Please enter your name', 'error'); return; }
    App.rememberName(enteredName);

    try {
      var result = await Api.bulkCheckinEvent({
        event_id: eventId, checked_in_by: enteredName, include_sub_events: true
      });
      eventCache = { id: null, data: null };
      UI.toast(UI.plural(result.checked_in.length, 'item') + ' checked in', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
    }
  };

  /* ================================================================
   * Settings
   * ================================================================ */

  function referenceEditor(title, description, listId, rows, opts) {
    opts = opts || {};
    return UI.card(
      '<h2 class="text-base font-semibold text-stone-900">' + UI.esc(title) + '</h2>' +
      '<p class="mt-0.5 mb-3 text-sm text-stone-500">' + UI.esc(description) + '</p>' +
      '<div id="' + listId + '" class="space-y-2">' +
        rows.map(function (row) {
          return '<div class="flex items-center gap-2" data-ref-row data-id="' +
            UI.esc(row.id) + '">' +
            '<input type="text" data-ref-field="name" value="' + UI.esc(row.name) + '" ' +
              'class="' + UI.INPUT_CLASS + ' py-2 text-sm">' +
            (opts.extraField
              ? '<input type="text" data-ref-field="' + opts.extraField + '" ' +
                'value="' + UI.esc(row[opts.extraField] === undefined ? '' : row[opts.extraField]) + '" ' +
                'placeholder="' + UI.esc(opts.extraPlaceholder || '') + '" ' +
                'class="' + UI.INPUT_CLASS + ' w-24 py-2 text-center font-mono text-sm">'
              : '') +
            '<label class="flex shrink-0 cursor-pointer items-center gap-1.5 px-1">' +
              '<input type="checkbox" data-ref-field="active" ' + (row.active ? 'checked ' : '') +
                'class="h-4 w-4 rounded border-stone-300 text-saffron-600 ' +
                'focus:ring-saffron-500">' +
              '<span class="text-xs text-stone-500">In use</span>' +
            '</label>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<button type="button" data-action="ref-add" data-value="' + listId + '" ' +
        'class="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-saffron-700 ' +
        'hover:bg-saffron-50">+ Add another</button>');
  }

  App.screens.settings = function () {
    return UI.pageTitle('Settings',
      'Anyone can change these. Renaming something updates it everywhere, including in past ' +
      'records.') +

      '<div class="space-y-4">' +
        referenceEditor('Centres',
          'Where instruments go. Untick "In use" to hide one without losing its history.',
          'ref-centres', App.data.centres) +

        referenceEditor('Instrument types',
          'The prefix is used to suggest asset IDs — Tabla → TAB-017.',
          'ref-types', App.data.instrumentTypes,
          { extraField: 'prefix', extraPlaceholder: 'TAB' }) +

        referenceEditor('Quality grades',
          'The number sets the order, 1 being the best.',
          'ref-grades', App.data.qualityGrades,
          { extraField: 'rank', extraPlaceholder: '1' }) +

        UI.card(
          '<h2 class="text-base font-semibold text-stone-900">Shared access code</h2>' +
          '<p class="mt-0.5 mb-3 text-sm text-stone-500">' +
            'Everyone uses the same code. Changing it signs out every other device — ' +
            'they will need the new code next time they open the app.</p>' +
          '<div class="grid gap-3 sm:grid-cols-2">' +
            UI.field('New access code',
              UI.input('new-code', '', { id: 'new-code', type: 'password',
                placeholder: 'Leave blank to keep the current one' }),
              'At least 6 characters.') +
            UI.field('Type it again',
              UI.input('new-code-2', '', { id: 'new-code-2', type: 'password' })) +
          '</div>') +

        photoStorageCard() +

        '<div class="flex flex-wrap gap-2 pb-8">' +
          UI.button('Save settings', { action: 'settings-save', id: 'settings-save' }) +
          UI.button('Sign out of this device', { action: 'settings-signout', variant: 'quiet' }) +
        '</div>' +
      '</div>';
  };

  /**
   * Where the photos actually live. Worth saying out loud: they are the only
   * part of this app that is not in the Sheet, so "where did they go?" is a
   * fair question to have answered without digging through Drive.
   */
  function photoStorageCard() {
    var url = App.data.photoFolderUrl;

    return UI.card(
      '<h2 class="text-base font-semibold text-stone-900">Where photos are kept</h2>' +
      (url
        ? '<p class="mt-0.5 mb-3 text-sm text-stone-500">' +
            'In a folder called <strong>Instrument Tracker Photos</strong>, sitting next to ' +
            'the Google Sheet in Drive. Move or rename it whenever you like — the app finds ' +
            'it by its Drive ID, not by where it is.</p>' +
          '<a href="' + UI.esc(url) + '" target="_blank" rel="noopener" ' +
            'class="inline-flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 ' +
            'text-sm font-medium text-stone-700 hover:bg-stone-200">' +
            '📁 Open the photos folder</a>'
        : '<p class="mt-0.5 text-sm text-stone-500">' +
            'No photos have been saved yet. The first one creates a folder called ' +
            '<strong>Instrument Tracker Photos</strong> next to the Google Sheet in Drive.</p>'));
  }

  App.actions['ref-add'] = function (button) {
    var list = document.getElementById(button.dataset.value);
    var template = list.querySelector('[data-ref-row]');
    var row = template.cloneNode(true);
    row.dataset.id = '';                                  // no id yet — the server assigns one
    row.querySelectorAll('input[type="text"]').forEach(function (i) { i.value = ''; });
    row.querySelector('[data-ref-field="active"]').checked = true;
    list.appendChild(row);
    row.querySelector('input').focus();
  };

  function readReferenceList(listId, extraField) {
    var rows = [];
    document.querySelectorAll('#' + listId + ' [data-ref-row]').forEach(function (node) {
      var name = node.querySelector('[data-ref-field="name"]').value.trim();
      if (!name) return;                                  // blank rows are simply ignored
      var entry = {
        id: node.dataset.id || '',
        name: name,
        active: node.querySelector('[data-ref-field="active"]').checked
      };
      if (extraField) {
        var value = node.querySelector('[data-ref-field="' + extraField + '"]').value.trim();
        if (extraField === 'rank') entry.rank = Number(value) || 99;
        else entry[extraField] = value.toUpperCase();
      }
      rows.push(entry);
    });
    return rows;
  }

  App.actions['settings-save'] = async function (button) {
    var code1 = document.getElementById('new-code').value;
    var code2 = document.getElementById('new-code-2').value;

    if (code1 || code2) {
      if (code1 !== code2) { UI.toast('The two access codes do not match', 'error'); return; }
      if (code1.length < 6) { UI.toast('The access code needs at least 6 characters', 'error'); return; }
    }

    var payload = {
      centres: readReferenceList('ref-centres'),
      instrumentTypes: readReferenceList('ref-types', 'prefix'),
      qualityGrades: readReferenceList('ref-grades', 'rank')
    };
    if (code1) payload.new_access_code = code1;

    var restore = UI.busy(button, 'Saving…');
    try {
      var result = await Api.saveSettings(payload);
      if (result.access_code_changed) {
        // This device keeps working; every other one is signed out.
        Api.setCode(code1);
        UI.toast('Settings saved. Other devices will need the new code.', 'success');
      } else {
        UI.toast('Settings saved', 'success');
      }
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  App.actions['settings-signout'] = async function () {
    if (!await UI.confirm('Sign out of this device?',
        'You will need to type the access code again next time.', 'Sign out')) return;
    Api.clearCode();
    // Signing out must not leave the mandir's inventory readable on the device.
    App.clearSnapshot();
    window.location.hash = '#/';
    App.showUnlock('Signed out.');
  };
})();
