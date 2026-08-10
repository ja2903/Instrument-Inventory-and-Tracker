/**
 * Instrument Tracker — shared UI pieces.
 *
 * Small, boring helpers: escaping, dates, status pills, toasts, dialogs.
 * Screens build HTML strings and hand them to these.
 *
 * Status colour is ALWAYS paired with a word. Around 1 in 12 men has some
 * degree of colour blindness, and a store cupboard is badly lit anyway.
 */

var UI = (function () {
  'use strict';

  /* ---------------- text ----------------------------------------- */

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-08-12' → '12 Aug'. String work only — no Date, no timezone. */
  function dayMonth(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : '';
  }

  /** '2026-08-12' → '12 Aug 2026'. */
  function fullDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }

  /** '2026-08-08T14:32:05+01:00' → '8 Aug, 2:32pm'. */
  function timestamp(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || '').trim());
    if (!m) return '';
    var hour = Number(m[4]);
    var suffix = hour >= 12 ? 'pm' : 'am';
    var display = hour % 12 === 0 ? 12 : hour % 12;
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ', ' + display + ':' + m[5] + suffix;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function daysLate(n) {
    return n === 1 ? '1 day overdue' : n + ' days overdue';
  }

  /** Today, as the server sees it. Falls back to the device clock pre-bootstrap. */
  function today() {
    if (window.App && App.data && App.data.today) return App.data.today;
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------------- status ---------------------------------------- */

  var STATUS = {
    available:   { label: 'Available',   cls: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20', dot: 'bg-emerald-500', icon: '✓' },
    checked_out: { label: 'Out', cls: 'bg-blue-50 text-blue-800 ring-blue-600/20',          dot: 'bg-blue-500',    icon: '→' },
    overdue:     { label: 'Overdue',     cls: 'bg-red-50 text-red-800 ring-red-600/25',             dot: 'bg-red-500',     icon: '!' },
    maintenance: { label: 'Maintenance', cls: 'bg-stone-100 text-stone-700 ring-stone-500/20',      dot: 'bg-stone-400',   icon: '⚒' },
    lost:        { label: 'Lost',        cls: 'bg-rose-100 text-rose-900 ring-rose-700/25',         dot: 'bg-rose-700',    icon: '?' },
    removed:     { label: 'Removed',     cls: 'bg-stone-100 text-stone-500 ring-stone-400/20',      dot: 'bg-stone-300',   icon: '−' }
  };

  /** The key an item should be shown under — overdue outranks checked out. */
  function statusKey(item) {
    if (!item.active) return 'removed';
    if (item.status === 'checked_out' && item.live && item.live.days_overdue > 0) return 'overdue';
    return item.status || 'available';
  }

  function statusPill(item, extraClass) {
    var key = statusKey(item);
    var s = STATUS[key] || STATUS.available;
    var text = s.label;
    if (key === 'overdue') text = daysLate(item.live.days_overdue);
    return '<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ' +
      'text-xs font-semibold ring-1 ring-inset ' + s.cls + ' ' + (extraClass || '') + '">' +
      '<span class="h-1.5 w-1.5 rounded-full ' + s.dot + '" aria-hidden="true"></span>' +
      esc(text) + '</span>';
  }

  function statusLabel(key) { return (STATUS[key] || STATUS.available).label; }

  var CONDITIONS = {
    excellent: 'Excellent', good: 'Good', fair: 'Fair', needs_repair: 'Needs repair'
  };

  function conditionLabel(value) { return CONDITIONS[value] || value || '—'; }

  /**
   * The plain-English line from the brief, e.g.
   * "Checked out to East London — Paris Mandir Mahotsav / Nagar Yatra — due 12 Aug — 3 days overdue"
   */
  function describe(item) {
    if (!item.active) return 'Removed from inventory';
    if (item.status === 'maintenance') return 'In maintenance';
    if (item.status === 'lost') return 'Marked lost';
    if (item.status !== 'checked_out' || !item.live) return 'Available';

    var live = item.live;
    var head = live.via_parent_asset_id
      ? 'Out — via ' + live.via_parent_asset_id +
        (live.via_parent_name ? ' (' + live.via_parent_name + ')' : '')
      : 'Out';
    if (live.centre) head += ' with ' + live.centre;

    var parts = [head];
    var ev = [];
    if (live.event_name) ev.push(live.event_name);
    if (live.sub_event_name) ev.push(live.sub_event_name);
    if (ev.length) parts.push(ev.join(' / '));
    if (live.expected_return_date) parts.push('due ' + dayMonth(live.expected_return_date));
    if (live.days_overdue > 0) parts.push(daysLate(live.days_overdue));

    return parts.join(' — ');
  }

  /* ---------------- photos ----------------------------------------- */

  /**
   * Shrinks a photo before it ever leaves the phone.
   *
   * A modern phone camera produces 3–8 MB per shot. Apps Script will not
   * accept that in a POST body, and a volunteer on mandir wifi should not be
   * uploading it anyway. 1280px on the long edge at JPEG 0.7 lands around
   * 150–300 KB, which is far more detail than is needed to show a split skin.
   */
  function shrinkImage(file, maxEdge, quality) {
    maxEdge = maxEdge || 1280;
    quality = quality || 0.7;

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That photo could not be read.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not an image.')); };
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);

          var ctx = canvas.getContext('2d');
          // White behind, so a PNG with transparency does not become black.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** Rough size of a data URL, for showing progress honestly. */
  function dataUrlKb(dataUrl) {
    var base64 = String(dataUrl).split(',')[1] || '';
    return Math.round(base64.length * 3 / 4 / 1024);
  }

  /* ---------------- building blocks -------------------------------- */

  function card(inner, extraClass) {
    return '<div class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-900/5 ' +
           (extraClass || '') + '">' + inner + '</div>';
  }

  function pageTitle(title, subtitle, actionsHtml) {
    return '<div class="mb-5 flex flex-wrap items-start justify-between gap-3">' +
      '<div><h1 class="text-2xl font-bold tracking-tight text-stone-900">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="mt-1 text-sm text-stone-500">' + esc(subtitle) + '</p>' : '') +
      '</div>' + (actionsHtml ? '<div class="flex gap-2">' + actionsHtml + '</div>' : '') +
      '</div>';
  }

  function emptyState(icon, title, message, actionHtml) {
    return '<div class="rounded-2xl border-2 border-dashed border-stone-200 px-6 py-14 text-center">' +
      '<div class="text-4xl" aria-hidden="true">' + icon + '</div>' +
      '<h3 class="mt-3 text-base font-semibold text-stone-800">' + esc(title) + '</h3>' +
      '<p class="mx-auto mt-1 max-w-sm text-sm text-stone-500">' + esc(message) + '</p>' +
      (actionHtml ? '<div class="mt-5">' + actionHtml + '</div>' : '') +
      '</div>';
  }

  function spinner(message) {
    return '<div class="flex flex-col items-center justify-center gap-3 py-20 text-stone-500">' +
      '<div class="h-8 w-8 animate-spin rounded-full border-[3px] border-stone-200 border-t-saffron-500"></div>' +
      '<p class="text-sm">' + esc(message || 'Loading…') + '</p></div>';
  }

  function errorPanel(title, message, retryHtml) {
    return '<div class="rounded-2xl bg-red-50 p-5 ring-1 ring-red-600/15">' +
      '<h3 class="flex items-center gap-2 text-base font-semibold text-red-900">' +
      '<span aria-hidden="true">⚠</span>' + esc(title) + '</h3>' +
      '<p class="mt-1.5 text-sm text-red-800">' + esc(message) + '</p>' +
      (retryHtml ? '<div class="mt-4">' + retryHtml + '</div>' : '') + '</div>';
  }

  /** Warnings from a kit operation — "5 of 6 went out, the hammer is in maintenance". */
  function warningList(warnings) {
    if (!warnings || !warnings.length) return '';
    return '<div class="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20">' +
      '<p class="text-sm font-semibold text-amber-900">Not everything was included</p>' +
      '<ul class="mt-2 space-y-1 text-sm text-amber-900">' +
      warnings.map(function (w) {
        return '<li class="flex gap-2"><span aria-hidden="true">•</span><span>' +
          '<span class="font-medium">' + esc(w.asset_id) + '</span> ' +
          esc(w.name || '') + ' — ' + esc(w.reason) + '</span></li>';
      }).join('') + '</ul></div>';
  }

  /* ---------------- form controls ---------------------------------- */

  function field(label, inner, hint) {
    return '<label class="block">' +
      '<span class="mb-1.5 block text-sm font-medium text-stone-700">' + esc(label) + '</span>' +
      inner +
      (hint ? '<span class="mt-1 block text-xs text-stone-500">' + esc(hint) + '</span>' : '') +
      '</label>';
  }

  var INPUT_CLASS =
    'w-full rounded-xl border-0 bg-white px-3.5 py-3 text-base text-stone-900 shadow-sm ' +
    'ring-1 ring-inset ring-stone-300 placeholder:text-stone-400 ' +
    'focus:ring-2 focus:ring-inset focus:ring-saffron-500 focus:outline-none';

  function input(name, value, opts) {
    opts = opts || {};
    return '<input type="' + (opts.type || 'text') + '" name="' + esc(name) + '" ' +
      'id="' + esc(opts.id || name) + '" ' +
      'value="' + esc(value || '') + '" ' +
      (opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '" ' : '') +
      (opts.required ? 'required ' : '') +
      (opts.min ? 'min="' + esc(opts.min) + '" ' : '') +
      (opts.autocomplete ? 'autocomplete="' + esc(opts.autocomplete) + '" ' : '') +
      (opts.attrs ? opts.attrs + ' ' : '') +
      'class="' + INPUT_CLASS + ' ' + (opts.class || '') + '">';
  }

  function textarea(name, value, opts) {
    opts = opts || {};
    return '<textarea name="' + esc(name) + '" id="' + esc(opts.id || name) + '" rows="' +
      (opts.rows || 3) + '" ' +
      (opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '" ' : '') +
      'class="' + INPUT_CLASS + '">' + esc(value || '') + '</textarea>';
  }

  /** options: [{value, label, disabled}] or plain strings. */
  function select(name, options, value, opts) {
    opts = opts || {};
    var html = '<select name="' + esc(name) + '" id="' + esc(opts.id || name) + '" ' +
      (opts.required ? 'required ' : '') +
      (opts.attrs ? opts.attrs + ' ' : '') +
      'class="' + INPUT_CLASS + ' appearance-none bg-[length:1.25rem] bg-[right_0.75rem_center] ' +
      'bg-no-repeat pr-10 ' + (opts.class || '') + '" ' +
      'style="background-image:url(\'data:image/svg+xml;utf8,' +
      '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 ' +
      'stroke-width=%222%22 stroke=%22%2378716c%22%3E%3Cpath stroke-linecap=%22round%22 ' +
      'stroke-linejoin=%22round%22 d=%22m19.5 8.25-7.5 7.5-7.5-7.5%22/%3E%3C/svg%3E\')">';

    if (opts.placeholder) {
      html += '<option value=""' + (value ? '' : ' selected') + '>' + esc(opts.placeholder) + '</option>';
    }
    options.forEach(function (o) {
      var val = typeof o === 'string' ? o : o.value;
      var label = typeof o === 'string' ? o : o.label;
      html += '<option value="' + esc(val) + '"' +
        (String(val) === String(value) ? ' selected' : '') +
        (o.disabled ? ' disabled' : '') + '>' + esc(label) + '</option>';
    });
    return html + '</select>';
  }

  function checkbox(name, label, checked, opts) {
    opts = opts || {};
    return '<label class="flex cursor-pointer items-center gap-3 py-1">' +
      '<input type="checkbox" name="' + esc(name) + '" id="' + esc(opts.id || name) + '" ' +
      (checked ? 'checked ' : '') +
      'class="h-5 w-5 rounded border-stone-300 text-saffron-600 focus:ring-saffron-500">' +
      '<span class="text-sm text-stone-700">' + esc(label) + '</span></label>';
  }

  var BTN = {
    primary: 'inline-flex items-center justify-center gap-2 rounded-xl bg-saffron-600 px-5 py-3 ' +
             'text-base font-semibold text-white shadow-sm transition hover:bg-saffron-700 ' +
             'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
             'focus-visible:outline-saffron-600 disabled:opacity-50 disabled:pointer-events-none',
    secondary: 'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 ' +
               'text-base font-semibold text-stone-700 shadow-sm ring-1 ring-inset ring-stone-300 ' +
               'transition hover:bg-stone-50 disabled:opacity-50 disabled:pointer-events-none',
    danger: 'inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 ' +
            'text-base font-semibold text-white shadow-sm transition hover:bg-red-700 ' +
            'disabled:opacity-50 disabled:pointer-events-none',
    quiet: 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm ' +
           'font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900'
  };

  function button(label, opts) {
    opts = opts || {};
    var cls = BTN[opts.variant || 'primary'] + ' ' + (opts.class || '');
    if (opts.href) {
      return '<a href="' + esc(opts.href) + '" class="' + cls + '">' + label + '</a>';
    }
    return '<button type="' + (opts.type || 'button') + '"' +
      (opts.action ? ' data-action="' + esc(opts.action) + '"' : '') +
      (opts.value ? ' data-value="' + esc(opts.value) + '"' : '') +
      (opts.id ? ' id="' + esc(opts.id) + '"' : '') +
      (opts.disabled ? ' disabled' : '') +
      ' class="' + cls + '">' + label + '</button>';
  }

  /* ---------------- toasts ----------------------------------------- */

  function toast(message, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;

    var palette = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-red-600 text-white',
      info: 'bg-stone-800 text-white'
    }[kind || 'info'];

    var node = document.createElement('div');
    node.className = 'pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 ' +
      'shadow-lg ring-1 ring-black/5 ' + palette + ' animate-slide-up';
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.innerHTML = '<span class="mt-0.5 shrink-0" aria-hidden="true">' +
      (kind === 'error' ? '⚠' : kind === 'success' ? '✓' : 'ℹ') + '</span>' +
      '<span class="text-sm font-medium">' + esc(message) + '</span>';

    host.appendChild(node);
    // Errors linger — a volunteer may be holding an instrument in the other hand.
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(function () { node.remove(); }, 250);
    }, kind === 'error' ? 7000 : 3500);
  }

  /* ---------------- dialogs ---------------------------------------- */

  var dialogResolve = null;

  /**
   * A promise-returning dialog. Resolves with { value, fields }:
   *   value  — the value of whatever button was pressed, or null if dismissed
   *   fields — the current contents of any input carrying data-dialog-field,
   *            read BEFORE the dialog is removed from the page
   *
   * That second part matters: a dialog that asks for a name is useless if the
   * name is gone by the time the promise resolves.
   */
  function dialog(opts) {
    var host = document.getElementById('dialog-host');
    var buttons = (opts.buttons || [{ label: 'OK', value: true, variant: 'primary' }]);

    host.innerHTML =
      '<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-0 ' +
      'backdrop-blur-[2px] sm:items-center sm:p-4" data-dialog-backdrop>' +
        '<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" ' +
        'class="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">' +
          '<h2 id="dialog-title" class="text-lg font-semibold text-stone-900">' +
            esc(opts.title) + '</h2>' +
          (opts.message
            ? '<p class="mt-2 text-sm leading-relaxed text-stone-600">' + esc(opts.message) + '</p>'
            : '') +
          (opts.html || '') +
          '<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">' +
            buttons.map(function (b) {
              return button(esc(b.label), {
                variant: b.variant || 'secondary',
                action: 'dialog-choice',
                value: String(b.value)
              });
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';

    host.querySelector('[data-dialog-backdrop]').addEventListener('click', function (e) {
      if (e.target === this) closeDialog(null);
    });
    host.querySelectorAll('[data-action="dialog-choice"]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeDialog(btn.dataset.value); });
    });

    // Let the caller wire up live behaviour inside the dialog — linked date
    // pickers, for instance — before anyone can interact with it.
    if (typeof opts.onOpen === 'function') opts.onOpen(host);

    var autofocus = host.querySelector('[autofocus]');
    (autofocus || host.querySelector('button')).focus();

    return new Promise(function (resolve) { dialogResolve = resolve; });
  }

  function closeDialog(value) {
    var host = document.getElementById('dialog-host');

    // Read the fields out first — the nodes are about to be destroyed.
    var fields = {};
    host.querySelectorAll('[data-dialog-field]').forEach(function (el) {
      fields[el.dataset.dialogField] =
        el.type === 'checkbox' ? el.checked : el.value;
    });

    host.innerHTML = '';
    if (dialogResolve) { dialogResolve({ value: value, fields: fields }); dialogResolve = null; }
  }

  /** Yes/no confirmation. Destructive actions get the red button. */
  function confirm(title, message, confirmLabel, destructive) {
    return dialog({
      title: title,
      message: message,
      buttons: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: confirmLabel || 'Confirm', value: 'ok', variant: destructive ? 'danger' : 'primary' }
      ]
    }).then(function (r) { return r.value === 'ok'; });
  }

  /* ---------------- misc ------------------------------------------- */

  /** Puts a button into a "saving…" state and returns a function to restore it. */
  function busy(button, label) {
    if (!button) return function () {};
    var original = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      '<span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>' +
      esc(label || 'Saving…');
    return function () { button.disabled = false; button.innerHTML = original; };
  }

  function scrollTop() { window.scrollTo({ top: 0, behavior: 'auto' }); }

  return {
    shrinkImage: shrinkImage, dataUrlKb: dataUrlKb,
    esc: esc, dayMonth: dayMonth, fullDate: fullDate, timestamp: timestamp,
    plural: plural, daysLate: daysLate, today: today,
    STATUS: STATUS, statusKey: statusKey, statusPill: statusPill, statusLabel: statusLabel,
    conditionLabel: conditionLabel, CONDITIONS: CONDITIONS, describe: describe,
    card: card, pageTitle: pageTitle, emptyState: emptyState, spinner: spinner,
    errorPanel: errorPanel, warningList: warningList,
    field: field, input: input, textarea: textarea, select: select, checkbox: checkbox,
    button: button, BTN: BTN, INPUT_CLASS: INPUT_CLASS,
    toast: toast, dialog: dialog, closeDialog: closeDialog, confirm: confirm,
    busy: busy, scrollTop: scrollTop
  };
})();
