/**
 * Instrument Tracker — talking to the Apps Script backend.
 *
 * ===================================================================
 *  THE CORS RULE — do not "fix" the fetch below into something that
 *  looks more correct.
 *
 *  Apps Script web apps do not answer CORS preflight (OPTIONS)
 *  requests. The browser sends a preflight for any POST whose
 *  Content-Type is application/json, or that carries a custom header.
 *  That preflight gets no valid answer, so the POST fails before it is
 *  ever sent — a CORS error in the console and NOTHING in the Apps
 *  Script logs, which is a genuinely confusing way to lose an hour.
 *
 *  So writes go out as text/plain;charset=utf-8, which the browser
 *  treats as a "simple request" and never preflights. The body is
 *  still JSON — it is just not labelled as JSON, and doPost parses it
 *  by hand.
 *
 *  For the same reason the access code goes in the JSON body, never in
 *  an Authorization or X-Access-Code header: a custom header would
 *  trigger a preflight too.
 *
 *  The matching comment is in apps-script/src/50-entry.js.
 *  If you change one, change both.
 * ===================================================================
 */

var Api = (function () {
  'use strict';

  var STORAGE_KEY = 'instrument_tracker_access_code';
  var URL_KEY = 'instrument_tracker_api_url';
  var accessCode = '';
  var storedUrl = '';

  try {
    accessCode = window.localStorage.getItem(STORAGE_KEY) || '';
    storedUrl = window.localStorage.getItem(URL_KEY) || '';
  } catch (e) {
    // Private browsing with storage blocked: the code just has to be
    // re-entered each session rather than the app refusing to start.
    accessCode = '';
    storedUrl = '';
  }

  /**
   * Which Sheet this app talks to.
   *
   * config.js is the normal answer, but it is also the one file a person edits
   * by hand and the one file a full re-upload silently overwrites with the
   * placeholder — which strands everybody with "not connected" and no way back
   * except GitHub. So a URL entered in the app itself wins, and is remembered
   * on the device. That makes the failure recoverable from the phone that hit
   * it, which is where the person actually is.
   */
  function apiUrl() {
    if (storedUrl) return storedUrl;
    return (typeof CONFIG !== 'undefined' && CONFIG.API_URL) || '';
  }

  function isPlaceholder(url) {
    return !url || url.indexOf('PASTE_YOUR') === 0;
  }

  /** Accepts the /exec URL, rejecting the mistakes people actually make. */
  function setApiUrl(url) {
    var clean = String(url || '').trim();

    if (!clean) throw new ApiError('BAD_REQUEST', 'Paste the web app URL first.');
    if (clean.indexOf('script.google.com') === -1) {
      throw new ApiError('BAD_REQUEST',
        'That does not look like an Apps Script address. It should start ' +
        'https://script.google.com/macros/s/…');
    }
    if (/\/dev\/?$/.test(clean)) {
      throw new ApiError('BAD_REQUEST',
        'That is the /dev address, which only works for you while signed in. ' +
        'Use the one ending in /exec from Deploy → Manage deployments.');
    }
    if (!/\/exec\/?$/.test(clean)) {
      throw new ApiError('BAD_REQUEST', 'The address needs to end in /exec.');
    }

    storedUrl = clean.replace(/\/$/, '');
    try { window.localStorage.setItem(URL_KEY, storedUrl); } catch (e) {}
    return storedUrl;
  }

  function clearApiUrl() {
    storedUrl = '';
    try { window.localStorage.removeItem(URL_KEY); } catch (e) {}
  }

  function ApiError(code, message, extra) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
    if (extra) Object.assign(this, extra);
  }
  ApiError.prototype = Object.create(Error.prototype);

  function getCode() { return accessCode; }

  function setCode(code) {
    accessCode = code || '';
    try { window.localStorage.setItem(STORAGE_KEY, accessCode); } catch (e) {}
  }

  function clearCode() {
    accessCode = '';
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function assertConfigured() {
    if (isPlaceholder(apiUrl())) {
      throw new ApiError('NOT_CONFIGURED',
        'This app is not connected to a Google Sheet. Paste the Apps Script web app ' +
        'address below and it will remember it on this device.');
    }
  }

  /** Unwraps the {ok, data, error} envelope every endpoint returns. */
  function unwrap(json) {
    if (json && json.ok) return json.data;
    var error = (json && json.error) || {};
    throw new ApiError(error.code || 'SERVER_ERROR',
                       error.message || 'Something went wrong.',
                       { blockers: error.blockers, conflicts: error.conflicts,
                         photo_required: error.photo_required });
  }

  /**
   * Apps Script sometimes answers a request with its own HTML error page
   * (a bad deployment, or a script that failed to load). Turning that into
   * a readable sentence saves a lot of confusion.
   */
  async function parseResponse(response) {
    var text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      if (text.indexOf('<!DOCTYPE') === -1 && text.indexOf('<html') === -1) {
        throw new ApiError('SERVER_ERROR', 'The server sent something unreadable. Try again.');
      }

      /*
       * Apps Script answers with HTML in two completely different situations,
       * and telling a volunteer to go and check the deployment settings is only
       * right in one of them.
       *
       *  - A genuinely misconfigured deployment bounces you to a Google sign-in
       *    or "you need permission" page. Those pages say so.
       *  - A working deployment ALSO returns HTML when Google is having a
       *    moment: the script timed out, hit a quota, or the servers are busy.
       *    That is transient and there is nothing to fix.
       *
       * Sending everyone to re-check settings that were never wrong wasted a
       * lot of people's time, so the two are now separated.
       */
      var signIn = /accounts\.google\.com|ServiceLogin|signin|Sign in|need permission|Request access/i
        .test(text);

      if (signIn) {
        throw new ApiError('BAD_DEPLOYMENT',
          'The Apps Script deployment is refusing anonymous visitors. In the Apps Script ' +
          'editor go to Deploy → Manage deployments, and set "Who has access" to Anyone ' +
          'and "Execute as" to Me.');
      }

      throw new ApiError('TRANSIENT',
        'Google did not answer that time. This is usually a busy moment at their end ' +
        'rather than anything wrong with the app.');
    }
  }

  /**
   * Reads are safe to repeat, so a transient failure gets retried rather than
   * shown. Writes deliberately are NOT retried: a checkout that did reach the
   * Sheet before the connection dropped would be recorded twice, and a
   * duplicate loan is worse than an error message.
   */
  async function withRetry(attempt) {
    var delays = [400, 1200];          // ~1.6s of patience, then give up
    for (var i = 0; ; i++) {
      try {
        return await attempt();
      } catch (e) {
        var worthRetrying = e.code === 'TRANSIENT' || e.code === 'OFFLINE';
        if (!worthRetrying || i >= delays.length) throw e;
        await new Promise(function (r) { setTimeout(r, delays[i]); });
      }
    }
  }

  /**
   * `fetch` only throws for network-level failures, and on this setup a genuine
   * loss of connection is the LEAST likely of them — the page itself has
   * already loaded from the internet. Far more often the request was blocked
   * because the Apps Script deployment refuses anonymous callers, which bounces
   * it to a Google login page and trips CORS.
   *
   * "Check your internet connection" sent people looking in exactly the wrong
   * place, so the message names the likely cause instead. `navigator.onLine`
   * separates the two cases when it can.
   */
  function unreachable(suffix) {
    if (navigator.onLine === false) {
      return new ApiError('OFFLINE',
        'You appear to be offline. Reconnect and try again.' + (suffix || ''));
    }
    return new ApiError('OFFLINE',
      'Could not reach the Google Sheet. This is usually the Apps Script deployment ' +
      'refusing anonymous visitors: in the Apps Script editor go to Deploy → Manage ' +
      'deployments, and set "Who has access" to Anyone. Also check the URL in config.js ' +
      'ends in /exec.' + (suffix || ''));
  }

  async function get(action, params) {
    assertConfigured();
    var query = new URLSearchParams(Object.assign(
      { action: action, code: accessCode }, params || {}
    ));

    return withRetry(async function () {
      var response;
      try {
        response = await fetch(apiUrl() + '?' + query.toString(), {
          method: 'GET',
          redirect: 'follow'    // Apps Script always redirects to googleusercontent.com
        });
      } catch (e) {
        throw unreachable();
      }
      return unwrap(await parseResponse(response));
    });
  }

  /*
   * A write answers with the updated dataset attached, so the app does not have
   * to turn round and ask for it. Stashed here and picked up by App.loadData(),
   * which keeps every calling screen exactly as it was — they still just say
   * "refresh", it simply no longer costs a round trip.
   */
  var freshBootstrap = null;

  function takeFreshBootstrap() {
    var payload = freshBootstrap;
    freshBootstrap = null;
    return payload;
  }

  // Actions where the app redraws afterwards. suggestAssetId and
  // checkAvailability deliberately are not here: they change nothing, and
  // dragging the whole dataset back on each keystroke would be worse than the
  // problem being solved.
  var REDRAWS_AFTER = {
    checkout: true, checkin: true, allocate: true, cancelAllocation: true,
    updateAllocation: true, saveItem: true, removeItem: true, saveEvent: true,
    deleteEvent: true, bulkCheckinEvent: true, setMovementPhoto: true,
    deletePhoto: true, saveSettings: true, archiveMovements: true
  };

  async function post(action, payload) {
    assertConfigured();

    var response;
    try {
      response = await fetch(apiUrl(), {
        method: 'POST',
        // text/plain keeps this a CORS "simple request" — see the note above.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          action: action,
          code: accessCode,
          payload: payload || {},
          want_bootstrap: !!REDRAWS_AFTER[action]
        })
      });
    } catch (e) {
      throw unreachable(' Nothing has been saved.');
    }

    // No retry here on purpose — see withRetry. A repeated write could record
    // the same loan twice.
    try {
      var data = unwrap(await parseResponse(response));
      if (data && data.bootstrap) {
        freshBootstrap = data.bootstrap;
        delete data.bootstrap;      // callers should never have to know
      }
      return data;
    } catch (e) {
      if (e.code === 'TRANSIENT') {
        throw new ApiError('TRANSIENT',
          'Google did not answer that time, so this may or may not have saved. ' +
          'Press Refresh and check before trying again.');
      }
      throw e;
    }
  }

  return {
    ApiError: ApiError,
    getCode: getCode,
    setCode: setCode,
    clearCode: clearCode,

    takeFreshBootstrap: takeFreshBootstrap,

    apiUrl: apiUrl,
    setApiUrl: setApiUrl,
    clearApiUrl: clearApiUrl,
    usingStoredUrl: function () { return !!storedUrl; },

    ping: function () { return get('ping'); },
    // `fresh` is what the Refresh button sends: skip the server's cache and
    // read the Sheet, so a hand-edit shows up the moment somebody asks for it.
    bootstrap: function (opts) {
      return get('bootstrap', opts && opts.fresh ? { fresh: '1' } : {});
    },
    item: function (assetId) { return get('item', { asset_id: assetId }); },
    resolve: function (q) { return get('resolve', { q: q }); },
    event: function (eventId) { return get('event', { event_id: eventId }); },

    checkout: function (payload) { return post('checkout', payload); },
    checkin: function (payload) { return post('checkin', payload); },
    allocate: function (payload) { return post('allocate', payload); },
    cancelAllocation: function (payload) { return post('cancelAllocation', payload); },
    updateAllocation: function (payload) { return post('updateAllocation', payload); },
    checkAvailability: function (payload) { return post('checkAvailability', payload); },
    saveItem: function (payload) { return post('saveItem', payload); },
    removeItem: function (assetId) { return post('removeItem', { asset_id: assetId, confirm: true }); },
    suggestAssetId: function (type) { return post('suggestAssetId', { instrument_type: type }); },
    saveEvent: function (payload) { return post('saveEvent', payload); },
    deleteEvent: function (payload) { return post('deleteEvent', payload); },
    bulkCheckinEvent: function (payload) { return post('bulkCheckinEvent', payload); },
    uploadPhoto: function (payload) { return post('uploadPhoto', payload); },
    setMovementPhoto: function (payload) { return post('setMovementPhoto', payload); },
    deletePhoto: function (payload) { return post('deletePhoto', payload); },
    archiveMovements: function (payload) { return post('archiveMovements', payload); },
    saveSettings: function (payload) { return post('saveSettings', payload); }
  };
})();
