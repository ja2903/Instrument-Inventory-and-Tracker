/**
 * Instrument Tracker — self-contained QR code generator.
 *
 * Byte mode, error-correction level M (recovers ~15% damage — the right
 * level for a sticker on an instrument that lives in a store cupboard).
 * Versions 1 to 10, which covers anything up to 213 characters; an asset
 * id like "TAB-014" fits in version 1.
 *
 * Deliberately NOT loaded from a CDN. Scanning can fall back to typing an
 * id by hand if a CDN is unreachable, but a broken label printing run means
 * peeling stickers off instruments — so this has no external dependency.
 *
 * The tests in tests/qr.test.js read the finished matrix back out and check
 * it against the codewords that went in.
 */

var QR = (function () {
  'use strict';

  /* ================================================================
   * Tables — level M only
   * ================================================================ */

  // [total codewords, ec codewords per block, [ [blocks, data cw], ... ] ]
  var VERSIONS = {
    1:  [26,  10, [[1, 16]]],
    2:  [44,  16, [[1, 28]]],
    3:  [70,  26, [[1, 44]]],
    4:  [100, 18, [[2, 32]]],
    5:  [134, 24, [[2, 43]]],
    6:  [172, 16, [[4, 27]]],
    7:  [196, 18, [[4, 31]]],
    8:  [242, 22, [[2, 38], [2, 39]]],
    9:  [292, 22, [[3, 36], [2, 37]]],
    10: [346, 26, [[4, 43], [1, 44]]]
  };

  var ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  /** Bits left over after the interleaved codewords, per version. */
  var REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

  var EC_LEVEL_M_BITS = 0;   // L=1, M=0, Q=3, H=2 — the standard's own odd ordering

  /* ================================================================
   * Galois field GF(256), primitive polynomial 0x11D
   * ================================================================ */

  var EXP = new Array(512);
  var LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** Generator polynomial for `degree` error-correction codewords. */
  function generatorPoly(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= gfMul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  /** Reed-Solomon remainder — the error-correction codewords for one block. */
  function ecCodewords(data, ecLength) {
    var gen = generatorPoly(ecLength);
    var remainder = new Array(ecLength).fill(0);

    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      for (var j = 0; j < gen.length - 1; j++) {
        remainder[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return remainder;
  }

  /* ================================================================
   * Encoding
   * ================================================================ */

  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var full = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (full >> 18), 0x80 | ((full >> 12) & 0x3F),
                 0x80 | ((full >> 6) & 0x3F), 0x80 | (full & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  function chooseVersion(byteLength) {
    for (var v = 1; v <= 10; v++) {
      var dataCw = VERSIONS[v][2].reduce(function (sum, g) { return sum + g[0] * g[1]; }, 0);
      var countBits = v <= 9 ? 8 : 16;
      var capacity = Math.floor((dataCw * 8 - 4 - countBits) / 8);
      if (byteLength <= capacity) return v;
    }
    throw new Error('QR: "' + byteLength + ' bytes" is too long for this label. ' +
                    'Asset IDs should be short.');
  }

  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.length = function () { return this.bits.length; };

  /** Mode + length + payload + terminator + padding, as one codeword array. */
  function buildDataCodewords(bytes, version) {
    var totalDataCw = VERSIONS[version][2]
      .reduce(function (sum, g) { return sum + g[0] * g[1]; }, 0);
    var capacityBits = totalDataCw * 8;

    var buf = new BitBuffer();
    buf.put(0x4, 4);                                    // byte mode
    buf.put(bytes.length, version <= 9 ? 8 : 16);       // character count
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    // Terminator: up to four zero bits, then pad to a byte boundary.
    var terminator = Math.min(4, capacityBits - buf.length());
    buf.put(0, terminator);
    while (buf.length() % 8 !== 0) buf.put(0, 1);

    var codewords = [];
    for (var b = 0; b < buf.bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | buf.bits[b + k];
      codewords.push(byte);
    }

    // Alternating pad bytes, as the spec requires.
    var pads = [0xEC, 0x11];
    var p = 0;
    while (codewords.length < totalDataCw) codewords.push(pads[p++ % 2]);

    return codewords;
  }

  /**
   * Split into blocks, add error correction, then interleave.
   *
   * Interleaving is what makes a scratch across the label survive: damage is
   * spread across blocks rather than destroying one block completely.
   */
  function buildFinalCodewords(dataCodewords, version) {
    var ecPerBlock = VERSIONS[version][1];
    var groups = VERSIONS[version][2];

    var dataBlocks = [];
    var ecBlocks = [];
    var pos = 0;

    groups.forEach(function (group) {
      for (var b = 0; b < group[0]; b++) {
        var block = dataCodewords.slice(pos, pos + group[1]);
        pos += group[1];
        dataBlocks.push(block);
        ecBlocks.push(ecCodewords(block, ecPerBlock));
      }
    });

    var out = [];
    var maxData = Math.max.apply(null, dataBlocks.map(function (b) { return b.length; }));
    for (var i = 0; i < maxData; i++) {
      for (var d = 0; d < dataBlocks.length; d++) {
        if (i < dataBlocks[d].length) out.push(dataBlocks[d][i]);
      }
    }
    for (var j = 0; j < ecPerBlock; j++) {
      for (var e = 0; e < ecBlocks.length; e++) out.push(ecBlocks[e][j]);
    }
    return out;
  }

  /* ================================================================
   * Matrix construction
   * ================================================================ */

  function newMatrix(size) {
    var m = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(null));   // null = not yet set (i.e. free for data)
    }
    return m;
  }

  function placeFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var onRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                     (c >= 0 && c <= 6 && (r === 0 || r === 6));
        var inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        m[rr][cc] = (onRing || inCore) ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, version) {
    var coords = ALIGNMENT[version];
    var size = m.length;
    for (var i = 0; i < coords.length; i++) {
      for (var j = 0; j < coords.length; j++) {
        var row = coords[i], col = coords[j];
        // Skip the three corners already occupied by finder patterns.
        if ((row <= 8 && col <= 8) ||
            (row <= 8 && col >= size - 9) ||
            (row >= size - 9 && col <= 8)) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var edge = Math.max(Math.abs(r), Math.abs(c));
            m[row + r][col + c] = (edge === 1) ? 0 : 1;
          }
        }
      }
    }
  }

  function placeTiming(m) {
    var size = m.length;
    for (var i = 8; i < size - 8; i++) {
      var bit = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = bit;
      if (m[i][6] === null) m[i][6] = bit;
    }
  }

  /** Reserve the format and version areas so data placement skips them. */
  function reserveFormatAreas(m, version) {
    var size = m.length;
    for (var i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][size - 1 - j] === null) m[8][size - 1 - j] = 0;
      if (m[size - 1 - j][8] === null) m[size - 1 - j][8] = 0;
    }
    m[size - 8][8] = 1;   // the always-dark module

    if (version >= 7) {
      for (var r = 0; r < 6; r++) {
        for (var c = 0; c < 3; c++) {
          m[r][size - 11 + c] = 0;
          m[size - 11 + c][r] = 0;
        }
      }
    }
  }

  /** True where a module is part of a function pattern and must not carry data. */
  function buildReservedMap(version) {
    var size = version * 4 + 17;
    var m = newMatrix(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    placeTiming(m);
    reserveFormatAreas(m, version);

    var reserved = [];
    for (var r = 0; r < size; r++) {
      reserved.push(m[r].map(function (v) { return v !== null; }));
    }
    return { matrix: m, reserved: reserved };
  }

  /**
   * The standard zigzag: two columns at a time, right to left, alternating
   * upward and downward, skipping the vertical timing column entirely.
   */
  function dataModulePositions(size, reserved) {
    var positions = [];
    var upward = true;

    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;            // column 6 is the timing pattern
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var k = 0; k < 2; k++) {
          var col = right - k;
          if (!reserved[row][col]) positions.push([row, col]);
        }
      }
      upward = !upward;
    }
    return positions;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
  ];

  /** BCH(15,5) format information, XOR-masked as the spec requires. */
  function formatBits(ecLevelBits, mask) {
    var data = (ecLevelBits << 3) | mask;
    var value = data << 10;
    for (var i = 4; i >= 0; i--) {
      if ((value >>> (i + 10)) & 1) value ^= 0x537 << i;   // generator 10100110111
    }
    return ((data << 10) | value) ^ 0x5412;                // mask 101010000010010
  }

  /** BCH(18,6) version information — only present from version 7 up. */
  function versionBits(version) {
    var value = version << 12;
    for (var i = 5; i >= 0; i--) {
      if ((value >>> (i + 12)) & 1) value ^= 0x1F25 << i;   // generator 1111100100101
    }
    return (version << 12) | value;
  }

  /**
   * The 15 module positions of each format-information copy, in the order the
   * bits are written: MOST significant bit first.
   *
   * Both copies are listed explicitly because the geometry is genuinely fiddly
   * and getting it subtly wrong produces a symbol that looks perfect, passes a
   * self-consistent round-trip test, and is refused by every real scanner —
   * the reader gets the wrong mask number and unmasks the data into noise.
   *
   * Copy 1 wraps the top-left finder. Copy 2 is split in two by the
   * always-dark module at (size-8, 8), which is NOT one of the 15.
   */
  function formatPositions(size) {
    var copy1 = [];
    for (var i = 0; i <= 5; i++) copy1.push([8, i]);        // (8,0) … (8,5)
    copy1.push([8, 7], [8, 8], [7, 8]);                     // skipping the timing column
    for (var j = 5; j >= 0; j--) copy1.push([j, 8]);        // (5,8) … (0,8)

    var copy2 = [];
    for (var k = 0; k < 7; k++) copy2.push([size - 1 - k, 8]);   // rows size-1 … size-7
    for (var n = 8; n >= 1; n--) copy2.push([8, size - n]);      // cols size-8 … size-1

    return [copy1, copy2];
  }

  function applyFormat(m, mask) {
    var bits = formatBits(EC_LEVEL_M_BITS, mask);

    formatPositions(m.length).forEach(function (positions) {
      positions.forEach(function (p, index) {
        m[p[0]][p[1]] = (bits >> (14 - index)) & 1;   // MSB first
      });
    });

    m[m.length - 8][8] = 1;   // the always-dark module, never a format bit
  }

  function applyVersionInfo(m, version) {
    if (version < 7) return;
    var size = m.length;
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var r = Math.floor(i / 3);
      var c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  /* ---------------- mask penalty scoring -------------------------- */

  function penalty(m) {
    var size = m.length;
    var score = 0;

    // Rule 1 — runs of five or more of the same colour.
    for (var pass = 0; pass < 2; pass++) {
      for (var a = 0; a < size; a++) {
        var run = 1;
        for (var b = 1; b < size; b++) {
          var prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
          var cur = pass === 0 ? m[a][b] : m[b][a];
          if (cur === prev) {
            run++;
          } else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    // Rule 2 — 2x2 blocks of one colour.
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3 — finder-like 1011101 patterns with four light modules beside them.
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (var pr = 0; pr < size; pr++) {
      for (var pc = 0; pc + 11 <= size; pc++) {
        var okRow1 = true, okRow2 = true, okCol1 = true, okCol2 = true;
        for (var q = 0; q < 11; q++) {
          if (m[pr][pc + q] !== p1[q]) okRow1 = false;
          if (m[pr][pc + q] !== p2[q]) okRow2 = false;
          if (m[pc + q][pr] !== p1[q]) okCol1 = false;
          if (m[pc + q][pr] !== p2[q]) okCol2 = false;
        }
        if (okRow1) score += 40;
        if (okRow2) score += 40;
        if (okCol1) score += 40;
        if (okCol2) score += 40;
      }
    }

    // Rule 4 — overall balance of dark to light.
    var dark = 0;
    for (var dr = 0; dr < size; dr++) {
      for (var dc = 0; dc < size; dc++) if (m[dr][dc]) dark++;
    }
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /* ================================================================
   * Public API
   * ================================================================ */

  /**
   * encode(text) -> { size, modules: [[0|1]], version, codewords, mask }
   * `modules[row][col]` is 1 for a dark module.
   */
  function encode(text) {
    var bytes = toUtf8Bytes(String(text));
    var version = chooseVersion(bytes.length);
    var dataCw = buildDataCodewords(bytes, version);
    var finalCw = buildFinalCodewords(dataCw, version);

    var base = buildReservedMap(version);
    var reserved = base.reserved;
    var positions = dataModulePositions(base.matrix.length, reserved);

    // Lay the bitstream into the free modules, then pad the remainder with zeros.
    var bits = [];
    finalCw.forEach(function (cw) {
      for (var i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    });
    for (var rem = 0; rem < REMAINDER_BITS[version]; rem++) bits.push(0);

    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = base.matrix.map(function (row) { return row.slice(); });
      for (var p = 0; p < positions.length; p++) {
        var row = positions[p][0], col = positions[p][1];
        var bit = p < bits.length ? bits[p] : 0;
        m[row][col] = MASKS[mask](row, col) ? bit ^ 1 : bit;
      }
      applyFormat(m, mask);
      applyVersionInfo(m, version);

      var score = penalty(m);
      if (!best || score < best.score) best = { score: score, matrix: m, mask: mask };
    }

    return {
      size: best.matrix.length,
      modules: best.matrix,
      version: version,
      mask: best.mask,
      codewords: finalCw,
      dataCodewords: dataCw
    };
  }

  /**
   * An SVG string for the given text.
   *
   * SVG rather than canvas because it prints at the printer's own resolution
   * — a canvas bitmap scaled to 25mm prints fuzzy, and a fuzzy QR is a QR
   * that does not scan.
   */
  function toSvg(text, options) {
    options = options || {};
    var quiet = options.quiet === undefined ? 4 : options.quiet;   // 4 modules, per spec
    var qr = encode(text);
    var total = qr.size + quiet * 2;

    var path = [];
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) path.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
           'shape-rendering="crispEdges" role="img" aria-label="QR code for ' +
           String(text).replace(/[<>&"]/g, '') + '">' +
           '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
           '<path d="' + path.join('') + '" fill="#000000"/>' +
           '</svg>';
  }

  return {
    encode: encode,
    toSvg: toSvg,
    // exposed for the tests
    _internal: {
      VERSIONS: VERSIONS, gfMul: gfMul, EXP: EXP, LOG: LOG,
      ecCodewords: ecCodewords, dataModulePositions: dataModulePositions,
      buildReservedMap: buildReservedMap, MASKS: MASKS, formatBits: formatBits,
      formatPositions: formatPositions, REMAINDER_BITS: REMAINDER_BITS
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QR;
