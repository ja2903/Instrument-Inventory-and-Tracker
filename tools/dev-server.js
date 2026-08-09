#!/usr/bin/env node
/**
 * Local development server.
 *
 *     node tools/dev-server.js        →  http://localhost:8787
 *
 * Serves the static frontend AND stands in for the Apps Script backend, using
 * the same fake runtime the tests use (tests/gas-mock.js). That means the whole
 * app can be clicked through — scanning, kit check-out, labels — without a
 * Google account, and against the exact Code.gs that gets pasted into Apps
 * Script.
 *
 * Data lives in memory and resets when the server restarts. This is a
 * development tool; it is not used in production and GitHub Pages never sees it.
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var GAS = require('../tests/gas-mock.js');

var ROOT = path.join(__dirname, '..');
var PORT = Number(process.env.PORT || 8787);

var app = GAS.loadApp();
app.sandbox.setupSheet();
if (process.argv.indexOf("--demo") !== -1) app.sandbox.seedDemoData();

var ACCESS_CODE = app.properties.ACCESS_CODE;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    // Apps Script sets this too; without it the local page cannot call /api.
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, 'http://localhost:' + PORT);

  /* ---- the stand-in Apps Script web app ---- */
  if (url.pathname === '/api') {
    if (req.method === 'GET') {
      var params = {};
      url.searchParams.forEach(function (v, k) { params[k] = v; });
      var out = app.sandbox.doGet({ parameter: params });
      return send(res, 200, out._text, MIME['.json']);
    }
    if (req.method === 'POST') {
      var body = '';
      req.on('data', function (chunk) { body += chunk; });
      req.on('end', function () {
        var out = app.sandbox.doPost({ postData: { contents: body } });
        send(res, 200, out._text, MIME['.json']);
      });
      return;
    }
    return send(res, 405, 'Method not allowed');
  }

  /* ---- config.js, rewritten to point at this server ---- */
  if (url.pathname === '/config.js') {
    var config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8')
      .replace('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',
               'http://localhost:' + PORT + '/api');
    return send(res, 200, config, MIME['.js']);
  }

  /* ---- static files ---- */
  var rel = url.pathname === '/' ? '/index.html' : url.pathname;
  var file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, 'Not found: ' + rel);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(PORT, function () {
  console.log('\n  Instrument Tracker — development server');
  console.log('  ──────────────────────────────────────');
  console.log('  http://localhost:' + PORT);
  console.log('  access code: ' + ACCESS_CODE);
  console.log('  data is in memory only and resets on restart');
  console.log('  pass --demo for a full store: 60+ instruments, loans, bookings\n');
});
