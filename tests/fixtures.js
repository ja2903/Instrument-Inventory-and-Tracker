/**
 * Test fixtures — the seeded tabla kit plus a standalone harmonium.
 *
 * Every test starts from a fresh state() so nothing leaks between them.
 */

var TODAY = '2026-08-08';

function item(assetId, name, opts) {
  opts = opts || {};
  return {
    asset_id: assetId,
    name: name,
    instrument_type: opts.instrument_type || 'Other',
    quality_grade: opts.quality_grade || 'Aradhana',
    parent_asset_id: opts.parent || '',
    is_kit: !!opts.is_kit,
    status: opts.status || 'available',
    current_condition: opts.condition || 'good',
    storage_location: 'Store Room 2, Shelf B',
    notes: '',
    active: opts.active === false ? false : true
  };
}

/** The 6-piece tabla kit + one standalone item, everything available. */
function state() {
  return {
    items: [
      item('TAB-014', 'Tabla Set A', { is_kit: true, instrument_type: 'Tabla' }),
      item('TAB-015', 'Tabla Set A — Dayyu', { parent: 'TAB-014', instrument_type: 'Tabla' }),
      item('TAB-016', 'Tabla Set A — Bayyu', { parent: 'TAB-014', instrument_type: 'Tabla' }),
      item('OTH-001', 'Tabla Set A — Hammer', { parent: 'TAB-014' }),
      item('OTH-002', 'Tabla Set A — Powder Bottle', { parent: 'TAB-014' }),
      item('OTH-003', 'Tabla Set A — Bag', { parent: 'TAB-014' }),
      item('HAR-003', 'Harmonium (Bina)', { instrument_type: 'Harmonium' })
    ],
    movements: [],
    allocations: []
  };
}

var KIT_ALL = ['OTH-001', 'OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016'];

/** Mutates state: set an item's status. */
function setStatus(s, assetId, status) {
  for (var i = 0; i < s.items.length; i++) {
    if (s.items[i].asset_id === assetId) { s.items[i].status = status; return s; }
  }
  throw new Error('fixture has no item ' + assetId);
}

var mvCounter = 0;

/** Mutates state: mark an item checked out, optionally via a parent. */
function checkOut(s, assetId, opts) {
  opts = opts || {};
  setStatus(s, assetId, 'checked_out');
  s.movements.push({
    movement_id: 'MV-' + (++mvCounter),
    asset_id: assetId,
    allocation_id: opts.allocation_id || '',
    event_id: opts.event_id || 'EV-001',
    sub_event_id: opts.sub_event_id || 'EV-003',
    event_name: opts.event_name || 'Paris Mandir Mahotsav',
    centre: opts.centre || 'East London',
    checked_out_at: '2026-08-05T10:00:00+01:00',
    checked_out_by: 'Nilesh',
    condition_out: 'good',
    expected_return_date: opts.due || '2026-08-12',
    checked_in_at: '',
    via_parent_asset_id: opts.via || ''
  });
  return s;
}

/** Mutates state: put the whole kit out as one set (the K1 outcome). */
function checkOutWholeKit(s, opts) {
  checkOut(s, 'TAB-014', opts);
  ['TAB-015', 'TAB-016', 'OTH-001', 'OTH-002', 'OTH-003'].forEach(function (id) {
    checkOut(s, id, Object.assign({}, opts, { via: 'TAB-014' }));
  });
  return s;
}

module.exports = {
  TODAY: TODAY,
  KIT_ALL: KIT_ALL,
  item: item,
  state: state,
  setStatus: setStatus,
  checkOut: checkOut,
  checkOutWholeKit: checkOutWholeKit
};
