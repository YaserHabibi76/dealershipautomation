# Deploying to Render

This runs the same Express + Playwright app as local dev, just kept alive on Render
instead of your Mac, with a password gate since it's now reachable by anyone with the
URL. The Docker image (`Dockerfile`) uses Playwright's official base image so Chromium
and its system dependencies are already correctly installed — no extra setup needed.

## Cost note before you start

Persistent storage (so your contact info, dealer lists, and results survive between
deploys and Render's idle spin-down) requires a **paid instance + disk add-on**
(`render.yaml` requests the `starter` plan + a 1GB disk, roughly $7-8/mo total as of
writing — check Render's current pricing). You *can* run this on Render's free tier
instead, but the filesystem resets on every redeploy and after ~15 min of inactivity,
so anything you entered through the GUI (contact info, CapSolver key, uploaded CSVs,
run results) would need re-entering each time. If you want free-tier, remove the
`disk:` block and `DATA_DIR` env var from `render.yaml` before deploying.

## One-time setup

1. Push this repo to GitHub (create an empty repo there, then from this folder):
   ```
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. In the Render dashboard: **New > Blueprint**, connect the GitHub repo. Render reads
   `render.yaml` automatically and provisions the web service + disk.
3. Render will prompt for the `APP_PASSWORD` env var (marked `sync: false` in
   `render.yaml` so it's not stored in the repo) — set it to whatever password you want
   to gate the app with. `SESSION_SECRET` is auto-generated for you.
4. Deploy. First build takes a few minutes (pulling the Playwright base image).

## After it's live

Everything is set up through the GUI itself — there's no server file to manually edit:
- Open the URL, sign in with `APP_PASSWORD`.
- **Settings tab**: enter your CapSolver API key.
- **Run tab**: fill in your contact info, upload a dealer CSV (or use Toyota/Lexus's
  "Scrape now" from the Dealer Lists tab), and start a run.

## Redeploys

Pushing new commits to the connected branch auto-redeploys. Because `/data` is a
persistent disk (not part of the git-tracked code), your contact info, CapSolver key,
dealer lists, and results all survive redeploys untouched.
