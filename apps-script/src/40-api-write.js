/**
 * Instrument Tracker — write endpoints (doPost).
 *
 * Every handler here follows the same shape:
 *   1. validate the payload,
 *   2. ask Rules for a plan (pure, tested, no Sheets access),
 *   3. apply that plan to the tables.
 *
 * Step 2 is where all the kit logic lives. Nothing in this file re-implements
 * a rule — if a check is missing, it belongs in 10-rules.js where the tests
 * can reach it.
 */

/** The Rules-shaped view of the world, built from the tables. */
function rulesState() {
  var evMap = eventsById();
  return {
    today: todayISO(),
    items: table('Items').all(),
    movements: table('Movements').all().map(function (m) {
      // Rules only reads event_name for its error wording.
      m.event_name = eventName(evMap, m.sub_event_id || m.event_id);
      return m;
    }),
    allocations: table('Allocations').all().map(function (a) {
      a.event_name = eventName(evMap, a.event_id);
      return a;
    })
  };
}

/**
 * The centre for a booking. If the volunteer picked one, that wins; otherwise
 * fall back to whatever centre the event itself belongs to.
 *
 * Centre is deliberately NOT required once an event is chosen — for a mandir
 * event like Paris Mandir Mahotsav there often is no single centre, and making
 * someone pick one just to get past a form produces worse data than a blank.
 */
function resolveCentre(explicitCentre, eventId) {
  var given = String(explicitCentre || '').trim();
  if (given) return given;
  var ev = eventsById()[eventId];
  return ev ? String(ev.centre || '') : '';
}

/** Turns a plan failure from Rules into the thrown ApiError the router expects. */
function assertPlan(plan) {
  if (!plan.ok) {
    var e = new ApiError(plan.error.code, plan.error.message);
    if (plan.blockers) e.blockers = plan.blockers;
    if (plan.conflicts) e.conflicts = plan.conflicts;
    throw e;
  }
  return plan;
}

/**
 * Splits a chosen event into the (top-level, sub-event) pair Movements stores.
 *
 * Allocations hold the LEAF event; Movements hold both. Deriving the pair in
 * one place is what stops the two columns ever disagreeing.
 */
function splitEvent(eventId) {
  var evMap = eventsById();
  if (!evMap[eventId]) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');
  var root = rootEventId(evMap, eventId);
  return {
    event_id: root,
    sub_event_id: root === eventId ? '' : eventId
  };
}

/* ================================================================
 * CHECK-OUT
 * ================================================================ */

function actionCheckout(p) {
  var eventId = requireField(p, 'event_id', 'an event');
  var due = requireField(p, 'expected_return_date', 'an expected return date');
  var by = requireField(p, 'checked_out_by', 'your name');
  var centre = resolveCentre(p.centre, eventId);   // optional — see resolveCentre

  if (!Rules.isValidDate(due)) fail('BAD_REQUEST', 'The expected return date is not a valid date.');

  var plan = assertPlan(Rules.planCheckout(rulesState(), {
    asset_ids: p.asset_ids || [],
    allow_partial: !!p.allow_partial
  }));

  var ev = splitEvent(eventId);
  var items = table('Items');
  var movements = table('Movements');
  var allocations = table('Allocations');
  var now = nowISO();
  var movementIds = [];

  plan.lines.forEach(function (line) {
    var item = items.findBy('asset_id', line.asset_id);

    // If this item was allocated in advance, close the loop: the movement
    // points back at the allocation, and the allocation stops showing as open.
    var alloc = null;
    for (var i = 0; i < allocations.all().length; i++) {
      var a = allocations.all()[i];
      if (a.asset_id === line.asset_id && a.status === 'open') { alloc = a; break; }
    }
    if (alloc) allocations.update(alloc, { status: 'fulfilled' });

    var id = nextSequentialId('Movements', 'movement_id', 'MV-', 6);
    movementIds.push(id);

    movements.append({
      movement_id: id,
      asset_id: line.asset_id,
      allocation_id: alloc ? alloc.allocation_id : '',
      event_id: ev.event_id,
      sub_event_id: ev.sub_event_id,
      centre: centre,
      checked_out_at: now,
      checked_out_by: by,
      condition_out: p.condition_out || item.current_condition || 'good',
      expected_return_date: due,
      checked_in_at: '',
      checked_in_by: '',
      condition_in: '',
      damage_notes: '',
      via_parent_asset_id: line.via_parent_asset_id || '',
      outcome: ''
    });

    items.update(item, { status: 'checked_out' });
  });

  flushAll();

  return {
    checked_out: plan.lines.map(function (l) { return l.asset_id; }),
    movement_ids: movementIds,
    warnings: plan.warnings
  };
}

/* ================================================================
 * CHECK-IN
 * ================================================================ */

function actionCheckin(p) {
  var by = requireField(p, 'checked_in_by', 'your name');

  var plan = assertPlan(Rules.planCheckin(rulesState(), { items: p.items || [] }));

  var items = table('Items');
  var movements = table('Movements');
  var now = nowISO();

  plan.lines.forEach(function (line) {
    var mv = movements.findBy('movement_id', line.movement_id);
    if (!mv) fail('SERVER_ERROR', 'Could not find the check-out record for ' + line.asset_id + '.');

    movements.update(mv, {
      checked_in_at: now,
      checked_in_by: by,
      condition_in: line.condition_in,
      damage_notes: line.damage_notes,
      outcome: line.outcome
    });

    var item = items.findBy('asset_id', line.asset_id);
    if (item) {
      var changes = { status: line.new_status };
      // A missing item keeps its last known condition — we cannot judge the
      // condition of something nobody has seen.
      if (line.condition_in) changes.current_condition = line.condition_in;
      items.update(item, changes);
    }
  });

  flushAll();

  return {
    checked_in: plan.lines.map(function (l) {
      return { asset_id: l.asset_id, outcome: l.outcome, new_status: l.new_status };
    }),
    warnings: plan.warnings
  };
}

/* ================================================================
 * ALLOCATE  — the emailed request, logged in one step
 * ================================================================ */

function actionAllocate(p) {
  // If no start date was given, fall back to the event's own start date before
  // defaulting to today — an event three weeks out should reserve its window
  // three weeks out, not from this morning.
  var neededFrom = String(p.needed_from || '').trim();
  if (!neededFrom) {
    var ev = eventsById()[p.event_id];
    if (ev && ev.start_date) neededFrom = ev.start_date;
  }

  var plan = assertPlan(Rules.planAllocate(rulesState(), {
    asset_ids: p.asset_ids || [],
    event_id: p.event_id,
    centre: p.centre,
    needed_from: neededFrom,
    expected_return_date: p.expected_return_date,
    allocated_by: p.allocated_by,
    ignore_allocation_ids: p.ignore_allocation_ids || []
  }));

  var centre = resolveCentre(p.centre, p.event_id);   // optional
  var allocations = table('Allocations');
  var now = nowISO();
  var created = [];

  plan.asset_ids.forEach(function (assetId) {
    var id = nextSequentialId('Allocations', 'allocation_id', 'AL-', 6);
    allocations.append({
      allocation_id: id,
      asset_id: assetId,
      event_id: p.event_id,          // the LEAF event — see docs/SCHEMA.md
      centre: centre,
      needed_from: plan.needed_from,
      expected_return_date: p.expected_return_date,
      allocated_by: p.allocated_by,
      allocated_at: now,
      notes: p.notes || '',
      status: 'open'
    });
    created.push(id);
  });

  flushAll();
  return {
    allocation_ids: created,
    asset_ids: plan.asset_ids,
    needed_from: plan.needed_from,
    warnings: plan.warnings
  };
}

/**
 * "Is this item free between these dates?" for a list of items at once.
 *
 * A read-shaped question, but it goes through doPost because the item list can
 * be long enough to strain a query string.
 */
function actionCheckAvailability(p) {
  var state = rulesState();
  var from = String(p.needed_from || '').trim() || state.today;
  var to = String(p.expected_return_date || '').trim();
  var ignore = p.ignore_allocation_ids || [];

  var ids = p.asset_ids && p.asset_ids.length
    ? p.asset_ids
    : state.items.filter(function (i) { return i.active; })
                 .map(function (i) { return i.asset_id; });

  var out = {};
  ids.forEach(function (assetId) {
    var conflicts = Rules.conflictsFor(state, assetId, from, to, ignore);
    out[assetId] = { available: conflicts.length === 0, conflicts: conflicts };
  });

  return { needed_from: from, expected_return_date: to, availability: out };
}

/**
 * Change a booking that has not been collected yet — its dates, its event, or
 * who is responsible.
 *
 * Availability is re-checked against the NEW dates, excluding this booking
 * itself: moving a booking from the 10th to the 11th must not report the
 * instrument as clashing with its own old window.
 *
 * A booking is edited as a group. Every row created by one trip through the
 * Give out screen shares an allocation_id prefix only by accident, so instead
 * the client passes the ids it wants changed and they move together.
 */
function actionUpdateAllocation(p) {
  var ids = p.allocation_ids && p.allocation_ids.length
    ? p.allocation_ids
    : [requireField(p, 'allocation_id')];

  var allocations = table('Allocations');
  var rows = ids.map(function (id) {
    var row = allocations.findBy('allocation_id', id);
    if (!row) fail('NOT_FOUND', 'No booking found with ID ' + id + '.');
    if (row.status !== 'open') {
      fail('BAD_REQUEST', 'That booking has already been ' + row.status + '.');
    }
    return row;
  });

  var eventId = String(p.event_id || rows[0].event_id).trim();
  if (!eventsById()[eventId]) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var from = String(p.needed_from || rows[0].needed_from).trim();
  var to = String(p.expected_return_date || rows[0].expected_return_date).trim();
  if (!Rules.isValidDate(to)) fail('BAD_REQUEST', 'Set a date for them to come back.');
  if (Rules.isValidDate(from) && Rules.daysBetween(from, to) < 0) {
    fail('BAD_REQUEST', 'The return date is before the date they are needed from.');
  }

  // Re-check every instrument against the new window, ignoring these rows.
  var state = rulesState();
  rows.forEach(function (row) {
    var clashes = Rules.conflictsFor(state, row.asset_id, from, to, ids);
    if (clashes.length) {
      var item = state.items.filter(function (i) { return i.asset_id === row.asset_id; })[0];
      var e = new ApiError('NOT_AVAILABLE',
        (item ? item.name : row.asset_id) + ' is not free for those dates: ' +
        clashes[0].reason + '.');
      e.conflicts = clashes;
      throw e;
    }
  });

  var centre = resolveCentre(p.centre !== undefined ? p.centre : rows[0].centre, eventId);
  rows.forEach(function (row) {
    allocations.update(row, {
      event_id: eventId,
      centre: centre,
      needed_from: from,
      expected_return_date: to,
      allocated_by: p.allocated_by !== undefined
        ? String(p.allocated_by).trim() : row.allocated_by,
      notes: p.notes !== undefined ? String(p.notes) : row.notes
    });
  });

  flushAll();
  return {
    allocation_ids: ids,
    event_id: eventId,
    needed_from: from,
    expected_return_date: to
  };
}

function actionCancelAllocation(p) {
  // Accepts one id or a whole booking's worth, so cancelling a set of six
  // instruments is one action rather than six.
  var ids = p.allocation_ids && p.allocation_ids.length
    ? p.allocation_ids
    : [requireField(p, 'allocation_id')];

  var allocations = table('Allocations');
  var cancelled = [];

  ids.forEach(function (id) {
    var row = allocations.findBy('allocation_id', id);
    if (!row) fail('NOT_FOUND', 'No booking found with ID ' + id + '.');
    // Already cancelled is not an error worth stopping for — the outcome the
    // volunteer wanted is the outcome they have.
    if (row.status !== 'open') return;
    allocations.update(row, { status: 'cancelled' });
    cancelled.push(id);
  });

  flushAll();
  return { allocation_ids: cancelled };
}

/* ================================================================
 * ITEMS — add, edit, remove
 * ================================================================ */

function prefixForType(typeName) {
  var t = table('InstrumentTypes').findBy('name', typeName);
  if (!t) fail('BAD_REQUEST', '"' + typeName + '" is not one of the instrument types.');
  return t.prefix || 'OTH';
}

function actionSuggestAssetId(p) {
  var type = requireField(p, 'instrument_type', 'an instrument type');
  return { asset_id: nextAssetId(prefixForType(type)) };
}

function validateAssetIdAvailable(items, assetId, exceptRow) {
  var existing = items.findBy('asset_id', assetId);
  if (existing && (!exceptRow || existing._row !== exceptRow._row)) {
    fail('DUPLICATE_ASSET_ID', assetId + ' is already in use by "' + existing.name + '".');
  }
}

function actionSaveItem(p) {
  var items = table('Items');
  var name = requireField(p, 'name', 'a name');
  var type = requireField(p, 'instrument_type', 'an instrument type');
  var grade = requireField(p, 'quality_grade', 'a quality grade');
  var isKit = asBool(p.is_kit);

  var assetId = String(p.asset_id || '').trim().toUpperCase();
  if (!assetId) assetId = nextAssetId(prefixForType(type));

  /*
   * A set with no pieces is not a set. Saving one produces an item that claims
   * to be a kit, shows no chevron, expands to nothing, and cascades over an
   * empty list at check-out — every symptom of a bug, from valid-looking data.
   *
   * Checked here as well as in the browser because this is the boundary that
   * actually protects the Sheet.
   */
  if (isKit) {
    var namedChildren = (p.children || []).filter(function (c) {
      return c && !c._delete && String(c.name || '').trim();
    });
    var existingChildren = p.original_asset_id
      ? table('Items').all().filter(function (i) {
          return i.parent_asset_id === String(p.original_asset_id).trim() && i.active;
        })
      : [];
    var keptExisting = existingChildren.filter(function (child) {
      return !(p.children || []).some(function (c) {
        return c && c._delete && String(c.asset_id || '').trim() === child.asset_id;
      });
    });

    if (!namedChildren.length && !keptExisting.length) {
      fail('BAD_REQUEST',
        'A set needs at least one piece with a name — for a tabla set that would be the ' +
        'dayyu, bayyu, hammer and so on. Add a piece, or untick "This is a set".');
    }
  }

  var existing = p.original_asset_id
    ? items.findBy('asset_id', String(p.original_asset_id).trim())
    : null;
  if (p.original_asset_id && !existing) {
    fail('NOT_FOUND', 'No item found with ID ' + p.original_asset_id + '.');
  }

  // Renaming the primary key would orphan every movement and allocation that
  // points at the old id, so it is only allowed while there is no history yet.
  if (existing && existing.asset_id !== assetId) {
    var hasHistory =
      table('Movements').filterBy('asset_id', existing.asset_id).length > 0 ||
      table('Allocations').filterBy('asset_id', existing.asset_id).length > 0;
    if (hasHistory) {
      fail('BAD_REQUEST',
        'This item already has movement history, so its ID cannot be changed. ' +
        'Remove it and add a new one if the ID is wrong.');
    }
  }
  validateAssetIdAvailable(items, assetId, existing);

  var saved = [];
  var row;

  if (existing) {
    if (existing.is_kit && !isKit) {
      var stillHasKids = table('Items').all().some(function (i) {
        return i.parent_asset_id === existing.asset_id && i.active;
      });
      if (stillHasKids) {
        fail('BAD_REQUEST',
          'Remove the pieces from this set before turning it back into a single item.');
      }
    }
    // An item that is out has a status owned by the check-in flow, not by this form.
    var newStatus = existing.status;
    if (existing.status !== 'checked_out' && p.status &&
        ['available', 'maintenance', 'lost'].indexOf(p.status) !== -1) {
      newStatus = p.status;
    }

    var oldId = existing.asset_id;
    items.update(existing, {
      asset_id: assetId,
      name: name,
      instrument_type: type,
      quality_grade: grade,
      is_kit: isKit,
      status: newStatus,
      current_condition: p.current_condition || existing.current_condition || 'good',
      storage_location: p.storage_location || '',
      notes: p.notes || '',
      qr_token: existing.qr_token || newQrToken()
    });
    if (oldId !== assetId) {
      table('Items').all().forEach(function (child) {
        if (child.parent_asset_id === oldId) items.update(child, { parent_asset_id: assetId });
      });
    }
    row = existing;
  } else {
    row = items.append({
      asset_id: assetId,
      qr_token: newQrToken(),
      name: name,
      instrument_type: type,
      quality_grade: grade,
      parent_asset_id: '',
      is_kit: isKit,
      status: 'available',
      current_condition: p.current_condition || 'good',
      storage_location: p.storage_location || '',
      notes: p.notes || '',
      photo_url: '',
      active: true
    });
  }
  saved.push(row);

  /* ---- kit children, saved on the same screen and the same round trip ---- */
  if (isKit && Array.isArray(p.children)) {
    p.children.forEach(function (c) {
      var childId = String(c.asset_id || '').trim().toUpperCase();
      var childRow = childId ? items.findBy('asset_id', childId) : null;

      if (c._delete) {
        if (!childRow) return;
        if (childRow.status === 'checked_out') {
          fail('ITEM_CHECKED_OUT',
            childRow.asset_id + ' (' + childRow.name + ') is still checked out and cannot be removed.');
        }
        items.update(childRow, { active: false });
        return;
      }

      var childName = String(c.name || '').trim();
      if (!childName) fail('BAD_REQUEST', 'Every piece in the set needs a name.');
      var childType = String(c.instrument_type || type).trim();

      if (childRow) {
        items.update(childRow, {
          name: childName,
          instrument_type: childType,
          quality_grade: c.quality_grade || grade,
          parent_asset_id: assetId,
          storage_location: c.storage_location || p.storage_location || '',
          notes: c.notes || '',
          active: true,
          qr_token: childRow.qr_token || newQrToken()
        });
        saved.push(childRow);
      } else {
        if (!childId) childId = nextAssetId(prefixForType(childType));
        validateAssetIdAvailable(items, childId, null);
        saved.push(items.append({
          asset_id: childId,
          qr_token: newQrToken(),
          name: childName,
          instrument_type: childType,
          quality_grade: c.quality_grade || grade,
          parent_asset_id: assetId,
          is_kit: false,               // one level of nesting only
          status: 'available',
          current_condition: c.current_condition || 'good',
          storage_location: c.storage_location || p.storage_location || '',
          notes: c.notes || '',
          photo_url: '',
          active: true
        }));
      }
    });
  }

  flushAll();

  // Returned with tokens so the label preview can render straight away.
  return { items: saved.map(publicCopy), asset_id: assetId };
}

function actionRemoveItem(p) {
  var assetId = requireField(p, 'asset_id');
  if (!p.confirm) fail('BAD_REQUEST', 'Removal was not confirmed.');

  var plan = assertPlan(Rules.planDeactivate(rulesState(), assetId));

  var items = table('Items');
  plan.asset_ids.forEach(function (id) {
    var row = items.findBy('asset_id', id);
    if (row) items.update(row, { active: false });
  });

  flushAll();
  // Nothing is deleted: the rows stay put so past movements still make sense.
  return { removed: plan.asset_ids };
}

/* ================================================================
 * EVENTS
 * ================================================================ */

function actionSaveEvent(p) {
  var events = table('Events');
  var name = requireField(p, 'name', 'an event name');
  var parentId = String(p.parent_event_id || '').trim();

  if (parentId) {
    var parent = events.findBy('event_id', parentId);
    if (!parent) fail('NOT_FOUND', 'No event found with ID ' + parentId + '.');
    // One level of nesting, enforced at the door rather than papered over later.
    if (parent.parent_event_id) {
      fail('BAD_REQUEST',
        '"' + parent.name + '" is already a sub-event. Sub-events cannot have sub-events of their own.');
    }
  }

  var existing = p.event_id ? events.findBy('event_id', String(p.event_id).trim()) : null;
  if (p.event_id && !existing) fail('NOT_FOUND', 'No event found with ID ' + p.event_id + '.');

  if (existing && parentId === existing.event_id) {
    fail('BAD_REQUEST', 'An event cannot be its own parent.');
  }
  // Turning a parent into a sub-event would orphan its children two levels down.
  if (existing && parentId && !existing.parent_event_id) {
    var hasKids = events.all().some(function (e) { return e.parent_event_id === existing.event_id; });
    if (hasKids) {
      fail('BAD_REQUEST', '"' + existing.name + '" has sub-events of its own, so it cannot become one.');
    }
  }

  // Dates: an end before a start is always a typo, and it quietly corrupts
  // every chronological list and every availability window built from it.
  var startDate = String(p.start_date || '').trim();
  var endDate = String(p.end_date || '').trim();
  if (startDate && !Rules.isValidDate(startDate)) {
    fail('BAD_REQUEST', 'The start date is not a valid date.');
  }
  if (endDate && !Rules.isValidDate(endDate)) {
    fail('BAD_REQUEST', 'The end date is not a valid date.');
  }
  if (startDate && endDate && Rules.daysBetween(startDate, endDate) < 0) {
    fail('BAD_REQUEST',
      'The end date (' + Rules.formatDayMonth(endDate) + ') is before the start date (' +
      Rules.formatDayMonth(startDate) + ').');
  }
  // A one-day event only needs a start date; fill the end in rather than
  // leaving a blank that sorts unpredictably.
  if (startDate && !endDate) endDate = startDate;

  var fields = {
    name: name,
    parent_event_id: parentId,
    start_date: startDate,
    end_date: endDate,
    location: p.location || '',
    centre: p.centre || '',
    status: p.status || 'planned'
  };

  var row;
  if (existing) {
    events.update(existing, fields);
    row = existing;
  } else {
    fields.event_id = nextSequentialId('Events', 'event_id', 'EV-', 3);
    row = events.append(fields);
  }

  flushAll();
  return { event: publicCopy(row) };
}

/**
 * Delete an event.
 *
 * Genuinely deletes the row, but only when nothing points at it. An event that
 * instruments have been out to is history — deleting it would leave movement
 * rows pointing at an id that no longer exists, and the item's own history page
 * would start showing blanks. Those get `cancelled` instead, which keeps the
 * record readable while taking the event out of every dropdown.
 */
function actionDeleteEvent(p) {
  var eventId = requireField(p, 'event_id');
  var events = table('Events');
  var row = events.findBy('event_id', eventId);
  if (!row) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var subEvents = events.all().filter(function (e) { return e.parent_event_id === eventId; });
  if (subEvents.length && !p.include_sub_events) {
    fail('BAD_REQUEST',
      '"' + row.name + '" has ' + subEvents.length + ' sub-event' +
      (subEvents.length === 1 ? '' : 's') + '. Deleting it would delete them too.');
  }

  var targets = [row].concat(p.include_sub_events ? subEvents : []);
  var ids = {};
  targets.forEach(function (e) { ids[e.event_id] = true; });

  // Anything still physically out for this event blocks the whole operation —
  // losing track of where an instrument went is the one thing this app exists
  // to prevent.
  var stillOut = table('Movements').all().filter(function (m) {
    return !m.checked_in_at && (ids[m.event_id] || ids[m.sub_event_id]);
  });
  if (stillOut.length) {
    fail('BAD_REQUEST',
      UI_plural(stillOut.length, 'instrument') + ' still out for this event. ' +
      'Take them back first.');
  }

  var hasHistory = table('Movements').all().some(function (m) {
    return ids[m.event_id] || ids[m.sub_event_id];
  });
  var openBookings = table('Allocations').all().filter(function (a) {
    return ids[a.event_id] && a.status === 'open';
  });

  if (hasHistory) {
    // Keep the row, take it out of circulation.
    targets.forEach(function (e) { events.update(e, { status: 'cancelled' }); });
    openBookings.forEach(function (a) {
      table('Allocations').update(a, { status: 'cancelled' });
    });
    flushAll();
    return {
      deleted: false,
      cancelled: targets.map(function (e) { return e.event_id; }),
      bookings_cancelled: openBookings.length,
      message: 'Instruments have been out to this event before, so it has been cancelled ' +
               'rather than deleted — that keeps the history readable. It no longer appears ' +
               'in any list.'
    };
  }

  // Nothing ever went out to it: safe to remove the row outright.
  openBookings.forEach(function (a) { table('Allocations').update(a, { status: 'cancelled' }); });
  flushAll();

  // Delete bottom-up so earlier deletions do not shift later row numbers.
  var sheet = getSheet('Events');
  targets.map(function (e) { return e._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (rowNum) { sheet.deleteRow(rowNum); });

  resetCache();
  return {
    deleted: true,
    event_ids: targets.map(function (e) { return e.event_id; }),
    bookings_cancelled: openBookings.length,
    message: 'Event deleted.'
  };
}

/** Tiny pluraliser for server-side messages. */
function UI_plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/** "Check in everything for this event", including its sub-events. */
function actionBulkCheckinEvent(p) {
  var eventId = requireField(p, 'event_id');
  var by = requireField(p, 'checked_in_by', 'your name');
  var includeSubs = p.include_sub_events !== false;

  var events = table('Events');
  if (!events.findBy('event_id', eventId)) {
    fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');
  }

  var treeIds = {};
  treeIds[eventId] = true;
  if (includeSubs) {
    events.all().forEach(function (e) {
      if (e.parent_event_id === eventId) treeIds[e.event_id] = true;
    });
  }

  var open = table('Movements').all().filter(function (m) {
    return !m.checked_in_at && (treeIds[m.event_id] || treeIds[m.sub_event_id]);
  });
  if (!open.length) fail('ITEM_NOT_OUT', 'Nothing is currently out for this event.');

  // Everything comes back "good" by default. Anything damaged or missing is
  // flagged one item at a time on the scan screen — a bulk button should not
  // be a way to record damage nobody has looked at.
  return actionCheckin({
    checked_in_by: by,
    items: open.map(function (m) { return { asset_id: m.asset_id }; })
  });
}

/* ================================================================
 * SETTINGS — reference lists and the shared access code
 * ================================================================ */

/**
 * Reference values are stored as TEXT in Items/Events/Allocations/Movements,
 * so renaming one has to rewrite every row that used the old name — otherwise
 * the history stops being readable. Done inside the same lock as the rename.
 */
function cascadeRename(oldName, newName, targets) {
  if (!oldName || oldName === newName) return;
  targets.forEach(function (t) {
    var tbl = table(t.tab);
    tbl.all().forEach(function (row) {
      if (row[t.field] === oldName) {
        var change = {};
        change[t.field] = newName;
        tbl.update(row, change);
      }
    });
  });
}

var RENAME_TARGETS = {
  Centres: [
    { tab: 'Events', field: 'centre' },
    { tab: 'Allocations', field: 'centre' },
    { tab: 'Movements', field: 'centre' }
  ],
  InstrumentTypes: [{ tab: 'Items', field: 'instrument_type' }],
  QualityGrades: [{ tab: 'Items', field: 'quality_grade' }]
};

function saveReferenceList(tabName, idPrefix, incoming, extraFields) {
  if (!Array.isArray(incoming)) return;
  var tbl = table(tabName);

  incoming.forEach(function (entry) {
    var name = String(entry.name || '').trim();
    if (!name) return;

    var row = entry.id ? tbl.findBy('id', String(entry.id).trim()) : null;
    var fields = { name: name, active: entry.active === false ? false : true };
    (extraFields || []).forEach(function (f) {
      if (entry[f] !== undefined) fields[f] = entry[f];
    });

    if (row) {
      cascadeRename(row.name, name, RENAME_TARGETS[tabName] || []);
      tbl.update(row, fields);
    } else {
      fields.id = nextSequentialId(tabName, 'id', idPrefix, 3);
      tbl.append(fields);
    }
  });
}

function actionSaveSettings(p) {
  saveReferenceList('Centres', 'C-', p.centres);
  saveReferenceList('InstrumentTypes', 'IT-', p.instrumentTypes, ['prefix']);
  saveReferenceList('QualityGrades', 'QG-', p.qualityGrades, ['rank']);

  var changed = false;
  if (p.new_access_code !== undefined && String(p.new_access_code).trim() !== '') {
    var next = String(p.new_access_code).trim();
    if (next.length < 6) {
      fail('BAD_REQUEST', 'The access code needs to be at least 6 characters.');
    }
    // The current code was already verified by requireAccess() before we got here.
    setAccessCode(next);
    changed = true;
  }

  flushAll();
  return { saved: true, access_code_changed: changed };
}
