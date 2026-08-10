/**
 * A deliberately small DOM, enough to load the browser code in Node.
 *
 * Not a browser and not trying to be. The point is to let every screen be
 * *rendered* — the phase that turns App.data into an HTML string — so that a
 * typo, a renamed helper, or a function deleted in a refactor fails a test
 * instead of reaching a volunteer as a blank page.
 *
 * Anything that needs real layout, real events or a real camera is out of
 * scope here and stays a manual check.
 */

var vm = require('vm');
var fs = require('fs');
var path = require('path');

function makeElement(id) {
  var el = {
    id: id || '',
    tagName: 'DIV',
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    open: false,
    disabled: false,
    dataset: {},
    style: {},
    children: [],
    classList: {
      _set: {},
      add: function () {
        for (var i = 0; i < arguments.length; i++) this._set[arguments[i]] = true;
      },
      remove: function () {
        for (var i = 0; i < arguments.length; i++) delete this._set[arguments[i]];
      },
      contains: function (c) { return !!this._set[c]; },
      toggle: function (c, force) {
        var on = force === undefined ? !this._set[c] : force;
        if (on) this._set[c] = true; else delete this._set[c];
        return on;
      }
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true; },
    appendChild: function (child) { this.children.push(child); return child; },
    setAttribute: function () {},
    removeAttribute: function () {},
    getAttribute: function () { return null; },
    focus: function () {},
    blur: function () {},
    select: function () {},
    setSelectionRange: function () {},
    scrollIntoView: function () {},
    click: function () {},
    closest: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    insertAdjacentHTML: function () {}
  };
  return el;
}

function makeDocument() {
  var byId = {};
  return {
    _byId: byId,
    documentElement: makeElement('html'),
    body: makeElement('body'),
    head: makeElement('head'),
    styleSheets: [],
    activeElement: null,
    getElementById: function (id) {
      if (!byId[id]) byId[id] = makeElement(id);
      return byId[id];
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) {
      var el = makeElement('');
      el.tagName = String(tag).toUpperCase();
      return el;
    },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
}

/**
 * Loads the browser files in order and returns the sandbox.
 * `bootstrap` is the payload Api.bootstrap should resolve with.
 */
function loadBrowserApp(bootstrap) {
  var ROOT = path.join(__dirname, '..');
  var store = {};

  var sandbox = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    JSON: JSON, Math: Math, Date: Date, String: String, Number: Number,
    Boolean: Boolean, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    Set: Set, Map: Map, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout,
    URLSearchParams: URLSearchParams, Buffer: Buffer,

    document: makeDocument(),
    navigator: { onLine: true, vibrate: function () {} },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    location: { hash: '#/', reload: function () {} },
    fetch: function () { return Promise.reject(new Error('no network in tests')); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = function () {};
  sandbox.addEventListener = function () {};

  vm.createContext(sandbox);

  // Same order as index.html — app.js must come before the screen files.
  ['config.js', 'js/rules.js', 'js/qr.js', 'js/ui.js', 'js/api.js',
   'js/app.js', 'js/inventory.js', 'js/operations.js'].forEach(function (file) {
    var code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    new vm.Script(code, { filename: file }).runInContext(sandbox);
  });

  /*
   * mount() does live DOM work this stub deliberately does not model, so it is
   * neutralised for the sweep — with ONE exception.
   *
   * The event page renders a spinner until its mount fetches the detail, and
   * only then draws the part that actually uses helpers. Neutralising that
   * mount meant the sweep never rendered the real body, and a missing helper
   * there sailed straight through a green test run. So the event mount is
   * kept, and the test stubs Api.event to feed it.
   */
  sandbox.__realEventMount = sandbox.App.screens.event.mount;
  sandbox.__realItemMount = sandbox.App.screens.item.mount;   // same trap, same fix
  Object.keys(sandbox.App.screens).forEach(function (name) {
    if (typeof sandbox.App.screens[name].mount === 'function') {
      sandbox.App.screens[name].mount = function () {};
    }
  });

  sandbox.Api.bootstrap = function () { return Promise.resolve(bootstrap); };
  sandbox.Api.getCode = function () { return 'test-code'; };

  return sandbox;
}

module.exports = { loadBrowserApp: loadBrowserApp, makeElement: makeElement };
