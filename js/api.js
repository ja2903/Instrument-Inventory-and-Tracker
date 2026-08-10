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
  var accessCode = '';

  try {
    accessCode = window.localStorage.getItem(STORAGE_KEY) || '';
  } catch (e) {
    // Private browsing with storage blocked: the code just has to be
    // re-entered each session rather than the app refusing to start.
    accessCode = '';
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
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
      throw new ApiError('NOT_CONFIGURED',
        'This app has not been connected to a Google Sheet yet. ' +
        'Open config.js and paste in the Apps Script web app URL — see README.md.');
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
      if (text.indexOf('<!DOCTYPE') !== -1 || text.indexOf('<html') !== -1) {
        throw new ApiError('BAD_DEPLOYMENT',
          'The app URL in config.js is not answering correctly. Check that the Apps Script ' +
          'deployment is set to "Execute as: Me" and "Who has access: Anyone", and that the ' +
          'URL ends in /exec.');
      }
      throw new ApiError('SERVER_ERROR', 'The server sent something unreadable. Try again.');
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

    var response;
    try {
      response = await fetch(CONFIG.API_URL + '?' + query.toString(), {
        method: 'GET',
        redirect: 'follow'    // Apps Script always redirects to googleusercontent.com
      });
    } catch (e) {
      throw unreachable();
    }
    return unwrap(await parseResponse(response));
  }

  async function post(action, payload) {
    assertConfigured();

    var response;
    try {
      response = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // text/plain keeps this a CORS "simple request" — see the note above.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          action: action,
          code: accessCode,
          payload: payload || {}
        })
      });
    } catch (e) {
      throw unreachable(' Nothing has been saved.');
    }
    return unwrap(await parseResponse(response));
  }

  return {
    ApiError: ApiError,
    getCode: getCode,
    setCode: setCode,
    clearCode: clearCode,

    ping: function () { return get('ping'); },
    bootstrap: function () { return get('bootstrap'); },
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
    saveSettings: function (payload) { return post('saveSettings', payload); }
  };
})();
