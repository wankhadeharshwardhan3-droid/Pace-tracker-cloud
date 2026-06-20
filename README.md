# Pace Tra cker — Cloudflare Workers version

This is your app ported from Netlify (Functions + Blobs) to a single
Cloudflare Worker (Workers + KV + Cron Triggers). One project, one deploy,
no separate cron service needed.

## What changed from the Netlify version

| Netlify | Cloudflare Worker |
|---|---|
| `netlify/functions/*.js` (one file per endpoint) | `src/*.js` route handlers, wired together in `src/index.js` |
| `@netlify/blobs` (`getStore`) | Workers KV (`env.PACE_KV`) |
| `netlify.toml` build config | `wrangler.jsonc` |
| Environment variables | Worker **secrets** (`wrangler secret put`) |
| Scheduled Function (`config.schedule`) | Cron Trigger (`triggers.crons` in `wrangler.jsonc`) + `scheduled()` export |
| `public/` folder, served automatically | `public/` folder, served via the `assets` binding |

The frontend (`public/index.html`) needed **zero changes** — it already
calls `/api/auth`, `/api/profile`, etc., which match the routes this
Worker defines.

## One-time setup

You'll need a computer with a terminal for this part (not realistically
doable from a tablet browser, unlike the GitHub web edits you were doing
before). If you don't have one handy, you can also run these commands from
Codespaces / Cloud Shell — just need *a* terminal, not necessarily your
own machine.

### 1. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

This opens a browser tab to authorize Wrangler against your Cloudflare
account.

### 2. Create the KV namespace

```bash
wrangler kv namespace create pace_kv
```

This prints something like:

```
{ binding = "PACE_KV", id = "abcd1234...">
```

Copy that `id` value.

### 3. Update wrangler.jsonc

Open `wrangler.jsonc` in this project and replace
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with the id you just got.

### 4. Set your secrets

Use the **same VAPID keys you already generated** — no need to make new
ones:

```bash
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_CONTACT_EMAIL
wrangler secret put PACE_ADMIN_PASSCODE
```

Each command will prompt you to paste the value. (`PACE_ADMIN_PASSCODE` is
whatever admin password you were using on the Netlify version — check your
Netlify environment variables if you don't remember it.)

### 5. Install dependencies

```bash
npm install
```

### 6. Deploy

```bash
wrangler deploy
```

This prints your live URL, something like:
`https://pace-tracker.<your-subdomain>.workers.dev`

### 7. Test

- Open the printed URL — your Pace site should load exactly as before.
- Test the reminder pipeline manually by visiting:
  `https://pace-tracker.<your-subdomain>.workers.dev/api/send-daily-reminder`
  You should get back JSON like `{"sent":1,"skipped":12,"failed":0,"total":13}`,
  same shape as the Netlify version.
- The cron trigger fires automatically every day at 16:30 UTC (10:00 PM
  IST) — no further action needed. To confirm it's registered, go to the
  Cloudflare dashboard → Workers & Pages → pace-tracker → Settings →
  Triggers → Cron Triggers, and you should see `30 16 * * *` listed.

## Re-deploying after future edits

Unlike Netlify (where every GitHub commit auto-triggers a deploy and costs
credits), this Worker only deploys when you explicitly run:

```bash
wrangler deploy
```

So you can edit freely and only "spend" a deploy when you're actually
ready — no surprise credit consumption from incremental commits.

## Moving existing user accounts and data over

Your current users (the ones who already signed up on the Netlify
version) don't need to do anything different — they'll keep using the
same name and PIN they already chose, on the new URL. This is a one-time
export/import you do before telling them about the new link.

### Step 1: Export from Netlify

A temporary export function (`export-data.js`) has been added to your
**Netlify** project at `netlify/functions/export-data.js`. Upload it the
same way you uploaded the other function files (GitHub → that folder →
Add file → Upload files), commit, let it redeploy.

Then visit, in your browser:

```
https://gmcapace.netlify.app/.netlify/functions/export-data?passcode=YOUR_ADMIN_PASSCODE
```

(Replace `YOUR_ADMIN_PASSCODE` with whatever admin passcode you already
use to log in as admin on the Pace app.)

This downloads a file, `pace-export.json`, containing every account and
every person's study data.

**Important:** once you've confirmed the migration worked (see Step 4),
delete `export-data.js` from your Netlify repo and redeploy — it's a
sensitive endpoint (it dumps password hashes) and shouldn't stay live
longer than needed.

### Step 2: Transform the export into KV's bulk-upload format

On the same computer where you're running `wrangler` commands, with this
project folder open:

```bash
node migrate-to-kv.js pace-export.json kv-bulk-upload.json
```

This prints how many accounts it found, and writes `kv-bulk-upload.json`.

### Step 3: Upload into your KV namespace

```bash
wrangler kv bulk put --namespace-id <your-namespace-id> kv-bulk-upload.json
```

Use the same namespace ID you already put into `wrangler.jsonc`.

### Step 4: Verify before telling anyone

Visit your new Worker URL and try logging in with one of the existing
names and PINs — it should work exactly like before, with that person's
existing goal and logged hours showing up. Try a couple of different
accounts to be confident, then move on to Step 1's cleanup (deleting
`export-data.js` from Netlify).

### What does NOT carry over (intentionally)

- **Active sessions** — everyone will need to log in again with their PIN
  once, on the new URL. This is expected and fine; sessions are meant to
  be short-lived anyway.
- **In-progress WebAuthn challenges** — these are 5-minute temporary
  values, irrelevant by the time you migrate.

Both Face ID / fingerprint registrations (`webauthnCredential`) *do*
carry over as part of the account record, so people who set up biometric
login won't need to redo that step — just their first login after the
move needs to be with their PIN (since the passkey is bound to the old
domain's origin in the browser; once they're on the new domain they can
re-register Face ID/fingerprint there if they want it again).

