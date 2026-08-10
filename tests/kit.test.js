/**
 * The kit cascade — rules K1 to K10 from docs/SCHEMA.md.
 *
 * A tabla set is one parent item with five children. Getting this wrong is how
 * a hammer quietly disappears, so each rule is pinned down individually and
 * named after the rule it defends.
 */

var Rules = require('../apps-script/src/10-rules.js');
var F = require('./fixtures.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk;
var expectOk = H.expectOk, expectErr = H.expectErr, ids = H.ids;

module.exports = function () {

  /* ---------------------------------------------------------------- */
  suite('K1 — scanning the parent takes the whole set', function () {

    test('checking out TAB-014 checks out all six pieces', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['TAB-014'] }));
      eq(ids(r.lines), F.KIT_ALL);
      eq(r.warnings, []);
    });

    test('each child carries via_parent_asset_id, the parent does not', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['TAB-014'] }));
      r.lines.forEach(function (line) {
        if (line.asset_id === 'TAB-014') {
          eq(line.via_parent_asset_id, '', 'the parent is not out via itself');
        } else {
          eq(line.via_parent_asset_id, 'TAB-014', line.asset_id + ' should be out via TAB-014');
        }
      });
    });

    test('a standalone item produces exactly one line', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['HAR-003'] }));
      eq(ids(r.lines), ['HAR-003']);
      eq(r.lines[0].via_parent_asset_id, '');
    });

    test('scanning a kit and a standalone item together works in one batch', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['TAB-014', 'HAR-003'] }));
      eq(ids(r.lines), F.KIT_ALL.concat(['HAR-003']).sort());
    });

    test('scanning the same item twice does not check it out twice', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['HAR-003', 'HAR-003'] }));
      eq(r.lines.length, 1);
    });

    test('scanning parent AND child keeps the child linked to the parent', function () {
      // Whichever order they were scanned in, the physical truth is that the
      // child left inside the bag — so a later parent check-in must sweep it up.
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['OTH-001', 'TAB-014'] }));
      eq(ids(r.lines), F.KIT_ALL);
      var hammer = r.lines.filter(function (l) { return l.asset_id === 'OTH-001'; })[0];
      eq(hammer.via_parent_asset_id, 'TAB-014');
    });

    test('an inactive child is left out of the set silently', function () {
      var s = F.state();
      s.items[3].active = false;                 // OTH-001 removed from inventory
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'] }));
      eq(ids(r.lines), ['OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016']);
      eq(r.warnings, [], 'a removed item is not a surprise worth warning about');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K2 — a child in maintenance is skipped, not fatal', function () {

    test('the rest of the set still goes out', function () {
      var s = F.setStatus(F.state(), 'OTH-001', 'maintenance');
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'] }));
      eq(ids(r.lines), ['OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016']);
    });

    test('and the skip is reported in plain English', function () {
      var s = F.setStatus(F.state(), 'OTH-001', 'maintenance');
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'] }));
      eq(r.warnings.length, 1);
      eq(r.warnings[0].asset_id, 'OTH-001');
      eq(r.warnings[0].reason, 'In maintenance — not included.');
    });

    test('a lost child is skipped the same way, with its own wording', function () {
      var s = F.setStatus(F.state(), 'OTH-001', 'lost');
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'] }));
      eq(r.warnings[0].reason, 'Marked lost — not included.');
      eq(r.lines.length, 5);
    });

    test('but scanning that same child DIRECTLY is a hard error', function () {
      // Skip-with-warning is for items swept up by a parent. If a volunteer
      // deliberately scanned this one, silence would be wrong.
      var s = F.setStatus(F.state(), 'OTH-001', 'maintenance');
      expectErr(Rules.planCheckout(s, { asset_ids: ['OTH-001'] }), 'BAD_REQUEST');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K3 — a child already out alone blocks the parent', function () {

    test('checking out the set is refused', function () {
      var s = F.checkOut(F.state(), 'OTH-001');   // hammer out on its own
      var r = expectErr(Rules.planCheckout(s, { asset_ids: ['TAB-014'] }), 'KIT_CHILD_OUT');
      ok(r.error.message.indexOf('OTH-001') !== -1, 'the message names the culprit');
      ok(r.error.message.indexOf('Hammer') !== -1, 'and names it in words, not just an ID');
    });

    test('the refusal hands back the blockers so the UI can offer a way through', function () {
      var s = F.checkOut(F.state(), 'OTH-001');
      var r = Rules.planCheckout(s, { asset_ids: ['TAB-014'] });
      eq(r.blockers.length, 1);
      eq(r.blockers[0].asset_id, 'OTH-001');
    });

    test('allow_partial lets the rest of the set go out', function () {
      var s = F.checkOut(F.state(), 'OTH-001');
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'], allow_partial: true }));
      eq(ids(r.lines), ['OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016']);
      eq(r.warnings.length, 1);
      eq(r.warnings[0].reason, 'Out on its own — not included.');
    });

    test('allow_partial never quietly re-checks-out the item that is already gone', function () {
      var s = F.checkOut(F.state(), 'OTH-001');
      var r = expectOk(Rules.planCheckout(s, { asset_ids: ['TAB-014'], allow_partial: true }));
      notOk(ids(r.lines).indexOf('OTH-001') !== -1);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K5 — a child goes out alone only if its parent is free', function () {

    test('allowed while the parent sits available in the store', function () {
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['OTH-001'] }));
      eq(ids(r.lines), ['OTH-001']);
      eq(r.lines[0].via_parent_asset_id, '', 'scanned alone, so not via the parent');
    });

    test('the parent stays available — it is K3 that stops the set going out incomplete', function () {
      // planCheckout reports only what it would change; TAB-014 is untouched here.
      var r = expectOk(Rules.planCheckout(F.state(), { asset_ids: ['OTH-001'] }));
      notOk(ids(r.lines).indexOf('TAB-014') !== -1);
    });

    test('refused once the parent is checked out', function () {
      var s = F.state();
      F.checkOutWholeKit(s);
      F.setStatus(s, 'OTH-001', 'available');    // repaired and back on the shelf mid-trip
      var r = expectErr(Rules.planCheckout(s, { asset_ids: ['OTH-001'] }), 'PARENT_OUT');
      ok(r.error.message.indexOf('Tabla Set A') !== -1);
    });

    test('refused while the parent is in maintenance', function () {
      var s = F.setStatus(F.state(), 'TAB-014', 'maintenance');
      var r = expectErr(Rules.planCheckout(s, { asset_ids: ['OTH-001'] }), 'PARENT_OUT');
      ok(r.error.message.indexOf('in maintenance') !== -1);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K6 — checking in the parent brings back everything it took', function () {

    test('one scan closes all six movements', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-014' }] }));
      eq(ids(r.lines), F.KIT_ALL);
    });

    test('children default to "good" and become available again', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-014' }] }));
      r.lines.forEach(function (l) {
        eq(l.condition_in, 'good', l.asset_id);
        eq(l.outcome, 'returned', l.asset_id);
        eq(l.new_status, 'available', l.asset_id);
      });
    });

    test('each line names the movement it closes, so nothing is guessed at write time', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-014' }] }));
      r.lines.forEach(function (l) { ok(l.movement_id, l.asset_id + ' has no movement_id'); });
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K7 — a child out on its own is NOT swept up by the parent', function () {

    test('it keeps its own movement open', function () {
      var s = F.state();
      F.checkOut(s, 'OTH-001');                       // hammer out alone, earlier
      F.checkOut(s, 'TAB-014');                       // then the set goes out
      ['TAB-015', 'TAB-016', 'OTH-002', 'OTH-003'].forEach(function (id) {
        F.checkOut(s, id, { via: 'TAB-014' });
      });

      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-014' }] }));
      notOk(ids(r.lines).indexOf('OTH-001') !== -1, 'the hammer must not be marked returned');
      eq(ids(r.lines), ['OTH-002', 'OTH-003', 'TAB-014', 'TAB-015', 'TAB-016']);
    });

    test('and the screen is told about it rather than staying silent', function () {
      var s = F.state();
      F.checkOut(s, 'OTH-001');
      F.checkOut(s, 'TAB-014');
      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-014' }] }));
      eq(r.warnings.length, 1);
      eq(r.warnings[0].asset_id, 'OTH-001');
      eq(r.warnings[0].reason, 'Out separately — check it in on its own.');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K8 — flagging individual children missing or damaged', function () {

    test('the hammer never came back: missing → lost, with a note', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'OTH-001', missing: true }]
      }));

      var hammer = r.lines.filter(function (l) { return l.asset_id === 'OTH-001'; })[0];
      eq(hammer.outcome, 'missing');
      eq(hammer.new_status, 'lost');
      eq(hammer.condition_in, '', 'a missing item has no return condition');
      eq(hammer.damage_notes, 'Not returned');
    });

    test('the rest of the set still comes back normally alongside it', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'OTH-001', missing: true }]
      }));
      eq(ids(r.lines), F.KIT_ALL, 'all six movements close');
      r.lines.filter(function (l) { return l.asset_id !== 'OTH-001'; })
        .forEach(function (l) { eq(l.new_status, 'available', l.asset_id); });
    });

    test('a damaged child goes to maintenance, not back on the shelf', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [
          { asset_id: 'TAB-014' },
          { asset_id: 'TAB-016', condition_in: 'needs_repair', damage_notes: 'Skin split',
            photo_url: 'https://drive.google.com/thumbnail?id=demo' }
        ]
      }));
      var bayyu = r.lines.filter(function (l) { return l.asset_id === 'TAB-016'; })[0];
      eq(bayyu.outcome, 'damaged');
      eq(bayyu.new_status, 'maintenance');
      eq(bayyu.damage_notes, 'Skin split');
    });

    test('"fair" is a normal return, not damage', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'TAB-015', condition_in: 'fair' }]
      }));
      var dayyu = r.lines.filter(function (l) { return l.asset_id === 'TAB-015'; })[0];
      eq(dayyu.outcome, 'returned');
      eq(dayyu.new_status, 'available');
      eq(dayyu.new_condition, 'fair', 'the condition is still recorded');
    });

    test('a missing note supplied by the volunteer beats the default wording', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'OTH-001', missing: true, damage_notes: 'Left at Paris mandir' }]
      }));
      eq(r.lines[0].damage_notes, 'Left at Paris mandir');
    });

    test('the parent itself can be flagged damaged while its children are fine', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'TAB-014', condition_in: 'needs_repair',
                   damage_notes: 'Bag zip torn', photo_url: 'https://drive.google.com/thumbnail?id=demo' }]
      }));
      var parent = r.lines.filter(function (l) { return l.asset_id === 'TAB-014'; })[0];
      eq(parent.new_status, 'maintenance');
      r.lines.filter(function (l) { return l.asset_id !== 'TAB-014'; })
        .forEach(function (l) { eq(l.new_status, 'available', l.asset_id); });
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K9 — partial returns', function () {

    test('a child can come back on its own while the set is still out', function () {
      var s = F.checkOutWholeKit(F.state());
      var r = expectOk(Rules.planCheckin(s, { items: [{ asset_id: 'TAB-015' }] }));
      eq(ids(r.lines), ['TAB-015'], 'only the dayyu comes back');
    });

    test('checking in an item that is not out is refused clearly', function () {
      var r = expectErr(Rules.planCheckin(F.state(), { items: [{ asset_id: 'HAR-003' }] }),
                        'ITEM_NOT_OUT');
      ok(r.error.message.indexOf('not currently checked out') !== -1);
    });

    test('a child already back is tolerated when submitted with its parent', function () {
      // The check-in screen lists every child; one may have been returned early.
      // Re-submitting it is redundant, not an error the volunteer should see.
      var s = F.checkOutWholeKit(F.state());
      s.movements.forEach(function (m) {
        if (m.asset_id === 'TAB-015') m.checked_in_at = '2026-08-09T10:00:00+01:00';
      });
      F.setStatus(s, 'TAB-015', 'available');

      var r = expectOk(Rules.planCheckin(s, {
        items: [{ asset_id: 'TAB-014' }, { asset_id: 'TAB-015' }]
      }));
      notOk(ids(r.lines).indexOf('TAB-015') !== -1);
    });
  });

  /* ---------------------------------------------------------------- */
  suite('K10 — removing a kit', function () {

    test('removing the parent removes its children too', function () {
      var r = expectOk(Rules.planDeactivate(F.state(), 'TAB-014'));
      eq(r.asset_ids.sort(), F.KIT_ALL);
    });

    test('removing a child leaves the rest of the set alone', function () {
      var r = expectOk(Rules.planDeactivate(F.state(), 'OTH-001'));
      eq(r.asset_ids, ['OTH-001']);
    });

    test('nothing checked out can be removed', function () {
      var s = F.checkOut(F.state(), 'HAR-003');
      expectErr(Rules.planDeactivate(s, 'HAR-003'), 'ITEM_CHECKED_OUT');
    });

    test('a kit with even one piece out cannot be removed', function () {
      var s = F.checkOut(F.state(), 'OTH-001');
      var r = expectErr(Rules.planDeactivate(s, 'TAB-014'), 'ITEM_CHECKED_OUT');
      ok(r.error.message.indexOf('OTH-001') !== -1, 'the message says which piece');
    });

    test('removing something already removed says so instead of silently passing', function () {
      var s = F.state();
      s.items[6].active = false;
      expectErr(Rules.planDeactivate(s, 'HAR-003'), 'ITEM_INACTIVE');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Allocation follows the same kit rules', function () {

    test('allocating a kit allocates every piece', function () {
      var r = expectOk(Rules.planAllocate(F.state(), {
        asset_ids: ['TAB-014'], event_id: 'EV-003', centre: 'East London',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      }));
      eq(r.asset_ids.sort(), F.KIT_ALL);
    });

    test('an item promised elsewhere over the SAME dates is refused', function () {
      // Availability is a question about dates, not a yes/no flag — the full
      // window logic lives in availability.test.js.
      var s = F.state();
      s.today = '2026-08-08';
      s.allocations.push({
        allocation_id: 'AL-1', asset_id: 'HAR-003', event_id: 'EV-002',
        event_name: 'Bal Din', needed_from: '2026-08-12',
        expected_return_date: '2026-08-14', status: 'open'
      });
      var r = expectErr(Rules.planAllocate(s, {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'Ruislip',
        needed_from: '2026-08-13', expected_return_date: '2026-08-16',
        allocated_by: 'Nilesh'
      }), 'NOT_AVAILABLE');
      ok(r.error.message.indexOf('Bal Din') !== -1);
    });

    test('a cancelled allocation does not block a new one', function () {
      var s = F.state();
      s.allocations.push({
        allocation_id: 'AL-1', asset_id: 'HAR-003', event_id: 'EV-002',
        expected_return_date: '2026-08-14', status: 'cancelled'
      });
      expectOk(Rules.planAllocate(s, {
        asset_ids: ['HAR-003'], event_id: 'EV-003', centre: 'Ruislip',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      }));
    });

    test('the form insists on an event, a date and a name', function () {
      var base = {
        asset_ids: ['HAR-003'], event_id: 'EV-003',
        expected_return_date: '2026-08-16', allocated_by: 'Nilesh'
      };
      expectErr(Rules.planAllocate(F.state(), Object.assign({}, base, { event_id: '' })), 'BAD_REQUEST');
      expectErr(Rules.planAllocate(F.state(), Object.assign({}, base, { expected_return_date: '16/08/2026' })), 'BAD_REQUEST');
      expectErr(Rules.planAllocate(F.state(), Object.assign({}, base, { allocated_by: '' })), 'BAD_REQUEST');
    });
  });

  /* ---------------------------------------------------------------- */
  suite('Bad input is refused, never guessed at', function () {

    test('an unknown asset ID', function () {
      expectErr(Rules.planCheckout(F.state(), { asset_ids: ['TAB-999'] }), 'NOT_FOUND');
    });

    test('an empty scan queue', function () {
      expectErr(Rules.planCheckout(F.state(), { asset_ids: [] }), 'BAD_REQUEST');
    });

    test('an item removed from inventory', function () {
      var s = F.state();
      s.items[6].active = false;
      expectErr(Rules.planCheckout(s, { asset_ids: ['HAR-003'] }), 'ITEM_INACTIVE');
    });

    test('checking out something already out names where it is', function () {
      var s = F.checkOut(F.state(), 'HAR-003', { centre: 'Ruislip' });
      var r = expectErr(Rules.planCheckout(s, { asset_ids: ['HAR-003'] }), 'ITEM_CHECKED_OUT');
      ok(r.error.message.indexOf('Ruislip') !== -1, 'so the volunteer knows where to look');
    });
  });
};
