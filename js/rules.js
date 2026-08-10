/*
 * GENERATED — do not edit.
 *
 * A copy of apps-script/src/10-rules.js so the browser can load the exact
 * same availability and kit logic the server enforces, without index.html
 * having to reach into the apps-script folder.
 *
 * Edit apps-script/src/10-rules.js and run: node tools/build-gs.js
 */

/**
 * Instrument Tracker — PURE RULES.
 *
 * ===================================================================
 *  Nothing in this file may touch SpreadsheetApp, Session, Utilities,
 *  Date.now(), or any other ambient state. Every function takes plain
 *  data in and returns plain data out.
 *
 *  That constraint is the only reason the kit cascade and the overdue
 *  maths are testable at all — tests/run.js loads this exact file in
 *  plain Node. If you add a SpreadsheetApp call here, the tests stop
 *  running and the trickiest logic in the app goes unchecked.
 * ===================================================================
 *
 * Shapes it expects (plain objects mirroring Sheet rows):
 *
 *   item     { asset_id, name, parent_asset_id, is_kit:boolean, status,
 *              current_condition, active:boolean, instrument_type, quality_grade }
 *   movement { movement_id, asset_id, checked_in_at, via_parent_asset_id,
 *              event_id, sub_event_id, centre, expected_return_date, checked_out_by }
 *   alloc    { allocation_id, asset_id, event_id, centre, expected_return_date, status }
 *
 *   state    { items: [item], movements: [movement], allocations: [alloc] }
 *
 * Dates are date-only strings 'YYYY-MM-DD'. Timestamps are ISO strings; this
 * module only ever asks whether a timestamp is blank.
 */

var Rules = (function () {
  'use strict';

  /* ================================================================
   * Dates and overdue
   * ================================================================ */

  /**
   * Whole days between two 'YYYY-MM-DD' strings (b − a), via Date.UTC.
   *
   * Using UTC deliberately keeps British Summer Time out of the arithmetic
   * entirely. A local-time subtraction across the March or October clock
   * change lands on 23 or 25 hours and silently truncates to the wrong
   * number of days. Date-only strings have no clocks to change.
   */
  function daysBetween(a, b) {
    var pa = parseDate(a), pb = parseDate(b);
    if (!pa || !pb) return null;
    var MS_PER_DAY = 86400000;
    return Math.round((pb - pa) / MS_PER_DAY);
  }

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function isValidDate(s) {
    return parseDate(s) !== null;
  }

  /**
   * Overdue is COMPUTED, never stored. A stored flag would be wrong every
   * midnight. An item is overdue when it is still out and its expected
   * return date has already passed.
   *
   * Due today is NOT overdue — you have until the end of the day.
   */
  function isOverdue(expectedReturnDate, checkedInAt, todayISO) {
    return daysOverdue(expectedReturnDate, checkedInAt, todayISO) > 0;
  }

  /** "1 day overdue" / "3 days overdue". One place, so it is never "1 days". */
  function daysLatePhrase(n) {
    return n === 1 ? '1 day overdue' : n + ' days overdue';
  }

  /** 0 when not overdue (including when already returned, or no date set). */
  function daysOverdue(expectedReturnDate, checkedInAt, todayISO) {
    if (checkedInAt) return 0;                    // already back
    if (!expectedReturnDate) return 0;            // no date promised
    var late = daysBetween(expectedReturnDate, todayISO);
    if (late === null) return 0;
    return late > 0 ? late : 0;
  }

  /* ================================================================
   * Small lookups
   * ================================================================ */

  function indexItems(items) {
    var map = {};
    for (var i = 0; i < items.length; i++) map[items[i].asset_id] = items[i];
    return map;
  }

  /** Active children of a kit parent, in sheet order. */
  function childrenOf(items, parentAssetId) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].parent_asset_id === parentAssetId && items[i].active) out.push(items[i]);
    }
    return out;
  }

  /** The open movement for an item (blank checked_in_at), or null. */
  function openMovementFor(movements, assetId) {
    for (var i = 0; i < movements.length; i++) {
      if (movements[i].asset_id === assetId && !movements[i].checked_in_at) return movements[i];
    }
    return null;
  }

  /** Open movements for every child currently out via this parent (rule K6). */
  function openMovementsViaParent(movements, parentAssetId) {
    var out = [];
    for (var i = 0; i < movements.length; i++) {
      if (movements[i].via_parent_asset_id === parentAssetId && !movements[i].checked_in_at) {
        out.push(movements[i]);
      }
    }
    return out;
  }

  function openAllocationFor(allocations, assetId) {
    for (var i = 0; i < (allocations || []).length; i++) {
      if (allocations[i].asset_id === assetId && allocations[i].status === 'open') {
        return allocations[i];
      }
    }
    return null;
  }

  /* ================================================================
   * Availability over a date range
   * ================================================================
   *
   * An allocation reserves an item for a WINDOW — from the day it is
   * needed to the day it is due back. Two requests for the same item
   * only clash if those windows overlap.
   *
   * This is what lets East London hold HAR-003 for the 10th to the 12th
   * while Paris takes it on the 14th, and what stops Paris booking it
   * for the 11th.
   */

  /**
   * Do [aFrom, aTo] and [bFrom, bTo] share at least one day?
   *
   * Both ends are INCLUSIVE: an item due back on the 12th is not free for
   * someone else on the 12th, because it may not physically return until
   * that evening. Erring towards "unavailable" is the cheap mistake here —
   * the expensive one is two centres arriving for the same harmonium.
   *
   * A missing end date means "open-ended", which overlaps everything after
   * its start.
   */
  function rangesOverlap(aFrom, aTo, bFrom, bTo) {
    var a1 = parseDate(aFrom), a2 = parseDate(aTo);
    var b1 = parseDate(bFrom), b2 = parseDate(bTo);

    // Anything with no usable start date cannot be reasoned about; treat it
    // as clashing so it surfaces to a human rather than being waved through.
    if (a1 === null && a2 === null) return true;
    if (b1 === null && b2 === null) return true;

    if (a1 === null) a1 = a2;
    if (a2 === null) a2 = Infinity;
    if (b1 === null) b1 = b2;
    if (b2 === null) b2 = Infinity;

    return a1 <= b2 && b1 <= a2;
  }

  /**
   * Everything standing in the way of using `assetId` between `from` and `to`.
   *
   * Returns a list of clashes, each with enough detail for the UI to say WHY
   * something is unavailable rather than just greying it out:
   *
   *   { kind: 'allocation' | 'checked_out' | 'status',
   *     from, to, event_id, centre, allocated_by, allocation_id, reason }
   *
   * `ignoreAllocationIds` lets an allocation being edited exclude itself.
   */
  function conflictsFor(state, assetId, from, to, ignoreAllocationIds) {
    var ignore = {};
    (ignoreAllocationIds || []).forEach(function (id) { ignore[id] = true; });

    var byId = indexItems(state.items);
    var item = byId[assetId];
    var out = [];
    if (!item) return out;

    // 1. A status that rules the item out whatever the dates are.
    if (item.status === 'maintenance' || item.status === 'lost') {
      out.push({
        kind: 'status',
        reason: item.status === 'maintenance' ? 'In maintenance' : 'Marked lost'
      });
    }

    // 2. Physically out right now. The window runs from today until it is due.
    if (item.status === 'checked_out') {
      var mv = openMovementFor(state.movements || [], assetId);
      var dueBack = mv ? mv.expected_return_date : '';
      var today = state.today || from;

      // An item that is ALREADY overdue has no known end date. Treating its
      // window as ending on a date that has passed would report a late tabla
      // set as free next week, which is exactly backwards — it is not even
      // back yet. Overdue means open-ended until someone returns it.
      var late = daysOverdue(dueBack, '', today) > 0;
      var effectiveTo = late ? '' : dueBack;

      if (rangesOverlap(from, to, today, effectiveTo)) {
        out.push({
          kind: 'checked_out',
          from: today,
          to: effectiveTo,
          event_id: mv ? mv.event_id : '',
          sub_event_id: mv ? mv.sub_event_id : '',
          event_name: mv ? (mv.event_name || '') : '',
          centre: mv ? mv.centre : '',
          reason: late
            ? 'Still out' + (mv && mv.centre ? ' with ' + mv.centre : '') +
              ' — ' + daysLatePhrase(daysOverdue(dueBack, '', today))
            : 'Out' + (mv && mv.centre ? ' with ' + mv.centre : '') +
              (dueBack ? ' until ' + formatDayMonth(dueBack) : '')
        });
      }
    }

    // 3. Promised to someone else over an overlapping window.
    (state.allocations || []).forEach(function (a) {
      if (a.asset_id !== assetId) return;
      if (a.status !== 'open') return;
      if (ignore[a.allocation_id]) return;
      if (!rangesOverlap(from, to, a.needed_from, a.expected_return_date)) return;

      out.push({
        kind: 'allocation',
        allocation_id: a.allocation_id,
        from: a.needed_from || '',
        to: a.expected_return_date || '',
        event_id: a.event_id || '',
        event_name: a.event_name || '',
        centre: a.centre || '',
        allocated_by: a.allocated_by || '',
        reason: 'Allocated to ' +
                (a.event_name || a.centre || 'another event') +
                windowPhrase(a.needed_from, a.expected_return_date)
      });
    });

    return out;
  }

  /** " (10–12 Aug)" — the bracketed window that follows a clash description. */
  function windowPhrase(from, to) {
    if (!from && !to) return '';
    if (from && to && from === to) return ' (' + formatDayMonth(from) + ')';
    if (from && to) return ' (' + formatDayMonth(from) + ' – ' + formatDayMonth(to) + ')';
    return ' (until ' + formatDayMonth(to || from) + ')';
  }

  /** True when nothing at all stands in the way of that window. */
  function isFreeBetween(state, assetId, from, to, ignoreAllocationIds) {
    return conflictsFor(state, assetId, from, to, ignoreAllocationIds).length === 0;
  }

  function label(item) {
    return item ? item.asset_id + ' (' + item.name + ')' : 'unknown item';
  }

  function err(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  /** Human phrase for where an item currently is. */
  function whereabouts(movement) {
    if (!movement) return 'checked out';
    var bits = [];
    if (movement.centre) bits.push(movement.centre);
    if (movement.event_name) bits.push(movement.event_name);
    return bits.length ? 'checked out to ' + bits.join(' — ') : 'checked out';
  }

  /* ================================================================
   * CHECK-OUT  (rules K1, K2, K3, K5)
   * ================================================================
   *
   * req = { asset_ids: [...], allow_partial: boolean }
   *
   * Returns on success:
   *   { ok:true, lines:[{asset_id, via_parent_asset_id}], warnings:[{asset_id,name,reason}] }
   *
   * Kit expansion happens HERE, server-side, so a stale browser can never
   * produce a half-checked-out kit.
   */
  function planCheckout(state, req) {
    var byId = indexItems(state.items);
    var movements = state.movements || [];
    var allowPartial = !!req.allow_partial;

    var lines = [];        // ordered, deduped below
    var seen = {};
    var warnings = [];
    var blockers = [];     // children already out alone — rule K3

    function addLine(assetId, via) {
      var existing = seen[assetId];
      if (existing) {
        // Scanning both a parent and one of its children: keep the line that
        // carries via_parent_asset_id, so a later parent check-in sweeps it up.
        if (via && !existing.via_parent_asset_id) existing.via_parent_asset_id = via;
        return;
      }
      var line = { asset_id: assetId, via_parent_asset_id: via || '' };
      seen[assetId] = line;
      lines.push(line);
    }

    var requested = dedupe(req.asset_ids || []);
    if (!requested.length) return err('BAD_REQUEST', 'No items were scanned.');

    for (var i = 0; i < requested.length; i++) {
      var id = requested[i];
      var item = byId[id];

      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');
      if (!item.active) {
        return err('ITEM_INACTIVE', label(item) + ' has been removed from inventory.');
      }

      // An explicitly scanned item that is unavailable is a hard error. Only
      // children pulled in by a parent get the skip-with-warning treatment (K2).
      if (item.status === 'checked_out') {
        return err('ITEM_CHECKED_OUT',
          label(item) + ' is already ' + whereabouts(openMovementFor(movements, id)) + '.');
      }
      if (item.status === 'maintenance') {
        return err('BAD_REQUEST', label(item) + ' is marked for maintenance and cannot go out.');
      }
      if (item.status === 'lost') {
        return err('BAD_REQUEST', label(item) + ' is marked lost and cannot go out.');
      }

      // --- Rule K5: a child may go out alone only if its parent is available.
      if (item.parent_asset_id) {
        var parent = byId[item.parent_asset_id];
        if (parent && parent.status !== 'available') {
          return err('PARENT_OUT',
            label(item) + ' belongs to ' + label(parent) + ', which is currently ' +
            plainStatus(parent.status) + '. Check the set in first.');
        }
      }

      addLine(id, '');

      // --- Rule K1: scanning a kit parent takes every child with it.
      if (item.is_kit) {
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var child = kids[k];
          if (child.status === 'available') {
            addLine(child.asset_id, id);
          } else if (child.status === 'checked_out') {
            // Rule K3 — out on its own. Block the whole set unless told otherwise.
            blockers.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: 'Already ' + whereabouts(openMovementFor(movements, child.asset_id)) + '.'
            });
          } else {
            // Rule K2 — in maintenance or lost. Skip it, say so plainly.
            warnings.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: child.status === 'maintenance'
                ? 'In maintenance — not included.'
                : 'Marked lost — not included.'
            });
          }
        }
      }
    }

    if (blockers.length && !allowPartial) {
      var names = blockers.map(function (b) { return b.asset_id + ' (' + b.name + ')'; });
      return {
        ok: false,
        error: {
          code: 'KIT_CHILD_OUT',
          message: 'Part of this set is already out on its own: ' + names.join(', ') +
                   '. Check it in first, or continue without it.'
        },
        blockers: blockers   // the client offers "continue without it" → allow_partial
      };
    }
    if (blockers.length) {
      for (var b = 0; b < blockers.length; b++) {
        warnings.push({
          asset_id: blockers[b].asset_id,
          name: blockers[b].name,
          reason: 'Out on its own — not included.'
        });
      }
    }

    return { ok: true, lines: lines, warnings: warnings };
  }

  /* ================================================================
   * CHECK-IN  (rules K6, K7, K8, K9)
   * ================================================================
   *
   * req = { items: [{ asset_id, condition_in, missing, damage_notes }] }
   *
   * Posting only the parent expands to every child out via that parent,
   * each defaulting to 'good'. Listing a child explicitly overrides its
   * default — that is exactly how "the hammer never came back" is recorded.
   */
  function planCheckin(state, req) {
    var byId = indexItems(state.items);
    var movements = state.movements || [];

    var explicit = {};
    var order = [];
    var reqItems = req.items || [];
    if (!reqItems.length) return err('BAD_REQUEST', 'No items to check in.');

    for (var i = 0; i < reqItems.length; i++) {
      var r = reqItems[i];
      if (!r || !r.asset_id) return err('BAD_REQUEST', 'An item was submitted without an ID.');
      explicit[r.asset_id] = r;
      order.push(r.asset_id);
    }

    var lines = [];
    var seen = {};
    var warnings = [];
    var photoRequired = [];

    function addLine(assetId, movement, spec) {
      if (seen[assetId]) return;
      var item = byId[assetId];
      var s = spec || {};
      var missing = !!s.missing;
      var condition = missing ? '' : (s.condition_in || 'good');

      // --- Rule K8: outcome and the item's resulting status.
      var outcome, newStatus, damage;
      if (missing) {
        outcome = 'missing';
        newStatus = 'lost';
        damage = s.damage_notes || 'Not returned';
      } else if (condition === 'needs_repair') {
        outcome = 'damaged';
        newStatus = 'maintenance';
        damage = s.damage_notes || '';
      } else {
        outcome = 'returned';
        newStatus = 'available';
        damage = s.damage_notes || '';
      }

      /*
       * A damaged return has to carry a photo.
       *
       * Six months later, "the skin was already split when we collected it"
       * is unanswerable without one. A photo settles it, and the moment to
       * take it is while the instrument is still on the table.
       *
       * Not required for a missing item — there is nothing to photograph.
       */
      if (outcome === 'damaged' && !String(s.photo_url || '').trim()) {
        photoRequired.push({ asset_id: assetId, name: item ? item.name : assetId });
      }

      var line = {
        asset_id: assetId,
        movement_id: movement.movement_id,
        condition_in: condition,
        damage_notes: damage,
        outcome: outcome,
        new_status: newStatus,
        new_condition: condition || (item ? item.current_condition : ''),
        photo_url: String(s.photo_url || '').trim(),
        via_parent_asset_id: movement.via_parent_asset_id || ''
      };
      seen[assetId] = line;
      lines.push(line);
    }

    for (var j = 0; j < order.length; j++) {
      var id = order[j];
      var item = byId[id];
      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');

      var mv = openMovementFor(movements, id);
      if (!mv) {
        // Tolerate a child listed on the parent's check-in screen that is
        // already back — that is a redundant submission, not a failure.
        if (item.parent_asset_id && explicit[item.parent_asset_id]) continue;
        return err('ITEM_NOT_OUT', label(item) + ' is not currently checked out.');
      }

      addLine(id, mv, explicit[id]);

      // --- Rule K6: checking in the parent closes every child out VIA this parent.
      if (item.is_kit) {
        var childMvs = openMovementsViaParent(movements, id);
        for (var c = 0; c < childMvs.length; c++) {
          addLine(childMvs[c].asset_id, childMvs[c], explicit[childMvs[c].asset_id]);
        }

        // --- Rule K7: children checked out on their own are NOT swept up.
        // Say so, rather than letting someone assume the whole set is back.
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var kid = kids[k];
          if (seen[kid.asset_id]) continue;
          var kidMv = openMovementFor(movements, kid.asset_id);
          if (kidMv && kidMv.via_parent_asset_id !== id) {
            warnings.push({
              asset_id: kid.asset_id,
              name: kid.name,
              reason: 'Out separately — check it in on its own.'
            });
          }
        }
      }
    }

    if (!lines.length) return err('ITEM_NOT_OUT', 'Nothing in this list is currently checked out.');

    if (photoRequired.length) {
      var names = photoRequired.map(function (p) { return p.name; });
      return {
        ok: false,
        error: {
          code: 'PHOTO_REQUIRED',
          message: (names.length === 1 ? names[0] + ' is' : names.join(', ') + ' are') +
                   ' marked as damaged, so a photo of the damage is needed before this ' +
                   'can be saved.'
        },
        photo_required: photoRequired
      };
    }

    return { ok: true, lines: lines, warnings: warnings };
  }

  /* ================================================================
   * ALLOCATION
   * ================================================================ */

  function planAllocate(state, req) {
    var byId = indexItems(state.items);
    var allocations = state.allocations || [];
    var movements = state.movements || [];

    var requested = dedupe(req.asset_ids || []);
    if (!requested.length) return err('BAD_REQUEST', 'No items were chosen.');
    if (!req.event_id) return err('BAD_REQUEST', 'Choose an event first.');
    if (!isValidDate(req.expected_return_date)) {
      return err('BAD_REQUEST', 'Set an expected return date.');
    }
    if (!req.allocated_by) return err('BAD_REQUEST', 'Enter the name of the person responsible.');

    // The window this request occupies. A blank needed_from means "from today".
    var from = isValidDate(req.needed_from) ? req.needed_from : (state.today || '');
    var to = req.expected_return_date;
    if (isValidDate(from) && daysBetween(from, to) < 0) {
      return err('BAD_REQUEST',
        'The return date is before the date the instruments are needed from.');
    }

    var lines = [];
    var seen = {};
    var warnings = [];

    function add(assetId) {
      if (seen[assetId]) return;
      seen[assetId] = true;
      lines.push(assetId);
    }

    for (var i = 0; i < requested.length; i++) {
      var id = requested[i];
      var item = byId[id];
      if (!item) return err('NOT_FOUND', 'No item found with ID ' + id + '.');
      if (!item.active) return err('ITEM_INACTIVE', label(item) + ' has been removed from inventory.');

      // An explicitly chosen item that clashes is a hard error naming the clash,
      // so the karyakar can go back to the requesting centre with a real answer
      // rather than a shrug.
      var clashes = conflictsFor(state, id, from, to, req.ignore_allocation_ids);
      if (clashes.length) {
        return {
          ok: false,
          error: {
            code: 'NOT_AVAILABLE',
            message: label(item) + ' is not free ' + windowPhrase(from, to).trim() +
                     ': ' + clashes[0].reason + '.'
          },
          conflicts: clashes
        };
      }

      // Rule K5 again — a child cannot be promised elsewhere while its set is out.
      if (item.parent_asset_id) {
        var parent = byId[item.parent_asset_id];
        if (parent && parent.status !== 'available') {
          return err('PARENT_OUT',
            label(item) + ' belongs to ' + label(parent) + ', which is currently ' +
            plainStatus(parent.status) + '.');
        }
      }

      add(id);

      // Allocating a kit allocates the whole kit — but a piece that is spoken
      // for over these dates is left behind with a note, not silently included.
      if (item.is_kit) {
        var kids = childrenOf(state.items, id);
        for (var k = 0; k < kids.length; k++) {
          var child = kids[k];
          var childClashes = conflictsFor(state, child.asset_id, from, to,
                                          req.ignore_allocation_ids);
          if (!childClashes.length) {
            add(child.asset_id);
          } else {
            warnings.push({
              asset_id: child.asset_id,
              name: child.name,
              reason: childClashes[0].reason + ' — not included.'
            });
          }
        }
      }
    }

    return { ok: true, asset_ids: lines, warnings: warnings, needed_from: from };
  }

  /* ================================================================
   * DEACTIVATION  (rule K10)
   * ================================================================
   * Nothing is ever deleted — history has to survive. Removing a kit
   * parent removes its children with it, and anything currently out
   * cannot be removed at all.
   */
  function planDeactivate(state, assetId) {
    var byId = indexItems(state.items);
    var item = byId[assetId];
    if (!item) return err('NOT_FOUND', 'No item found with ID ' + assetId + '.');
    if (!item.active) return err('ITEM_INACTIVE', label(item) + ' has already been removed.');

    var cascade = [item];
    if (item.is_kit) cascade = cascade.concat(childrenOf(state.items, assetId));

    for (var i = 0; i < cascade.length; i++) {
      if (cascade[i].status === 'checked_out') {
        return err('ITEM_CHECKED_OUT',
          label(cascade[i]) + ' is still checked out. Check it in before removing it.');
      }
    }

    return {
      ok: true,
      asset_ids: cascade.map(function (it) { return it.asset_id; })
    };
  }

  /* ================================================================
   * Display helpers shared by server messages and the UI
   * ================================================================ */

  function plainStatus(status) {
    switch (status) {
      case 'available': return 'available';
      case 'checked_out': return 'checked out';
      case 'maintenance': return 'in maintenance';
      case 'lost': return 'lost';
      default: return status || 'unknown';
    }
  }

  /**
   * "Checked out to East London — Paris Mandir Mahotsav / Nagar Yatra — due 12 Aug — 3 days overdue."
   * Built here so the server and the client cannot drift apart on the wording.
   */
  function describeStatus(item, live, todayISO) {
    if (!item.active) return 'Removed from inventory';
    if (item.status === 'maintenance') return 'In maintenance';
    if (item.status === 'lost') return 'Marked lost';
    if (item.status !== 'checked_out' || !live) return 'Available';

    // Rule K4: a child out with its set leads with where it went, not just that it left.
    var head = live.via_parent_asset_id
      ? 'Out — via ' + live.via_parent_asset_id +
        (live.via_parent_name ? ' (' + live.via_parent_name + ')' : '')
      : 'Out';
    if (live.centre) head += ' with ' + live.centre;

    var parts = [head];

    var ev = [];
    if (live.event_name) ev.push(live.event_name);
    if (live.sub_event_name) ev.push(live.sub_event_name);
    if (ev.length) parts.push(ev.join(' / '));

    if (live.expected_return_date) parts.push('due ' + formatDayMonth(live.expected_return_date));

    var late = daysOverdue(live.expected_return_date, '', todayISO);
    if (late > 0) parts.push(daysLatePhrase(late));

    return parts.join(' — ');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-08-12' → '12 Aug'. Purely string work, no Date object, no timezone. */
  function formatDayMonth(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return iso || '';
    return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1];
  }

  function dedupe(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var v = String(arr[i] || '').trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    return out;
  }

  return {
    // dates / overdue
    daysBetween: daysBetween,
    isValidDate: isValidDate,
    isOverdue: isOverdue,
    daysOverdue: daysOverdue,
    daysLatePhrase: daysLatePhrase,
    formatDayMonth: formatDayMonth,
    // lookups
    indexItems: indexItems,
    childrenOf: childrenOf,
    openMovementFor: openMovementFor,
    openMovementsViaParent: openMovementsViaParent,
    openAllocationFor: openAllocationFor,
    // availability over a window
    rangesOverlap: rangesOverlap,
    conflictsFor: conflictsFor,
    isFreeBetween: isFreeBetween,
    windowPhrase: windowPhrase,
    // decisions
    planCheckout: planCheckout,
    planCheckin: planCheckin,
    planAllocate: planAllocate,
    planDeactivate: planDeactivate,
    // display
    plainStatus: plainStatus,
    describeStatus: describeStatus,
    dedupe: dedupe
  };
})();

// Loadable by the Node test runner. In Apps Script `module` is undefined and
// this line is simply skipped — which is what keeps one file serving both.
if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
