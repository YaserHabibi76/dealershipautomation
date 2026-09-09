# Deploying to Render

This runs the same Express + Playwright app as local dev, just kept alive on Render
instead of your Mac, with a password gate since it's now reachable by anyone with the
URL. The Docker image (`Dockerfile`) uses Playwright's official base image so Chromium
and its system dependencies are already correctly installed — no extra setup needed.

## Plan: starter (what `render.yaml` is set up for)

`render.yaml` requests Render's `starter` web service plan — ~$7/mo, 0.5 CPU / 512MB
RAM. Originally this ran on the `free` plan (0.1 CPU / 512MB), but that proved too
CPU-starved for reliable Playwright automation: Chromium's internal
actionability/timing checks (is this element done rendering, is the page network-idle,
is this field truly ready for input) kept failing under load in ways that never
reproduced testing the same pages locally. Starter isn't a huge jump in resources, but
it stopped being a tenth of a core, which is what mattered.

Starter also doesn't spin down after ~15 min of inactivity the way free does, so the
app responds instantly instead of a 50+ second cold-start delay on the first request
of a session.

There's still no persistent disk attached, so `/data` (contact info, dealer CSVs,
results) resets on every redeploy — same trade-off as before, just without the
idle-spin-down reset on top of it now. In practice, for occasional use (a run once or
twice a week), you'll be re-entering contact info most sessions, and keeping a local
copy of any dealer CSV that doesn't have a scraper (e.g. Chevrolet's) to re-upload
quickly. Toyota/Lexus can just be re-scraped fresh each time from the Dealer Lists tab.

The CapSolver key is the one exception: it's set as the `CAPSOLVER_API_KEY` env var
(like `APP_PASSWORD`, `sync: false` — entered once in Render's dashboard, not the repo),
so it survives resets. The Settings tab can still set a different key for a one-off
session; that overrides the env var until the next reset.

If you'd rather have contact info / CSVs persist between sessions too, add a disk:
```yaml
disk:
  name: dealer-bot-data
  mountPath: /data
  sizeGB: 1
```
(roughly $0.25/GB/mo on top of the $7/mo instance, as of writing — check Render's
current pricing).

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

## Redeploys

Pushing new commits to the connected branch auto-redeploys. `/data` resets on every
redeploy (no persistent disk — see above), but unlike on the free plan it no longer
also resets from idle spin-down, since starter stays running between sessions. Re-enter
contact info / re-upload CSVs as needed after a redeploy (the CapSolver key survives,
since it's an env var, not `/data`); nothing about the app itself requires manual
fixing after a reset, it's just an empty-state GUI again.
