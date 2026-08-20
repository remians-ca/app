# Remians Canada — Project Context

> Handoff document for working on this project in Cursor (or any editor + AI assistant).
> Read this first. It captures the architecture, conventions, credentials, and gotchas
> so an AI assistant can pick up work without re-deriving the whole system.

---

## 1. What this project is

The website for **Remians Canada** — the Canadian chapter of the Dhaka Residential Model
College (DRMC) Alumni Association. ~280 members, mostly Greater Toronto Area. Run by a
volunteer committee on a **$0/month budget**. Parent org: remians.com.bd (Bangladesh).

It's a public marketing site + a members-only area (directory, events, welfare fund) gated
behind login and committee approval.

---

## 2. Architecture — "JAMstack with a Sheets backend"

Four free layers, no server to maintain:

```
Browser (static HTML/CSS/JS on GitHub Pages)
    │
    ├──> Firebase Authentication ......... login, signup, email verification, sessions
    │
    └──> Google Apps Script Web App ...... the API: reads/writes the Sheet, enforces permissions
             │
             └──> Google Sheets ........... the database (one tab per table)
```

**Data flow:** the browser fetches the Apps Script URL → Apps Script reads/writes the Google
Sheet → returns JSON → JS renders it. Firebase issues a user UID; that UID is passed to Apps
Script so it knows who is asking and what tier they are.

**Why this stack:** zero cost, non-technical committee can edit content directly in the Sheet,
scales fine for <5,000 rows with occasional writes. (If it ever needs real-time or
high-concurrency writes, Sheets breaks and it would need Firestore — not the case today.)

---

## 3. Files & where they live

| File (in repo)          | Role                                                        | Deploys to |
|-------------------------|-------------------------------------------------------------|------------|
| `index.html`            | The entire frontend (HTML + CSS + inline page JS)           | GitHub Pages |
| `remians_api_client.js` | Frontend connector — wraps all calls to the Apps Script API | GitHub Pages |
| `firebase_auth.js`      | Auth module — two-gate login, tier views, directory render  | GitHub Pages |
| `remians_appscript.js`  | The backend API code — **reference copy only** (see §7)      | Google Apps Script editor (NOT GitHub Pages) |
| `context.md`            | This document                                               | — |

> **Naming note:** in this build session the main file was `remians_canada.html`. On GitHub
> it MUST be named `index.html` (GitHub Pages serves `index.html` as the site root).

**Script load order in `index.html` (do not reorder — later scripts depend on earlier ones):**
1. `firebase-app-compat.js` + `firebase-auth-compat.js` (CDN, in `<head>`)
2. inline `<script>` with `firebaseConfig` + `firebase.initializeApp()` (in `<head>`)
3. `remians_api_client.js`
4. `firebase_auth.js`
5. inline page `<script>` at the bottom (loadPageData, renderEvents, modal, etc.)

---

## 4. Hosting & deployment

- **Repo:** `remians-ca/app` (GitHub). **Live at:** `https://remians-ca.github.io/app`
- **Frontend deploy:** push to `main` → GitHub Pages rebuilds in ~60s. No build step, no CI.
- **Content updates** (events, news, welfare stats) come from the Google Sheet — **no deploy
  needed**; they appear on page load. Only design/structure changes touch GitHub.

---

## 5. The database — Google Sheet tabs & columns

Seven tabs, created by the `setupSheets()` function in the Apps Script. Column names are the
**internal contract** — the API and client reference them by exact name. Do not rename columns.

- **Members:** `id, firebase_uid, name, email, batch_year, city, province, profession, employer, phone, linkedin_url, bio, joined_date, status, tier, internal_notes`
- **Pending:** same as Members minus `joined_date`, plus `submitted_date, notes`
- **Events:** `id, title, event_date, event_time, venue, city, description, yapla_url, capacity, tag, status, created_date, created_by`
- **News:** `id, headline, summary, full_body, tag, publish_date, author, published, created_by`
- **Committee:** `id, name, role, batch_year, photo_url, active, display_order`
- **Welfare:** `fund_balance, members_supported, active_scholarships, total_disbursed, last_updated` (single data row)
- **Gallery:** `id, title, event_date, photo_url, album_label, published`

> **IMPORTANT — "HSC year" vs `batch_year`:** the user-facing label is **"HSC year"**, but the
> internal Sheet column and all API/client code use **`batch_year`**. This split is intentional.
> Change the *label* freely in HTML/UI copy; **never rename the `batch_year` column or the
> `batch_year` key in code** — the Apps Script and API client reference it by name and renaming
> it breaks reads/writes.

---

## 6. Authentication & permissions

**Two-gate access** — a user must pass BOTH gates before seeing members-only content. Enforced
in `firebase_auth.js` inside `onAuthStateChanged`:
- **Gate 1 — Email verified** (`user.emailVerified` from Firebase). If false → sign out, prompt to verify.
- **Gate 2 — Committee approved** (`status === 'approved'` in the Members sheet, read via the
  `getMemberTier` API endpoint which returns both `tier` and `status`). New signups are `pending`
  → they land in the Pending tab and are blocked until the committee moves them to Members with
  `status = approved`.

**Five-tier system** — a single `tier` column drives what each user sees:
`public` (not logged in) · `free` · `paid` · `moderator` · `admin`.
- Frontend gating (`applyTierView`) is **cosmetic** — it shows/hides UI.
- **Real enforcement is server-side in the Apps Script.** Every gated endpoint re-checks the
  caller's tier by looking up their UID (e.g. `getDirectoryFull` requires paid-or-above). Never
  trust the frontend for permissions — anyone can call the API URL directly.

---

## 7. The Apps Script backend (critical workflow gotcha)

`remians_appscript.js` in the repo is a **reference copy for version control and AI context.**
Editing it locally does **NOT** update the live API. The live API is a Web App deployment inside
the Google Apps Script editor attached to the Google Sheet.

**To change the backend:**
1. Edit the code (locally in Cursor, or directly in the Apps Script editor).
2. Open the Sheet → Extensions → Apps Script → paste the updated code → Save.
3. **Deploy → Manage deployments → edit → deploy a NEW version.** Apps Script serves the
   *deployed version*, not the latest saved code. Skipping this = your changes don't go live.
4. If the deployment URL changes, update `BASE_URL` in `remians_api_client.js`.

**Optional upgrade (recommended if you'll edit the backend often):** use **`clasp`** (Google's
CLI for Apps Script) to push/pull the Apps Script from the repo, so the backend is versioned and
editable from Cursor. See §9, Path B.

---

## 8. Config & credentials

These are **public by design** (Firebase web keys and the Apps Script URL are meant to live in
browser code). They're already in the deployed files. The real security is: two-gate auth,
server-side permission checks, API-key HTTP-referrer restriction, and Firebase Authorized Domains.

- **Apps Script Web App URL** (in `remians_api_client.js` as `BASE_URL`):
  `https://script.google.com/macros/s/AKfycbwA0Vl3cW-8mJU1lxBBXbz41R3tBjyA4rlKFA__syOcd96GWxPxwMr_56KusQBEzqMHPQ/exec`
- **Firebase config** (in `index.html` inline `<script>`): project `remians-canada`,
  authDomain `remians-canada.firebaseapp.com`. Full config object is in `index.html`.
- **Email:** remians.ca@gmail.com
- **Payments:** hosted Yapla/Stripe forms, linked externally. After payment, an admin manually
  flips the member's `tier` cell to `paid`. Never build payment processing into the Sheet.

**Security checklist (keep true):**
- Firebase config lives in `index.html` inline, NOT in a `.js` file (avoids GitHub secret-scanning flags).
- API key restricted by HTTP referrer in Google Cloud Console to `remians-ca.github.io/*` (+ localhost for dev).
- Site domain added to Firebase Console → Authentication → Authorized domains.
- No true secrets (Stripe secret key, admin tokens) anywhere in frontend or repo.

---

## 9. Design system (for any visual work)

Warm-minimalist, adapted from the Notion design language. Repositions the brand from
"institution" to "community."
- **Canvas:** warm cream `#F7F2E7` / `#FBF8F1`. **Ink:** warm charcoal `#2B2823`.
- **Fonts:** Fraunces (serif headings) + Inter (body), loaded from Google Fonts.
- **Accent:** deep muted green `#2F6B4E` is the single dominant accent (buttons + one anchor
  band). Red is a flat accent only (warm brick `#C64A3B`). **No red-green gradients anywhere.**
- **Pastel card tints:** mint / blush / sky / cream. Flat fills, soft shadows.
- **Geometry:** 8px buttons (rectangles, not pills), 12px cards.
- All colors are CSS variables in `:root` at the top of `index.html`. `firebase_auth.js` injects
  directory styles that reference these variables — keep the variable names stable
  (`--white, --border-g, --green, --cream, --green-deep, --text-tert, --text-sec, --gold-lt, --radius-md`).
- **Logo:** horizontal lockup (red maple leaf + green brush-script "Remians Canada" + tagline).
  Embedded as base64 in `index.html` (`const LOGO` = leaf+script, `const LOGO_MARK` = leaf only),
  injected into `img[data-logo]` / `img[data-logo-mark]` by `setLogos()`.

---

## 10. Current state & what's next

**Done:** full public site, live data wired to the Sheet (events/news/welfare), Firebase auth
with two-gate access, five-tier system, warm-minimalist redesign with the new logo, "HSC year"
relabel (label only — `batch_year` column unchanged).

**Open / next candidates:**
- Admin panel (a protected page for the committee to approve members and flip tiers).
- Confirm the Apps Script deployment is current after the latest edits (redeploy a new version).
- Logo assets are base64-inlined (~370KB); optionally move to hosted PNG files for faster first paint.

---

## 11. Conventions for an AI assistant working here

- **Never rename internal column keys** (`batch_year` etc.) even when the UI label changes.
- **Permissions belong in the Apps Script**, never only in the frontend.
- **Firebase = identity only.** Business data lives in the Sheet.
- **Redeploy the Apps Script** (new version) after any backend change.
- **Preserve the functional hooks** in `index.html` when restyling: DOM IDs (`eventList`,
  `newsGrid`, `welfareGrid`, `gateRows`, `gateWrap`, `dirBasic`, `dirFull`, `dirSearch`,
  `modalOverlay`, `toast`), the `su-*`/`li-*` modal input IDs, `data-target` counters, the
  `tag-*`/`nc-bg*` classes the news renderer emits, and the script load order.
- **Keep it zero-cost and no-build** — static files, CDN libraries, no bundler.
