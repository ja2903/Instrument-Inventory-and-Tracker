/**
 * Instrument Tracker — read endpoints (doGet).
 *
 * The heavy lifting is `live`: for every item currently out, the server
 * resolves the event, sub-event, centre and days-overdue once, so the browser
 * never has to join tables to render a status line.
 */

/* ---------------- shared derivation ------------------------------ */

function eventsById() {
  var map = {};
  table('Events').all().forEach(function (e) { map[e.event_id] = e; });
  return map;
}

/**
 * Top-level ancestor of an event.
 *
 * The data model is recursive but the UI shows exactly one level. If someone
 * hand-edits the Sheet into a three-deep chain, this walks up to the root
 * rather than crashing — and the depth guard stops a circular parent
 * reference from hanging the script.
 */
function rootEventId(evMap, eventId) {
  var current = evMap[eventId];
  var guard = 0;
  while (current && current.parent_event_id && evMap[current.parent_event_id] && guard++ < 10) {
    current = evMap[current.parent_event_id];
  }
  return current ? current.event_id : eventId;
}

function eventName(evMap, id) {
  return id && evMap[id] ? evMap[id].name : '';
}

/** Open movements (blank checked_in_at), keyed by asset_id. */
function openMovementsByAsset() {
  var map = {};
  table('Movements').all().forEach(function (m) {
    if (!m.checked_in_at) map[m.asset_id] = m;
  });
  return map;
}

/** The `live` block described in docs/API.md. Computed fresh, stored nowhere. */
function liveFor(movement, evMap, itemsById, today) {
  if (!movement) return null;
  var viaId = movement.via_parent_asset_id || '';
  return {
    movement_id: movement.movement_id,
    allocation_id: movement.allocation_id || '',
    event_id: movement.event_id || '',
    event_name: eventName(evMap, movement.event_id),
    sub_event_id: movement.sub_event_id || '',
    sub_event_name: eventName(evMap, movement.sub_event_id),
    centre: movement.centre || '',
    expected_return_date: movement.expected_return_date || '',
    days_overdue: Rules.daysOverdue(movement.expected_return_date, '', today),
    via_parent_asset_id: viaId,
    via_parent_name: viaId && itemsById[viaId] ? itemsById[viaId].name : '',
    checked_out_at: movement.checked_out_at || '',
    checked_out_by: movement.checked_out_by || ''
  };
}

/** Every item as the client wants it: public fields, children ids, live state. */
function decoratedItems() {
  var today = todayISO();
  var evMap = eventsById();
  var rows = table('Items').all();

  var byId = {};
  rows.forEach(function (r) { byId[r.asset_id] = r; });

  var openMv = openMovementsByAsset();

  var childrenOf = {};
  rows.forEach(function (r) {
    if (!r.parent_asset_id) return;
    (childrenOf[r.parent_asset_id] = childrenOf[r.parent_asset_id] || []).push(r.asset_id);
  });

  return rows.map(function (r) {
    var item = publicCopy(r);
    item.children = childrenOf[r.asset_id] || [];
    item.live = liveFor(openMv[r.asset_id], evMap, byId, today);
    return item;
  });
}

/* ---------------- endpoints -------------------------------------- */

function handlePing() {
  return { ok: true, version: APP_VERSION, today: todayISO() };
}

/**
 * The single call the app makes on load. One round trip, whole dataset.
 * At this scale that is simpler and faster than a dozen chatty endpoints.
 */
function handleBootstrap() {
  var today = todayISO();
  var evMap = eventsById();

  /*
   * has_history: has anything EVER been out to this event?
   *
   * The client cannot work this out for itself — bootstrap only carries open
   * movements, so a finished event with only returned loans looked empty and
   * the delete dialog promised a permanent deletion the server would refuse
   * to perform. One boolean per event settles it.
   */
  var eventHasHistory = {};
  table('Movements').all().forEach(function (m) {
    if (m.event_id) eventHasHistory[m.event_id] = true;
    if (m.sub_event_id) eventHasHistory[m.sub_event_id] = true;
  });

  var events = table('Events').all().map(function (e) {
    var ev = publicCopy(e);
    ev.children = [];
    ev.has_history = !!eventHasHistory[e.event_id];
    return ev;
  });
  var evOut = {};
  events.forEach(function (e) { evOut[e.event_id] = e; });
  events.forEach(function (e) {
    if (e.parent_event_id && evOut[e.parent_event_id]) {
      evOut[e.parent_event_id].children.push(e.event_id);
    }
  });

  // Open allocations go to the client in full, with their event names resolved,
  // so the Allocate screen can work out what is free on a given date without a
  // round trip every time someone changes the date picker.
  var itemNames = {};
  table('Items').all().forEach(function (i) { itemNames[i.asset_id] = i.name; });

  var openAllocations = table('Allocations').all()
    .filter(function (a) { return a.status === 'open'; })
    .map(function (a) {
      var al = publicCopy(a);
      al.event_name = eventName(evMap, a.event_id);
      al.parent_event_name = eventName(evMap, rootEventId(evMap, a.event_id));
      al.name = itemNames[a.asset_id] || a.asset_id;
      return al;
    });

  var openMovements = table('Movements').all()
    .filter(function (m) { return !m.checked_in_at; })
    .map(function (m) {
      var mv = publicCopy(m);
      mv.event_name = eventName(evMap, m.event_id);
      mv.sub_event_name = eventName(evMap, m.sub_event_id);
      mv.days_overdue = Rules.daysOverdue(m.expected_return_date, '', today);
      return mv;
    });

  return {
    today: today,
    version: APP_VERSION,
    centres: table('Centres').all().map(publicCopy),
    instrumentTypes: table('InstrumentTypes').all().map(publicCopy),
    qualityGrades: table('QualityGrades').all().map(publicCopy),
    events: events,
    items: decoratedItems(),
    openAllocations: openAllocations,
    openMovements: openMovements
  };
}

/** One item in full: attributes, expanded children, complete movement history. */
function handleItem(params) {
  var assetId = String(params.asset_id || '').trim();
  if (!assetId) fail('BAD_REQUEST', 'No item was asked for.');

  var today = todayISO();
  var evMap = eventsById();
  var itemsTable = table('Items');
  var row = itemsTable.findBy('asset_id', assetId);
  if (!row) fail('NOT_FOUND', 'No item found with ID ' + assetId + '.');

  var all = decoratedItems();
  var byId = {};
  all.forEach(function (i) { byId[i.asset_id] = i; });

  var item = byId[assetId];
  var children = (item.children || []).map(function (id) { return byId[id]; })
                                      .filter(function (c) { return !!c; });

  var history = table('Movements').all()
    .filter(function (m) { return m.asset_id === assetId; })
    .map(function (m) {
      var mv = publicCopy(m);
      mv.event_name = eventName(evMap, m.event_id);
      mv.sub_event_name = eventName(evMap, m.sub_event_id);
      mv.days_overdue = Rules.daysOverdue(m.expected_return_date, m.checked_in_at, today);
      return mv;
    })
    .reverse();   // newest first

  var allocations = table('Allocations').all()
    .filter(function (a) { return a.asset_id === assetId; })
    .map(function (a) {
      var al = publicCopy(a);
      al.event_name = eventName(evMap, a.event_id);
      return al;
    })
    .reverse();

  item.children_expanded = children;
  item.movements = history;
  item.allocations = allocations;
  item.status_text = Rules.describeStatus(item, item.live, today);
  return item;
}

/**
 * Scan lookup. `q` is whatever the QR held or the volunteer typed.
 *
 * The QR encodes the asset_id in plain text, so `q` is normally an asset_id —
 * but a qr_token is accepted too, and matching is case-insensitive with
 * whitespace trimmed because this input is often typed on a phone.
 */
function handleResolve(params) {
  var q = String(params.q || params.token || '').trim();
  if (!q) fail('BAD_REQUEST', 'Nothing was scanned.');

  var needle = q.toUpperCase();
  var rows = table('Items').all();
  var found = null;

  for (var i = 0; i < rows.length && !found; i++) {
    if (String(rows[i].asset_id).toUpperCase() === needle) found = rows[i];
  }
  for (var j = 0; j < rows.length && !found; j++) {
    if (String(rows[j].qr_token).toUpperCase() === needle) found = rows[j];
  }
  if (!found) {
    fail('NOT_FOUND', 'No item found for "' + q + '". Check the ID printed under the QR code.');
  }

  var today = todayISO();
  var evMap = eventsById();
  var byId = {};
  rows.forEach(function (r) { byId[r.asset_id] = r; });

  var item = publicCopy(found);
  item.children = rows.filter(function (r) { return r.parent_asset_id === found.asset_id && r.active; })
                      .map(function (r) { return r.asset_id; });
  item.live = liveFor(openMovementsByAsset()[found.asset_id], evMap, byId, today);
  item.status_text = Rules.describeStatus(item, item.live, today);
  return item;
}

/**
 * One event, its sub-events, and everything allocated across the whole tree —
 * with the out / returned / overdue counts the event page shows.
 */
function handleEvent(params) {
  var eventId = String(params.event_id || '').trim();
  if (!eventId) fail('BAD_REQUEST', 'No event was asked for.');

  var today = todayISO();
  var evMap = eventsById();
  var root = evMap[eventId];
  if (!root) fail('NOT_FOUND', 'No event found with ID ' + eventId + '.');

  var subEvents = table('Events').all().filter(function (e) {
    return e.parent_event_id === eventId;
  });
  var treeIds = {};
  treeIds[eventId] = true;
  subEvents.forEach(function (e) { treeIds[e.event_id] = true; });

  var itemsById = {};
  table('Items').all().forEach(function (i) { itemsById[i.asset_id] = i; });

  var movements = table('Movements').all().filter(function (m) {
    return treeIds[m.event_id] || treeIds[m.sub_event_id];
  });

  var lines = movements.map(function (m) {
    var item = itemsById[m.asset_id];
    return {
      movement_id: m.movement_id,
      asset_id: m.asset_id,
      name: item ? item.name : m.asset_id,
      instrument_type: item ? item.instrument_type : '',
      is_kit: item ? item.is_kit : false,
      via_parent_asset_id: m.via_parent_asset_id || '',
      centre: m.centre || '',
      event_id: m.event_id,
      sub_event_id: m.sub_event_id || '',
      sub_event_name: eventName(evMap, m.sub_event_id),
      expected_return_date: m.expected_return_date || '',
      checked_out_at: m.checked_out_at,
      checked_out_by: m.checked_out_by,
      checked_in_at: m.checked_in_at || '',
      outcome: m.outcome || '',
      is_out: !m.checked_in_at,
      days_overdue: Rules.daysOverdue(m.expected_return_date, m.checked_in_at, today)
    };
  }).reverse();

  function countFor(filterFn) {
    var subset = lines.filter(filterFn);
    return {
      out: subset.filter(function (l) { return l.is_out; }).length,
      returned: subset.filter(function (l) { return !l.is_out; }).length,
      overdue: subset.filter(function (l) { return l.days_overdue > 0; }).length
    };
  }

  var allocations = table('Allocations').all()
    .filter(function (a) { return treeIds[a.event_id]; })
    .map(function (a) {
      var al = publicCopy(a);
      var item = itemsById[a.asset_id];
      al.name = item ? item.name : a.asset_id;
      al.item_status = item ? item.status : '';
      al.event_name = eventName(evMap, a.event_id);
      return al;
    })
    .reverse();

  return {
    event: publicCopy(root),
    sub_events: subEvents.map(function (e) {
      var out = publicCopy(e);
      out.counts = countFor(function (l) { return l.sub_event_id === e.event_id; });
      return out;
    }),
    counts: countFor(function () { return true; }),
    movements: lines,
    allocations: allocations,
    today: today
  };
}
