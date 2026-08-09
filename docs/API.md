# Instrument Tracker — Apps Script API contract

One Apps Script web app deployed as **Execute as: Me**, **Who has access: Anyone**. That is what
makes it reachable from GitHub Pages without a Google login. Access is gated by the shared code,
not by Google identity.

---

## The CORS rule — read this before touching any fetch call

Apps Script web apps **do not answer CORS preflight (`OPTIONS`) requests**. A browser sends a
preflight for any POST whose `Content-Type` is `application/json`. That preflight gets no valid
response, and the POST fails before it is ever sent — you see a CORS error in the console and
nothing at all in the Apps Script logs.

The fix is to keep every request inside the browser's definition of a **CORS simple request**,
which skips preflight entirely. `text/plain` is one of the three content types allowed there.

```js
// CORRECT — no preflight, works from GitHub Pages.
await fetch(CONFIG.API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(payload),   // still JSON — just not *labelled* as JSON
});
```

```js
// WRONG — triggers preflight, always fails. Do not "fix" the line above into this.
headers: { 'Content-Type': 'application/json' }
```

Server side:

```js
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);  // body is JSON despite the text/plain header
  ...
}
```

Also forbidden for the same reason: custom headers (`X-Access-Code`, `Authorization`, …). Any
custom header triggers preflight. **The access code travels in the JSON body, never in a header.**

This comment lives in `apps-script/Code.gs` and in `js/api.js` too, so nobody removes it from
just one place.

---

## Envelope

Every response, success or failure, is HTTP 200 with a JSON body. Apps Script cannot set status
codes on `ContentService` output, so status lives in the payload.

```jsonc
// success
{ "ok": true, "data": { ... }, "server_time": "2026-08-08T14:32:05+01:00" }

// failure
{ "ok": false, "error": { "code": "ITEM_CHECKED_OUT", "message": "OTH-001 (Hammer) is already checked out to East London — Bal Din." } }
```

`error.message` is written for a volunteer, not a developer — it goes straight onto the screen.

### Error codes

| Code | Meaning |
|---|---|
| `BAD_CODE` | Access code missing or wrong. Client clears the stored code and shows the unlock screen. |
| `BAD_REQUEST` | Malformed body or missing required field |
| `NOT_FOUND` | Unknown asset_id / event_id / qr_token |
| `ITEM_CHECKED_OUT` | Action needs the item to be in, and it is out |
| `ITEM_NOT_OUT` | Check-in attempted on an item with no open movement |
| `PARENT_OUT` | Child check-out blocked because its parent is out (rule K5) |
| `KIT_CHILD_OUT` | Parent check-out blocked by a child already out alone (rule K3) |
| `NOT_AVAILABLE` | The item is not free for the requested dates. Carries a `conflicts` array saying why. |
| `ITEM_INACTIVE` | Item has been removed from inventory |
| `DUPLICATE_ASSET_ID` | Asset ID already in use |
| `SERVER_ERROR` | Anything unexpected; the real stack goes to the Apps Script log, not to the user |

---

## Authentication

One shared code for everyone. No accounts, no roles, no per-user anything.

- Stored server-side in **Script Properties** under `ACCESS_CODE` — deliberately *not* in the
  Sheet, so sharing the Sheet with someone does not hand them the code.
- Stored client-side in `localStorage`. Entered once per device.
- Sent as `code` on **every** request, GET and POST.
- Compared with a constant-time comparison so the code cannot be guessed a character at a time.
- Changing it in Settings requires typing the current code, and immediately invalidates every
  other device (they get `BAD_CODE` and are asked to re-enter).

This is a shed lock, not a bank vault, and it is proportionate to a trusted-group tool. What it
is *not* is a substitute for keeping the Sheet itself private.

---

## Reads — `doGet(e)`

`GET {API_URL}?action=<name>&code=<access_code>&<params>`

### `action=ping`
Validates the code. `data: { ok: true, version: "1.0.0" }`. Used by the unlock screen.

### `action=bootstrap`
The one call the app makes on load. At this scale (hundreds of items, thousands of movements)
this is a single ~100 KB response and it keeps the whole frontend synchronous and simple.

```jsonc
{
  "ok": true,
  "data": {
    "today": "2026-08-08",                  // London-local; the client trusts this, not the device clock
    "centres":        [{ "id": "C-001", "name": "East London", "active": true }],
    "instrumentTypes":[{ "id": "IT-001", "name": "Tabla", "prefix": "TAB", "active": true }],
    "qualityGrades":  [{ "id": "QG-001", "name": "Aradhana", "rank": 1, "active": true }],
    "events": [
      { "event_id": "EV-001", "name": "Paris Mandir Mahotsav", "parent_event_id": "",
        "start_date": "2026-08-10", "end_date": "2026-08-16",
        "location": "Paris", "centre": "", "status": "active",
        "children": ["EV-002", "EV-003"] }   // server-computed convenience
    ],
    "items": [
      { "asset_id": "TAB-014", "name": "Tabla Set A", "instrument_type": "Tabla",
        "quality_grade": "Aradhana", "parent_asset_id": "", "is_kit": true,
        "status": "checked_out", "current_condition": "good",
        "storage_location": "Store Room 2, Shelf B", "notes": "", "photo_url": "",
        "active": true, "qr_token": "k7d92mfq1x0asb3e",
        "children": ["TAB-015", "TAB-016", "OTH-001", "OTH-002", "OTH-003"],

        // --- server-computed live state, present only when the item is out ---
        "live": {
          "movement_id": "MV-000456",
          "event_id": "EV-001", "event_name": "Paris Mandir Mahotsav",
          "sub_event_id": "EV-003", "sub_event_name": "Nagar Yatra",
          "centre": "East London",
          "expected_return_date": "2026-08-12",
          "days_overdue": 3,                 // 0 when not overdue
          "via_parent_asset_id": "",         // set on children out via a parent
          "checked_out_by": "Nilesh"
        }
      }
    ],
    "openAllocations": [ /* Allocations rows with status=open */ ],
    "openMovements":   [ /* Movements rows with blank checked_in_at */ ]
  }
}
```

`live` is the whole reason the dashboard, the overdue table and the "Out — via TAB-014" label
need no client-side joining. Computed fresh on every bootstrap, stored nowhere.

### `action=item&asset_id=TAB-014`
Full detail for one item: the item object above, plus `movements` — its complete history newest
first, each row enriched with `event_name` / `sub_event_name` — plus `children` expanded to full
item objects with their own `live` state.

### `action=resolve&q=TAB-014`
Scan lookup. `q` is whatever the QR contained or the volunteer typed. The QR encodes the
**asset_id in plain text**, so in practice `q` is an asset_id — but resolve also accepts a
`qr_token`, and matches case-insensitively with surrounding whitespace trimmed, because typed
input is typed by a human on a phone. Returns `{ asset_id, name, status, live }` or `NOT_FOUND`.
Kept separate and tiny so the scanner feels instant.

### `action=event&event_id=EV-001`
Everything allocated to this event *and its sub-events*, with per-sub-event `out` / `returned` /
`overdue` counts, for the event page and its bulk check-in button.

---

## Writes — `doPost(e)`

Body is JSON, sent as `text/plain;charset=utf-8` (see the CORS section):

```jsonc
{ "action": "checkout", "code": "…", "payload": { … } }
```

Every write is wrapped in `LockService.getScriptLock()` with a short timeout. That is not the
"write-locking" the brief rules out — there is no user-facing locking, no claiming, no
"someone else is editing". It is a few milliseconds inside the script so two simultaneous
check-outs cannot both take row 51.

### `checkout`

Batch. The scan screen queues several items and submits once against one event context.

```jsonc
{
  "asset_ids": ["TAB-014", "HAR-003"],
  "event_id": "EV-003",                  // leaf; server derives the top-level parent
  "centre": "East London",               // optional; falls back to the event's centre
  "expected_return_date": "2026-08-12",
  "checked_out_by": "Nilesh",
  "condition_out": "good",               // optional; defaults to each item's current_condition
  "allow_partial": false                 // rule K3 escape hatch
}
```

Response:

```jsonc
{ "ok": true, "data": {
    "checked_out": ["TAB-014", "TAB-015", "TAB-016", "OTH-002", "OTH-003", "HAR-003"],
    "warnings": [{ "asset_id": "OTH-001", "reason": "In maintenance — not included." }],
    "movement_ids": ["MV-000456", "…"]
}}
```

Kit expansion happens **server-side**. The client posts the parent and gets the whole set back —
so a stale client can never produce a half-checked-out kit.

### `checkin`

```jsonc
{
  "checked_in_by": "Nilesh",
  "items": [
    { "asset_id": "TAB-014",   "condition_in": "good" },
    { "asset_id": "OTH-001", "missing": true },
    { "asset_id": "TAB-016", "condition_in": "needs_repair", "damage_notes": "Skin split" }
  ]
}
```

Posting only the parent auto-expands to every child out via that parent (rule K6), each defaulting
to `condition_in: "good"`. Listing a child explicitly overrides its default — that is how the
"hammer not returned" screen works. Response mirrors `checkout`, plus `outcomes` per item.

### `allocate`

```jsonc
{ "asset_ids": ["TAB-014", "HAR-003"], "event_id": "EV-003",
  "centre": "East London",              // optional — falls back to the event's centre
  "needed_from": "2026-08-10",          // optional — falls back to the event's start_date, then today
  "expected_return_date": "2026-08-12",
  "allocated_by": "Nilesh",             // the person responsible for getting them back
  "notes": "Requested by email 6 Aug" }
```

Writes one Allocations row per item, `status = open`. Allocating a kit parent allocates the whole
kit; a piece that is spoken for over those dates is left behind with a warning naming it.

Refused with `NOT_AVAILABLE` if any chosen item's window overlaps an existing booking. The error
carries the clashes:

```jsonc
{ "ok": false, "error": {
    "code": "NOT_AVAILABLE",
    "message": "HAR-003 (Harmonium) is not free (11 Aug – 13 Aug): Allocated to Bal Din (10 Aug – 12 Aug).",
    "conflicts": [{
      "kind": "allocation", "allocation_id": "AL-000001",
      "from": "2026-08-10", "to": "2026-08-12",
      "event_id": "EV-002", "event_name": "Bal Din", "centre": "East London",
      "reason": "Allocated to Bal Din (10 Aug – 12 Aug)"
    }]
}}
```

`kind` is `allocation`, `checked_out` or `status`. See "Availability is a question about dates"
in `docs/SCHEMA.md` for the full rules.

### `checkAvailability`

"Is this free between these dates?" for many items at once. A read-shaped question that goes
through `doPost` because the item list can be longer than a query string comfortably holds.

```jsonc
{ "asset_ids": ["HAR-003", "KEY-002"],   // omit to ask about every active item
  "needed_from": "2026-08-11", "expected_return_date": "2026-08-11",
  "ignore_allocation_ids": []            // exclude an allocation being edited from clashing with itself
}
```

```jsonc
{ "ok": true, "data": { "needed_from": "2026-08-11", "expected_return_date": "2026-08-11",
    "availability": {
      "HAR-003": { "available": false, "conflicts": [ … ] },
      "KEY-002": { "available": true,  "conflicts": [] }
}}}
```

The Allocate screen does **not** normally call this — it runs the same rules in the browser for
instant feedback. This endpoint exists for anything that cannot.

### `saveItem`

Create **or** update — presence of `original_asset_id` means update. Kit children are sent in the
same call, so one screen is one round trip.

```jsonc
{
  "original_asset_id": "TAB-014",        // omit to create
  "asset_id": "TAB-014", "name": "Tabla Set A", "instrument_type": "Tabla",
  "quality_grade": "Aradhana", "storage_location": "Store Room 2, Shelf B",
  "notes": "", "is_kit": true, "current_condition": "good",
  // photo_url is not sent by the UI (no photo field) but is preserved if already present
  "children": [
    { "asset_id": "TAB-015", "name": "Dayyu",  "instrument_type": "Tabla" },
    { "asset_id": "OTH-001", "name": "Hammer", "instrument_type": "Other", "_delete": true }
  ]
}
```

The server generates `qr_token` for any row that lacks one and returns every saved row with its
token, so the label preview can render immediately. A child marked `_delete` is deactivated, not
removed.

### `removeItem`
`{ "asset_id": "TAB-014", "confirm": true }` → sets `active = FALSE`, cascades to children
(K10). Refused with `ITEM_CHECKED_OUT` if anything in the set is out.

### `suggestAssetId`
`{ "instrument_type": "Tabla" }` → `{ "asset_id": "TAB-015" }`. Next free number for that
prefix, scanning active *and* inactive rows so a retired ID is never reused.

### `saveEvent`
Create or update an event. Refuses to give an event a `parent_event_id` that itself has a parent
— one level of nesting, enforced at the door.

### `bulkCheckinEvent`
`{ "event_id": "EV-001", "checked_in_by": "Nilesh", "include_sub_events": true }` → checks in
everything still out for that event and its sub-events, defaulting each to `good`. Response lists
what was checked in so the screen can show it.

### `saveSettings`
Manages the reference lists and the access code in one call.

```jsonc
{
  "centres":         [{ "id": "C-001", "name": "East London", "active": true }],
  "instrumentTypes": [{ "id": "IT-001", "name": "Tabla", "prefix": "TAB", "active": true }],
  "qualityGrades":   [{ "id": "QG-001", "name": "Aradhana", "rank": 1, "active": true }],
  "new_access_code": "…"                 // optional; `code` above must be the current one
}
```

Renaming a reference value rewrites the matching text in Items / Events / Allocations /
Movements in the same locked transaction, so history stays readable. Reference rows are
deactivated, never deleted, for the same reason.

---

## Tests

`tests/` runs in plain Node with no dependencies (`node tests/run.js`). The kit and overdue logic
is extracted into `apps-script/lib/rules.js`, a pure module with no `SpreadsheetApp` in it, which
both the Apps Script bundle and the test runner load. That is the only reason this logic is
testable at all — and it is the logic most likely to be got wrong.

Covered: K1–K10 above, plus overdue at the boundary (due today is **not** overdue; due yesterday
is 1 day late), across a London BST/GMT change.
