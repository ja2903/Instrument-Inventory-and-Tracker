/**
 * Dependency-free test harness. No npm install, no config, no framework.
 * Run everything with:   node tests/run.js
 */

var results = { passed: 0, failed: 0, failures: [] };
var currentSuite = '';

var suites = [];
var currentTests = null;

function suite(name, fn) {
  currentSuite = name;
  currentTests = [];
  suites.push({ name: name, tests: currentTests });
  fn();                       // registration only — nothing runs yet
  currentTests = null;
  currentSuite = '';
}

function test(name, fn) {
  if (!currentTests) throw new Error('test("' + name + '") called outside a suite');
  currentTests.push({ name: name, fn: fn, suite: currentSuite });
}

/**
 * Runs everything that was registered, in order, awaiting each test.
 *
 * Tests are collected first and executed here for one reason: a test function
 * may be async. Executing them as they were registered meant an async
 * failure surfaced as an unhandled rejection long after the run had already
 * printed "all passed" — a suite that cannot fail is worse than no suite.
 */
async function run() {
  for (var s = 0; s < suites.length; s++) {
    console.log('\n\x1b[1m' + suites[s].name + '\x1b[0m');
    var tests = suites[s].tests;
    for (var i = 0; i < tests.length; i++) {
      var entry = tests[i];
      try {
        await entry.fn();
        results.passed++;
        console.log('  \x1b[32m✓\x1b[0m ' + entry.name);
      } catch (e) {
        results.failed++;
        results.failures.push({ suite: entry.suite, name: entry.name, error: e });
        console.log('  \x1b[31m✗ ' + entry.name + '\x1b[0m');
        console.log('      ' + String(e && e.message ? e.message : e)
          .split('\n').join('\n      '));
      }
    }
  }
}

function fail(msg) {
  throw new Error(msg);
}

function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) {
    fail((msg ? msg + '\n' : '') + 'expected: ' + b + '\n  actual: ' + a);
  }
}

function ok(value, msg) {
  if (!value) fail(msg || 'expected truthy, got ' + JSON.stringify(value));
}

function notOk(value, msg) {
  if (value) fail(msg || 'expected falsy, got ' + JSON.stringify(value));
}

/** Asserts a Rules.plan* call succeeded, and returns it. Prints the error if not. */
function expectOk(result, msg) {
  if (!result.ok) {
    fail((msg ? msg + '\n' : '') + 'expected success, got ' +
      result.error.code + ': ' + result.error.message);
  }
  return result;
}

/** Asserts a Rules.plan* call failed with a specific error code. */
function expectErr(result, code, msg) {
  if (result.ok) {
    fail((msg ? msg + '\n' : '') + 'expected error ' + code + ', but the call succeeded');
  }
  if (result.error.code !== code) {
    fail((msg ? msg + '\n' : '') + 'expected error ' + code +
      ', got ' + result.error.code + ': ' + result.error.message);
  }
  return result;
}

/** Sorted asset ids from a plan result — order of expansion is not part of the contract. */
function ids(lines) {
  return lines.map(function (l) { return l.asset_id || l; }).sort();
}

function summary() {
  var total = results.passed + results.failed;
  console.log('\n' + '─'.repeat(56));
  if (results.failed === 0) {
    console.log('\x1b[32m\x1b[1m' + total + ' passed\x1b[0m');
  } else {
    console.log('\x1b[31m\x1b[1m' + results.failed + ' failed\x1b[0m, ' +
                results.passed + ' passed, ' + total + ' total');
  }
  return results.failed;
}

module.exports = {
  suite: suite, test: test, run: run, eq: eq, ok: ok, notOk: notOk, fail: fail,
  expectOk: expectOk, expectErr: expectErr, ids: ids, summary: summary
};
