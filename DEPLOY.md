# Deploying to Render

This runs the same Express + Playwright app as local dev, just kept alive on Render
instead of your Mac, with a password gate since it's now reachable by anyone with the
URL. The Docker image (`Dockerfile`) uses Playwright's official base image so Chromium
and its system dependencies are already correctly installed — no extra setup needed.

## Free tier (what `render.yaml` is set up for)

`render.yaml` requests Render's `free` web service plan — $0/mo, no card or trial
required. The trade-off: there's no persistent disk on free tier, so `/data` (contact
info, dealer CSVs, results) resets on every redeploy and after ~15 min of inactivity.
In practice, for occasional use (a run once or twice a week), you'll be re-entering
contact info most sessions, and keeping a local copy of any dealer CSV that doesn't
have a scraper (e.g. Chevrolet's) to re-upload quickly. Toyota/Lexus can just be
re-scraped fresh each time from the Dealer Lists tab.

The CapSolver key is the one exception: it's set as the `CAPSOLVER_API_KEY` env var
(like `APP_PASSWORD`, `sync: false` — entered once in Render's dashboard, not the repo),
so it survives resets. The Settings tab can still set a different key for a one-off
session; that overrides the env var until the next reset.

If you'd rather have things persist between sessions, add a paid instance + disk
instead — swap `plan: free` for `plan: starter` and add back:
```yaml
disk:
  name: dealer-bot-data
  mountPath: /data
  sizeGB: 1
```
(roughly $7-8/mo total as of writing — check Render's current pricing).

## One-time setup

1. Push this repo to GitHub (create an empty repo there, then from this folder):
   ```
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. In the Render dashboard: **New > Blueprint**, connect the GitHub repo. Render reads
   `render.yaml` automatically and provisions the web service.
3. Render will prompt for the `APP_PASSWORD` and `CAPSOLVER_API_KEY` env vars (marked
   `sync: false` in `render.yaml` so neither is stored in the repo) — set `APP_PASSWORD`
   to whatever password you want to gate the app with, and `CAPSOLVER_API_KEY` to your
   CapSolver key. `SESSION_SECRET` is auto-generated for you.
4. Deploy. First build takes a few minutes (pulling the Playwright base image).

## After it's live

Everything is set up through the GUI itself — there's no server file to manually edit:
- Open the URL, sign in with `APP_PASSWORD`.
- **Settings tab**: the CapSolver key from the `CAPSOLVER_API_KEY` env var is already
  active; only touch this tab if you want to use a different key for one session.
- **Run tab**: fill in your contact info, upload a dealer CSV (or use Toyota/Lexus's
  "Scrape now" from the Dealer Lists tab), and start a run.

## Redeploys / idle spin-down

Pushing new commits to the connected branch auto-redeploys. On the free plan this also
means `/data` resets — same as after ~15 min of inactivity. Re-enter contact info /
re-upload CSVs as needed each session (the CapSolver key survives, since it's an env
var, not `/data`); nothing about the app itself requires manual fixing after a reset,
it's just an empty-state GUI again.
