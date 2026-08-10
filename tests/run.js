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

/*
 * Test modules may be async — the screen tests have to let a promise resolve
 * before they can render anything, and a synchronous spin loop can never do
 * that. So every module is awaited, whether it needs it or not.
 */
async function main() {

// Unit tests: the pure rules, loaded straight from source.
await require('./kit.test.js')();
await require('./overdue.test.js')();

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

await require('./availability.test.js')();

await require('./integration.test.js')();
await require('./events.test.js')();
await require('./demo.test.js')();
await require('./fixes.test.js')();
await require('./screens.test.js')();

// The label printer. Verified by reading the finished QR matrix back out.
await require('./qr.test.js')();

await H.run();

process.exit(H.summary() === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('\nThe test run itself failed:\n', e);
  process.exit(1);
});
