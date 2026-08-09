#!/usr/bin/env node
/**
 * Concatenates apps-script/src/*.js into a single apps-script/Code.gs.
 *
 * Why: the source is split so that 10-rules.js can be pure and testable in
 * Node, but a volunteer setting this up should paste ONE file into the Apps
 * Script editor, not six. The generated file is committed, so nobody setting
 * the app up ever has to run this.
 *
 *     node tools/build-gs.js          # rebuild
 *     node tools/build-gs.js --check  # fail if Code.gs is stale (used by the tests)
 *
 * Apps Script puts every .gs file in one global scope, so concatenation
 * changes nothing about how the code behaves.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'apps-script', 'src');
var OUT = path.join(ROOT, 'apps-script', 'Code.gs');

/*
 * The rules module runs in three places: the Apps Script bundle, the Node test
 * runner, and the browser. The browser used to load it straight out of
 * apps-script/src/ — which worked, but meant index.html depended on a folder
 * that looks like backend-only code. Anyone uploading "just the website" left
 * it behind, and the app rendered a completely blank page.
 *
 * So the build drops a copy at js/rules.js, alongside the other frontend
 * files, and a test fails if the two ever drift apart.
 */
var RULES_SRC = path.join(SRC, '10-rules.js');
var RULES_COPY = path.join(ROOT, 'js', 'rules.js');

function rulesCopy() {
  return [
    '/*',
    ' * GENERATED — do not edit.',
    ' *',
    ' * A copy of apps-script/src/10-rules.js so the browser can load the exact',
    ' * same availability and kit logic the server enforces, without index.html',
    ' * having to reach into the apps-script folder.',
    ' *',
    ' * Edit apps-script/src/10-rules.js and run: node tools/build-gs.js',
    ' */',
    '',
    fs.readFileSync(RULES_SRC, 'utf8')
  ].join('\n');
}

function build() {
  var files = fs.readdirSync(SRC).filter(function (f) { return /\.js$/.test(f); }).sort();

  var banner = [
    '/**',
    ' * ===================================================================',
    ' *  Instrument Tracker — BAPS Shri Swaminarayan Mandir, London',
    ' *',
    ' *  GENERATED FILE. Do not edit this in the Apps Script editor and',
    ' *  expect the change to survive — edit apps-script/src/*.js in the',
    ' *  repository and run `node tools/build-gs.js`.',
    ' *',
    ' *  Built from: ' + files.join(', '),
    ' * ===================================================================',
    ' */',
    ''
  ].join('\n');

  var parts = files.map(function (f) {
    var body = fs.readFileSync(path.join(SRC, f), 'utf8');

    // The Node export footer in 10-rules.js is inert inside Apps Script
    // (`module` is undefined there), but stripping it keeps the pasted file
    // free of anything that looks like it belongs to another runtime.
    body = body.replace(
      /\n\/\/ Loadable by the Node test runner[\s\S]*?module\.exports = Rules;\n?$/,
      '\n'
    );

    return [
      '/* ================================================================',
      ' * ' + f,
      ' * ================================================================ */',
      '',
      body.trim(),
      ''
    ].join('\n');
  });

  return banner + '\n' + parts.join('\n') + '\n';
}

var generated = build();

var browserRules = rulesCopy();

if (process.argv.indexOf('--check') !== -1) {
  var current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== generated) {
    console.error('\x1b[31mapps-script/Code.gs is out of date.\x1b[0m Run: node tools/build-gs.js');
    process.exit(1);
  }
  var currentRules = fs.existsSync(RULES_COPY) ? fs.readFileSync(RULES_COPY, 'utf8') : '';
  if (currentRules !== browserRules) {
    console.error('\x1b[31mjs/rules.js is out of date.\x1b[0m Run: node tools/build-gs.js');
    process.exit(1);
  }
  console.log('apps-script/Code.gs and js/rules.js are up to date.');
  process.exit(0);
}

fs.writeFileSync(OUT, generated, 'utf8');
fs.writeFileSync(RULES_COPY, browserRules, 'utf8');
console.log('Wrote ' + path.relative(ROOT, OUT) + ' (' +
            Math.round(generated.length / 1024) + ' KB)');
console.log('Wrote ' + path.relative(ROOT, RULES_COPY) + ' (' +
            Math.round(browserRules.length / 1024) + ' KB)');
