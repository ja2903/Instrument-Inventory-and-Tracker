/**
 * Overdue is computed, never stored.
 *
 * The boundary cases here are the ones that bite in practice: "due today"
 * must not read as late, and the arithmetic must survive the two nights a
 * year when British clocks change.
 */

var Rules = require('../apps-script/src/10-rules.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk;

module.exports = function () {

  suite('Overdue — the boundary', function () {

    test('due today is NOT overdue — you have until the end of the day', function () {
      eq(Rules.daysOverdue('2026-08-08', '', '2026-08-08'), 0);
      notOk(Rules.isOverdue('2026-08-08', '', '2026-08-08'));
    });

    test('due yesterday is exactly 1 day late', function () {
      eq(Rules.daysOverdue('2026-08-07', '', '2026-08-08'), 1);
      ok(Rules.isOverdue('2026-08-07', '', '2026-08-08'));
    });

    test('due in the future is not overdue and never negative', function () {
      eq(Rules.daysOverdue('2026-08-12', '', '2026-08-08'), 0);
      notOk(Rules.isOverdue('2026-08-12', '', '2026-08-08'));
    });

    test('three days late reads as 3', function () {
      eq(Rules.daysOverdue('2026-08-05', '', '2026-08-08'), 3);
    });
  });

  suite('Overdue — returned and missing data', function () {

    test('an item already checked in is never overdue, however late it was', function () {
      eq(Rules.daysOverdue('2026-01-01', '2026-08-08T09:00:00+01:00', '2026-08-08'), 0);
      notOk(Rules.isOverdue('2026-01-01', '2026-08-08T09:00:00+01:00', '2026-08-08'));
    });

    test('no expected return date means nothing was promised, so nothing is late', function () {
      eq(Rules.daysOverdue('', '', '2026-08-08'), 0);
      eq(Rules.daysOverdue(null, '', '2026-08-08'), 0);
    });

    test('an unparseable date is treated as no date, not as a crash', function () {
      eq(Rules.daysOverdue('12/08/2026', '', '2026-08-08'), 0);
      eq(Rules.daysBetween('not a date', '2026-08-08'), null);
    });
  });

  suite('Overdue — British Summer Time', function () {

    // Clocks go FORWARD on the last Sunday of March (29 March 2026).
    // A local-time subtraction across this night is 23 hours and rounds wrong.
    test('spans the March clock change (GMT → BST) without losing a day', function () {
      eq(Rules.daysBetween('2026-03-28', '2026-03-31'), 3);
      eq(Rules.daysOverdue('2026-03-28', '', '2026-03-31'), 3);
    });

    // Clocks go BACK on the last Sunday of October (25 October 2026).
    // That night is 25 hours long.
    test('spans the October clock change (BST → GMT) without gaining a day', function () {
      eq(Rules.daysBetween('2026-10-24', '2026-10-28'), 4);
      eq(Rules.daysOverdue('2026-10-24', '', '2026-10-28'), 4);
    });

    test('the clock-change night itself counts as exactly one day, both ways', function () {
      eq(Rules.daysBetween('2026-03-28', '2026-03-29'), 1);  // 23-hour night
      eq(Rules.daysBetween('2026-10-24', '2026-10-25'), 1);  // 25-hour night
    });
  });

  suite('Overdue — calendar arithmetic', function () {

    test('crosses a year boundary', function () {
      eq(Rules.daysBetween('2025-12-30', '2026-01-02'), 3);
    });

    test('handles a leap day (2028 is a leap year)', function () {
      eq(Rules.daysBetween('2028-02-28', '2028-03-01'), 2);
      eq(Rules.daysBetween('2026-02-28', '2026-03-01'), 1);
    });

    test('a very stale item counts in whole days, not weeks or months', function () {
      eq(Rules.daysOverdue('2026-05-08', '', '2026-08-08'), 92);
    });
  });

  suite('Plain-English status line', function () {

    test('reads the way the brief asks for it', function () {
      var item = { asset_id: 'HAR-003', name: 'Harmonium', status: 'checked_out', active: true };
      var live = {
        centre: 'East London',
        event_name: 'Paris Mandir Mahotsav',
        sub_event_name: 'Nagar Yatra',
        expected_return_date: '2026-08-12',
        via_parent_asset_id: ''
      };
      eq(
        Rules.describeStatus(item, live, '2026-08-15'),
        // The one status sentence, worded the way a volunteer would say it.
        'Out with East London — Paris Mandir Mahotsav / Nagar Yatra — due 12 Aug — 3 days overdue'
      );
    });

    test('says "1 day overdue", not "1 days overdue"', function () {
      var item = { asset_id: 'HAR-003', name: 'Harmonium', status: 'checked_out', active: true };
      var live = { centre: 'Ruislip', expected_return_date: '2026-08-12', via_parent_asset_id: '' };
      ok(Rules.describeStatus(item, live, '2026-08-13').indexOf('1 day overdue') !== -1);
    });

    test('omits the overdue clause entirely when the item is not late', function () {
      var item = { asset_id: 'HAR-003', name: 'Harmonium', status: 'checked_out', active: true };
      var live = { centre: 'Ruislip', expected_return_date: '2026-08-12', via_parent_asset_id: '' };
      notOk(Rules.describeStatus(item, live, '2026-08-10').indexOf('overdue') !== -1);
    });

    // Rule K4 — how a kit child must read while it is out with its set.
    test('a child out via its parent reads "Out — via TAB-014 (Tabla Set A)"', function () {
      var child = { asset_id: 'OTH-001', name: 'Hammer', status: 'checked_out', active: true };
      var live = {
        centre: 'East London',
        via_parent_asset_id: 'TAB-014',
        via_parent_name: 'Tabla Set A',
        expected_return_date: '2026-08-12'
      };
      ok(Rules.describeStatus(child, live, '2026-08-08')
           .indexOf('Out — via TAB-014 (Tabla Set A)') === 0);
    });

    test('dates render as "12 Aug" with no leading zero', function () {
      eq(Rules.formatDayMonth('2026-08-12'), '12 Aug');
      eq(Rules.formatDayMonth('2026-01-05'), '5 Jan');
      eq(Rules.formatDayMonth(''), '');
    });
  });
};
