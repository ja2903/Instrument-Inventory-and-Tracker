/**
 * QR encoder verification.
 *
 * There is no scanner in the test environment, so instead of trusting the
 * encoder these tests take the finished module matrix apart the way a scanner
 * would — read the format info, undo the mask, walk the zigzag, de-interleave
 * the blocks — and check that what comes out is what went in. Plus a
 * Reed-Solomon syndrome check, which is zero only if the error correction is
 * genuinely correct.
 *
 * If these pass, a real scanner will read the label.
 */

var QR = require('../js/qr.js');
var H = require('./harness.js');
var suite = H.suite, test = H.test, eq = H.eq, ok = H.ok, notOk = H.notOk, fail = H.fail;

var I = QR._internal;

/* ---------------- golden fixtures --------------------------------- */

/**
 * Module matrices produced by an INDEPENDENT implementation
 * (qrcode-generator 1.4.4, byte mode, level M) for two of the seeded asset ids.
 *
 * These matter more than any of the self-consistency checks below. A QR encoder
 * can be wrong in a way that a round-trip through its own decoder cannot see —
 * this project already shipped one such bug, where the 15 format-information
 * bits were written in reverse order along their module positions. Every
 * self-consistent test passed; every real scanner refused the label, because
 * the reader recovered the wrong mask number and unmasked the data into noise.
 *
 * Comparing against a matrix this code did not produce is what catches that.
 */
var GOLDEN = {
  'TAB-014': [
    '111111100111001111111', '100000100100101000001', '101110101110001011101',
    '101110101111101011101', '101110101000101011101', '100000101111001000001',
    '111111101010101111111', '000000001000000000000', '101111100101001111100',
    '111111001111111100100', '001001111100101101110', '110011001001111101100',
    '110111111100100000110', '000000001110100010110', '111111100111010100010',
    '100000101000000000111', '101110101011010100010', '101110101011111011000',
    '101110101100101101100', '100000100011111100100', '111111101000100101010'
  ],
  'MIC-011': [
    '111111100100101111111', '100000100001001000001', '101110101110001011101',
    '101110101001001011101', '101110101100101011101', '100000101001001000001',
    '111111101010101111111', '000000001110000000000', '101111100111001111100',
    '001101011101111100000', '111001110010101101110', '011111011001111001110',
    '110111110110100100111', '000000001000100010100', '111111100001010101010',
    '100000101110000000111', '101110101001010100010', '101110101111111011000',
    '101110101110101101100', '100000100011111100100', '111111101010100101010'
  ]
};

/* ---------------- a minimal scanner ------------------------------ */

/**
 * Reads the 15 format bits back out of one copy.
 * `which` is 0 for the copy around the top-left finder, 1 for the split copy.
 */
function readFormat(m, which) {
  var positions = QR._internal.formatPositions(m.length)[which || 0];
  var bits = 0;
  positions.forEach(function (p, index) {
    bits |= m[p[0]][p[1]] << (14 - index);     // MSB first
  });
  return bits ^ 0x5412;
}

/** Undoes the mask and walks the data modules in placement order. */
function readCodewords(qr) {
  var base = I.buildReservedMap(qr.version);
  var positions = I.dataModulePositions(qr.size, base.reserved);
  var maskFn = I.MASKS[qr.mask];

  var bits = [];
  positions.forEach(function (p) {
    var row = p[0], col = p[1];
    var v = qr.modules[row][col];
    bits.push(maskFn(row, col) ? v ^ 1 : v);
  });

  var codewords = [];
  var usable = bits.length - I.REMAINDER_BITS[qr.version];
  for (var i = 0; i + 8 <= usable; i += 8) {
    var byte = 0;
    for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
    codewords.push(byte);
  }
  return codewords;
}

/** Splits interleaved codewords back into the per-block data + EC arrays. */
function deinterleave(codewords, version) {
  var spec = I.VERSIONS[version];
  var ecPerBlock = spec[1];
  var groups = spec[2];

  var blockSizes = [];
  groups.forEach(function (g) {
    for (var b = 0; b < g[0]; b++) blockSizes.push(g[1]);
  });

  var dataBlocks = blockSizes.map(function () { return []; });
  var maxData = Math.max.apply(null, blockSizes);
  var pos = 0;
  for (var i = 0; i < maxData; i++) {
    for (var b = 0; b < blockSizes.length; b++) {
      if (i < blockSizes[b]) dataBlocks[b].push(codewords[pos++]);
    }
  }

  var ecBlocks = blockSizes.map(function () { return []; });
  for (var j = 0; j < ecPerBlock; j++) {
    for (var e = 0; e < blockSizes.length; e++) ecBlocks[e].push(codewords[pos++]);
  }

  return { dataBlocks: dataBlocks, ecBlocks: ecBlocks, ecPerBlock: ecPerBlock };
}

/**
 * Reed-Solomon syndromes. Every one is zero if and only if the block is a
 * valid codeword — the single strongest check available without a decoder.
 */
function syndromes(block, ecCount) {
  var out = [];
  for (var d = 0; d < ecCount; d++) {
    var sum = 0;
    for (var i = 0; i < block.length; i++) {
      var power = (d * (block.length - 1 - i)) % 255;
      sum ^= I.gfMul(block[i], I.EXP[power]);
    }
    out.push(sum);
  }
  return out;
}

/** Reads the payload back out of the data codewords, as a scanner would. */
function decodeText(dataBlocks, version) {
  var stream = [];
  dataBlocks.forEach(function (b) { stream = stream.concat(b); });

  var bits = [];
  stream.forEach(function (cw) {
    for (var i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  });

  var p = 0;
  function take(n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = (v << 1) | bits[p++];
    return v;
  }

  var mode = take(4);
  if (mode !== 4) fail('expected byte mode (0100), got ' + mode.toString(2));
  var length = take(version <= 9 ? 8 : 16);

  var bytes = [];
  for (var i = 0; i < length; i++) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

/** Full round trip: encode, then read it back the way a scanner would. */
function roundTrip(text) {
  var qr = QR.encode(text);

  var format = readFormat(qr.modules);
  var ecBits = format >> 13;
  var mask = (format >> 10) & 7;
  eq(ecBits, 0, 'format info says error-correction level M');
  eq(mask, qr.mask, 'format info agrees with the mask actually applied');

  var codewords = readCodewords(qr);
  eq(codewords.slice(0, qr.codewords.length), qr.codewords,
     'codewords read out of the matrix match the ones put in');

  var blocks = deinterleave(qr.codewords, qr.version);
  blocks.dataBlocks.forEach(function (data, i) {
    var full = data.concat(blocks.ecBlocks[i]);
    var s = syndromes(full, blocks.ecPerBlock);
    var nonZero = s.filter(function (v) { return v !== 0; });
    eq(nonZero, [], 'block ' + i + ' is a valid Reed-Solomon codeword');
  });

  eq(decodeText(blocks.dataBlocks, qr.version), text, 'the payload survives the round trip');
  return qr;
}

module.exports = function () {

  suite('QR — structure', function () {

    test('a short asset id fits in version 1 (21x21)', function () {
      var qr = QR.encode('TAB-014');
      eq(qr.version, 1);
      eq(qr.size, 21);
    });

    test('finder patterns sit in all three corners', function () {
      var m = QR.encode('TAB-014').modules;
      var size = m.length;
      [[0, 0], [0, size - 7], [size - 7, 0]].forEach(function (corner) {
        var r = corner[0], c = corner[1];
        eq(m[r][c], 1, 'outer ring');
        eq(m[r + 1][c + 1], 0, 'light ring');
        eq(m[r + 3][c + 3], 1, 'dark core');
        eq(m[r + 6][c + 6], 1, 'far corner of the ring');
      });
    });

    test('timing patterns alternate along row 6 and column 6', function () {
      var m = QR.encode('TAB-014').modules;
      for (var i = 8; i < m.length - 8; i++) {
        eq(m[6][i], i % 2 === 0 ? 1 : 0, 'row 6 at ' + i);
        eq(m[i][6], i % 2 === 0 ? 1 : 0, 'column 6 at ' + i);
      }
    });

    test('the always-dark module is set', function () {
      var m = QR.encode('TAB-014').modules;
      eq(m[m.length - 8][8], 1);
    });

    test('every module is a definite 0 or 1 — none left unset', function () {
      var m = QR.encode('TAB-014').modules;
      m.forEach(function (row, r) {
        row.forEach(function (v, c) {
          ok(v === 0 || v === 1, 'module ' + r + ',' + c + ' is ' + v);
        });
      });
    });

    // A scanner falls back to the second copy when the top-left corner is
    // damaged, so the two have to agree — and the second must not be clipped
    // by the always-dark module sitting in the middle of its run.
    test('the two format-info copies carry the same bits', function () {
      ['OTH-001', 'TAB-014', 'HAR-003', 'KEY-002'].forEach(function (id) {
        var m = QR.encode(id).modules;
        eq(readFormat(m, 0), readFormat(m, 1), id);
      });
    });

    test('the dark module survives the second format copy being written', function () {
      ['OTH-001', 'TAB-014', 'AMPLIFIER-000123-SPARE-CHANNEL-B'].forEach(function (id) {
        var m = QR.encode(id).modules;
        eq(m[m.length - 8][8], 1, id);
      });
    });

    test('neither format copy overlaps the other or the dark module', function () {
      var groups = QR._internal.formatPositions(21);
      groups.forEach(function (positions, i) {
        eq(positions.length, 15, 'copy ' + i + ' has 15 modules');
        var seen = {};
        positions.forEach(function (p) { seen[p[0] + ',' + p[1]] = true; });
        eq(Object.keys(seen).length, 15, 'copy ' + i + ' has no repeated position');
        notOk(seen['13,8'], 'copy ' + i + ' does not claim the dark module');
      });
    });
  });

  suite('QR — matches an independent implementation', function () {

    Object.keys(GOLDEN).forEach(function (id) {
      test(id + ' is module-for-module identical to the reference encoder', function () {
        var mine = QR.encode(id);
        var expected = GOLDEN[id];
        eq(mine.size, expected.length, 'symbol size');
        var actual = mine.modules.map(function (row) { return row.join(''); });
        eq(actual, expected);
      });
    });

    test('the format info declares level M and the mask actually applied', function () {
      // The bug this catches: a self-consistent encoder that reverses these 15
      // bits still round-trips through its own decoder, and still fails to scan.
      ['TAB-014', 'OTH-001', 'HAR-003', 'k7d92mfq1x0asb3e'].forEach(function (id) {
        var qr = QR.encode(id);
        var format = readFormat(qr.modules, 0);
        eq(format >> 13, 0, id + ': error-correction level M is 00');
        eq((format >> 10) & 7, qr.mask, id + ': declared mask matches the applied mask');
      });
    });

    test('the format info is a valid BCH(15,5) codeword', function () {
      ['TAB-014', 'OTH-001', 'MIC-011'].forEach(function (id) {
        var format = readFormat(QR.encode(id).modules, 0);
        var remainder = format;
        for (var i = 4; i >= 0; i--) {
          if ((remainder >>> (i + 10)) & 1) remainder ^= 0x537 << i;
        }
        eq(remainder, 0, id + ': BCH remainder is zero');
      });
    });
  });

  suite('QR — round trip through a scanner-shaped decoder', function () {

    test('TAB-014 — a kit parent', function () { roundTrip('TAB-014'); });
    test('OTH-001 — a kit child', function () { roundTrip('OTH-001'); });
    test('HAR-003 — a standalone item', function () { roundTrip('HAR-003'); });
    test('MIC-011', function () { roundTrip('MIC-011'); });

    test('every seeded asset id encodes and decodes cleanly', function () {
      ['TAB-014', 'TAB-015', 'TAB-016', 'OTH-001', 'OTH-002', 'OTH-003',
       'HAR-003', 'KEY-002', 'DHO-007', 'MIC-011'].forEach(roundTrip);
    });

    test('a long id still round-trips (version 2)', function () {
      var qr = roundTrip('AMPLIFIER-000123-SPARE-CHANNEL-B');
      ok(qr.version >= 2, 'needed a bigger symbol');
    });

    test('a 16-character token round-trips, in case labels move to tokens later', function () {
      roundTrip('k7d92mfq1x0asb3e');
    });

    test('a single character', function () { roundTrip('X'); });

    test('non-ASCII is encoded as UTF-8', function () { roundTrip('Manjira — pair'); });
  });

  suite('QR — Reed-Solomon', function () {

    test('a known generator polynomial matches the standard', function () {
      // Degree 10 (used by version 1-M). Published coefficients as α exponents:
      // 0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45
      var gen = [1];
      for (var d = 0; d < 10; d++) {
        var next = new Array(gen.length + 1).fill(0);
        for (var i = 0; i < gen.length; i++) {
          next[i] ^= gen[i];
          next[i + 1] ^= I.gfMul(gen[i], I.EXP[d]);
        }
        gen = next;
      }
      eq(gen.map(function (v) { return I.LOG[v]; }),
         [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
    });

    test('the field wraps correctly at the primitive polynomial', function () {
      eq(I.EXP[8], 0x1D, 'alpha^8 reduces by 0x11D');
      eq(I.gfMul(0, 123), 0);
      eq(I.gfMul(1, 123), 123);
    });

    test('version 1-M produces 16 data and 10 EC codewords', function () {
      var qr = QR.encode('TAB-014');
      eq(qr.dataCodewords.length, 16);
      eq(qr.codewords.length, 26);
    });
  });

  suite('QR — SVG output', function () {

    test('renders an SVG sized to the module grid plus a quiet zone', function () {
      var svg = QR.toSvg('TAB-014');
      ok(svg.indexOf('viewBox="0 0 29 29"') !== -1, '21 modules + 4 quiet each side');
      ok(svg.indexOf('shape-rendering="crispEdges"') !== -1, 'no anti-aliased edges when printed');
    });

    test('is pure vector — no canvas, no raster, so it prints sharp at 25mm', function () {
      var svg = QR.toSvg('TAB-014');
      ok(svg.indexOf('<path') !== -1);
      ok(svg.indexOf('data:image') === -1);
    });

    test('refuses a payload too long for a label rather than emitting a broken code', function () {
      var tooLong = new Array(300).join('X');
      var threw = false;
      try { QR.encode(tooLong); } catch (e) { threw = true; }
      ok(threw, 'expected an error for an over-long payload');
    });
  });
};
