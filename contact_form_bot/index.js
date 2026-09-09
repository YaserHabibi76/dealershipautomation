const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// CapSolver key lives in config.json (gitignored), editable via the GUI Settings tab.
// See config.example.json for the shape. CAPSOLVER_CONFIG_PATH lets the GUI point this
// at a persistent-disk location when deployed (code dir is ephemeral there); defaults
// to the same relative path as before for plain CLI usage.
const configFile = process.env.CAPSOLVER_CONFIG_PATH || path.resolve(__dirname, 'config.json');
let localConfig = {};
if (fs.existsSync(configFile)) {
  try { localConfig = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch (e) { console.error(`Warning: could not parse config.json (${e.message}); ignoring.`); }
}
// Falls back to the CAPSOLVER_API_KEY env var (set in Render's Environment tab, same
// as APP_PASSWORD) so the key survives free-tier disk resets between sessions.
const CAPSOLVER_API_KEY = localConfig.capsolverApiKey || process.env.CAPSOLVER_API_KEY || 'YOUR_KEY_HERE';

// Load contact details from contact.json (edit that file to change them).
// CONTACT_PATH overrides for the same reason as CAPSOLVER_CONFIG_PATH above.
const contactFile = process.env.CONTACT_PATH || path.resolve(__dirname, '../contact.json');
if (!fs.existsSync(contactFile)) {
  console.error('Missing contact.json — create it in the project root with firstName, lastName, email, phone, message.');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(contactFile, 'utf8'));
const missing = ['firstName', 'lastName', 'email', 'phone', 'message'].filter(k => !raw[k]);
if (missing.length) {
  console.error(`contact.json is missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}
const CONTACT = {
  firstName: raw.firstName,
  lastName:  raw.lastName,
  fullName:  `${raw.firstName} ${raw.lastName}`,
  email:     raw.email,
  phone:     raw.phone,
  message:   raw.message,
};

const DRY_RUN  = process.argv.includes('--dry-run');
const HEADLESS = !process.argv.includes('--headed');

// The GUI's Stop button sends SIGTERM. Node's default is to kill the process
// immediately on that signal — but Playwright appears to intercept it to close
// the browser first, and an in-flight page operation racing that closure then
// throws as an uncaught exception (looks like a crash, isn't one). Registering
// a handler takes over shutdown ourselves: the main loop checks this flag and
// exits cleanly at the next safe point instead.
let shuttingDown = false;
process.on('SIGTERM', () => { shuttingDown = true; });

function argValue(flag, fallback) {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  return arg ? arg.slice(flag.length + 3) : fallback;
}

const CSV_IN  = path.resolve(__dirname, argValue('csv', '../ontario_chevrolet_dealerships.csv'));
const CSV_OUT = path.resolve(__dirname, argValue('out', 'results.csv'));

const SELECTORS = {
  firstName: [
    'input[name*="first" i]:not([type="hidden"])',
    'input[id*="first" i]:not([type="hidden"])',
    'input[placeholder*="first" i]',
    'input[aria-label*="first name" i]',
  ],
  lastName: [
    'input[name*="last" i]:not([type="hidden"])',
    'input[id*="last" i]:not([type="hidden"])',
    'input[placeholder*="last" i]',
    'input[aria-label*="last name" i]',
  ],
  fullName: [
    'input[name="name"]:not([type="hidden"])',
    'input[name*="fullname" i]:not([type="hidden"])',
    'input[name*="full_name" i]:not([type="hidden"])',
    'input[placeholder*="full name" i]',
    'input[placeholder*="your name" i]',
  ],
  email: [
    'input[type="email"]',
    'input[name*="email" i]:not([type="hidden"])',
    'input[id*="email" i]:not([type="hidden"])',
    'input[placeholder*="email" i]',
  ],
  phone: [
    'input[type="tel"]',
    'input[name*="phone" i]:not([type="hidden"])',
    'input[name*="mobile" i]:not([type="hidden"])',
    'input[id*="phone" i]:not([type="hidden"])',
    'input[placeholder*="phone" i]',
  ],
  message: [
    'textarea[name*="comment" i]',
    'textarea[name*="message" i]',
    'textarea[name*="note" i]',
    'textarea[id*="comment" i]',
    'textarea[id*="message" i]',
    'textarea',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Send")',
    'button:has-text("Submit")',
    'button:has-text("Contact Us")',
    '[class*="submit" i]:not(form)',
  ],
};

async function detectCaptcha(page) {
  try {
    return await page.evaluate(() => {
      // hCaptcha
      const hc = document.querySelector('.h-captcha[data-sitekey]') ||
                 document.querySelector('iframe[src*="hcaptcha"]');
      if (hc) {
        const key = hc.getAttribute('data-sitekey') ||
          new URL(hc.src || 'https://x').searchParams.get('sitekey');
        return { type: 'hcaptcha', sitekey: key, invisible: false };
      }
      // reCAPTCHA v2 (visible or invisible)
      const rc = document.querySelector('.g-recaptcha[data-sitekey]');
      if (rc) {
        const key = rc.getAttribute('data-sitekey');
        const invisible = rc.getAttribute('data-size') === 'invisible';
        return { type: 'recaptcha', sitekey: key, invisible };
      }
      // reCAPTCHA loaded via iframe (v2 or v3)
      const iframe = document.querySelector('iframe[src*="recaptcha"]');
      if (iframe) {
        const url = new URL(iframe.src);
        const key = url.searchParams.get('k');
        // /enterprise/ or /api2/bframe = v2; /api2/anchor = v3 check via path
        const invisible = iframe.src.includes('invisible') || iframe.src.includes('bframe');
        return { type: 'recaptcha', sitekey: key, invisible };
      }
      // Generic data-sitekey fallback
      const generic = document.querySelector('[data-sitekey]');
      if (generic) {
        return { type: 'recaptcha', sitekey: generic.getAttribute('data-sitekey'), invisible: false };
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function capsolverRequest(endpoint, body) {
  const res = await fetch(`https://api.capsolver.com/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, ...body }),
  });
  return res.json();
}

async function solveCaptcha(page, pageUrl, captcha) {
  let taskType, taskExtras = {};
  if (captcha.type === 'hcaptcha') {
    taskType = 'HCaptchaTaskProxyless';
  } else if (captcha.invisible) {
    taskType = 'ReCaptchaV2TaskProxyless';
    taskExtras = { isInvisible: true };
  } else {
    taskType = 'ReCaptchaV2TaskProxyless';
  }

  const created = await capsolverRequest('createTask', {
    task: { type: taskType, websiteURL: pageUrl, websiteKey: captcha.sitekey, ...taskExtras },
  });
  if (created.errorId !== 0) throw new Error(`CapSolver: ${created.errorDescription}`);

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    const result = await capsolverRequest('getTaskResult', { taskId: created.taskId });
    if (result.errorId !== 0) throw new Error(`CapSolver: ${result.errorDescription}`);
    if (result.status === 'ready') {
      const token = result.solution.gRecaptchaResponse;
      await page.evaluate(({ token, type }) => {
        const field = document.querySelector(
          type === 'hcaptcha' ? '[name="h-captcha-response"]' : '[name="g-recaptcha-response"]'
        );
        if (field) field.value = token;
        const widget = document.querySelector(type === 'hcaptcha' ? '.h-captcha' : '.g-recaptcha');
        const cb = widget?.getAttribute('data-callback');
        if (cb && window[cb]) window[cb](token);
      }, { token, type: captcha.type });
      return;
    }
  }
  throw new Error('CapSolver timed out after 90s');
}

// Dealer sites often have several elements matching the same selector — a
// hidden "quick email" sidebar widget or chat popup frequently appears earlier
// in the DOM than the real, visible contact form. Checking only .first() means
// a single hidden decoy permanently blocks that selector from ever reaching
// the real field, so every match is scanned until a visible one is found.
async function findFirst(scope, selectors) {
  for (const sel of selectors) {
    try {
      const loc = scope.locator(sel);
      const count = await loc.count();
      for (let i = 0; i < Math.min(count, 25); i++) {
        const el = loc.nth(i);
        if (await el.isVisible({ timeout: 400 })) return el;
      }
    } catch {}
  }
  return null;
}

// Non-mutating check of how many field categories are present & visible in a
// given scope (Page or Frame) — used to pick the right form among decoys
// (quick-email widgets, chat popups, etc.) without touching any of them.
async function scanScope(scope) {
  let count = 0;
  const hasName = (await findFirst(scope, SELECTORS.firstName)) && (await findFirst(scope, SELECTORS.lastName));
  if (hasName) count += 2;
  else if (await findFirst(scope, [...SELECTORS.fullName, ...SELECTORS.firstName])) count += 1;
  if (await findFirst(scope, SELECTORS.email)) count++;
  if (await findFirst(scope, SELECTORS.phone)) count++;
  if (await findFirst(scope, SELECTORS.message)) count++;
  return count;
}

// Contact forms are frequently embedded in a CRM iframe (Dealer.com, xSellerator, …)
// rather than the top-level document, so every frame is a candidate scope.
function getScopes(page) {
  return [page, ...page.frames().filter(f => f !== page.mainFrame())];
}

async function findBestScope(page) {
  let best = { scope: page, count: 0 };
  for (const scope of getScopes(page)) {
    let count = 0;
    try { count = await scanScope(scope); } catch {}
    if (count > best.count) best = { scope, count };
  }
  return best;
}

async function dismissCookieBanner(page) {
  try {
    const btn = page.locator(
      'button:has-text("Accept All"), button:has-text("Accept all"), button:has-text("Accept"), ' +
      'button:has-text("I Agree"), button:has-text("Got it"), #onetrust-accept-btn-handler'
    ).first();
    if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 1500 });
  } catch {}
}

// Many dealer sites keep the real contact form hidden in a modal/popup until a
// "Contact Us"-ish trigger is clicked, or render it in late-loading JS. There is
// often more than one matching trigger on a page (a header nav link that just
// re-navigates, plus the real "Send Us A Message" button) — clicking only the
// first one silently no-ops, so every candidate is tried in turn until the
// field count actually improves.
async function revealMore(page, attempt, baselineCount) {
  try {
    if (attempt === 0) {
      const count = await page.evaluate(() => {
        const re = /^(contact( us)?|get in touch|send( us)? a message|request info|inquire now|email us)$/i;
        return [...document.querySelectorAll('a,button')].filter(el => re.test((el.textContent || '').trim())).length;
      });
      for (let i = 0; i < Math.min(count, 5); i++) {
        try {
          await page.evaluate((idx) => {
            const re = /^(contact( us)?|get in touch|send( us)? a message|request info|inquire now|email us)$/i;
            const els = [...document.querySelectorAll('a,button')].filter(el => re.test((el.textContent || '').trim()));
            if (els[idx]) els[idx].click();
          }, i);
        } catch {}
        await page.waitForTimeout(1200);
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        const rescan = await findBestScope(page);
        if (rescan.count > baselineCount) return true;
      }
      return false;
    } else if (attempt === 1) {
      await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// A single slow/stuck field (Playwright's actionability wait can hang up to
// its timeout under a CPU-starved host — see Render free-tier notes) used to
// take down the whole dealer via an uncaught rejection here. Now it just
// doesn't count as filled, so the rest of the form still gets a shot.
async function safeFill(el, value, timeout = 12000) {
  try {
    await el.fill(value, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function fillForm(page) {
  let filled = 0;

  const firstEl = await findFirst(page, SELECTORS.firstName);
  const lastEl  = await findFirst(page, SELECTORS.lastName);

  if (firstEl && lastEl) {
    if (await safeFill(firstEl, CONTACT.firstName)) filled++;
    if (await safeFill(lastEl, CONTACT.lastName)) filled++;
  } else {
    const nameEl = await findFirst(page, [...SELECTORS.fullName, ...SELECTORS.firstName]);
    if (nameEl && await safeFill(nameEl, CONTACT.fullName)) filled++;
  }

  const emailEl = await findFirst(page, SELECTORS.email);
  if (emailEl && await safeFill(emailEl, CONTACT.email)) filled++;

  const phoneEl = await findFirst(page, SELECTORS.phone);
  if (phoneEl && await safeFill(phoneEl, CONTACT.phone)) filled++;

  const msgEl = await findFirst(page, SELECTORS.message);
  if (msgEl && await safeFill(msgEl, CONTACT.message)) filled++;

  // Select best-match option in any department/type dropdown — prefer Sales, fall back to General
  try {
    const dropdowns = page.locator('select[name*="subject" i], select[name*="type" i], select[name*="inquiry" i], select[name*="reason" i], select[name*="department" i], select[name*="interest" i]');
    const count = await dropdowns.count();
    for (let i = 0; i < count; i++) {
      const dd = dropdowns.nth(i);
      if (await dd.isVisible({ timeout: 400 })) {
        const options = await dd.locator('option').allTextContents();
        const pick =
          options.find(o => /new (car|vehicle|truck|ev|sales)/i.test(o)) ||
          options.find(o => /^sales$/i.test(o.trim())) ||
          options.find(o => /\bsales\b/i.test(o)) ||
          options.find(o => /general|inquiry|information|other/i.test(o));
        if (pick) await dd.selectOption({ label: pick });
      }
    }
  } catch {}

  return filled;
}

async function detectSuccess(scope, urlBefore) {
  try {
    await scope.waitForFunction(
      (before) => location.href !== before ||
        /(thank you|thanks|message sent|we.ll be in touch|received your|get back to you)/i.test(document.body.innerText),
      urlBefore,
      { timeout: 6000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function processDealer(page, row) {
  const url  = row['Contact Page URL'];
  const name = row['Dealership Name'];
  const city = row['City'];

  if (!url || url === 'N/A') {
    return { name, city, url: 'N/A', status: 'SKIPPED', notes: 'No contact URL in CSV' };
  }

  try {
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    // Best-effort extra wait for slow/JS-heavy pages (e.g. under Render's
    // resource-constrained free tier, form widgets can render well after the
    // fixed 2s above) — bounded so pages with permanent background chatter
    // (chat widgets, analytics polling) don't stall the whole run.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await dismissCookieBanner(page);

    // Up to 3 real attempts to locate a fillable form: as-loaded, after
    // clicking a contact/get-in-touch trigger (reveals hidden modals), and
    // after a full reload with a longer wait (catches slow/late JS widgets).
    // Every frame (including embedded CRM iframes) is scanned each time.
    let best = await findBestScope(page);
    let attempt = 0;
    const triedStrategies = ['direct scan + iframe scan'];
    while (best.count < 2 && attempt < 2) {
      const revealed = await revealMore(page, attempt, best.count);
      triedStrategies.push(attempt === 0 ? 'click contact/reveal trigger' : 'reload + longer wait');
      attempt++;
      if (!revealed) continue;
      const rescan = await findBestScope(page);
      if (rescan.count > best.count) best = rescan;
    }

    const captchaScope = best.scope;
    const captcha = await detectCaptcha(captchaScope);
    if (captcha) {
      if (!CAPSOLVER_API_KEY || CAPSOLVER_API_KEY === 'YOUR_KEY_HERE') {
        return { name, city, url, status: 'CAPTCHA_BLOCKED', notes: 'Set CAPSOLVER_API_KEY to solve automatically' };
      }
      try {
        await solveCaptcha(captchaScope, captchaScope.url ? captchaScope.url() : url, captcha);
      } catch (err) {
        return { name, city, url, status: 'CAPTCHA_ERROR', notes: err.message.slice(0, 150) };
      }
    }

    if (best.count < 2) {
      return {
        name, city, url, status: 'FORM_NOT_FOUND',
        notes: `Only ${best.count} field(s) matched after ${attempt + 1} attempts (${triedStrategies.join(' -> ')})`,
      };
    }

    const filled = await fillForm(best.scope);
    if (filled < 2) {
      return { name, city, url, status: 'FORM_NOT_FOUND', notes: `Only ${filled} field(s) matched on fill` };
    }

    if (DRY_RUN) {
      return { name, city, url, status: 'DRY_RUN', notes: `${filled} fields filled, not submitted` };
    }

    const submitEl = await findFirst(best.scope, SELECTORS.submit);
    if (!submitEl) {
      return { name, city, url, status: 'FORM_NOT_FOUND', notes: 'No submit button found' };
    }

    const urlBefore = best.scope.url ? best.scope.url() : page.url();
    await submitEl.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await submitEl.click({ timeout: 10000 });
    } catch {
      await submitEl.click({ timeout: 5000, force: true });
    }
    const success = await detectSuccess(best.scope, urlBefore);
    const finalUrl = page.url();

    return {
      name, city, url,
      status: success ? 'SUBMITTED' : 'UNCERTAIN',
      notes: success ? (finalUrl !== url ? `Redirected to ${finalUrl}` : '') : `Clicked submit but no confirmation detected — check manually`,
    };

  } catch (err) {
    return { name, city, url, status: 'ERROR', notes: err.message.slice(0, 150) };
  }
}

(async () => {
  const rows = parse(fs.readFileSync(CSV_IN), { columns: true, skip_empty_lines: true });

  const alreadySubmitted = new Set();
  if (fs.existsSync(CSV_OUT)) {
    const prev = parse(fs.readFileSync(CSV_OUT), { columns: true, skip_empty_lines: true });
    prev.filter(r => r.status === 'SUBMITTED').forEach(r => alreadySubmitted.add(r.name));
    if (alreadySubmitted.size > 0)
      console.log(`Resuming — skipping ${alreadySubmitted.size} already SUBMITTED.\n`);
  }

  console.log(`Loaded ${rows.length} dealers.  DRY_RUN=${DRY_RUN}  HEADLESS=${HEADLESS}\n`);

  async function launchBrowserContext() {
    const b = await chromium.launch({ headless: HEADLESS });
    const c = await b.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    return { browser: b, context: c };
  }

  let { browser, context } = await launchBrowserContext();
  // Bounds memory growth from 147 sequential different sites' cookies/cache
  // by periodically starting fresh, rather than waiting to see if a long run
  // ever actually exhausts memory under Render free tier's limit.
  const RECYCLE_EVERY = 20;

  const results = [];

  for (let i = 0; i < rows.length; i++) {
    if (shuttingDown) { console.log('\n[stopped]'); break; }
    const row = rows[i];

    if (alreadySubmitted.has(row['Dealership Name'])) {
      process.stdout.write(`[${i + 1}/${rows.length}] ${row['Dealership Name']} (${row['City']}) ... SKIPPED (already submitted)\n`);
      results.push({ name: row['Dealership Name'], city: row['City'], url: row['Contact Page URL'], status: 'SUBMITTED', notes: 'Previously submitted' });
      continue;
    }

    if (i > 0 && i % RECYCLE_EVERY === 0 && browser.isConnected()) {
      console.log('[recycling browser to bound memory growth]');
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      ({ browser, context } = await launchBrowserContext());
    }

    process.stdout.write(`[${i + 1}/${rows.length}] ${row['Dealership Name']} (${row['City']}) ... `);

    // Fresh page per dealer — prevents redirects from one site bleeding into the next.
    // A newPage() failure here is only ever a genuine unexpected browser crash
    // (not a stop request — shuttingDown is checked above, before this point,
    // so a real Stop click never reaches this catch block), so relaunching and
    // retrying is always the right call.
    let page;
    try {
      page = await context.newPage();
    } catch (err) {
      console.log(`\n[browser died — relaunching] ${err.message}`);
      ({ browser, context } = await launchBrowserContext());
      try {
        page = await context.newPage();
      } catch (err2) {
        const result = { name: row['Dealership Name'], city: row['City'], url: row['Contact Page URL'], status: 'ERROR', notes: `Browser relaunch failed: ${err2.message}`.slice(0, 150) };
        results.push(result);
        console.log(result.status + `  — ${result.notes}`);
        fs.writeFileSync(CSV_OUT, stringify(results, { header: true, columns: ['name', 'city', 'url', 'status', 'notes'] }));
        continue;
      }
    }
    const result = await processDealer(page, row);
    await page.close().catch(() => {});

    results.push(result);
    console.log(result.status + (result.notes ? `  — ${result.notes}` : ''));

    fs.writeFileSync(
      CSV_OUT,
      stringify(results, { header: true, columns: ['name', 'city', 'url', 'status', 'notes'] })
    );

    if (!DRY_RUN && result.status === 'SUBMITTED') {
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  await browser.close().catch(() => {});

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  console.log('\n── Summary ──────────────────────────────────');
  Object.entries(counts).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`));
  console.log(`\nFull results → ${CSV_OUT}`);
})();
