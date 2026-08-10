# Instrument Tracker

A small web app for **BAPS Shri Swaminarayan Mandir, London** that keeps track of which
instruments are allocated to which event, and whether they have been collected and returned.

It runs on a Google Sheet and a free GitHub Pages site. There is nothing to pay for, nothing that
expires, and nothing that needs reactivating.

---

## Contents

- [What it does](#what-it-does)
- [Setting it up](#setting-it-up) — start here
- [Sharing it with other karyakars](#sharing-it-with-other-karyakars)
- [Changing the app after people are using it](#changing-the-app-after-people-are-using-it)
- [Changing the access code](#changing-the-access-code)
- [Where photos are stored](#where-photos-are-stored)
- [Moving it to another Google account](#moving-the-whole-thing-to-another-google-account)
- [Printing labels](#printing-labels)
- [How sets work](#how-sets-work-tabla-kits-and-the-like)
- [If something goes wrong](#if-something-goes-wrong)
- [For developers](#for-developers)

---

## What it does

There are only two things anyone does with this app, and they are the two buttons on the home
screen.

### 📤 Give out instruments

Three steps, in this order:

1. **Who is taking them?** Say whether they are *taking them now* or *booking ahead*, pick the
   event, set the date they should come back, and put your name in. If the event does not exist
   yet, you can create it here without leaving the screen.
2. **Which instruments?** They are grouped by type — harmoniums, tablas, keyboards — and only the
   ones actually free for those dates are shown. Scan a sticker or tick from the list.
3. **Check and confirm.** A summary, then one button.

Booking ahead holds the instruments for those dates without marking them as gone. When the
karyakar turns up to collect, use **Give out** again and the booking is settled automatically.

### 📥 Take instruments back

1. **What is coming back?** Grouped by event, so a pile from one mahotsav is one tick. Scanning
   a piece of a tabla set brings the whole set back.
2. **Is everything alright?** Every piece is "back and fine" by default. Tap anything that is
   damaged or that never came back. The hammer that went missing gets recorded against that set
   for good.

> **Notes follow the instrument.** Anything written in an instrument's *Notes* — "scale changer,
> handle with care", "left skin worn", "belongs to Ramesh" — appears next to it while you are
> choosing what goes out, on the final check-and-confirm, and as a message on screen if you get
> to it by scanning. Write it once in Instruments and it turns up at the moment somebody is
> picking the thing up.

### Everything else

- **Instruments** — the full inventory. Search, filter, edit, remove, add.
- **Out on loan** — everything currently out, as a list you can print. Grouped by event, late
  things first, with a box against each instrument to tick while you walk the store room. Reach it
  from **More**, or by tapping the "*n* out" count on the home screen.
- **Events** — mahotsavs and their sub-events, with what went where.
- **More** — printing labels, the scanner, and settings.

Everyone shares one access code and can do everything, including adding and removing
instruments. There are no accounts, no passwords per person, and no admin role. It is a small
tool for a group of people who trust each other.

> **A note on wording.** The app says "give out" and "take back", not "check out" and "check in".
> The Google Sheet behind it still uses the technical column names (`checked_out_at`,
> `Movements`, `Allocations`) because those are the data, not the wording a volunteer reads.

---

## Setting it up

You do this once. It takes about twenty minutes. You do not need to know how to write code —
you will be copying and pasting.

### Step 1 — Make the Google Sheet

1. Go to [sheets.new](https://sheets.new) while signed in to the Google account that should own
   this. **Use an account that will still exist in five years** — ideally a mandir account rather
   than a personal one, because the Sheet and the script both live in it.
2. Give it a name, for example `Instrument Tracker`.

Leave the tab open.

### Step 2 — Add the script

1. In the Sheet, go to **Extensions → Apps Script**. A new tab opens with a code editor.
2. Delete everything already in the editor (it will say something like `function myFunction() {}`).
3. Open the file [`apps-script/Code.gs`](apps-script/Code.gs) from this project, select all of it,
   copy it, and paste it into the editor.
4. Click the **save icon** (💾).

### Step 3 — Create the tabs and sample data

1. Still in the Apps Script editor, find the dropdown near the top that says `doGet` and change it
   to **`setupSheet`**.
2. Click **▶ Run**.
3. Google will ask for permission the first time. Click **Review permissions**, choose your
   account, then click **Advanced → Go to (your project name)** and **Allow**.

   > The "Google hasn't verified this app" warning is expected. It is your own script, in your own
   > account, and it is only asking for access to your own Sheet.

4. Go back to the Sheet tab. It now has seven tabs (Items, Events, Allocations, Movements,
   Centres, InstrumentTypes, QualityGrades) filled with sample data — including one complete
   tabla set and a Paris Mandir Mahotsav event with two sub-events.
5. **Write down the access code** it showed you. The starting code is `mandir2026`. You will
   change it in Step 6.

### Step 4 — Publish the script as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description**: anything, e.g. `Instrument Tracker v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**

   > "Anyone" sounds alarming but is required — it means anyone can *reach* the address. Without
   > it, the app would demand a Google login from every volunteer. The access code is what
   > actually protects the data.

4. Click **Deploy**, then **Authorise access** if asked.
5. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfycbx...................../exec
   ```

   It must end in **`/exec`**, not `/dev`.

### Step 5 — Put the app on the web

1. Create a free account at [github.com](https://github.com) if you do not have one.
2. Create a new repository. Name it `instrument-tracker`. Set it to **Public** (GitHub Pages needs
   this on a free account) and click **Create repository**.
3. Click **uploading an existing file**. Now the important bit:

   > **Drag the *contents* of the project folder, not the folder itself.**
   >
   > In Finder, open `Instrument Tracker`, press **⌘A** to select everything inside it, and drag
   > that onto the page. The folders — `js`, `css`, `apps-script` — come across as folders and
   > must stay that way. It is only the outer wrapper that gets unwrapped.

   When it is right, your repository's main page lists this:

   ```
   apps-script   css   js   config.js   index.html   README.md
   ```

   Two ways it commonly goes wrong:

   - **One folder** named after the project, with everything inside it. You dragged the folder
     rather than its contents. Open it and re-upload from inside.
   - **Loose files** like `app.js` and `qr.js` sitting at the top level. The `js` folder was
     flattened, usually by using the *"choose your files"* link, which cannot take folders.
     Drag the `js` folder in, then delete the loose copies.

4. Click **Commit changes**.
5. In the repository, open the file **`config.js`** and click the pencil icon to edit it.
6. Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the URL you copied in Step 4. Keep the
   quote marks:

   ```js
   API_URL: 'https://script.google.com/macros/s/AKfycbx...../exec',
   ```

7. Click **Commit changes**.
8. Go to **Settings → Pages**. Under "Branch", choose **main** and **/ (root)**, then **Save**.
9. Wait two or three minutes, then reload the page. It will show your address:

   ```
   https://your-username.github.io/instrument-tracker/
   ```

### Step 6 — Open it and change the code

1. Open that address on your phone.
2. Enter the access code from Step 3 (`mandir2026`).
3. Go to **More → Settings**, set a new access code, and press **Save settings**.
4. Share the address and the new code with the other karyakars.

**Add it to the home screen** so it opens like an app: on iPhone, Share → Add to Home Screen; on
Android, the ⋮ menu → Add to Home screen.

### Optional — load a full store to try it out properly

The starter sample is ten instruments, which is enough to see that it works but not enough to
get a feel for it. If you want to trial the app properly before committing:

1. In the Apps Script editor, change the dropdown from `doGet` to **`seedDemoData`**.
2. Click **▶ Run**.

That fills the Sheet with a mandir-sized store and a few weeks of plausible history:

| | |
|---|---|
| **73 instruments** | 7 harmoniums, 5 keyboards, 4 tabla sets (5 pieces each), 4 dholaks, 7 manjira, 5 kartal, 3 jhanjh, violins, sitars, amps, 7 mics, cables |
| **11 events** | Three mahotsavs with sub-events, weekly sabhas at three centres, two finished events |
| **26 out right now** | Including 12 late, and one due back *today* so you can check that "due today" is correctly not treated as late |
| **21 booked ahead** | For Diwali Annakut and the coming weeks |
| **Real history** | Loans that came back fine, one that came back damaged, one where a manjira never came back |

Two things worth playing with once it is loaded:

- **The harmonium `HAR-003` is booked twice**, by two different centres, for two weeks that do
  not overlap. Try booking it for a day in between — it works. Try booking it for a day inside
  one of those windows — it refuses and tells you who has it.
- **`HAR-007` shows as needing repair and `MAN-007` as lost.** Neither was set that way; both got
  there through a real return being recorded, and the item's history page shows exactly when.

When you have finished trialling, run **`clearDemoData`** the same way. That empties Items,
Events, Allocations and Movements completely, ready for your real instruments.

### Step 7 — Put in your real instruments

The sample data is there so you can see how everything works. When you are ready:

1. Go through **Instruments** and use the 🗑 button on each sample item you do not have. Removing
   never deletes anything — it just hides the item from the list.
2. Use **+ Add instrument** for your real ones.
3. Go to **More → Print labels**, select everything, and print.

If you would rather start from a completely clean Sheet, delete the sample rows directly in the
Google Sheet instead, leaving row 1 (the headings) alone.

---

## Sharing it with other karyakars

Once Steps 1–6 are done you have a permanent web address that looks like:

```
https://your-username.github.io/instrument-tracker/
```

**Send people that address and the access code.** Two separate messages is a sensible habit — the
address in the group chat, the code by itself. There is nothing to install and no account to
create; they open the link, type the code once, and that device stays unlocked.

Tell them to **add it to their home screen** so it opens like an app and they never have to find
the link again:

- **iPhone:** open in Safari → Share button → *Add to Home Screen*
- **Android:** open in Chrome → ⋮ menu → *Add to Home screen*

That address is public in the sense that anyone who has it can reach the page — but without the
access code they cannot see or change anything.

---

## Changing the app after people are using it

This is the normal case, not an emergency. **The web address never changes**, so nobody needs a
new link and nobody has to reinstall anything.

There are three different kinds of change, and only two of them involve any deploying at all.

### 1. Changing your instruments, events or centres

Nothing to deploy. Add instruments, edit events, rename centres in Settings — it all goes
straight into the Google Sheet and everyone sees it the next time they open the app or press
**Refresh**.

### 2. Changing the app's screens or wording

These are the files in your GitHub repository — `index.html`, `js/`, `css/`.

1. In GitHub, open the file and click the **pencil** icon.
2. Make the change and **Commit changes**.
3. **Open `index.html` and bump the version number.** Every `?v=1.3.3` becomes `?v=1.3.4`. There
   are about nine of them; change them all to the same new number.
4. Wait a minute or two, then reload.

> **Step 3 is the one people forget.** Phones cache JavaScript aggressively. Without a new
> version number, some karyakars keep running the old app for days and report bugs you have
> already fixed. Changing the number is what forces every device to fetch the new files.

### 3. Changing the rules behind it (the Apps Script)

Only needed if the *behaviour* changes — new fields, different validation, new actions.

1. Copy the new `apps-script/Code.gs` and paste it over the old one in the Apps Script editor.
   Save.
2. **Deploy → Manage deployments.**
3. Click the **pencil** icon on your existing deployment.
4. Set **Version** to **New version**. Click **Deploy**.

> ⚠️ **Use "Manage deployments", not "New deployment".**
>
> "New deployment" creates a *second* web app with a *different* URL. Your old one keeps running
> the old code, `config.js` still points at it, and it looks like your change simply did nothing.
> Editing the existing deployment keeps the same URL, which is what everyone's app is pointing at.

### Does redeploying wipe anything?

**No.** Your instruments, loans and bookings live in the Google Sheet, and the photos live in a
Drive folder beside it (see [Where photos are stored](#where-photos-are-stored)). The app is just
code that reads and writes it. Replacing the code cannot touch the rows, the same way installing
a new version of Excel doesn't empty your spreadsheets.

Nothing restarts either — there is no server sitting there holding your data in memory. Each tap
in the app is a separate request; the next one simply runs the new code.

`setupSheet()` is safe to run as many times as you like. It only creates tabs that are missing,
rewrites the header row, and adds sample rows to a tab that is **completely empty**. Once you have
real instruments in there, the seeding is skipped entirely. There is a test that proves this: it
creates a real instrument, a real loan and a real booking, runs `setupSheet()` twice, and checks
the Sheet comes out identical.

The things that *can* lose data are all separate from deploying:

| Do this | And this happens |
| --- | --- |
| Run `clearDemoData()` or `seedDemoData()` | **Wipes** Items, Events, Bookings and loan history. Only ever use these before real use. |
| Delete or rename a heading in row 1 of the Sheet | Breaks the app — columns are found by their heading text, not their position. |
| Edit rows in the Sheet by hand while people are using the app | You can overwrite what someone just saved. Use the app where you can. |
| Overwrite `config.js` with the version from GitHub | No data is lost, but the app forgets which Sheet it belongs to. Paste your `/exec` URL back in. |

One small thing worth knowing: if a karyakar is halfway through a **Give out** or **Take back**
when you deploy, the basket they have built up lives in their phone's memory until they press the
final button. They are not interrupted mid-tap — but if they reload the page before finishing,
that basket is gone and they start it again. Nothing that was already saved is affected. If you
can, deploy when nobody is mid-handover.

### Getting changes back into GitHub

If someone has been editing this project on a computer rather than in GitHub's web editor, the
simplest route for a non-developer is:

1. In your repository, click **Add file → Upload files**.
2. Drag in the changed files (keeping the same folder names).
3. **Commit changes.**

Uploading a file that already exists replaces it. Nothing is lost, and every previous version
stays in the repository's history if you need to go back.

### If a change goes wrong

GitHub keeps every version. Open the repository, click **History**, find the commit before the
problem, and revert it. For the Apps Script side, **Deploy → Manage deployments → pencil →
Version** lets you pick an earlier version from the dropdown and deploy that instead.

### Telling people to refresh

Most of the time they will pick up changes on their own next time they open the app. If you have
just deployed something and want everyone on it immediately, ask them to **pull down to refresh**
the page, or press the **Refresh** button in the top corner.

---

## Changing the access code

**In the app:** More → Settings → New access code → Save settings.

Changing it signs out every other device immediately. Everyone will be asked for the new code
next time they open the app, and each device only needs it typed once.

**If everyone is locked out** and nobody remembers the code, you can reset it from the Apps
Script editor:

1. Open the Sheet → **Extensions → Apps Script**.
2. Click the **⚙ Project Settings** icon on the left.
3. Scroll to **Script Properties**. The code is stored there as `ACCESS_CODE`.
4. Click **Edit**, set a new value, and **Save script properties**.

The code is deliberately kept there rather than in the Sheet, so that sharing the Sheet with
someone does not hand them the code as well.

---

## Where photos are stored

Photos are the only part of this app that is not in the Google Sheet — a spreadsheet cell cannot
hold an image usefully, and storing them as text in the Sheet would slow down every screen for
everybody.

They go into **one folder, created right next to your Google Sheet in Drive**:

```
📁 (wherever your Sheet lives)
   📄 Instrument Tracker          ← your Sheet
   📁 Instrument Tracker Photos   ← every photo, and nothing else
```

Nothing is ever scattered around your Drive. If your Sheet is inside a folder called
*Mandir Admin*, the photos folder is created inside *Mandir Admin* too. If your Sheet is loose at
the top of My Drive, the folder appears there beside it — so if you would rather it were tucked
away, put the Sheet in a folder first and the photos will follow.

**You can move or rename that folder whenever you like.** The app remembers it by its Drive ID,
not by its name or location, so filing it somewhere tidier will not break anything.

To find it quickly, open **Settings** in the app — there is an "Open the photos folder" button.

Each file is named after the instrument and the moment it was taken, so the folder stays readable
on its own:

```
TAB-014-in-2026-08-10-142233.jpg
HAR-003-out-2026-08-11-091502.jpg
```

`-in-` is a photo taken when something came back, `-out-` when it went out.

### Who can see the photos

Each photo is set to **"anyone with the link can view"**.

This is deliberate and it is worth understanding. The volunteers using the app are not signed in
to the mandir's Google account — they just have the web address and the access code. Without link
sharing, a damage photo would show as a broken image for almost everyone.

In practice this means the photos are unlisted rather than private: they do not appear in search
and nobody can browse to them, but anyone who has the exact link can open one without signing in.
The links are only ever shown inside the app, which is behind your access code.

For photos of damaged tablas this is a sensible trade. If you would rather they were locked down
to signed-in mandir accounts only — accepting that most volunteers would then see broken images —
say so and it can be changed in one line.

### Deleting a photo

Wherever a photo appears in the app there is a **🗑 Delete** next to it — on the damage panel at
the top of an instrument's page, and on each line of its history.

Deleting does two things: the record stops showing the photo, and the file goes to the **Drive
bin**, where Google keeps it for 30 days. So a photo deleted by mistake can be fetched back, but
a photo of somebody's front room does not sit in the mandir's Drive for ever.

Two things it deliberately does **not** do:

- **It never deletes the record.** Delete the photo of a damaged tabla and the tabla is still
  recorded as damaged, still has its note, and is still out of action. Only the picture goes.
- **It asks twice for damage photos.** That photo is the only picture of what happened, so the
  confirmation says so plainly rather than treating it like any other tap.

If you would rather replace a photo than remove it, use **Retake** instead — that keeps the old
file in Drive and simply points the record at the new one.

Nothing is deleted automatically. If the folder gets large after a few years you can also tidy it
straight from Drive; the app carries on working and shows a broken thumbnail on those old
records. Deleting the whole folder is safe too — the app makes a new one next time somebody takes
a photo.

---

## Moving the whole thing to another Google account

Yes, this can be done at any time, and it is worth knowing how before you need it — for example
if the app was set up on someone's personal account and should live on a mandir one.

**Transfer ownership. Do not copy.** This is the whole trick. Transferring keeps Google's internal
IDs identical, so every photo already recorded keeps working. Copying creates new files with new
IDs, and every photo in the app's history becomes a broken image.

There are three pieces, and the GitHub side is not one of them:

| Piece | What to do |
| --- | --- |
| The Google Sheet (all your data) | In Drive, right-click → **Share** → add the new account → set it to **Owner**. The Apps Script goes with it automatically; it lives inside the Sheet. |
| The **Instrument Tracker Photos** folder | Same again: **Share** → new account → **Owner**. Do this even though it feels optional — otherwise the photos still belong to the old account and vanish if that account is ever closed. |
| The GitHub Pages site | Nothing to do. It is not a Google thing and is unaffected. |

Then, signed in as the **new** account:

1. Open the Sheet → **Extensions → Apps Script**.
2. **Run `setupSheet`** and accept the permission screen. (It changes no data — see
   [Does redeploying wipe anything?](#does-redeploying-wipe-anything))
3. **Run `authorizePhotos`** and accept that permission screen too.
4. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*. Copy the
   new `/exec` URL.
5. In GitHub, edit **`config.js`** and paste the new URL in. Commit.

The web address everyone uses does not change, so nobody needs a new link.

> **Check before you close the old account.** Open the app, find an instrument with a damage
> photo, and make sure the photo still loads. If it does, the transfer is complete. Photos are
> the one part that can be left behind, because they are the one part that is not in the Sheet.

If the photos ever do end up in a different folder — you moved them by hand, or copied rather
than transferred — you can point the app at the new folder without redeploying. In the Apps
Script editor, add this function, paste your folder's address in, and run it once:

```js
function myFolder() {
  setPhotoFolder('https://drive.google.com/drive/folders/PASTE_FOLDER_ADDRESS');
}
```

That only changes where the **next** photo is saved. Photos already taken are untouched.

---

## Printing labels

Go to **More → Print labels**, tick the instruments you want, and press **Print**.

A set collapses to one line with a **Whole set** button, so relabelling a tabla set is one tap
rather than six.

### Settings that matter

- **Print at "Actual size" / 100%.** Do not use "Fit to page" or "Shrink to fit" — it shrinks the
  QR codes below the size they were designed at, and small QR codes stop scanning.
- **Set the paper to A4** and leave the browser's own margins at Default.
- Print in **black and white at the highest quality** your printer offers. Draft mode blurs the
  edges of the squares, which is exactly what a scanner needs to be sharp.
- **Do not tick "Headers and footers"** — it pushes the last row of labels onto a second page.

### Checking the size came out right

Take a ruler to the first sheet before you print fifty of them.

| What to measure | Should be |
|---|---|
| The black QR square on a normal label | **25mm** across (give or take half a millimetre) |
| The black QR square on a kit-bag tag | **40mm** across |
| The full width of three labels side by side | **188mm** |
| Labels per A4 sheet | **21** — three columns, seven rows |

If the QR measures noticeably under 25mm, the printer is scaling the page down. Go back and set
it to Actual size / 100%.

> **Why those numbers.** A4 is 210mm wide; the sheet uses 10mm margins, leaving 190mm. Three
> 60mm labels with 4mm gaps come to 188mm, which fits with 2mm to spare. The QR is drawn in a
> 30mm box that includes a small white border, so the black part lands at just over 25mm and
> each individual square in the code is 1.2mm — well above the ~0.5mm where phone cameras start
> to fail. The full arithmetic is written out at the top of the print section in `css/app.css`.

### What to print on

| Where the label goes | What to use |
|---|---|
| Instruments (tabla, harmonium, dholak…) | **Matte vinyl** sticker paper, or paper labels **laminated** afterwards. Instruments get handled with damp hands and stored in dusty rooms; plain paper lasts weeks. |
| Kit bags and cases | A **40mm** QR on a **luggage-style tag**, tied to the handle. The app prints these bigger automatically. |
| Small parts (hammers, powder bottles) | The standard 25mm label, wrapped around or stuck flat. Avoid curved surfaces where you can — a QR bent around a narrow cylinder will not scan. |

**Do not use glossy paper.** Overhead lights reflect off it and the camera sees a white blob.

### What is on each label

```
  [QR code]   TAB-014
              Tabla Set A
              Property of BAPS London Mandir
```

Pieces of a set also carry a line saying which set they belong to, so a hammer found on a floor
can be put back where it belongs:

```
  [QR code]   OTH-001
              Tabla Set A — Hammer
              Part of: Tabla Set A (TAB-014)
              Property of BAPS London Mandir
```

The QR code contains the asset ID and nothing else — the same text printed underneath it. So if a
label gets scratched or a sticker peels, **anyone can just type the ID into the box under the camera**
instead. Nothing depends on the QR surviving.

---

## How sets work (tabla kits and the like)

A tabla set is one item with several pieces: dayyu, bayyu, hammer, powder bottle and bag. Each
piece has its own label, and the bag has its own tag too.

- **Scanning the set takes everything with it.** Scan `TAB-014` and all five pieces are checked
  out at the same time. You do not scan them individually.
- **Pieces show where they went.** In Instruments, the hammer reads
  *"Out — via TAB-014 (Tabla Set A)"*, and cannot be booked for a different event while it is out.
- **Checking the set back in brings everything back** — but the check-in screen lists every piece
  separately, each with a condition and a **Not returned** switch. That is how you record that
  the hammer did not come back: the rest of the set goes back on the shelf, the hammer is marked
  lost, and it shows up as lost until somebody finds it.
- **A single piece can go out on its own**, but only while the rest of the set is in the store.
  If you then try to check the whole set out, the app stops you and tells you which piece is
  already elsewhere — you can either fetch it first or send the set without it.
- **A piece that is in for repair is skipped** rather than blocking the set. The app tells you
  plainly: *"Checked out 5 of 6 — Hammer is in maintenance."*

---

## If something goes wrong

### The page is completely blank, just a plain cream background

Something the page needs did not upload. The app detects this and tells you which file — reload
and you should see **"This page did not load properly"** with a list.

Open your repository's main page. It should look exactly like this:

```
apps-script   css   js   config.js   index.html   README.md
```

Compare it against what you actually see:

| What you see | What happened | Fix |
|---|---|---|
| One folder named after the project | You dragged the project folder instead of its contents | Open it, select everything inside, upload that |
| Loose `app.js`, `qr.js`, `ui.js`… at the top level | The `js` folder was flattened | Drag the **`js` folder** in, then delete the loose files |
| A folder called `JS` or `Js` | Capitals — your Mac ignores them, GitHub Pages does not | Upload a correctly named `js` folder, delete the other |
| Everything looks right | Cached old page | Hard-refresh, or wait for the Actions tab to go green |

The rule in one line: **the repository root mirrors the inside of the project folder.** The outer
wrapper gets unwrapped; `js`, `css` and `apps-script` stay as folders.

If the error names one specific file, you only need that file — uploaded into the same folder it
came from.

### "There isn't a GitHub Pages site here" (a dark 404 page)

Pages has not finished publishing. Check the repository's **Actions** tab for the
*pages build and deployment* job and wait for the green tick — the first publish can take ten
minutes. If there is no job at all, go to **Settings → Pages** and confirm **Branch: main** and
**Folder: / (root)**, and that the repository is **Public**.

### "This app has not been connected to a Google Sheet yet"

`config.js` still has the placeholder in it. Go back to **Step 5.4** and paste in your Apps Script
web app URL.

### "The app URL in config.js is not answering correctly"

Usually one of three things:

- The URL ends in `/dev` instead of `/exec`. Redeploy and copy the `/exec` one.
- The deployment is not set to **Execute as: Me** and **Who has access: Anyone**. Check
  **Deploy → Manage deployments** in the Apps Script editor.
- You edited the script and did not redeploy. **Editing the code does not update the live app.**
  Go to **Deploy → Manage deployments**, click the pencil icon, set Version to **New version**,
  and click **Deploy**. The URL stays the same.

### "That access code is not right"

Someone changed it in Settings. Ask another karyakar, or reset it from Script Properties
([above](#changing-the-access-code)).

### "Could not reach the Google Sheet"

Almost never an actual internet problem — the page itself just loaded, so your connection works.
The request was *blocked*, and there is one test that identifies why.

**Paste your Apps Script URL — the `/exec` one from `config.js` — straight into a browser tab.**

| What comes back | Meaning | Fix |
|---|---|---|
| `{"ok":false,"error":{"code":"BAD_CODE"…}}` | The script is working correctly and refused you for having no access code | The problem is in `config.js` — see below |
| A **Google sign-in page** | The deployment will not accept anonymous visitors | Deploy → Manage deployments → pencil → **Who has access: Anyone** → Deploy |
| "Sorry, unable to open the file" | Wrong URL, or the deployment was deleted | Re-copy the Web app URL from Manage deployments |

> **"Anyone", not "Anyone with a Google account".** The second still demands a login, which the
> browser blocks. This is the single most common cause.

If you got the JSON, check `config.js`:

- the URL ends in **`/exec`**, never `/dev` — a `/dev` URL only works while *you* are signed in
- it is still inside quotes, with the comma: `API_URL: 'https://…/exec',`
- there are no stray spaces or line breaks inside the quotes

Nothing is ever half-saved when this happens: either a whole check-out goes through or none of
it does.

### Taking a photo says "something went wrong at our end"

Everything else works, but the moment you try to take a photo it fails. This is almost always
that **the script has never been given permission to use Google Drive**, where the photos are
saved.

Google decides what a script is allowed to do by reading its code, and it only asks your
permission when *a person* runs a function from the editor. Pasting in new code and deploying a
new version never asks. So the app can happily use your Sheet — it was allowed to do that long
ago — but is refused the moment it reaches for Drive.

**The fix takes about twenty seconds and there is nothing to redeploy:**

1. Open your Google Sheet → **Extensions → Apps Script**.
2. In the toolbar there is a dropdown listing the functions. Choose **`authorizePhotos`**
   (on older code that function does not exist yet — choose **`photoFolder`** instead; it does
   exactly the same job).
3. Click **▶ Run**.
4. Google shows a permission screen. Click **Review permissions**, pick your account, click
   **Advanced → Go to Instrument Tracker (unsafe)** if it warns you — it says that about every
   script that has not been through Google's paid review, including your own — then **Allow**.
5. You should see "Photos are switched on."

Go back to the app and take the photo again. It will work, for everybody, straight away.

You only ever do this once. If it happens again after a future update, it means the new code
needs a permission it did not need before — same fix.

### The camera does not start

- The app must be opened over **https://**. A `github.io` address always is. If you are testing
  from a file on your computer, the camera will not work — that is a browser rule, not a bug.
- The browser asks for camera permission the first time. If you said no, you will need to allow it
  in your browser settings for that site.
- On iPhone, the camera only works in **Safari** (and apps using Safari underneath). Chrome on
  iPhone cannot use it.
- **You can always type the asset ID instead.** The box is right under the camera and does exactly
  the same thing. Nobody is ever stuck.

### A QR code will not scan

- Check the printed size — it needs to be about 25mm across.
- Clean the label, and try in better light.
- Move the phone slowly to about 15–20cm away.
- If the label is damaged, type the ID printed underneath it.
- If it still fails, print a fresh label from **More → Print labels**.

### Two people used it at the same time and something looks wrong

Press the **refresh** button (the circular arrow, top right). The app fetches everything fresh
each time it loads, so refreshing always shows the true state of the Sheet.

### Something is wrong in the data

Open the Google Sheet and look. Every tab is plain readable text, and you can fix a typo directly
in a cell. Two rules:

- **Do not change row 1** — those are the column headings and the app looks for them by name.
- **Do not delete rows.** The app never deletes anything either; it marks items inactive so old
  records still make sense. If you delete a movement row, the history it belongs to stops adding
  up.

### I want to start over

In the Apps Script editor, run **`clearDemoMovements`** to wipe the movement and allocation
history and put every instrument back to available. The instruments and events stay.

---

## For developers

```
index.html            the whole frontend shell
config.js             the one file you edit to connect it to your Sheet
css/app.css           navigation, print rules for labels, camera overlay
js/qr.js              self-contained QR encoder (no CDN — labels must always print)
js/ui.js              escaping, dates, status pills, toasts, dialogs
js/api.js             fetch wrapper (read the CORS note before touching it)
js/app.js             routing, bootstrap, shared state
js/inventory.js       inventory, item detail, add/edit, labels
js/operations.js      dashboard, scan, allocate, events, settings

apps-script/Code.gs   GENERATED — the single file you paste into Apps Script
apps-script/src/      the real source, split into files
tools/build-gs.js     concatenates src/ into Code.gs
tools/dev-server.js   run the whole app locally with a fake Apps Script backend

docs/SCHEMA.md        every Sheet tab, column by column, plus the kit rules K1–K10
docs/API.md           the API contract and the CORS explanation
tests/                163 tests, no dependencies
```

### Running it locally

```bash
node tools/dev-server.js --demo
```

Serves the frontend on `http://localhost:8787` with an in-memory stand-in for Apps Script, so you
can click through the whole app — kit check-out, labels, everything — without a Google account.
Data resets when you stop it.

### Tests

```bash
node tests/run.js
```

No `npm install`, no framework. Covers the kit cascade (rules K1–K10), overdue arithmetic across
both British clock changes, the whole API end to end against the generated `Code.gs`, and the QR
encoder — including a check that its output is module-for-module identical to an independent
encoder, which is the only thing that catches a QR bug that a self-consistency test cannot see.

### After changing anything in `apps-script/src/`

```bash
node tools/build-gs.js
```

Then paste the regenerated `apps-script/Code.gs` into the Apps Script editor and **Deploy → Manage
deployments → New version**. The tests fail if `Code.gs` is out of date.

### The one thing not to "fix"

Writes are sent as `Content-Type: text/plain;charset=utf-8` even though the body is JSON. That is
deliberate: Apps Script does not answer CORS preflight requests, and `application/json` triggers
one. The full explanation is at the top of [`js/api.js`](js/api.js) and
[`apps-script/src/50-entry.js`](apps-script/src/50-entry.js).
