/**
 * Instrument Tracker — Sheet access layer.
 *
 * Everything that touches SpreadsheetApp lives here. Columns are resolved by
 * HEADER TEXT, never by position, so reordering columns in the Sheet is safe.
 *
 * Reads happen once per request and are cached; writes are buffered and
 * flushed a row at a time, so a six-piece kit check-out is a handful of
 * Sheets calls rather than sixty.
 */

/* ---------------- value coercion -------------------------------- */

var BOOL_FIELDS = { active: 1, is_kit: 1 };
var NUM_FIELDS = { rank: 1 };
var DATE_FIELDS = { start_date: 1, end_date: 1, expected_return_date: 1, needed_from: 1 };
var TS_FIELDS = { allocated_at: 1, checked_out_at: 1, checked_in_at: 1 };

/** A Sheets cell can come back as a Date even when a human typed text. Normalise. */
function cellToValue(field, raw) {
  if (raw === null || raw === undefined) return BOOL_FIELDS[field] ? false : '';

  if (BOOL_FIELDS[field]) {
    if (typeof raw === 'boolean') return raw;
    return String(raw).trim().toUpperCase() === 'TRUE';
  }
  if (NUM_FIELDS[field]) {
    var n = Number(raw);
    return isNaN(n) ? 0 : n;
  }
  if (DATE_FIELDS[field] && Object.prototype.toString.call(raw) === '[object Date]') {
    return Utilities.formatDate(raw, TIMEZONE, 'yyyy-MM-dd');
  }
  if (TS_FIELDS[field] && Object.prototype.toString.call(raw) === '[object Date]') {
    return Utilities.formatDate(raw, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(raw).trim();
}

function valueToCell(field, value) {
  if (BOOL_FIELDS[field]) return value ? 'TRUE' : 'FALSE';
  if (value === null || value === undefined) return '';
  return value;
}

/* ---------------- Table ----------------------------------------- */

function getSheet(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) {
    throw new ApiError('SERVER_ERROR',
      'The "' + name + '" tab is missing from the Sheet. Run setupSheet() from the Apps Script editor.');
  }
  return sheet;
}

/**
 * One tab, read into memory once.
 *
 * `obj._row` is the 1-based sheet row number, which is what makes targeted
 * writes possible without re-searching the sheet.
 */
function Table(name) {
  this.name = name;
  this.sheet = getSheet(name);

  var values = this.sheet.getDataRange().getValues();
  this.headers = (values[0] || []).map(function (h) { return String(h).trim(); });

  this.colOf = {};
  for (var c = 0; c < this.headers.length; c++) this.colOf[this.headers[c]] = c;

  this.rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    // Skip fully blank rows — a volunteer pressing Enter in the Sheet should
    // not create a phantom item.
    if (raw.join('').trim() === '') continue;

    var obj = { _row: r + 1 };
    for (var i = 0; i < this.headers.length; i++) {
      obj[this.headers[i]] = cellToValue(this.headers[i], raw[i]);
    }
    this.rows.push(obj);
  }

  this._dirty = {};   // rowNumber -> obj
  this._appends = [];
}

Table.prototype.all = function () { return this.rows; };

Table.prototype.findBy = function (field, value) {
  for (var i = 0; i < this.rows.length; i++) {
    if (this.rows[i][field] === value) return this.rows[i];
  }
  return null;
};

Table.prototype.filterBy = function (field, value) {
  return this.rows.filter(function (r) { return r[field] === value; });
};

/** Stage a change on an in-memory row. Nothing hits the Sheet until flush(). */
Table.prototype.update = function (row, changes) {
  for (var k in changes) {
    if (!Object.prototype.hasOwnProperty.call(changes, k)) continue;
    if (this.colOf[k] === undefined) continue;   // unknown column: ignore, do not crash
    row[k] = changes[k];
  }
  this._dirty[row._row] = row;
  return row;
};

/** Stage a new row. Its _row is assigned at flush time. */
Table.prototype.append = function (obj) {
  this._appends.push(obj);
  this.rows.push(obj);
  return obj;
};

Table.prototype.flush = function () {
  var self = this;
  var width = this.headers.length;

  // Updates: one setValues per changed row. Kit operations touch ~6 rows.
  Object.keys(this._dirty).forEach(function (rowNum) {
    var obj = self._dirty[rowNum];
    var line = self.headers.map(function (h) { return valueToCell(h, obj[h]); });
    self.sheet.getRange(Number(rowNum), 1, 1, width).setValues([line]);
  });
  this._dirty = {};

  // Appends: a single block write, whatever the count.
  if (this._appends.length) {
    var block = this._appends.map(function (obj) {
      return self.headers.map(function (h) { return valueToCell(h, obj[h]); });
    });
    var start = this.sheet.getLastRow() + 1;
    this.sheet.getRange(start, 1, block.length, width).setValues(block);
    for (var i = 0; i < this._appends.length; i++) this._appends[i]._row = start + i;
    this._appends = [];
  }
};

/* ---------------- request-scoped cache -------------------------- */

var _tableCache = {};

function table(name) {
  if (!_tableCache[name]) _tableCache[name] = new Table(name);
  return _tableCache[name];
}

function flushAll() {
  Object.keys(_tableCache).forEach(function (n) { _tableCache[n].flush(); });
}

function resetCache() { _tableCache = {}; }

/* ---------------- ids, tokens, time ----------------------------- */

/**
 * Next sequential id for a prefix, e.g. nextSequentialId('Movements','movement_id','MV-',6).
 * Scans existing rows rather than keeping a counter, so a hand-edited Sheet
 * cannot make the app reissue an id that is already in use.
 */
function nextSequentialId(tabName, field, prefix, pad) {
  var rows = table(tabName).all();
  var max = 0;
  var re = new RegExp('^' + prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d+)$');
  for (var i = 0; i < rows.length; i++) {
    var m = re.exec(String(rows[i][field] || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  var next = String(max + 1);
  while (next.length < pad) next = '0' + next;
  return prefix + next;
}

/**
 * Next free asset id for an instrument type, e.g. Tabla -> TAB-017.
 *
 * Deliberately scans inactive rows too: a retired asset id must never be
 * reused, or old movement history would appear to belong to the new item.
 */
function nextAssetId(prefix) {
  var rows = table('Items').all();
  var max = 0;
  var re = new RegExp('^' + prefix + '-(\\d+)$', 'i');
  for (var i = 0; i < rows.length; i++) {
    var m = re.exec(String(rows[i].asset_id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  var next = String(max + 1);
  while (next.length < 3) next = '0' + next;
  return prefix + '-' + next;
}

/** Opaque token stored on every item. Not what the QR encodes today — see docs/SCHEMA.md. */
function newQrToken() {
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789';   // no l/o/0/1 — these get transcribed by hand
  var out = '';
  for (var i = 0; i < 16; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/** London-local 'YYYY-MM-DD'. The one place "today" is decided. */
function todayISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function nowISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
