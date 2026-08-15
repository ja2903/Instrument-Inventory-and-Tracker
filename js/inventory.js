/**
 * Instrument Tracker — Inventory list, item detail, add/edit form, labels.
 */

(function () {
  'use strict';

  /* ================================================================
   * Shared pieces
   * ================================================================ */

  /** The "Out — via TAB-014 (Tabla Set A)" line, or the plain status. */
  function statusLine(item) {
    return '<p class="mt-1 text-sm text-stone-500">' + UI.esc(UI.describe(item)) + '</p>';
  }

  /**
   * One inventory row: tap the body to open it, or use Edit / Remove directly.
   *
   * The actions sit on the row itself rather than only on the detail page,
   * because tidying up a shelf means editing several things in a row and a
   * round trip through the detail screen each time is friction for no gain.
   */
  function itemRow(item, opts) {
    opts = opts || {};
    var kids = item.is_kit ? App.childrenOf(item.asset_id) : [];
    var outCount = kids.filter(function (k) { return k.status === 'checked_out'; }).length;

    return '<div class="group flex items-start gap-1 ' + (opts.nested ? 'pl-6 ' : '') + '">' +
      '<a href="#/item/' + encodeURIComponent(item.asset_id) + '" ' +
      'class="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 transition ' +
      'hover:bg-stone-50">' +

        '<span class="mt-0.5 shrink-0 text-xl" aria-hidden="true">' +
          (item.is_kit ? '🎒' : opts.nested ? '•' : '🎵') + '</span>' +

        '<span class="min-w-0 flex-1">' +
          '<span class="flex flex-wrap items-center gap-x-2 gap-y-1">' +
            '<span class="font-semibold text-stone-900">' + UI.esc(item.name) + '</span>' +
            '<span class="font-mono text-xs text-stone-400">' + UI.esc(item.asset_id) + '</span>' +
          '</span>' +
          '<span class="mt-0.5 block text-sm text-stone-500">' +
            UI.esc(UI.describe(item)) +
            (item.is_kit && kids.length
              ? ' · ' + kids.length + ' pieces' + (outCount ? ', ' + outCount + ' out' : '')
              : '') +
          '</span>' +
        '</span>' +

        '<span class="shrink-0">' + UI.statusPill(item) + '</span>' +
      '</a>' +

      '<span class="flex shrink-0 items-center gap-0.5 py-3">' +
        '<a href="#/edit/' + encodeURIComponent(item.asset_id) + '" title="Edit" ' +
          'class="rounded-lg p-2 text-stone-400 transition hover:bg-stone-100 ' +
          'hover:text-stone-700">' +
          '<span class="sr-only">Edit ' + UI.esc(item.name) + '</span>' +
          '<svg class="h-4.5 w-4.5" style="width:1.125rem;height:1.125rem" fill="none" ' +
            'viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" ' +
              'd="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 ' +
              '0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/>' +
          '</svg>' +
        '</a>' +
        '<button type="button" data-action="remove-item" ' +
          'data-value="' + UI.esc(item.asset_id) + '" title="Remove" ' +
          'class="rounded-lg p-2 text-stone-400 transition hover:bg-red-50 hover:text-red-600">' +
          '<span class="sr-only">Remove ' + UI.esc(item.name) + '</span>' +
          '<svg class="h-4.5 w-4.5" style="width:1.125rem;height:1.125rem" fill="none" ' +
            'viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" ' +
              'd="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165' +
              'L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 ' +
              '5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165' +
              'm0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 ' +
              '51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.2v.916m7.5 0a48.667 48.667 0 0 ' +
              '0-7.5 0"/>' +
          '</svg>' +
        '</button>' +
      '</span>' +
    '</div>';
  }

  /* ================================================================
   * Inventory list
   * ================================================================ */

  // Filter state survives navigating to an item and back, which is what a
  // volunteer working through a shelf actually does.
  /**
   * Inventory is a record of what the mandir owns, not a to-do list. Overdue
   * is deliberately absent from here — it belongs on the Dashboard, where you
   * act on it. Filtering a stock list by lateness only muddles the two jobs.
   */
  var filters = { q: '', centre: '', event: '', type: '', grade: '', status: '' };

  function emptyFilters() {
    return { q: '', centre: '', event: '', type: '', grade: '', status: '' };
  }

  function matchesFilters(item) {
    if (filters.q) {
      var needle = filters.q.toLowerCase();
      var hay = (item.name + ' ' + item.asset_id + ' ' + item.instrument_type + ' ' +
                 (item.storage_location || '') + ' ' + (item.notes || '')).toLowerCase();
      if (hay.indexOf(needle) === -1) return false;
    }
    if (filters.type && item.instrument_type !== filters.type) return false;
    if (filters.grade && item.quality_grade !== filters.grade) return false;

    if (filters.status && item.status !== filters.status) return false;

    if (filters.centre) {
      var centre = item.live ? item.live.centre : '';
      if (centre !== filters.centre) return false;
    }
    if (filters.event) {
      if (!item.live) return false;
      // Selecting a parent event includes everything under its sub-events.
      var matches = item.live.event_id === filters.event ||
                    item.live.sub_event_id === filters.event;
      if (!matches) return false;
    }
    return true;
  }

  /**
   * A kit parent stays visible when any of its children match, so filtering by
   * "overdue" never shows an orphaned hammer with no set around it.
   */
  function visibleGroups() {
    var groups = [];
    App.topLevelItems().forEach(function (item) {
      var kids = item.is_kit ? App.childrenOf(item.asset_id) : [];
      var matchingKids = kids.filter(matchesFilters);
      if (matchesFilters(item) || matchingKids.length) {
        groups.push({ parent: item, children: kids, matchingChildren: matchingKids });
      }
    });
    return groups;
  }

  function renderResults() {
    var host = document.getElementById('inventory-results');
    if (!host) return;

    var groups = visibleGroups();
    var count = groups.reduce(function (n, g) {
      return n + 1 + g.children.length;
    }, 0);

    var summary = document.getElementById('inventory-count');
    if (summary) {
      summary.textContent = groups.length
        ? UI.plural(groups.length, 'result') + (count !== groups.length ? ' · ' + count + ' items' : '')
        : 'No matches';
    }

    if (!groups.length) {
      host.innerHTML = UI.emptyState('🔍', 'Nothing matches those filters',
        'Try clearing the search or choosing fewer filters.',
        UI.button('Clear filters', { action: 'clear-filters', variant: 'secondary' }));
      return;
    }

    /*
     * Grouped by instrument type, not one flat list.
     *
     * Seventy-three rows in a single column is a scroll, not a list — you
     * cannot see at a glance how many harmoniums exist, which is the question
     * people actually arrive with. Categories collapse, and each header
     * carries its own available/out counts.
     */
    var byType = {};
    var typeOrder = [];
    groups.forEach(function (g) {
      var type = g.parent.instrument_type || 'Other';
      if (!byType[type]) { byType[type] = []; typeOrder.push(type); }
      byType[type].push(g);
    });

    // Settings order, so it matches every dropdown in the app.
    var settingsOrder = App.activeTypes().map(function (t) { return t.name; });
    typeOrder.sort(function (a, b) {
      var ia = settingsOrder.indexOf(a), ib = settingsOrder.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    // A search or a filter has already narrowed things down, so opening every
    // category is helpful then and overwhelming otherwise.
    var openByDefault = !!filters.q || hasActiveFilters() || typeOrder.length === 1;

    host.innerHTML = typeOrder.map(function (type) {
      var inType = byType[type];
      var pieces = inType.reduce(function (n, g) { return n + 1 + g.children.length; }, 0);
      var free = inType.filter(function (g) {
        return g.parent.status === 'available';
      }).length;
      var out = inType.filter(function (g) {
        return g.parent.status === 'checked_out';
      }).length;
      var attention = inType.filter(function (g) {
        return g.parent.status === 'maintenance' || g.parent.status === 'lost';
      }).length;

      return '<details class="overflow-hidden rounded-2xl bg-white shadow-sm ' +
        'ring-1 ring-stone-900/5"' + (openByDefault ? ' open' : '') + '>' +
        '<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5">' +
          '<span class="min-w-0 flex-1">' +
            '<span class="block text-base font-semibold text-stone-900">' +
              UI.esc(type) + '</span>' +
            '<span class="block text-xs text-stone-500">' +
              UI.plural(inType.length, 'item') +
              (pieces !== inType.length ? ' · ' + pieces + ' pieces in total' : '') +
              (out ? ' · ' + out + ' out' : '') +
              (attention ? ' · ' + attention + ' to fix' : '') + '</span>' +
          '</span>' +
          '<span class="shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ' +
            (free ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-500') + '">' +
            free + ' free</span>' +
          '<svg class="chevron h-5 w-5 shrink-0 text-stone-400 transition-transform" ' +
            'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
            'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
            'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
        '</summary>' +
        '<div class="border-t border-stone-100 p-2">' +
          inType.map(itemGroupHtml).join('') +
        '</div>' +
      '</details>';
    }).join('');
  }

  /** One instrument, or one set with its pieces folded inside. */
  function itemGroupHtml(g) {
      if (!g.parent.is_kit || !g.children.length) return itemRow(g.parent);

      // A set stays CLOSED until you ask for it. Showing six pieces of a tabla
      // set inline pushes everything else off the screen, and the pieces are
      // rarely what you came looking for — the set is.
      var out = g.children.filter(function (c) { return c.status === 'checked_out'; }).length;
      var attention = g.children.filter(function (c) {
        return c.status === 'maintenance' || c.status === 'lost';
      }).length;

      // Open it anyway when a filter matched a piece but not the set itself,
      // otherwise the result would look like an empty row.
      var forcedOpen = g.matchingChildren.length > 0 && !matchesFilters(g.parent);

      return '<details class="overflow-hidden rounded-xl"' + (forcedOpen ? ' open' : '') + '>' +
        '<summary class="cursor-pointer rounded-xl">' +
          '<span class="flex items-center gap-1">' +
            '<span class="min-w-0 flex-1">' + itemRow(g.parent) + '</span>' +
            '<span class="flex shrink-0 items-center gap-1.5 pr-2 text-xs text-stone-400">' +
              '<span class="hidden sm:inline">' + UI.plural(g.children.length, 'piece') +
                (out ? ' · ' + out + ' out' : '') +
                (attention ? ' · ' + attention + ' to fix' : '') + '</span>' +
              '<svg class="chevron h-5 w-5 transition-transform" fill="none" viewBox="0 0 24 24" ' +
                'stroke-width="2" stroke="currentColor" aria-hidden="true">' +
                '<path stroke-linecap="round" stroke-linejoin="round" ' +
                'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
            '</span>' +
          '</span>' +
        '</summary>' +
        '<div class="mt-1 border-t border-stone-100 pt-1">' +
          g.children.map(function (c) { return itemRow(c, { nested: true }); }).join('') +
        '</div>' +
      '</details>';
  }

  App.screens.inventory = function () {
    var typeNames = App.activeTypes().map(function (t) { return t.name; });
    var gradeNames = App.activeGrades().map(function (g) { return g.name; });

    return UI.pageTitle('Inventory', null,
        UI.button('+ Add instrument', { href: '#/add' })) +

      // --- filters ---
      '<div class="mb-4 space-y-3">' +
        // The Clear button is always in the DOM and merely hidden, so typing
        // never re-renders the screen. Re-rendering mid-word was what kept
        // stealing the caret and undoing select-on-focus.
        '<div class="relative">' +
          '<input type="search" id="filter-q" value="' + UI.esc(filters.q) + '" ' +
            'placeholder="Search name, ID, location…" autocomplete="off" ' +
            'class="' + UI.INPUT_CLASS + ' pr-20">' +
          '<button type="button" id="filter-clear" data-action="clear-search" ' +
            (filters.q ? '' : 'hidden ') +
            'class="absolute inset-y-0 right-0 my-1.5 mr-1.5 rounded-lg bg-stone-100 px-3 ' +
            'text-sm font-medium text-stone-600 hover:bg-stone-200">Clear</button>' +
        '</div>' +

        '<details class="rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/5"' +
          (hasActiveFilters() ? ' open' : '') + '>' +
          '<summary class="cursor-pointer px-4 py-3 text-sm font-medium text-stone-700">' +
            'Filters' +
            (hasActiveFilters()
              ? ' <span class="ml-1 rounded-full bg-saffron-100 px-2 py-0.5 text-xs ' +
                'font-semibold text-saffron-800">on</span>'
              : '') +
          '</summary>' +
          '<div class="grid gap-3 border-t border-stone-100 p-4 sm:grid-cols-2 lg:grid-cols-3">' +
            UI.field('Status', UI.select('filter-status', [
              { value: 'available', label: 'Available' },
              { value: 'checked_out', label: 'Out' },
              { value: 'maintenance', label: 'Maintenance' },
              { value: 'lost', label: 'Lost' }
            ], filters.status, { placeholder: 'Any status', id: 'filter-status' })) +

            UI.field('Instrument type',
              UI.select('filter-type', typeNames, filters.type,
                { placeholder: 'Any type', id: 'filter-type' })) +

            UI.field('Quality grade',
              UI.select('filter-grade', gradeNames, filters.grade,
                { placeholder: 'Any grade', id: 'filter-grade' })) +

            UI.field('Centre (currently out to)',
              UI.select('filter-centre', App.activeCentres(), filters.centre,
                { placeholder: 'Any centre', id: 'filter-centre' })) +

            UI.field('Event / sub-event',
              UI.select('filter-event', App.eventOptions(true), filters.event,
                { placeholder: 'Any event', id: 'filter-event' })) +
          '</div>' +
          '<div class="border-t border-stone-100 px-4 py-3">' +
            UI.button('Clear all filters', { action: 'clear-filters', variant: 'quiet' }) +
          '</div>' +
        '</details>' +

        '<p id="inventory-count" class="px-1 text-sm text-stone-500"></p>' +
      '</div>' +

      '<div id="inventory-results" class="space-y-3"></div>';
  };

  function hasActiveFilters() {
    return !!(filters.centre || filters.event || filters.type ||
              filters.grade || filters.status);
  }

  App.screens.inventory.mount = function () {
    var search = document.getElementById('filter-q');
    search.addEventListener('input', function () {
      filters.q = search.value;
      document.getElementById('filter-clear').hidden = !filters.q;
      renderResults();
    });

    /*
     * Tapping a box that already has text should let you type over it, not
     * append to it — without this you get "Bug TestTabla Set A".
     *
     * Selecting inside the focus handler is not enough: the click that caused
     * the focus lands afterwards and collapses the selection to a caret. So
     * the select is deferred to the next tick, and a flag stops the mouseup
     * from undoing it.
     */
    var selectOnNextFocus = true;
    search.addEventListener('focus', function () {
      if (!selectOnNextFocus) return;
      selectOnNextFocus = false;
      setTimeout(function () {
        var el = document.getElementById('filter-q');
        if (el && document.activeElement === el && el.value) el.select();
      }, 0);
    });
    search.addEventListener('mouseup', function (e) { e.preventDefault(); });
    search.addEventListener('blur', function () { selectOnNextFocus = true; });

    [['filter-status', 'status'], ['filter-type', 'type'], ['filter-grade', 'grade'],
     ['filter-centre', 'centre'], ['filter-event', 'event']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      el.addEventListener('change', function () {
        filters[pair[1]] = el.value;
        renderResults();
      });
    });

    renderResults();
  };

  App.actions['clear-filters'] = function () {
    filters = emptyFilters();
    App.render();
  };

  App.actions['clear-search'] = function () {
    filters.q = '';
    var search = document.getElementById('filter-q');
    search.value = '';
    document.getElementById('filter-clear').hidden = true;
    renderResults();
    search.focus();
  };

  /**
   * Filters survive a trip to an item and back — that is what working along a
   * shelf feels like. They do NOT survive coming to Instruments from the nav,
   * because a search silently reappearing days later reads as a bug rather
   * than as a convenience.
   */
  App.onNavigate(function (from, to) {
    if (to !== 'inventory') return;
    var cameFromDetail = from === 'item' || from === 'edit' || from === 'add' ||
                         from === 'labels';
    if (!cameFromDetail) filters = emptyFilters();
  });

  /** Used by the dashboard tiles that lead here. */
  App.setInventoryFilter = function (patch) {
    filters = Object.assign(emptyFilters(), patch);
  };

  /* ================================================================
   * Item detail
   * ================================================================ */

  function attributeRow(label, value) {
    return '<div class="flex justify-between gap-4 border-b border-stone-100 py-2.5 last:border-0">' +
      '<dt class="text-sm text-stone-500">' + UI.esc(label) + '</dt>' +
      '<dd class="text-right text-sm font-medium text-stone-800">' + (value || '—') + '</dd></div>';
  }

  function movementRow(m) {
    var back = !!m.checked_in_at;
    var outcome = m.outcome === 'missing'
      ? '<span class="font-semibold text-rose-700">Not returned</span>'
      : m.outcome === 'damaged'
        ? '<span class="font-semibold text-amber-700">Returned damaged</span>'
        : back ? 'Returned' : '<span class="font-semibold text-blue-700">Still out</span>';

    var where = [m.centre, m.event_name, m.sub_event_name].filter(Boolean).join(' — ');

    return '<li class="border-b border-stone-100 py-3 last:border-0">' +
      '<div class="flex flex-wrap items-baseline justify-between gap-2">' +
        '<span class="text-sm font-medium text-stone-800">' + UI.esc(where || 'Given out') + '</span>' +
        '<span class="text-xs text-stone-400">' + UI.esc(UI.timestamp(m.checked_out_at)) + '</span>' +
      '</div>' +
      '<div class="mt-1 text-sm text-stone-500">' +
        'Out by ' + UI.esc(m.checked_out_by || '—') +
        (m.via_parent_asset_id
          ? ' · with ' + UI.esc(m.via_parent_asset_id)
          : '') +
        ' · due ' + UI.esc(UI.dayMonth(m.expected_return_date) || '—') +
      '</div>' +
      '<div class="mt-1 text-sm">' + outcome +
        (back
          ? ' ' + UI.esc(UI.timestamp(m.checked_in_at)) +
            (m.checked_in_by ? ' by ' + UI.esc(m.checked_in_by) : '') +
            (m.condition_in ? ' · ' + UI.esc(UI.conditionLabel(m.condition_in)) : '')
          : m.days_overdue > 0
            ? ' · <span class="font-semibold text-red-700">' +
              UI.esc(UI.daysLate(m.days_overdue)) + '</span>'
            : '') +
      '</div>' +
      (m.damage_notes
        ? '<p class="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">' +
          UI.esc(m.damage_notes) + '</p>'
        : '') +

      // Photos taken as it left and as it came back. Stored all along; they
      // simply were not being shown, which made taking them feel pointless.
      '<div class="mt-2 flex flex-wrap items-center gap-2">' +
        UI.photoThumb(m.photo_out_url, 'Going out') +
        UI.photoThumb(m.photo_in_url, m.outcome === 'damaged' ? 'Damage' : 'Coming back') +

        '<button type="button" data-action="movement-photo" ' +
          'data-value="' + UI.esc(m.movement_id) + '" ' +
          'data-kind="' + (m.checked_in_at ? 'in' : 'out') + '" ' +
          'class="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 ' +
          'ring-1 ring-inset ring-stone-200 hover:bg-stone-50">' +
          (m.checked_in_at
            ? (m.photo_in_url ? 'Retake' : '📷 Add photo')
            : (m.photo_out_url ? 'Retake' : '📷 Add photo')) +
        '</button>' +

        // One Delete per photo that actually exists, so it is always obvious
        // which of the two is about to go.
        (m.photo_out_url
          ? deletePhotoButton(m.movement_id, 'out', false,
              m.photo_in_url ? 'Delete "going out"' : 'Delete photo')
          : '') +
        (m.photo_in_url
          ? deletePhotoButton(m.movement_id, 'in', m.outcome === 'damaged',
              m.photo_out_url
                ? (m.outcome === 'damaged' ? 'Delete damage photo' : 'Delete "coming back"')
                : 'Delete photo')
          : '') +
      '</div>' +
    '</li>';
  }

  /**
   * The most recent damaged or missing return, if the item is still out of
   * action because of it. Returns '' once the item is back in use — old
   * damage that has since been repaired belongs in the history, not at the top.
   */
  function damagePanel(loaded, item) {
    if (!loaded) return '';
    if (item.status !== 'maintenance' && item.status !== 'lost') return '';

    var incident = null;
    for (var i = 0; i < loaded.movements.length; i++) {   // newest first
      var m = loaded.movements[i];
      if (m.outcome === 'damaged' || m.outcome === 'missing') { incident = m; break; }
    }
    if (!incident) return '';

    var lost = incident.outcome === 'missing';
    return '<div class="mb-4 overflow-hidden rounded-2xl ' +
      (lost ? 'bg-rose-50 ring-1 ring-rose-200' : 'bg-amber-50 ring-1 ring-amber-200') + '">' +
      '<div class="p-4">' +
        '<h2 class="text-base font-semibold ' +
          (lost ? 'text-rose-900' : 'text-amber-900') + '">' +
          (lost ? 'Not returned' : 'Damaged') + '</h2>' +
        '<p class="mt-0.5 text-sm ' + (lost ? 'text-rose-800' : 'text-amber-800') + '">' +
          UI.esc(incident.damage_notes || 'No note was left.') + '</p>' +
        '<p class="mt-1 text-xs ' + (lost ? 'text-rose-700/80' : 'text-amber-700/80') + '">' +
          UI.esc([incident.centre, incident.event_name, incident.sub_event_name]
            .filter(Boolean).join(' — ')) +
          (incident.checked_in_at ? ' · ' + UI.esc(UI.timestamp(incident.checked_in_at)) : '') +
          (incident.checked_in_by ? ' · ' + UI.esc(incident.checked_in_by) : '') + '</p>' +
      '</div>' +

      (incident.photo_in_url
        ? '<button type="button" data-action="view-photo" ' +
            'data-value="' + UI.esc(incident.photo_in_url) + '" ' +
            'data-caption="' + UI.esc(item.name + ' — ' + (lost ? 'last seen' : 'damage')) + '" ' +
            'class="block w-full">' +
            '<img src="' + UI.esc(incident.photo_in_url) + '" ' +
              'alt="Photo of the damage to ' + UI.esc(item.name) + '" ' +
              'class="max-h-72 w-full bg-white object-contain">' +
          '</button>'
        : '<p class="px-4 pb-3 text-xs ' + (lost ? 'text-rose-700' : 'text-amber-700') + '">' +
          'No photo was taken.</p>') +

      '<div class="flex gap-2 px-4 py-3">' +
        '<button type="button" data-action="movement-photo" ' +
          'data-value="' + UI.esc(incident.movement_id) + '" data-kind="in" ' +
          'class="rounded-lg bg-white px-3 py-2 text-xs font-semibold ' +
          (lost ? 'text-rose-800' : 'text-amber-900') + ' ring-1 ring-inset ' +
          (lost ? 'ring-rose-200' : 'ring-amber-200') + '">' +
          (incident.photo_in_url ? '📷 Retake the photo' : '📷 Add a photo') + '</button>' +
        (incident.photo_out_url
          ? '<button type="button" data-action="view-photo" ' +
            'data-value="' + UI.esc(incident.photo_out_url) + '" ' +
            'data-caption="' + UI.esc(item.name + ' — before it went out') + '" ' +
            'class="rounded-lg bg-white px-3 py-2 text-xs font-medium text-stone-600 ' +
            'ring-1 ring-inset ring-stone-200">Compare with before</button>'
          : '') +
        (incident.photo_in_url
          ? deletePhotoButton(incident.movement_id, 'in', !lost, 'Delete', 'panel')
          : '') +
      '</div>' +
    '</div>';
  }

  App.actions['view-photo'] = function (button) {
    UI.showPhoto(button.dataset.value, button.dataset.caption || '');
  };

  /**
   * Take a photo against a past movement, replacing whatever is there.
   *
   * The first attempt is often taken in a hurry in a badly lit store room, and
   * a clearer one of the same damage is strictly better. The old file stays in
   * Drive — the row just stops pointing at it — so retaking can never destroy
   * the earlier evidence.
   */
  App.actions['movement-photo'] = async function (button) {
    var movementId = button.dataset.value;
    var kind = button.dataset.kind === 'out' ? 'out' : 'in';
    var item = App.itemById(detailCache.assetId) || {};

    var dataUrl = await App.takePhoto(item.name || 'Photo');
    if (!dataUrl) return;

    var restore = UI.busy(button, 'Uploading…');
    try {
      var uploaded = await Api.uploadPhoto({
        data_url: dataUrl, asset_id: detailCache.assetId, kind: kind
      });
      await Api.setMovementPhoto({
        movement_id: movementId, kind: kind, photo_url: uploaded.photo_url
      });

      detailCache = { assetId: null, data: null };
      UI.toast('Photo saved', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  /**
   * Delete a photo outright — off the record, and into the Drive bin.
   *
   * Photos get taken by accident: a thumb over the lens, the wrong instrument,
   * somebody's front room in the background. Retaking covers a bad photo of the
   * right thing; this covers a photo that should not exist at all.
   */
  App.actions['photo-delete'] = async function (button) {
    var movementId = button.dataset.value;
    var kind = button.dataset.kind === 'out' ? 'out' : 'in';
    var isDamage = button.dataset.damage === '1';

    var yes = await UI.confirm(
      'Delete this photo?',
      isDamage
        ? 'This is the only photo of the damage, and deleting it leaves no picture ' +
          'of what happened. The record itself stays. The file goes to the Drive bin, ' +
          'where it can be recovered for 30 days.'
        : 'The file goes to the Drive bin, where it can be recovered for 30 days. ' +
          'The rest of the record is not affected.',
      'Delete photo', true);
    if (!yes) return;

    var restore = UI.busy(button, 'Deleting…');
    try {
      await Api.deletePhoto({ movement_id: movementId, kind: kind, confirm: true });
      detailCache = { assetId: null, data: null };
      UI.toast('Photo deleted', 'success');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  /**
   * The small "Delete" beside a photo that exists.
   *
   * `label` matters when a movement has both photos: two buttons both saying
   * "Delete" is a coin toss, and the wrong one loses the damage evidence.
   */
  function deletePhotoButton(movementId, kind, isDamage, label, tone) {
    return '<button type="button" data-action="photo-delete" ' +
      'data-value="' + UI.esc(movementId) + '" data-kind="' + kind + '" ' +
      'data-damage="' + (isDamage ? '1' : '0') + '" ' +
      'class="rounded-lg px-2.5 py-1.5 text-xs font-medium ' +
      (tone === 'panel'
        ? 'bg-white text-red-700 ring-1 ring-inset ring-red-200'
        : 'text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50') + '">' +
      '🗑 ' + UI.esc(label || 'Delete') + '</button>';
  }

  var detailCache = { assetId: null, data: null };

  // A check-in that happened elsewhere changes this item's history, so drop it.
  App.onRefresh(function () { detailCache = { assetId: null, data: null }; });

  App.screens.item = function (params) {
    var assetId = params[0];
    var item = App.itemById(assetId);
    if (!item) {
      return UI.pageTitle('Item not found') +
        UI.emptyState('🤷', 'No item with ID ' + assetId,
          'It may have been renamed.', UI.button('Back to inventory', { href: '#/inventory' }));
    }

    var loaded = detailCache.assetId === assetId ? detailCache.data : null;
    var kids = App.childrenOf(assetId);

    return '<a href="#/inventory" class="mb-4 inline-flex items-center gap-1 text-sm ' +
      'font-medium text-stone-500 hover:text-stone-800">← Inventory</a>' +

      '<div class="mb-5">' +
        '<div class="flex flex-wrap items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<h1 class="text-2xl font-bold tracking-tight text-stone-900">' +
              UI.esc(item.name) + '</h1>' +
            '<p class="mt-1 font-mono text-sm text-stone-400">' + UI.esc(item.asset_id) + '</p>' +
          '</div>' +
          UI.statusPill(item) +
        '</div>' +
        '<p class="mt-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-700 shadow-sm ' +
          'ring-1 ring-stone-900/5">' + UI.esc(UI.describe(item)) + '</p>' +
      '</div>' +

      '<div class="mb-4 flex flex-wrap gap-2">' +
        UI.button('Edit', { href: '#/edit/' + encodeURIComponent(assetId), variant: 'secondary' }) +
        UI.button('Print label', { action: 'label-one', value: assetId, variant: 'secondary' }) +
        (item.status === 'checked_out'
          ? UI.button('Take it back', { action: 'quick-checkin', value: assetId })
          : item.status === 'available'
            ? UI.button('Give it out', { action: 'quick-checkout', value: assetId })
            : '') +
        UI.button('Remove', { action: 'remove-item', value: assetId, variant: 'quiet' }) +
      '</div>' +

      '<div class="grid gap-4 lg:grid-cols-2">' +
        /*
         * The damage photo, right at the top, whenever the item is out of
         * action. If a harmonium is in maintenance, "what is wrong with it"
         * is the only question anyone opening this page has — burying the
         * answer three screens down in the history was the wrong call.
         */
        damagePanel(loaded, item) +

        UI.card(
          '<h2 class="mb-2 text-base font-semibold text-stone-900">Details</h2><dl>' +
          attributeRow('Instrument type', UI.esc(item.instrument_type)) +
          attributeRow('Quality grade', UI.esc(item.quality_grade)) +
          attributeRow('Condition', UI.esc(UI.conditionLabel(item.current_condition))) +
          attributeRow('Storage location', UI.esc(item.storage_location)) +
          (item.parent_asset_id
            ? attributeRow('Part of', '<a class="text-saffron-700 underline" href="#/item/' +
                encodeURIComponent(item.parent_asset_id) + '">' +
                UI.esc(item.parent_asset_id) + '</a>')
            : '') +
          (item.is_kit ? attributeRow('Set', kids.length + ' pieces') : '') +
          (item.notes ? attributeRow('Notes', UI.esc(item.notes)) : '') +
          '</dl>') +

        (item.is_kit && kids.length
          ? UI.card(
              '<h2 class="mb-1 text-base font-semibold text-stone-900">Pieces in this set</h2>' +
              '<p class="mb-2 text-sm text-stone-500">Each piece has its own label.</p>' +
              '<div class="-mx-2">' +
              kids.map(function (k) { return itemRow(k); }).join('') + '</div>')
          : '') +
      '</div>' +

      '<div class="mt-4">' +
        UI.card(
          '<h2 class="mb-1 text-base font-semibold text-stone-900">Where it has been</h2>' +
          '<div id="item-history">' +
            (loaded
              ? (loaded.movements.length
                  ? '<ul class="-mb-3">' + loaded.movements.map(movementRow).join('') + '</ul>'
                  : '<p class="py-6 text-center text-sm text-stone-400">' +
                    'This item has never left the store.</p>')
              : UI.spinner('Loading history…')) +
          '</div>') +
      '</div>';
  };

  App.screens.item.mount = async function (params) {
    var assetId = params[0];
    if (!App.itemById(assetId)) return;
    if (detailCache.assetId === assetId && detailCache.data) return;

    try {
      var detail = await Api.item(assetId);
      detailCache = { assetId: assetId, data: detail };
      if (App.route.name === 'item' && App.route.params[0] === assetId) App.render();
    } catch (e) {
      var host = document.getElementById('item-history');
      if (host) host.innerHTML = UI.errorPanel('Could not load history', e.message);
    }
  };

  App.actions['remove-item'] = async function (button) {
    var assetId = button.dataset.value;
    var item = App.itemById(assetId);
    var kids = item && item.is_kit ? App.childrenOf(assetId) : [];

    var message = kids.length
      ? 'This will also remove all ' + kids.length + ' pieces in the set. ' +
        'Nothing is deleted — the items stay in the history, they just ' +
        'drop out of the inventory list.'
      : 'Nothing is deleted — the item stays in the history, it just ' +
        'drops out of the inventory list.';

    if (!await UI.confirm('Remove ' + item.name + '?', message, 'Remove', true)) return;

    var restore = UI.busy(button, 'Removing…');
    try {
      var result = await Api.removeItem(assetId);
      detailCache = { assetId: null, data: null };
      UI.toast(UI.plural(result.removed.length, 'item') + ' removed', 'success');
      App.go('#/inventory');
      await App.refresh({ showSpinner: false });
    } catch (e) {
      App.handleError(e);
      restore();
    }
  };

  /* ================================================================
   * Add / edit instrument
   * ================================================================ */

  // Draft children live here between renders so adding a row does not lose
  // what has already been typed into the others.
  var draftChildren = [];
  var draftKey = null;

  function childRowHtml(child, index) {
    var typeNames = App.activeTypes().map(function (t) { return t.name; });
    return '<div class="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200" data-child="' + index + '">' +
      '<div class="grid gap-3 sm:grid-cols-[1fr_10rem_8rem_auto] sm:items-end">' +
        UI.field('Piece name',
          '<input type="text" data-child-field="name" value="' + UI.esc(child.name || '') + '" ' +
          'placeholder="e.g. Dayyu" class="' + UI.INPUT_CLASS + '">') +
        UI.field('Type',
          UI.select('child-type-' + index, typeNames, child.instrument_type,
            { id: 'child-type-' + index, class: 'child-type' })) +
        UI.field('Asset ID',
          '<input type="text" data-child-field="asset_id" value="' + UI.esc(child.asset_id || '') + '" ' +
          'placeholder="auto" class="' + UI.INPUT_CLASS + ' font-mono text-sm">') +
        '<button type="button" data-action="remove-child" data-value="' + index + '" ' +
          'class="mb-1 rounded-lg px-3 py-3 text-sm font-medium text-red-600 hover:bg-red-50">' +
          'Remove</button>' +
      '</div>' +
      (child.asset_id && child._existing
        ? '<p class="mt-2 text-xs text-stone-400">Already labelled as ' +
          UI.esc(child.asset_id) + ' — changing this ID will not change the printed sticker.</p>'
        : '') +
    '</div>';
  }

  function renderChildren() {
    var host = document.getElementById('children-list');
    if (!host) return;
    host.innerHTML = draftChildren.length
      ? draftChildren.map(childRowHtml).join('')
      : '<p class="rounded-xl border-2 border-dashed border-stone-200 px-4 py-6 text-center ' +
        'text-sm text-stone-500">No pieces yet. A tabla set usually has a dayyu, a bayyu, ' +
        'a hammer, a powder bottle and a bag.</p>';
  }

  /** Reads the typed values back out of the DOM before a re-render. */
  function captureChildren() {
    document.querySelectorAll('[data-child]').forEach(function (node) {
      var index = Number(node.dataset.child);
      if (!draftChildren[index]) return;
      draftChildren[index].name = node.querySelector('[data-child-field="name"]').value;
      draftChildren[index].asset_id = node.querySelector('[data-child-field="asset_id"]').value;
      draftChildren[index].instrument_type = node.querySelector('.child-type').value;
    });
  }

  App.screens.add = function () { return itemForm(null); };
  App.screens.edit = function (params) { return itemForm(params[0]); };

  function itemForm(assetId) {
    var editing = assetId ? App.itemById(assetId) : null;
    if (assetId && !editing) {
      return UI.pageTitle('Item not found') +
        UI.emptyState('🤷', 'No item with ID ' + assetId, '',
          UI.button('Back to inventory', { href: '#/inventory' }));
    }

    // Reset the draft when we open a different item than last time.
    var key = editing ? editing.asset_id : '__new__';
    if (draftKey !== key) {
      draftKey = key;
      draftChildren = editing && editing.is_kit
        ? App.childrenOf(editing.asset_id).map(function (c) {
            return {
              name: c.name, asset_id: c.asset_id,
              instrument_type: c.instrument_type, _existing: true
            };
          })
        : [];
    }

    var typeNames = App.activeTypes().map(function (t) { return t.name; });
    var gradeNames = App.activeGrades().map(function (g) { return g.name; });
    var isKit = editing ? editing.is_kit : false;

    return '<a href="' + (editing ? '#/item/' + encodeURIComponent(editing.asset_id) : '#/inventory') +
      '" class="mb-4 inline-flex items-center gap-1 text-sm font-medium text-stone-500 ' +
      'hover:text-stone-800">← Back</a>' +

      UI.pageTitle(editing ? 'Edit instrument' : 'Add instrument') +

      '<form id="item-form" class="space-y-4">' +

        UI.card(
          '<div class="grid gap-4 sm:grid-cols-2">' +
            '<div class="sm:col-span-2">' +
              UI.field('Name',
                UI.input('name', editing ? editing.name : '',
                  { required: true, placeholder: 'e.g. Tabla Set A, or Harmonium (Bina)' })) +
            '</div>' +

            UI.field('Instrument type',
              UI.select('instrument_type', typeNames,
                editing ? editing.instrument_type : '',
                { required: true, placeholder: 'Choose a type', id: 'instrument_type' })) +

            UI.field('Asset ID',
              UI.input('asset_id', editing ? editing.asset_id : '',
                { class: 'font-mono', placeholder: 'Choose a type first' }),
              'Printed under the QR code. Suggested automatically — change it only if you ' +
              'already have a numbering system.') +

            UI.field('Quality grade',
              UI.select('quality_grade', gradeNames,
                editing ? editing.quality_grade : (gradeNames[1] || gradeNames[0]),
                { required: true, id: 'quality_grade' })) +

            UI.field('Condition',
              UI.select('current_condition', [
                { value: 'excellent', label: 'Excellent' },
                { value: 'good', label: 'Good' },
                { value: 'fair', label: 'Fair' },
                { value: 'needs_repair', label: 'Needs repair' }
              ], editing ? editing.current_condition : 'good', { id: 'current_condition' })) +

            UI.field('Storage location',
              UI.input('storage_location', editing ? editing.storage_location : '',
                { placeholder: 'e.g. Store Room 2, Shelf B' })) +

            (editing && editing.status !== 'checked_out'
              ? UI.field('Status',
                  UI.select('status', [
                    { value: 'available', label: 'Available' },
                    { value: 'maintenance', label: 'In maintenance' },
                    { value: 'lost', label: 'Lost' }
                  ], editing.status, { id: 'status' }))
              : '<div></div>') +

            '<div class="sm:col-span-2">' +
              UI.field('Notes', UI.textarea('notes', editing ? editing.notes : '',
                { placeholder: 'Anything worth knowing — spare parts, quirks, who donated it' })) +
            '</div>' +
          '</div>') +

        UI.card(
          '<div class="flex items-start gap-3">' +
            '<input type="checkbox" id="is_kit" name="is_kit" ' + (isKit ? 'checked ' : '') +
              'class="mt-1 h-5 w-5 rounded border-stone-300 text-saffron-600 ' +
              'focus:ring-saffron-500">' +
            '<label for="is_kit" class="cursor-pointer">' +
              '<span class="block font-semibold text-stone-900">This is a set with several pieces</span>' +
              '<span class="mt-0.5 block text-sm text-stone-500">' +
                'Like a tabla set: dayyu, bayyu, hammer, powder bottle and bag. Each piece gets ' +
                'its own label, and scanning the set takes them all out together.</span>' +
            '</label>' +
          '</div>' +

          '<div id="kit-section" class="' + (isKit ? '' : 'hidden ') + 'mt-5 border-t ' +
            'border-stone-100 pt-5">' +
            '<h3 class="mb-3 text-sm font-semibold text-stone-800">Pieces in this set</h3>' +
            '<div id="children-list" class="space-y-3"></div>' +
            '<div class="mt-3">' +
              UI.button('+ Add a piece', { action: 'add-child', variant: 'secondary' }) +
            '</div>' +
          '</div>') +

        '<div class="flex flex-wrap gap-2 pb-4">' +
          UI.button(editing ? 'Save changes' : 'Save and show label',
            { type: 'submit', id: 'save-item' }) +
          UI.button('Cancel', {
            href: editing ? '#/item/' + encodeURIComponent(editing.asset_id) : '#/inventory',
            variant: 'secondary'
          }) +
        '</div>' +
      '</form>' +

      '<div id="label-preview" class="mt-2"></div>';
  }

  App.screens.add.mount = App.screens.edit.mount = function (params) {
    /*
     * itemForm() returns an "Item not found" page instead of the form when the
     * asset ID does not resolve — and this mount then ran anyway, dereferenced
     * a null #is_kit, and threw. An uncaught TypeError in a mount takes the
     * whole app down, so the graceful message was never actually seen: you got
     * a dead screen instead.
     *
     * The ID stops resolving more easily than it looks. Editing an instrument
     * and changing its asset ID leaves the old #/edit/OLD-ID route pointing at
     * nothing, so a Back tap lands here; so does opening an instrument someone
     * else has just removed.
     */
    var form = document.getElementById('item-form');
    if (!form) return;

    var editing = params[0] ? App.itemById(params[0]) : null;
    renderChildren();

    var kitToggle = document.getElementById('is_kit');
    kitToggle.addEventListener('change', function () {
      captureChildren();
      document.getElementById('kit-section').classList.toggle('hidden', !kitToggle.checked);
      if (kitToggle.checked && !draftChildren.length) {
        draftChildren = [{ name: '', asset_id: '', instrument_type: '' }];
        renderChildren();
      }
    });

    // Suggest an asset ID as soon as a type is chosen, but never overwrite one
    // the karyakar has typed.
    var typeSelect = document.getElementById('instrument_type');
    var assetInput = document.querySelector('#item-form [name="asset_id"]');
    typeSelect.addEventListener('change', async function () {
      if (editing || !typeSelect.value) return;
      if (assetInput.value.trim() && assetInput.dataset.suggested !== 'true') return;
      try {
        var result = await Api.suggestAssetId(typeSelect.value);
        assetInput.value = result.asset_id;
        assetInput.dataset.suggested = 'true';
      } catch (e) { /* the karyakar can type one; not worth an error toast */ }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveItem(editing);
    });
  };

  App.actions['add-child'] = function () {
    captureChildren();
    draftChildren.push({ name: '', asset_id: '', instrument_type: '' });
    renderChildren();
  };

  App.actions['remove-child'] = function (button) {
    captureChildren();
    // Just drop it from the list. saveItem() works out which existing pieces
    // are missing and marks those for removal, so nothing needs flagging here.
    draftChildren.splice(Number(button.dataset.value), 1);
    renderChildren();
  };

  async function saveItem(editing) {
    var form = document.getElementById('item-form');
    var button = document.getElementById('save-item');
    captureChildren();

    var payload = {
      name: form.name.value.trim(),
      asset_id: form.asset_id.value.trim(),
      instrument_type: form.instrument_type.value,
      quality_grade: form.quality_grade.value,
      current_condition: form.current_condition.value,
      storage_location: form.storage_location.value.trim(),
      notes: form.notes.value.trim(),
      is_kit: document.getElementById('is_kit').checked
    };
    if (form.status) payload.status = form.status.value;
    if (editing) payload.original_asset_id = editing.asset_id;

    if (payload.is_kit) {
      /*
       * A set with no named pieces used to save silently as a plain item —
       * the tick vanished, no chevron appeared, and nothing said why. Rows with
       * an id but no name are just as bad: the server would reject them.
       * So ask, in the two ways this can go wrong.
       */
      var named = draftChildren.filter(function (c) { return c.name.trim(); });
      var halfFilled = draftChildren.filter(function (c) {
        return !c.name.trim() && c.asset_id.trim();
      });

      if (halfFilled.length) {
        UI.toast('Every piece needs a name', 'error');
        var blank = document.querySelector('[data-child-field="name"]');
        if (blank) blank.focus();
        return;
      }

      var keepingExisting = editing
        ? App.childrenOf(editing.asset_id).filter(function (existing) {
            return draftChildren.some(function (c) {
              return c.asset_id.trim() === existing.asset_id;
            });
          }).length
        : 0;

      if (!named.length && !keepingExisting) {
        var carryOn = await UI.confirm(
          'This set has no pieces',
          'You ticked "This is a set with several pieces" but have not named any. ' +
          'Save it as a single instrument instead, or go back and add the pieces — ' +
          'for a tabla set that would be the dayyu, bayyu, hammer and so on.',
          'Save as a single instrument');
        if (!carryOn) return;
        payload.is_kit = false;
      }
    }

    if (payload.is_kit) {
      payload.children = draftChildren
        .filter(function (c) { return c.name.trim() || c.asset_id.trim(); })
        .map(function (c) {
          return {
            name: c.name.trim(),
            asset_id: c.asset_id.trim(),
            instrument_type: c.instrument_type || payload.instrument_type
          };
        });
      // Anything that was there before and is no longer listed gets deactivated.
      if (editing) {
        var keeping = {};
        payload.children.forEach(function (c) { if (c.asset_id) keeping[c.asset_id] = true; });
        App.childrenOf(editing.asset_id).forEach(function (existing) {
          if (!keeping[existing.asset_id]) {
            payload.children.push({ asset_id: existing.asset_id, _delete: true });
          }
        });
      }
    }

    var restore = UI.busy(button, 'Saving…');
    try {
      var result = await Api.saveItem(payload);
      detailCache = { assetId: null, data: null };
      draftKey = null;
      UI.toast(editing ? 'Changes saved' : 'Instrument added', 'success');

      await App.refresh({ showSpinner: false });

      if (!editing) {
        // Straight to the label — a new instrument needs a sticker before it
        // is any use, and this is the moment the karyakar is holding it.
        showLabelsFor(result.items.map(function (i) { return i.asset_id; }));
      } else {
        App.go('#/item/' + encodeURIComponent(result.asset_id));
      }
    } catch (e) {
      App.handleError(e);
      restore();
    }
  }

  /* ================================================================
   * Labels
   * ================================================================ */

  var labelSelection = {};   // asset_id -> true
  var labelSheet = 'avery';  // 'avery' (L7160/J8160) or 'plain' (cut them out)

  /**
   * Which items get the big luggage-style tag: the set itself, and the bag or
   * case it lives in. Both are tied on rather than stuck to an instrument.
   */
  function isBagLabel(item) {
    return item.is_kit || /\bbag\b|\bcase\b/i.test(item.name);
  }

  /** One printable label. Kit bags get the bigger 40mm tag. */
  function labelHtml(item) {
    var parent = item.parent_asset_id ? App.itemById(item.parent_asset_id) : null;
    var isBag = isBagLabel(item);

    var svg;
    try {
      // quiet: 2 rather than the default 4. The label's own 2.5mm white padding
      // supplies the rest of the quiet zone, which lets the black symbol fill
      // more of the box — that is how a 30mm box yields a 25mm symbol.
      // The sums are worked through in css/app.css under "printing".
      svg = QR.toSvg(item.asset_id, { quiet: 2 });
    } catch (e) {
      svg = '<div class="text-xs text-red-600">ID too long for a QR code</div>';
    }

    return '<div class="label' + (isBag ? ' label-bag' : '') + '">' +
      '<div class="label-qr">' + svg + '</div>' +
      '<div class="label-text">' +
        '<div class="label-id">' + UI.esc(item.asset_id) + '</div>' +
        '<div class="label-name">' + UI.esc(item.name) + '</div>' +
        (parent
          ? '<div class="label-parent">Part of: ' + UI.esc(parent.name) +
            ' (' + UI.esc(parent.asset_id) + ')</div>'
          : '') +
        '<div class="label-org">Property of ' + UI.esc(CONFIG.ORGANISATION) + '</div>' +
      '</div>' +
    '</div>';
  }

  App.screens.labels = function () {
    var selectedIds = Object.keys(labelSelection).filter(function (id) { return labelSelection[id]; });
    var selected = selectedIds.map(App.itemById).filter(Boolean);

    // Bag tags need a 48mm QR box, which is taller than an Avery label — so
    // they are printed separately rather than squeezed or straddling two.
    var bagLabels = selected.filter(isBagLabel);
    var normalLabels = selected.filter(function (i) { return !isBagLabel(i); });

    // 21 address labels per sheet; 4 bag tags per plain sheet.
    var sheets = Math.ceil(normalLabels.length / 21) + Math.ceil(bagLabels.length / 4);

    var groups = App.topLevelItems().map(function (parent) {
      return { parent: parent, children: App.childrenOf(parent.asset_id) };
    });

    return '<div class="no-print">' +
        UI.pageTitle('Print labels',
          'Choose items, then print. Each label carries the QR code, the asset ID and the ' +
          'mandir name.') +
      '</div>' +

      // Which paper is going in the printer decides the whole geometry, so it
      // is asked before anything else.
      '<div class="no-print mb-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-900/5">' +
        '<p class="mb-2 text-sm font-medium text-stone-700">What are you printing on?</p>' +
        '<div class="grid gap-2 sm:grid-cols-2">' +
          [['avery', 'Avery L7160 label sheets',
            '63.5 x 38.1mm, 21 per sheet. No cutting — peel and stick.'],
           ['plain', 'Plain A4 paper',
            'Dashed guides to cut along. Nothing to buy.']
          ].map(function (o) {
            var active = labelSheet === o[0];
            return '<button type="button" data-action="labels-sheet" data-value="' + o[0] + '" ' +
              'class="rounded-xl p-3 text-left transition ' +
              (active ? 'bg-saffron-50 ring-2 ring-saffron-500'
                      : 'bg-white ring-1 ring-stone-200 hover:bg-stone-50') + '">' +
              '<span class="block text-sm font-semibold ' +
                (active ? 'text-saffron-900' : 'text-stone-900') + '">' + o[1] + '</span>' +
              '<span class="block text-xs text-stone-500">' + o[2] + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        (labelSheet === 'avery'
          ? '<p class="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">' +
            'In the print dialog set <strong>Margins: None</strong> and ' +
            '<strong>Scale: 100%</strong>. Avery sheets carry their own margins — ' +
            'adding the printer\'s on top shifts every label down a row.</p>' +
            nudgeControls()
          : '<p class="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">' +
            'In the print dialog set <strong>Scale: 100%</strong> (not "fit to page") ' +
            'and turn headers and footers off.</p>') +
      '</div>' +

      '<div class="no-print mb-4 flex flex-wrap items-center gap-2">' +
        UI.button('Select all', { action: 'labels-all', variant: 'secondary' }) +
        UI.button('Clear', { action: 'labels-none', variant: 'secondary' }) +
        '<span class="ml-auto text-sm text-stone-500">' +
          UI.plural(selected.length, 'label') + ' selected' +
          (selected.length ? ' · ' + UI.plural(sheets, 'sheet') : '') +
          (bagLabels.length
            ? ' (incl. ' + UI.plural(bagLabels.length, 'bag tag') + ')' : '') + '</span>' +
        UI.button('Print', { action: 'labels-print', disabled: !selected.length }) +
      '</div>' +

      '<div class="no-print mb-6 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-stone-900/5">' +
        groups.map(function (g) {
          if (!g.children.length) return labelPicker(g.parent, false);

          // A set collapses to one row. Six ticked boxes for a tabla set is
          // noise when you almost always want the whole set relabelled at once.
          var chosen = [g.parent].concat(g.children)
            .filter(function (i) { return labelSelection[i.asset_id]; }).length;

          return '<details class="rounded-xl">' +
            '<summary class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ' +
              'hover:bg-stone-50">' +
              '<span class="text-base" aria-hidden="true">🎒</span>' +
              '<span class="min-w-0 flex-1">' +
                '<span class="block text-sm font-medium text-stone-800">' +
                  UI.esc(g.parent.name) + '</span>' +
                '<span class="block text-xs text-stone-400">' +
                  UI.plural(g.children.length + 1, 'label') +
                  (chosen ? ' · ' + chosen + ' selected' : '') + '</span>' +
              '</span>' +
              '<button type="button" data-action="labels-set" ' +
                'data-value="' + UI.esc(g.parent.asset_id) + '" ' +
                'class="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold ' +
                'text-saffron-700 hover:bg-saffron-50">' +
                (chosen === g.children.length + 1 ? 'Clear set' : 'Whole set') + '</button>' +
              '<svg class="chevron h-4 w-4 shrink-0 text-stone-400 transition-transform" ' +
                'fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" ' +
                'aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" ' +
                'd="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
            '</summary>' +
            '<div class="border-l-2 border-stone-100 pb-1">' +
              labelPicker(g.parent, true) +
              g.children.map(function (c) { return labelPicker(c, true); }).join('') +
            '</div>' +
          '</details>';
        }).join('') +
      '</div>' +

      (selected.length
        ? '<h2 class="no-print mb-3 text-base font-semibold text-stone-900">Preview</h2>' +
          '<div class="label-sheet' + (labelSheet === 'plain' ? ' sheet-plain' : '') + '"' +
            nudgeStyle() + '>' +
            normalLabels.map(labelHtml).join('') + '</div>' +

          (bagLabels.length
            ? '<h3 class="no-print mb-2 mt-6 text-sm font-semibold text-stone-700">' +
                'Kit bag tags — printed on a separate plain sheet</h3>' +
              '<div class="label-sheet sheet-plain sheet-bags">' +
                bagLabels.map(labelHtml).join('') + '</div>'
            : '') +
          '<p class="no-print mt-6 rounded-xl bg-saffron-50 p-4 text-sm text-saffron-900">' +
            '<strong>Check the first sheet with a ruler.</strong> The black QR square should ' +
            'measure about <strong>25mm</strong> across (40mm on a kit-bag tag). If it comes ' +
            'out smaller, the printer is scaling the page down — set Scale to 100%.</p>'
        : UI.emptyState('🏷', 'No labels selected',
            'Tick the instruments you want labels for.'));
  };

  /*
   * Fine alignment for the printer in front of you.
   *
   * The Avery geometry in the stylesheet is exactly right on paper, but no two
   * printers agree about where the paper actually is — feed rollers, driver
   * margins and "borderless" settings all shift the sheet by a millimetre or
   * two. That is enough to clip a column of £15 label stock.
   *
   * So the whole grid can be nudged. Set it once against a test sheet and it
   * is remembered on this device.
   */
  var NUDGE_KEY = 'instrument_tracker_label_nudge';
  var nudge = (function () {
    try {
      var saved = JSON.parse(window.localStorage.getItem(NUDGE_KEY) || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved;
    } catch (e) {}
    return { x: 0, y: 0 };
  })();

  function saveNudge() {
    try { window.localStorage.setItem(NUDGE_KEY, JSON.stringify(nudge)); } catch (e) {}
  }

  /** Added to the sheet's own padding, so 0/0 is the true Avery geometry. */
  function nudgeStyle() {
    if (!nudge.x && !nudge.y) return '';
    return ' style="--nudge-x:' + nudge.x + 'mm; --nudge-y:' + nudge.y + 'mm"';
  }

  function nudgeControls() {
    if (labelSheet !== 'avery') return '';

    function stepper(axis, label, hint) {
      return '<div class="flex items-center gap-2">' +
        '<span class="w-24 text-xs text-stone-600">' + label + '</span>' +
        '<button type="button" data-action="label-nudge" data-axis="' + axis + '" ' +
          'data-value="-1" class="h-8 w-8 rounded-lg bg-white text-sm font-bold ' +
          'text-stone-700 ring-1 ring-stone-200">\u2212</button>' +
        '<span class="w-16 text-center font-mono text-xs text-stone-700">' +
          (nudge[axis] > 0 ? '+' : '') + nudge[axis] + 'mm</span>' +
        '<button type="button" data-action="label-nudge" data-axis="' + axis + '" ' +
          'data-value="1" class="h-8 w-8 rounded-lg bg-white text-sm font-bold ' +
          'text-stone-700 ring-1 ring-stone-200">+</button>' +
        '<span class="text-xs text-stone-400">' + hint + '</span>' +
      '</div>';
    }

    return '<details class="mt-2 rounded-lg bg-stone-50 px-3 py-2"' +
        ((nudge.x || nudge.y) ? ' open' : '') + '>' +
      '<summary class="cursor-pointer text-xs font-medium text-stone-600">' +
        'Labels not lining up? Nudge the sheet' +
        ((nudge.x || nudge.y)
          ? ' <span class="font-mono text-stone-400">(' +
            (nudge.x > 0 ? '+' : '') + nudge.x + ', ' +
            (nudge.y > 0 ? '+' : '') + nudge.y + ')</span>'
          : '') +
      '</summary>' +
      '<div class="mt-2 space-y-2">' +
        '<p class="text-xs text-stone-500">Print one sheet on plain paper, hold it against ' +
          'a sheet of labels, and adjust until they line up.</p>' +
        stepper('x', 'Left / right', 'move right +') +
        stepper('y', 'Up / down', 'move down +') +
        '<button type="button" data-action="label-nudge-reset" ' +
          'class="text-xs font-medium text-stone-500 underline-offset-2 hover:underline">' +
          'Reset to 0</button>' +
      '</div>' +
    '</details>';
  }

  App.actions['label-nudge'] = function (button) {
    var axis = button.dataset.axis === 'y' ? 'y' : 'x';
    nudge[axis] = Math.max(-15, Math.min(15, nudge[axis] + Number(button.dataset.value)));
    saveNudge();
    App.render();
  };

  App.actions['label-nudge-reset'] = function () {
    nudge = { x: 0, y: 0 };
    saveNudge();
    App.render();
  };

  function labelPicker(item, nested) {
    var checked = !!labelSelection[item.asset_id];
    return '<label class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ' +
      'hover:bg-stone-50 ' + (nested ? 'pl-9' : '') + '">' +
      '<input type="checkbox" data-action="label-toggle" data-value="' + UI.esc(item.asset_id) + '" ' +
        (checked ? 'checked ' : '') +
        'class="h-5 w-5 rounded border-stone-300 text-saffron-600 focus:ring-saffron-500">' +
      '<span class="min-w-0 flex-1">' +
        '<span class="block text-sm font-medium text-stone-800">' + UI.esc(item.name) + '</span>' +
        '<span class="block font-mono text-xs text-stone-400">' + UI.esc(item.asset_id) + '</span>' +
      '</span>' +
      (item.is_kit ? '<span class="text-xs text-stone-400">40mm tag</span>' : '') +
    '</label>';
  }

  App.actions['label-toggle'] = function (input) {
    labelSelection[input.dataset.value] = input.checked;
    App.render();
  };

  /** Tick or clear a whole set in one go. */
  App.actions['labels-set'] = function (button) {
    var parentId = button.dataset.value;
    var all = [App.itemById(parentId)].concat(App.childrenOf(parentId)).filter(Boolean);
    var allChosen = all.every(function (i) { return labelSelection[i.asset_id]; });
    all.forEach(function (i) {
      if (allChosen) delete labelSelection[i.asset_id];
      else labelSelection[i.asset_id] = true;
    });
    App.render();
  };

  App.actions['labels-all'] = function () {
    App.activeItems().forEach(function (i) { labelSelection[i.asset_id] = true; });
    App.render();
  };

  App.actions['labels-none'] = function () {
    labelSelection = {};
    App.render();
  };

  App.actions['labels-sheet'] = function (button) {
    labelSheet = button.dataset.value;
    App.render();
  };

  App.actions['labels-print'] = function () { window.print(); };

  App.actions['label-one'] = function (button) {
    showLabelsFor([button.dataset.value]);
  };

  function showLabelsFor(assetIds) {
    labelSelection = {};
    assetIds.forEach(function (id) { labelSelection[id] = true; });
    App.go('#/labels');
  }

  App.showLabelsFor = showLabelsFor;
})();
