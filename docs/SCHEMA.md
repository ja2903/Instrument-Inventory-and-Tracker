# Instrument Tracker — Google Sheet schema

One Google Sheet is the whole database. Each tab below is a table. **Row 1 is always the
header row** and the Apps Script reads column positions by header name, not by index — so a
human can reorder or add columns in the Sheet without breaking the app.

Conventions used everywhere:

| Rule | Detail |
|---|---|
| Dates | Stored as plain text `YYYY-MM-DD` (no time). Never a Sheets Date object — avoids timezone drift. |
| Timestamps | ISO 8601 with offset, e.g. `2026-08-08T14:32:05+01:00`. Written by the server, never the client. |
| Booleans | Literal text `TRUE` / `FALSE`. |
| Blank | Empty cell means "not set". Never `null`, never `"-"`. |
| Primary key | `asset_id` for items, `event_id` for events, etc. Server generates ids; client never invents one. |
| Timezone | Europe/London, set on the Script project. "Today" for overdue is London-local. |
| Deletes | Nothing is ever deleted. `active = FALSE` is the soft delete. |

---

## Tab: `Centres`

| Column | Type | Notes |
|---|---|---|
| `id` | text | `C-001`, `C-002`… server-generated |
| `name` | text | Display name, must be unique among active rows |
| `active` | TRUE/FALSE | Inactive centres disappear from dropdowns but stay readable in history |

**Seed:** East London, Ruislip, Central London, Blank 1, Blank 2, Blank 3
*(the three "Blank" rows are placeholders the karyakar renames in Settings)*

---

## Tab: `InstrumentTypes`

| Column | Type | Notes |
|---|---|---|
| `id` | text | `IT-001`… |
| `name` | text | Display name |
| `prefix` | text | 3-letter asset-ID prefix, e.g. `TAB`. Unique. Used to auto-suggest asset IDs. |
| `active` | TRUE/FALSE | |

**Seed:**

| name | prefix |
|---|---|
| Tabla | TAB |
| Harmonium | HAR |
| Keyboard | KEY |
| Dholak | DHO |
| Manjira | MAN |
| Kartal | KAR |
| Jhanjh | JHA |
| Violin | VIO |
| Sitar | SIT |
| Amplifier | AMP |
| Microphone | MIC |
| Cables | CAB |
| Other | OTH |

> `prefix` is an addition to the spec's `id, name`. It is what makes "asset ID auto-suggested,
> editable" on the Add-instrument screen work without hardcoding a lookup table in the JS.

---

## Tab: `QualityGrades`

| Column | Type | Notes |
|---|---|---|
| `id` | text | `QG-001`… |
| `name` | text | |
| `rank` | number | 1 = best. Used for sorting only. |
| `active` | TRUE/FALSE | |

**Seed:** Aradhana (1), Normal Sabha (2), Practice Use (3)

---

## Tab: `Items`

The core table. One row per physical thing that carries a QR label — including every kit child.

| Column | Type | Notes |
|---|---|---|
| `asset_id` | text | **Primary key.** Human-readable, printed under the QR, **and the exact string the QR encodes**. e.g. `TAB-014`. Unique across the whole tab, including inactive rows. |
| `qr_token` | text | Opaque 16-char random string, generated for every item. **Not currently used by the QR code** — see "QR contents" below. Kept because the spec calls for it and because it is the migration path if labels ever need to stop being forgeable. |
| `name` | text | e.g. `Tabla Set A`, `Tabla Set A — Hammer` |
| `instrument_type` | text | Must match an `InstrumentTypes.name` |
| `quality_grade` | text | Must match a `QualityGrades.name` |
| `parent_asset_id` | text | Blank for top-level items. Set to the parent's `asset_id` for kit children. |
| `is_kit` | TRUE/FALSE | TRUE only on parent rows |
| `status` | enum | `available` \| `checked_out` \| `maintenance` \| `lost` |
| `current_condition` | enum | `excellent` \| `good` \| `fair` \| `needs_repair` |
| `storage_location` | text | Free text, e.g. `Store Room 2, Shelf B` |
| `notes` | text | Free text |
| `photo_url` | text | **Not surfaced in the UI.** Column exists so photos can be added later without a schema migration; every read/write carries it through untouched. |
| `active` | TRUE/FALSE | FALSE = removed from inventory; drops out of the default list, stays in history |

### QR contents

**The QR encodes the `asset_id` as plain text — nothing else.** `TAB-014`, not a URL and not a token.

- Nothing to break. No hosting URL baked into a sticker, so moving the app or renaming the repo
  never invalidates a single printed label.
- If a QR is scratched or a sticker is peeling, the same string is printed underneath in large
  text — a volunteer types six characters and carries on. The scan screen's manual-entry box is
  the same code path as the scanner.
- The trade-off, stated plainly: **labels are forgeable and guessable.** Anyone can print a
  `TAB-014` QR. For a trusted-group store cupboard that is not a threat worth engineering
  against, and the shared access code is still what gates the app.
- `resolve` accepts *either* an asset_id or a qr_token, so switching to opaque tokens later is a
  label reprint and a one-line change in the label generator — not a rewrite.

### Asset IDs for kit children

**Children get their own type-sequence ID.** Set membership is carried by `parent_asset_id`, not
by the shape of the string.

| asset_id | name | instrument_type | parent_asset_id |
|---|---|---|---|
| `TAB-014` | Tabla Set A | Tabla | — *(is_kit)* |
| `TAB-015` | Tabla Set A — Dayyu | Tabla | `TAB-014` |
| `TAB-016` | Tabla Set A — Bayyu | Tabla | `TAB-014` |
| `OTH-001` | Tabla Set A — Hammer | Other | `TAB-014` |
| `OTH-002` | Tabla Set A — Powder Bottle | Other | `TAB-014` |
| `OTH-003` | Tabla Set A — Bag | Other | `TAB-014` |

Because `OTH-001` no longer says "hammer belongs to TAB-014" on its face, **every child label
prints a set line** so a loose part found on a floor is still traceable:

```
  [QR: OTH-001]
  OTH-001
  Tabla Set A — Hammer
  Part of: Tabla Set A (TAB-014)
  Property of BAPS London Mandir
```

This keeps the practical benefit of parent-derived IDs while leaving children free to be moved
between kits — reparenting is then an edit to one cell, with no reprinting and no ID that lies.

### Rules the server enforces on this tab

1. A row with `parent_asset_id` set must **not** have `is_kit = TRUE`. Nesting is one level deep only.
2. `parent_asset_id` must point at an existing row with `is_kit = TRUE`.
3. `status` is owned by the server. The client never writes it directly — it changes only as a
   side effect of check-out, check-in, or an explicit "mark for maintenance" action.
4. Removing (deactivating) a parent deactivates all its children.
5. An item that is `checked_out` cannot be deactivated — check it in first. (Clear error, not a silent no-op.)

### Sample data seeded by the setup script (10 items)

| asset_id | name | type | kit? | parent |
|---|---|---|---|---|
| `TAB-014` | Tabla Set A | Tabla | TRUE | — |
| `TAB-015` | Tabla Set A — Dayyu | Tabla | | `TAB-014` |
| `TAB-016` | Tabla Set A — Bayyu | Tabla | | `TAB-014` |
| `OTH-001` | Tabla Set A — Hammer | Other | | `TAB-014` |
| `OTH-002` | Tabla Set A — Powder Bottle | Other | | `TAB-014` |
| `OTH-003` | Tabla Set A — Bag | Other | | `TAB-014` |
| `HAR-003` | Harmonium (Bina, 3.5 octave) | Harmonium | | — |
| `KEY-002` | Yamaha PSR-E373 | Keyboard | | — |
| `DHO-007` | Dholak — brass shell | Dholak | | — |
| `MIC-011` | Shure SM58 | Microphone | | — |

That is 10 rows: one full 6-piece tabla kit (parent + 5 children) plus 4 standalone items.

---

## Tab: `Events`

| Column | Type | Notes |
|---|---|---|
| `event_id` | text | `EV-001`… |
| `name` | text | |
| `parent_event_id` | text | Blank for a top-level event; otherwise the parent's `event_id` |
| `start_date` | date | `YYYY-MM-DD` |
| `end_date` | date | `YYYY-MM-DD` |
| `location` | text | |
| `centre` | text | Matches `Centres.name`, or blank |
| `status` | enum | `planned` \| `active` \| `completed` \| `cancelled` |

The data is recursive (an event points at a parent), but **the UI only ever renders one level** —
a top-level event expanding to its sub-events. If someone hand-edits the Sheet to nest three
deep, the API flattens grandchildren up to the top-level ancestor rather than crashing.

**Seed:**

| event_id | name | parent | dates |
|---|---|---|---|
| `EV-001` | Paris Mandir Mahotsav | — | 2026-08-10 → 2026-08-16 |
| `EV-002` | Bal Din | `EV-001` | 2026-08-12 |
| `EV-003` | Nagar Yatra | `EV-001` | 2026-08-15 |

---

## Tab: `Allocations`

Created directly by the karyakar after reading the request email. There is no request workflow
and no approval step — an allocation row *is* the decision.

| Column | Type | Notes |
|---|---|---|
| `allocation_id` | text | `AL-000123` |
| `asset_id` | text | One row per item. Allocating 6 items writes 6 rows sharing everything but `asset_id`. |
| `event_id` | text | **The leaf event** — the sub-event if one was picked, otherwise the top-level event. See note below. |
| `centre` | text | **Optional.** Blank is normal for a mandir-wide event. Falls back to the event's own centre. |
| `needed_from` | date | Start of the window the item is spoken for. Defaults to the event's `start_date`, then to today. |
| `expected_return_date` | date | End of that window. |
| `allocated_by` | text | Karyakar's name, free text |
| `allocated_at` | timestamp | Server-set |
| `notes` | text | |
| `status` | enum | `open` \| `fulfilled` \| `cancelled` — **addition to spec, see below** |

> **Two additions to the spec, both cheap and both load-bearing:**
>
> - **`status`** — without it there is no way to tell "allocated but never collected" from
>   "allocated and now returned", and no way to cancel a plan that changed. It is not a
>   workflow; it is one cell the server flips.
> - **Leaf `event_id`** — the spec gives Allocations a single `event_id` but Movements both an
>   `event_id` and a `sub_event_id`. Resolution: Allocations stores the leaf, and the server
>   derives the parent when it writes the Movement row. One source of truth, no chance of the
>   two columns disagreeing.

---

## Tab: `Movements`

The physical audit trail. One row per item per trip out of the store. A row with a blank
`checked_in_at` is **currently out**.

| Column | Type | Notes |
|---|---|---|
| `movement_id` | text | `MV-000456` |
| `asset_id` | text | |
| `allocation_id` | text | Blank if checked out without a prior allocation (walk-up case) |
| `event_id` | text | Top-level event |
| `sub_event_id` | text | Leaf sub-event, or blank if allocated straight to the top-level event |
| `centre` | text | |
| `checked_out_at` | timestamp | |
| `checked_out_by` | text | Karyakar name, free text |
| `condition_out` | enum | Item condition at the moment it left |
| `expected_return_date` | date | Copied from the allocation, editable at check-out |
| `checked_in_at` | timestamp | **Blank = still out** |
| `checked_in_by` | text | |
| `condition_in` | enum | Blank if the item never came back |
| `damage_notes` | text | Free text. Also carries `Not returned` for a missing kit child. |
| `via_parent_asset_id` | text | Set on child rows when the movement was triggered by scanning the parent. Blank when the child was scanned on its own. |
| `outcome` | enum | `returned` \| `missing` \| `damaged` — **addition to spec** |

> **`outcome`** is added so "hammer not returned" is a queryable state rather than something you
> have to infer from a blank `condition_in` plus free text. Set at check-in; blank while out.

---

## Availability is a question about dates

"Is HAR-003 available?" has no answer. "Is HAR-003 available on the 14th?" does.

An allocation reserves an item for the window `needed_from` → `expected_return_date`.
Two requests clash only if those windows **overlap**, so East London can hold the harmonium
from the 10th to the 12th while Paris takes it on the 14th.

| Rule | Behaviour |
|---|---|
| A1 | Both ends are **inclusive**. An item due back on the 12th is not free for someone else on the 12th — it may not physically arrive until that evening. |
| A2 | A booking with no dates at all is treated as **clashing**, not as free. Failing towards "ask a human" is the cheap mistake; failing towards "available" is how two centres turn up for the same harmonium. |
| A3 | An item physically checked out blocks from today until its due date. |
| A4 | An item **already overdue** blocks *every* future date. Its window is open-ended, because nobody knows when it is coming back — treating it as free after its lapsed due date would be exactly backwards. |
| A5 | `maintenance` and `lost` block every date regardless of the window. |
| A6 | A `cancelled` allocation blocks nothing. |
| A7 | A kit can be available while one of its pieces is not. The set goes out without that piece, with a warning naming it. |

Every clash carries a plain-English reason — "Allocated to Bal Din (10 Aug – 12 Aug)" — so the
karyakar can answer the centre that asked without opening anything else.

The browser runs this **exact same file** (`apps-script/src/10-rules.js`, loaded by a script tag
in `index.html`), so the Allocate screen re-answers the question the instant a date changes, with
no round trip. The server re-checks on save, because someone else may have taken the item in the
meantime.

### Overdue is never stored

An item is overdue when, on a Movement row:

```
checked_in_at is blank  AND  expected_return_date < today (Europe/London)
```

Days late = `today − expected_return_date`. Computed on the server for the dashboard and on the
client for list filtering. There is no `overdue` column anywhere, by design — a stored flag
would be wrong every midnight.

---

## Kit behaviour — the exact rules

These are the rules the tests pin down.

**Vocabulary.** *Parent* = `is_kit = TRUE`, `parent_asset_id` blank. *Child* = `parent_asset_id` set.

| # | Situation | Behaviour |
|---|---|---|
| K1 | Scan parent to check out | Parent + every `available` active child get a Movement row. Children's rows carry `via_parent_asset_id = <parent>`. All go `status = checked_out`. |
| K2 | A child is in `maintenance` or `lost` when the parent is checked out | That child is **skipped**, the rest proceed, and the response returns a `warnings` list the UI shows plainly: "Checked out 5 of 6 — Hammer is in maintenance." |
| K3 | A child is already `checked_out` on its own when the parent is scanned | The whole check-out is **blocked** with an error naming the child and where it is. The client may retry with `allow_partial: true` to proceed without it (then it behaves like K2). |
| K4 | Child shown in inventory while out via its parent | `Out — via TAB-014 (Tabla Set A)`. It cannot be allocated or checked out independently while that movement is open. |
| K5 | Check out a child alone | Allowed **only if the parent's status is `available`**. If the parent is `checked_out`, blocked. The parent's own status does **not** change — it stays `available`, and rule K3 is what stops the set going out incomplete. |
| K6 | Scan parent to check in | Closes the parent's movement and every child movement where `via_parent_asset_id = <parent>` and `checked_in_at` is blank. |
| K7 | Children checked out alone are not swept up by a parent check-in | Their movements have a blank `via_parent_asset_id`, so K6 does not touch them. They must be scanned individually. |
| K8 | Per-child flags on the check-in screen | Each child row offers a condition and a "missing" toggle. `missing` → `outcome = missing`, `damage_notes = "Not returned"`, item `status = lost`. A condition of `needs_repair` → `outcome = damaged`, item `status = maintenance`. Anything else → `outcome = returned`, item `status = available`. |
| K9 | Partial return | Checking in a child alone while the parent is still out is allowed. The parent stays out. |
| K10 | Deactivating a parent | Cascades `active = FALSE` to children. Blocked entirely if the parent or any child is `checked_out`. |

---

## What the setup script creates

`setupSheet()` run once from the Apps Script editor:

1. Creates all 7 tabs with their header rows, frozen and bold.
2. Seeds Centres, InstrumentTypes, QualityGrades.
3. Seeds the 3 nested events and the 10 sample items (incl. the full tabla kit).
4. Sets the script timezone to `Europe/London`.
5. Writes a starter access code into Script Properties and logs it once.
6. Is **idempotent** — running it twice does not duplicate anything.
