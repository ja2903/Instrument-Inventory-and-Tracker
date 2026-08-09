/**
 * Instrument Tracker — errors, responses and the shared access code.
 */

/**
 * An error with a code the client can branch on and a message a volunteer can read.
 * Anything thrown that is NOT an ApiError is a bug: it gets logged in full and
 * reported to the user as a generic failure, so a stack trace never lands on screen.
 */
function ApiError(code, message) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);

function fail(code, message) { throw new ApiError(code, message); }

/**
 * Every response is HTTP 200 with the real status inside the body.
 * ContentService cannot set status codes, so there is no alternative —
 * and it keeps the client's error handling in exactly one place.
 */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function okResponse(data) {
  return jsonOut({ ok: true, data: data, server_time: nowISO() });
}

function errResponse(code, message) {
  return jsonOut({ ok: false, error: { code: code, message: message } });
}

/* ---------------- access code ----------------------------------- */

function getAccessCode() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty(PROP_ACCESS_CODE);
  if (!code) {
    // First run before setupSheet() — fall back to the default rather than
    // locking everyone out of a freshly deployed script.
    code = DEFAULT_ACCESS_CODE;
    props.setProperty(PROP_ACCESS_CODE, code);
  }
  return code;
}

function setAccessCode(code) {
  PropertiesService.getScriptProperties().setProperty(PROP_ACCESS_CODE, code);
}

/**
 * Constant-time string comparison.
 *
 * A plain `a === b` returns as soon as it finds a differing character, and the
 * timing difference is measurable over a network. This compares every character
 * either way. Modest, but it costs nothing.
 */
function safeEquals(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Called at the top of every request, read and write alike. */
function requireAccess(code) {
  if (!safeEquals(code, getAccessCode())) {
    fail('BAD_CODE', 'That access code is not right. Ask another karyakar for the current one.');
  }
}

/* ---------------- small shared helpers -------------------------- */

function asBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v).trim().toUpperCase() === 'TRUE';
}

function requireField(payload, field, label) {
  var v = payload[field];
  if (v === undefined || v === null || String(v).trim() === '') {
    fail('BAD_REQUEST', 'Please fill in ' + (label || field.replace(/_/g, ' ')) + '.');
  }
  return String(v).trim();
}

/** Strips the internal _row bookkeeping before anything is sent to the browser. */
function publicCopy(obj) {
  var out = {};
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && k !== '_row') out[k] = obj[k];
  }
  return out;
}
