#!/usr/bin/env node
/**
 * Bumps the cache-busting version stamp.
 *
 *     node tools/bump-version.js            # 1.3.3 -> 1.3.4
 *     node tools/bump-version.js 1.4.0      # set it explicitly
 *
 * Why this exists: index.html carries `?v=x.y.z` on every script and
 * stylesheet, and phones cache those files hard. Forget to change the stamp
 * and half the karyakars keep running last week's app and report bugs that
 * were fixed days ago. Nine identical edits by hand is exactly the job that
 * gets done eight times.
 *
 * It also keeps APP_VERSION in the Apps Script config in step, so the version
 * the server reports matches the files the browser is running.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var INDEX = path.join(ROOT, 'index.html');
var CONFIG = path.join(ROOT, 'apps-script', 'src', '00-config.js');

function read(file) { return fs.readFileSync(file, 'utf8'); }

var indexHtml = read(INDEX);
var current = (indexHtml.match(/\?v=(\d+\.\d+\.\d+)/) || [])[1];
if (!current) {
  console.error('Could not find a ?v=x.y.z stamp in index.html.');
  process.exit(1);
}

var next = process.argv[2];
if (!next) {
  var parts = current.split('.').map(Number);
  parts[2] += 1;                       // patch bump by default
  next = parts.join('.');
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Version must look like 1.4.0 — got "' + next + '".');
  process.exit(1);
}
if (next === current) {
  console.error('That is already the current version (' + current + ').');
  process.exit(1);
}

var stamps = (indexHtml.match(/\?v=\d+\.\d+\.\d+/g) || []).length;
fs.writeFileSync(INDEX, indexHtml.split('?v=' + current).join('?v=' + next), 'utf8');

// Keep the server's reported version aligned with the files being served.
var config = read(CONFIG);
var configVersion = (config.match(/var APP_VERSION = '([^']+)'/) || [])[1];
if (configVersion) {
  fs.writeFileSync(CONFIG,
    config.replace(/var APP_VERSION = '[^']+'/, "var APP_VERSION = '" + next + "'"), 'utf8');
}

console.log('Version ' + current + ' -> ' + next);
console.log('  index.html               ' + stamps + ' stamps updated');
if (configVersion) console.log('  apps-script APP_VERSION  updated');
console.log('\nNext: node tools/build-gs.js && node tests/run.js');
