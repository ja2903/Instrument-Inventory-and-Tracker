/**
 * Date-window availability.
 *
 * The question this answers: East London have already asked for HAR-003 over
 * the 10th to the 12th. Paris now want it. Is it free?
 *
 * The answer depends entirely on WHICH days Paris want it, which is why an
 * allocation carries needed_from as well as expected_return_date.
 */

var Rules = require('../apps-script/src/10-rules.js');
var F = require('./fixtures.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk;
var expectOk = H.expectOk, expectErr = H.expectErr;

/** State with one open allocation: HAR-003 to East London, 10–12 Aug. */
function stateWithEastLondonBooking() {
  var s = F.state();
  s.today = '2026-08-08';
  s.allocations.push({
    allocation_id: 'AL-000001',
    asset_id: 'HAR-003',
    event_id: 'EV-002',
    event_name: 'Bal Din',
    centre: 'East London',
    needed_from: '2026-08-10',
    expected_return_date: '2026-08-12',
    allocated_by: 'Nilesh',
    status: 'open'
  });
  return s;
}

function allocReq(extra) {
  return Object.assign({
    asset_ids: ['HAR-003'],
    event_id: 'EV-003',
    centre: 'Paris',
    allocated_by: 'Jignesh'
  }, extra);
}

module.exports = function () {

  suite('rangesOverlap — the primitive', function () {

    test('two ranges that share days overlap', function () {
      ok(Rules.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-11', '2026-08-15'));
    });

    test('two ranges that do not touch are free of each other', function () {
      notOk(Rules.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15'));
      notOk(Rules.rangesOverlap('2026-08-13', '2026-08-15', '2026-08-10', '2026-08-12'));
    });

    test('touching on a single day counts as a clash — both ends are inclusive', function () {
      // An item due back on the 12th may not physically arrive until that
      // evening, so promising it to someone else on the 12th is a trap.
      ok(Rules.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-12', '2026-08-15'));
    });

    test('one range entirely inside another overlaps', function () {
      ok(Rules.rangesOverlap('2026-08-01', '2026-08-31', '2026-08-11', '2026-08-12'));
      ok(Rules.rangesOverlap('2026-08-11', '2026-08-12', '2026-08-01', '2026-08-31'));
    });

    test('identical single days overlap', function () {
      ok(Rules.rangesOverlap('2026-08-12', '2026-08-12', '2026-08-12', '2026-08-12'));
    });

    test('an open-ended booking blocks everything after its start', function () {
      ok(Rules.rangesOverlap('2026-09-01', '2026-09-02', '2026-08-10', ''));
      notOk(Rules.rangesOverlap('2026-08-01', '2026-08-05', '2026-08-10', ''));
    });

    test('a booking with no dates at all is treated as clashing, not as free', function () {
      // Failing towards "ask a human" is the cheap mistake. Failing towards
      // "available" is how two centres turn up for the same harmonium.
      ok(Rules.rangesOverlap('2026-08-10', '2026-08-12', '', ''));
    });
  });

  suite('The Paris and East London case', function () {

    test('Paris cannot have it on the 11th — East London have it 10th to 12th', function () {
      var s = stateWithEastLondonBooking();
      var conflicts = Rules.conflictsFor(s, 'HAR-003', '2026-08-11', '2026-08-11');
      eq(conflicts.length, 1);
      eq(conflicts[0].kind, 'allocation');
      eq(conflicts[0].centre, 'East London');
    });

    test('the clash says who has it and for which days', function () {
      var s = stateWithEastLondonBooking();
      var c = Rules.conflictsFor(s, 'HAR-003', '2026-08-11', '2026-08-11')[0];
      eq(c.reason, 'Allocated to Bal Din (10 Aug – 12 Aug)');
      eq(c.from, '2026-08-10');
      eq(c.to, '2026-08-12');
    });

    test('Paris CAN have it on the 14th — the windows do not touch', function () {
      var s = stateWithEastLondonBooking();
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-14', '2026-08-16'), []);
      ok(Rules.isFreeBetween(s, 'HAR-003', '2026-08-14', '2026-08-16'));
    });

    test('and the allocation goes through for those dates', function () {
      var s = stateWithEastLondonBooking();
      expectOk(Rules.planAllocate(s, allocReq({
        needed_from: '2026-08-14', expected_return_date: '2026-08-16'
      })));
    });

    test('but is refused for overlapping dates, naming the clash', function () {
      var s = stateWithEastLondonBooking();
      var r = expectErr(Rules.planAllocate(s, allocReq({
        needed_from: '2026-08-11', expected_return_date: '2026-08-13'
      })), 'NOT_AVAILABLE');
      ok(r.error.message.indexOf('Bal Din') !== -1, 'the message names the other event');
      ok(r.error.message.indexOf('11 Aug') !== -1, 'and the dates asked for');
      eq(r.conflicts.length, 1, 'the conflicts come back for the UI to show');
    });

    test('the same item CAN be booked twice for non-overlapping windows', function () {
      var s = stateWithEastLondonBooking();
      expectOk(Rules.planAllocate(s, allocReq({
        needed_from: '2026-08-13', expected_return_date: '2026-08-14'
      })), 'the day after East London give it back');
      expectOk(Rules.planAllocate(s, allocReq({
        needed_from: '2026-08-01', expected_return_date: '2026-08-09'
      })), 'the week before they need it');
    });

    test('a cancelled booking blocks nothing', function () {
      var s = stateWithEastLondonBooking();
      s.allocations[0].status = 'cancelled';
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-11', '2026-08-11'), []);
    });

    test('an allocation can exclude itself, so editing one is not a self-clash', function () {
      var s = stateWithEastLondonBooking();
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-11', '2026-08-11', ['AL-000001']), []);
    });
  });

  suite('Other reasons an item is not free', function () {

    test('physically checked out blocks the dates it is out for', function () {
      var s = F.state();
      s.today = '2026-08-08';
      F.checkOut(s, 'HAR-003', { due: '2026-08-12', centre: 'Ruislip' });
      var c = Rules.conflictsFor(s, 'HAR-003', '2026-08-10', '2026-08-11');
      eq(c.length, 1);
      eq(c[0].kind, 'checked_out');
      ok(c[0].reason.indexOf('Ruislip') !== -1);
      ok(c[0].reason.indexOf('12 Aug') !== -1);
    });

    test('but not the dates after it is due back', function () {
      var s = F.state();
      s.today = '2026-08-08';
      F.checkOut(s, 'HAR-003', { due: '2026-08-12' });
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-13', '2026-08-15'), []);
    });

    test('an ALREADY OVERDUE item blocks every future date, not just its old window', function () {
      // The subtle one. An item due back on the 5th and still out on the 8th
      // has no known return date — reporting it free for the 20th would be
      // exactly backwards, because it is not even back yet.
      var s = F.state();
      s.today = '2026-08-08';
      F.checkOut(s, 'HAR-003', { due: '2026-08-05', centre: 'East London' });

      var c = Rules.conflictsFor(s, 'HAR-003', '2026-08-20', '2026-08-22');
      eq(c.length, 1, 'a late item is not available next month');
      eq(c[0].kind, 'checked_out');
      eq(c[0].to, '', 'its window is open-ended until someone returns it');
      ok(c[0].reason.indexOf('3 days overdue') !== -1, 'and it says how late');
    });

    test('an overdue item cannot be allocated to anyone', function () {
      var s = F.state();
      s.today = '2026-08-08';
      F.checkOut(s, 'HAR-003', { due: '2026-08-05' });
      expectErr(Rules.planAllocate(s, {
        asset_ids: ['HAR-003'], event_id: 'EV-003', allocated_by: 'Jignesh',
        needed_from: '2026-09-01', expected_return_date: '2026-09-02'
      }), 'NOT_AVAILABLE');
    });

    test('due back today is still a normal booking, not an overdue one', function () {
      var s = F.state();
      s.today = '2026-08-08';
      F.checkOut(s, 'HAR-003', { due: '2026-08-08' });
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-10', '2026-08-11'), [],
         'free from tomorrow onwards');
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-08', '2026-08-08').length, 1,
         'but not today');
    });

    test('maintenance blocks every date, not a window', function () {
      var s = F.setStatus(F.state(), 'HAR-003', 'maintenance');
      s.today = '2026-08-08';
      var c = Rules.conflictsFor(s, 'HAR-003', '2027-01-01', '2027-01-02');
      eq(c.length, 1);
      eq(c[0].kind, 'status');
      eq(c[0].reason, 'In maintenance');
    });

    test('a lost item blocks every date too', function () {
      var s = F.setStatus(F.state(), 'HAR-003', 'lost');
      s.today = '2026-08-08';
      eq(Rules.conflictsFor(s, 'HAR-003', '2027-01-01', '2027-01-02')[0].reason, 'Marked lost');
    });

    test('an available item with no bookings is free', function () {
      var s = F.state();
      s.today = '2026-08-08';
      eq(Rules.conflictsFor(s, 'HAR-003', '2026-08-10', '2026-08-12'), []);
    });
  });

  suite('Kits over a window', function () {

    test('a kit whose piece is booked elsewhere goes out without that piece', function () {
      var s = F.state();
      s.today = '2026-08-08';
      s.allocations.push({
        allocation_id: 'AL-000001', asset_id: 'OTH-001', event_id: 'EV-002',
        event_name: 'Bal Din', centre: 'East London',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12', status: 'open'
      });

      var r = expectOk(Rules.planAllocate(s, {
        asset_ids: ['TAB-014'], event_id: 'EV-003', allocated_by: 'Jignesh',
        needed_from: '2026-08-11', expected_return_date: '2026-08-13'
      }));
      eq(r.asset_ids.sort(), ['OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016']);
      eq(r.warnings.length, 1);
      eq(r.warnings[0].asset_id, 'OTH-001');
      ok(r.warnings[0].reason.indexOf('Bal Din') !== -1);
    });

    test('the whole kit goes when the dates do not clash', function () {
      var s = F.state();
      s.today = '2026-08-08';
      s.allocations.push({
        allocation_id: 'AL-000001', asset_id: 'OTH-001', event_id: 'EV-002',
        needed_from: '2026-08-10', expected_return_date: '2026-08-12', status: 'open'
      });
      var r = expectOk(Rules.planAllocate(s, {
        asset_ids: ['TAB-014'], event_id: 'EV-003', allocated_by: 'Jignesh',
        needed_from: '2026-08-14', expected_return_date: '2026-08-16'
      }));
      eq(r.asset_ids.sort(), F.KIT_ALL);
      eq(r.warnings, []);
    });
  });

  suite('Form validation', function () {

    test('a return date before the needed-from date is refused', function () {
      var s = F.state();
      s.today = '2026-08-08';
      var r = expectErr(Rules.planAllocate(s, allocReq({
        needed_from: '2026-08-16', expected_return_date: '2026-08-14'
      })), 'BAD_REQUEST');
      ok(r.error.message.indexOf('before') !== -1);
    });

    test('a missing needed-from date falls back to today', function () {
      var s = F.state();
      s.today = '2026-08-08';
      var r = expectOk(Rules.planAllocate(s, allocReq({
        expected_return_date: '2026-08-16'
      })));
      eq(r.needed_from, '2026-08-08');
    });

    test('the name is described as the person responsible', function () {
      var s = F.state();
      s.today = '2026-08-08';
      var r = expectErr(Rules.planAllocate(s, allocReq({
        expected_return_date: '2026-08-16', allocated_by: ''
      })), 'BAD_REQUEST');
      ok(r.error.message.indexOf('person responsible') !== -1);
    });

    test('centre is no longer required', function () {
      var s = F.state();
      s.today = '2026-08-08';
      expectOk(Rules.planAllocate(s, {
        asset_ids: ['HAR-003'], event_id: 'EV-003', allocated_by: 'Jignesh',
        expected_return_date: '2026-08-16'
      }));
    });
  });
};
