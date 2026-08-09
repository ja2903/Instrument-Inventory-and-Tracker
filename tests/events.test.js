/**
 * Deleting events.
 *
 * The rule that matters: an event instruments have actually been out to is
 * history. Deleting its row would leave movement records pointing at an id
 * that no longer exists, and the item history page would show blanks.
 */

var GAS = require('./gas-mock.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

function freshApp() {
  var app = GAS.loadApp({ now: '2026-08-08T13:00:00Z' });
  app.sandbox.setupSheet();
  return app;
}

function expectOk(res, msg) {
  if (!res.ok) fail((msg ? msg + '\n' : '') + 'expected success, got ' +
                    res.error.code + ': ' + res.error.message);
  return res.data;
}

function expectErr(res, code) {
  if (res.ok) fail('expected error ' + code + ', but the call succeeded');
  if (res.error.code !== code) {
    fail('expected error ' + code + ', got ' + res.error.code + ': ' + res.error.message);
  }
  return res.error;
}

module.exports = function () {

  suite('Deleting an event that was never used', function () {

    test('the row is removed outright', function () {
      var app = freshApp();
      expectOk(app.post('saveEvent', { name: 'Cancelled fundraiser', start_date: '2026-09-01' }));
      eq(app.rows('Events').length, 4);

      var d = expectOk(app.post('deleteEvent', { event_id: 'EV-004' }));
      eq(d.deleted, true);
      eq(app.rows('Events').length, 3);
      notOk(app.rows('Events').some(function (e) { return e.event_id === 'EV-004'; }));
    });

    test('deleting a sub-event leaves its parent alone', function () {
      var app = freshApp();
      expectOk(app.post('deleteEvent', { event_id: 'EV-003' }));
      eq(app.rows('Events').length, 2);
      ok(app.rows('Events').some(function (e) { return e.event_id === 'EV-001'; }));
      ok(app.rows('Events').some(function (e) { return e.event_id === 'EV-002'; }));
    });

    test('open bookings for it are cancelled, not orphaned', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      });
      var d = expectOk(app.post('deleteEvent', { event_id: 'EV-003' }));
      eq(d.bookings_cancelled, 1);
      eq(app.rows('Allocations')[0].status, 'cancelled');
    });

    test('and the instrument is free again afterwards', function () {
      var app = freshApp();
      app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-003',
        needed_from: '2026-08-15', expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      });
      app.post('deleteEvent', { event_id: 'EV-003' });
      expectOk(app.post('allocate', {
        asset_ids: ['HAR-003'], event_id: 'EV-002',
        needed_from: '2026-08-15', expected_return_date: '2026-08-16', allocated_by: 'Jignesh'
      }));
    });
  });

  suite('Deleting an event that has history', function () {

    function withHistory(app) {
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      app.post('checkin', { checked_in_by: 'Nilesh', items: [{ asset_id: 'HAR-003' }] });
      return app;
    }

    test('the row survives — it is cancelled instead', function () {
      var app = withHistory(freshApp());
      var d = expectOk(app.post('deleteEvent', { event_id: 'EV-003' }));
      eq(d.deleted, false);
      eq(app.rows('Events').length, 3, 'nothing was removed');
      eq(app.rows('Events').filter(function (e) { return e.event_id === 'EV-003'; })[0].status,
         'cancelled');
    });

    test('and says why, in words a volunteer can act on', function () {
      var app = withHistory(freshApp());
      var d = expectOk(app.post('deleteEvent', { event_id: 'EV-003' }));
      ok(d.message.indexOf('cancelled rather than deleted') !== -1);
    });

    test('the item history still reads correctly afterwards', function () {
      var app = withHistory(freshApp());
      app.post('deleteEvent', { event_id: 'EV-003' });
      var item = expectOk(app.get('item', { asset_id: 'HAR-003' }));
      eq(item.movements.length, 1);
      eq(item.movements[0].sub_event_name, 'Nagar Yatra', 'the event name still resolves');
    });
  });

  suite('Deletions that are refused', function () {

    test('an event with instruments still out cannot be deleted', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      var e = expectErr(app.post('deleteEvent', { event_id: 'EV-003' }), 'BAD_REQUEST');
      ok(e.message.indexOf('still out') !== -1);
      ok(e.message.indexOf('6 instruments') !== -1, 'it counts the whole set');
      eq(app.rows('Events').length, 3);
    });

    test('a parent with sub-events warns before taking them with it', function () {
      var app = freshApp();
      var e = expectErr(app.post('deleteEvent', { event_id: 'EV-001' }), 'BAD_REQUEST');
      ok(e.message.indexOf('2 sub-events') !== -1);
      eq(app.rows('Events').length, 3, 'nothing was removed');
    });

    test('but does delete the whole tree once that is confirmed', function () {
      var app = freshApp();
      var d = expectOk(app.post('deleteEvent', {
        event_id: 'EV-001', include_sub_events: true
      }));
      eq(d.deleted, true);
      eq(d.event_ids.sort(), ['EV-001', 'EV-002', 'EV-003']);
      eq(app.rows('Events').length, 0);
    });

    test('an unknown event id', function () {
      var app = freshApp();
      expectErr(app.post('deleteEvent', { event_id: 'EV-999' }), 'NOT_FOUND');
    });

    test('deleting the tree still refuses if any piece is out under a sub-event', function () {
      var app = freshApp();
      app.post('checkout', {
        asset_ids: ['HAR-003'], event_id: 'EV-002', centre: 'Ruislip',
        expected_return_date: '2026-08-12', checked_out_by: 'Nilesh'
      });
      expectErr(app.post('deleteEvent', { event_id: 'EV-001', include_sub_events: true }),
                'BAD_REQUEST');
      eq(app.rows('Events').length, 3);
    });
  });
};
