/**
 * A minimal in-memory stand-in for the Apps Script runtime.
 *
 * It exists so the generated apps-script/Code.gs can be loaded and exercised
 * end to end in Node — setupSheet(), doGet(), doPost() and all — without a
 * Google account. It implements only the surface this app actually uses, and
 * deliberately no more: anything the app calls that is missing here should
 * fail loudly in the tests rather than be quietly stubbed.
 */

var vm = require('vm');
var fs = require('fs');
var path = require('path');

/* ---------------- date formatting ------------------------------- */

/**
 * Utilities.formatDate for the two patterns this app uses, honouring a real
 * IANA timezone via Intl — so the tests see the same BST/GMT behaviour that
 * Apps Script would produce in London.
 */
function formatDate(date, tz, pattern) {
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).reduce(function (acc, p) { acc[p.type] = p.value; return acc; }, {});

  if (pattern === 'yyyy-MM-dd') {
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  if (pattern === 'yyyy-MM-dd-HHmmss') {
    return parts.year + '-' + parts.month + '-' + parts.day + '-' +
           (parts.hour === '24' ? '00' : parts.hour) + parts.minute + parts.second;
  }
  if (pattern === "yyyy-MM-dd'T'HH:mm:ssXXX") {
    // Offset in ±HH:MM, derived by comparing the zoned wall time against UTC.
    var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
                         +(parts.hour === '24' ? '00' : parts.hour), +parts.minute, +parts.second);
    var offsetMin = Math.round((asUTC - date.getTime()) / 60000);
    var sign = offsetMin >= 0 ? '+' : '-';
    var abs = Math.abs(offsetMin);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' +
           parts.hour + ':' + parts.minute + ':' + parts.second +
           sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }
  throw new Error('gas-mock: unsupported date pattern "' + pattern + '"');
}

/* ---------------- sheets ---------------------------------------- */

function FakeRange(sheet, row, col, numRows, numCols) {
  this.sheet = sheet; this.row = row; this.col = col;
  this.numRows = numRows; this.numCols = numCols;
}
FakeRange.prototype.getValues = function () {
  var out = [];
  for (var r = 0; r < this.numRows; r++) {
    var line = [];
    for (var c = 0; c < this.numCols; c++) line.push(this.sheet.read(this.row + r, this.col + c));
    out.push(line);
  }
  return out;
};
FakeRange.prototype.setValues = function (values) {
  if (values.length !== this.numRows) {
    throw new Error('setValues row count mismatch: range has ' + this.numRows +
                    ', got ' + values.length);
  }
  for (var r = 0; r < values.length; r++) {
    if (values[r].length !== this.numCols) {
      throw new Error('setValues column count mismatch on row ' + r + ': range has ' +
                      this.numCols + ', got ' + values[r].length);
    }
    for (var c = 0; c < values[r].length; c++) {
      this.sheet.write(this.row + r, this.col + c, values[r][c]);
    }
  }
  return this;
};
FakeRange.prototype.setFontWeight = function () { return this; };
FakeRange.prototype.setBackground = function () { return this; };
FakeRange.prototype.setNumberFormat = function () { return this; };

function FakeSheet(name) {
  this.name = name;
  this.grid = {};        // 'r,c' -> value
  this.maxColumns = 26;
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.read = function (r, c) {
  var v = this.grid[r + ',' + c];
  return v === undefined ? '' : v;
};
FakeSheet.prototype.write = function (r, c, v) {
  this.grid[r + ',' + c] = v === undefined || v === null ? '' : v;
  // Real Sheets grows the grid when you add a column, and getMaxColumns
  // reports the new width. Without this the mock silently under-reported and
  // hid a destructive branch in setupSheet.
  if (c > this.maxColumns) this.maxColumns = c;
};
FakeSheet.prototype.getLastRow = function () {
  var last = 0;
  Object.keys(this.grid).forEach(function (k) {
    if (String(this.grid[k]).trim() === '') return;
    var r = Number(k.split(',')[0]);
    if (r > last) last = r;
  }, this);
  return last;
};
FakeSheet.prototype.getLastColumn = function () {
  var last = 0;
  Object.keys(this.grid).forEach(function (k) {
    if (String(this.grid[k]).trim() === '') return;
    var c = Number(k.split(',')[1]);
    if (c > last) last = c;
  }, this);
  return last;
};
FakeSheet.prototype.getMaxColumns = function () { return this.maxColumns; };
FakeSheet.prototype.deleteColumns = function (start, howMany) {
  this.maxColumns -= howMany;
  var self = this;
  Object.keys(this.grid).forEach(function (k) {
    if (Number(k.split(',')[1]) >= start) delete self.grid[k];
  });
};
FakeSheet.prototype.deleteRows = function (start, howMany) {
  var self = this;
  var moved = {};
  Object.keys(this.grid).forEach(function (k) {
    var p = k.split(','), r = Number(p[0]), c = Number(p[1]);
    if (r < start) { moved[k] = self.grid[k]; return; }
    if (r < start + howMany) return;              // deleted
    moved[(r - howMany) + ',' + c] = self.grid[k];
  });
  this.grid = moved;
};
FakeSheet.prototype.deleteRow = function (row) { this.deleteRows(row, 1); };
FakeSheet.prototype.setFrozenRows = function () { return this; };
FakeSheet.prototype.autoResizeColumns = function () { return this; };
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  return new FakeRange(this, row, col, numRows === undefined ? 1 : numRows,
                       numCols === undefined ? 1 : numCols);
};
FakeSheet.prototype.getDataRange = function () {
  var rows = Math.max(1, this.getLastRow());
  var cols = Math.max(1, this.getLastColumn());
  return new FakeRange(this, 1, 1, rows, cols);
};

function FakeSpreadsheet() {
  this.sheets = [new FakeSheet('Sheet1')];
  this.timezone = 'Etc/GMT';
}
FakeSpreadsheet.prototype.getId = function () { return 'sheet-id'; };
FakeSpreadsheet.prototype.getSheetByName = function (name) {
  return this.sheets.filter(function (s) { return s.name === name; })[0] || null;
};
FakeSpreadsheet.prototype.insertSheet = function (name) {
  var s = new FakeSheet(name);
  this.sheets.push(s);
  return s;
};
FakeSpreadsheet.prototype.deleteSheet = function (sheet) {
  this.sheets = this.sheets.filter(function (s) { return s !== sheet; });
};
FakeSpreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
FakeSpreadsheet.prototype.setSpreadsheetTimeZone = function (tz) { this.timezone = tz; };

/* ---------------- drive ------------------------------------------ */

/**
 * Enough of DriveApp to run the photo upload path for real.
 *
 * `denied` reproduces the failure that actually bit us in production: an Apps
 * Script project authorised before the code used DriveApp throws on the very
 * first Drive call until the owner re-consents. Redeploying does not do that,
 * so the web app keeps failing with a scope error no volunteer can act on.
 */
function FakeDrive(opts) {
  opts = opts || {};
  this.denied = !!opts.denied;
  this.folders = [];
  this.files = [];
  this.nextId = 1;
}
FakeDrive.prototype._guard = function (name) {
  if (!this.denied) return;
  var e = new Error(
    'Exception: You do not have permission to call ' + name +
    '. Required permissions: https://www.googleapis.com/auth/drive');
  throw e;
};
FakeDrive.prototype._file = function (blob, folder) {
  var drive = this;
  var id = 'file-' + (this.nextId++);
  var file = {
    id: id,
    blob: blob,
    folder: folder,
    sharing: null,
    trashed: false,
    getId: function () { return id; },
    getName: function () { return blob.name; },
    getBlob: function () { return blob; },
    setTrashed: function (yes) {
      drive._guard('DriveApp.File.setTrashed');
      file.trashed = !!yes;
      return file;
    },
    setSharing: function (access, permission) {
      drive._guard('DriveApp.File.setSharing');
      if (drive.sharingRefused) throw new Error('Sharing is disabled for this domain.');
      file.sharing = access + '/' + permission;
      return file;
    }
  };
  this.files.push(file);
  return file;
};
function iterator(list) {
  var i = 0;
  return { hasNext: function () { return i < list.length; },
           next: function () { return list[i++]; } };
}

/**
 * `parentId` is null for the top of My Drive. The mock models containment
 * properly because where the photos folder ends up is the whole point — a
 * folder dumped at the root of someone's Drive is a real complaint.
 */
FakeDrive.prototype.makeFolder = function (name, parentId) {
  var drive = this;
  var id = 'folder-' + (this.nextId++);
  var folder = {
    id: id,
    name: name,
    parentId: parentId === undefined ? null : parentId,
    getId: function () { return id; },
    getName: function () { return name; },
    getUrl: function () { return 'https://drive.google.com/drive/folders/' + id; },
    createFile: function (blob) {
      drive._guard('DriveApp.Folder.createFile');
      return drive._file(blob, folder);
    },
    createFolder: function (childName) {
      drive._guard('DriveApp.Folder.createFolder');
      return drive.makeFolder(childName, id);
    },
    getFoldersByName: function (childName) {
      drive._guard('DriveApp.Folder.getFoldersByName');
      return iterator(drive.folders.filter(function (f) {
        return f.parentId === id && f.name === childName;
      }));
    }
  };
  this.folders.push(folder);
  return folder;
};

FakeDrive.prototype.api = function () {
  var drive = this;

  // The spreadsheet is a Drive file like any other, and by default it sits
  // loose at the top of My Drive — which is how a real new install starts.
  drive.root = drive.makeFolder('My Drive', undefined);
  drive.root.parentId = null;
  drive.sheetParentId = null;

  return {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    getRootFolder: function () {
      drive._guard('DriveApp.getRootFolder');
      return drive.root;
    },
    getFileById: function (id) {
      drive._guard('DriveApp.getFileById');

      // The spreadsheet itself, asked for so we can find the folder it is in.
      if (id === 'sheet-id') {
        return {
          getParents: function () {
            var parent = drive.folders.filter(function (f) {
              return f.id === drive.sheetParentId;
            })[0];
            return iterator(parent ? [parent] : []);
          }
        };
      }

      var hit = drive.files.filter(function (f) { return f.id === id; })[0];
      if (!hit) throw new Error('No file with id ' + id);
      return hit;
    },
    getFolderById: function (id) {
      drive._guard('DriveApp.getFolderById');
      var hit = drive.folders.filter(function (f) { return f.id === id; })[0];
      if (!hit) throw new Error('No folder with id ' + id);
      return hit;
    },
    getFoldersByName: function (name) {
      drive._guard('DriveApp.getFoldersByName');
      return iterator(drive.folders.filter(function (f) { return f.name === name; }));
    },
    createFolder: function (name) {
      drive._guard('DriveApp.createFolder');
      return drive.makeFolder(name, null);
    }
  };
};

/* ---------------- the sandbox ------------------------------------ */

/**
 * Loads apps-script/Code.gs into a fresh sandbox and returns handles to it.
 * `now` fixes the clock so "today" and overdue counts are deterministic.
 */
function loadApp(opts) {
  opts = opts || {};
  var spreadsheet = new FakeSpreadsheet();
  var drive = new FakeDrive({ denied: opts.driveDenied });
  var properties = {};
  var logs = [];
  var fixedNow = opts.now ? new Date(opts.now).getTime() : null;

  var RealDate = Date;
  function MockDate(a, b, c, d, e, f, g) {
    if (!(this instanceof MockDate)) return new MockDate().toString();
    if (arguments.length === 0) return new RealDate(fixedNow === null ? RealDate.now() : fixedNow);
    if (arguments.length === 1) return new RealDate(a);
    return new RealDate(a, b, c, d || 0, e || 0, f || 0, g || 0);
  }
  MockDate.prototype = RealDate.prototype;
  MockDate.now = function () { return fixedNow === null ? RealDate.now() : fixedNow; };
  MockDate.UTC = RealDate.UTC;
  MockDate.parse = RealDate.parse;

  var sandbox = {
    Date: fixedNow === null ? RealDate : MockDate,
    Math: Math, JSON: JSON, String: String, Number: Number, Boolean: Boolean,
    Object: Object, Array: Array, RegExp: RegExp, Error: Error, isNaN: isNaN,
    Intl: Intl,

    console: {
      log: function (m) { logs.push(String(m)); },
      info: function (m) { logs.push('INFO: ' + String(m)); },
      warn: function (m) { logs.push('WARN: ' + String(m)); },
      error: function (m) { logs.push('ERROR: ' + String(m)); }
    },

    DriveApp: drive.api(),

    SpreadsheetApp: {
      getActive: function () { return spreadsheet; },
      getUi: function () { throw new Error('no UI in tests'); }
    },

    Utilities: {
      formatDate: function (date, tz, pattern) { return formatDate(date, tz, pattern); },
      base64Decode: function (b64) {
        // Apps Script hands back a byte array; Buffer is close enough for the
        // one thing the app does with it, which is wrap it in a blob.
        return Array.prototype.slice.call(Buffer.from(String(b64), 'base64'));
      },
      newBlob: function (bytes, mimeType, name) {
        return {
          bytes: bytes, mimeType: mimeType, name: name,
          getBytes: function () { return bytes; },
          getName: function () { return name; },
          getContentType: function () { return mimeType; }
        };
      }
    },

    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return properties[k] === undefined ? null : properties[k]; },
          setProperty: function (k, v) { properties[k] = v; return this; }
        };
      }
    },

    LockService: {
      getScriptLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () {} };
      }
    },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: function (text) {
        return { _text: text, setMimeType: function () { return this; } };
      }
    }
  };
  sandbox.globalThis = sandbox;

  var code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(sandbox);

  /** Calls doGet and unwraps the JSON envelope. */
  function get(action, params) {
    var p = Object.assign({ action: action, code: properties.ACCESS_CODE }, params || {});
    var out = sandbox.doGet({ parameter: p });
    return JSON.parse(out._text);
  }

  /** Calls doPost the way the browser does — a JSON string body. */
  function post(action, payload, code) {
    var body = JSON.stringify({
      action: action,
      code: code === undefined ? properties.ACCESS_CODE : code,
      payload: payload || {}
    });
    var out = sandbox.doPost({ postData: { contents: body } });
    return JSON.parse(out._text);
  }

  return {
    sandbox: sandbox,
    spreadsheet: spreadsheet,
    drive: drive,
    properties: properties,
    logs: logs,
    get: get,
    post: post,
    /** Raw rows of a tab as objects, for asserting what actually landed in the Sheet. */
    rows: function (tabName) {
      var sheet = spreadsheet.getSheetByName(tabName);
      var values = sheet.getDataRange().getValues();
      var headers = values[0];
      return values.slice(1)
        .filter(function (r) { return r.join('').trim() !== ''; })
        .map(function (r) {
          var o = {};
          headers.forEach(function (h, i) { o[h] = r[i]; });
          return o;
        });
    }
  };
}

module.exports = { loadApp: loadApp, formatDate: formatDate };
