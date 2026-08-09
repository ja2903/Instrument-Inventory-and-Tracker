#!/usr/bin/env node
/**
 * Instrument Tracker test suite.
 *
 *     node tests/run.js
 *
 * No npm install, no dependencies, no config. It loads the pure rules module
 * straight from apps-script/src/10-rules.js — the same file that runs in
 * production — and exercises the two things most likely to be got wrong:
 * the kit cascade and the overdue calculation.
 */

var H = require('./harness.js');
var execFileSync = require('child_process').execFileSync;
var path = require('path');

console.log('\n\x1b[1mInstrument Tracker\x1b[0m');

// Unit tests: the pure rules, loaded straight from source.
require('./kit.test.js')();
require('./overdue.test.js')();

// Integration tests: the generated Code.gs, running in a fake Apps Script
// runtime. These are the only way to check the wiring without a Google account,
// so the bundle has to be current before they mean anything.
H.suite('Build', function () {
  H.test('apps-script/Code.gs is up to date with apps-script/src/', function () {
    try {
      execFileSync(process.execPath,
        [path.join(__dirname, '..', 'tools', 'build-gs.js'), '--check'],
        { stdio: 'pipe' });
    } catch (e) {
      H.fail('Code.gs is stale. Run: node tools/build-gs.js');
    }
  });
});

require('./availability.test.js')();

require('./integration.test.js')();
require('./events.test.js')();
require('./demo.test.js')();
require('./fixes.test.js')();

// The label printer. Verified by reading the finished QR matrix back out.
require('./qr.test.js')();

process.exit(H.summary() === 0 ? 0 : 1);
