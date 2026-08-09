const { chromium } = require('./contact_form_bot/node_modules/playwright');
const fs   = require('fs');
const path = require('path');
const { stringify } = require('./contact_form_bot/node_modules/csv-stringify/dist/cjs/sync.cjs');

// SCRAPE_OUTPUT lets the GUI redirect this to a persistent-disk data dir when deployed.
const CSV_OUT = process.env.SCRAPE_OUTPUT || path.resolve(__dirname, 'lexus_ontario_dealerships.csv');
const HEADED  = process.argv.includes('--headed');

// Lexus Canada dealersList API — triggered when user types a province name
const DEALERS_API = 'https://www.lexus.ca/bin/find_a_dealer/dealersList'
  + '?brand=lexus&language=en&userInput=Ontario'
  + '&latitude=51.253775&longitude=-85.3232139'
  + '&scenario=proximity&dayOfWeek=tuesday';

const CONTACT_PATHS = [
  '/contact/', '/contact-us/', '/contactus/',
  '/en/contact/', '/en/contact-us/',
  '/contact', '/contact-us', '/contactus',
];

async function fetchDealers() {
  const res = await fetch(DEALERS_API, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, */*',
      'Referer': 'https://www.lexus.ca/en/dealers/',
    },
  });
  if (!res.ok) throw new Error(`Dealer API returned ${res.status}`);
  const json = await res.json();
  const all = json.dealers || json;
  return all.filter(d => d.province === 'ON');
}

async function findContactUrl(context, siteUrl) {
  const page = await context.newPage();
  try {
    const r = await page.goto(siteUrl, { timeout: 20000, waitUntil: 'domcontentloaded' });
    if (!r || r.status() >= 400) return 'N/A';
    await page.waitForTimeout(1000);

    const found = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href]')];
      // Exact nav label
      const exact = links.find(a =>
        /^contact( us)?$/i.test(a.textContent.trim()) && /^https?:/.test(a.href)
      );
      if (exact) return exact.href;
      // Path ends with /contact or /contact-us
      const byPath = links.find(a => /\/contact(?:-us|us)?[/#?]?$/i.test(new URL(a.href).pathname));
      if (byPath) return byPath.href;
      // Any contact href, not mailto
      const any = links.find(a => /contact/i.test(a.href) && !/mailto/i.test(a.href) && /^https?:/.test(a.href));
      return any ? any.href : null;
    });
    if (found) return found;

    const origin = new URL(siteUrl).origin;
    for (const p of CONTACT_PATHS) {
      try {
        const r2 = await page.goto(origin + p, { timeout: 8000, waitUntil: 'domcontentloaded' });
        if (r2 && r2.status() < 400) return origin + p;
      } catch {}
    }
    return 'N/A';
  } catch {
    return 'N/A';
  } finally {
    await page.close();
  }
}

(async () => {
  console.log('Fetching Ontario Lexus dealers from Lexus Canada API…');
  const dealers = await fetchDealers();
  console.log(`Found ${dealers.length} Ontario dealers.\n`);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const rows = [];
  for (let i = 0; i < dealers.length; i++) {
    const { name, city, website } = dealers[i];
    const siteUrl = (website || '').replace(/\/$/, '');
    process.stdout.write(`[${i + 1}/${dealers.length}] ${name} (${city}) … `);

    const contactUrl = siteUrl ? await findContactUrl(context, siteUrl) : 'N/A';
    console.log(contactUrl);

    rows.push({ 'Dealership Name': name, City: city, Website: siteUrl, 'Contact Page URL': contactUrl });
    fs.writeFileSync(CSV_OUT, stringify(rows, { header: true }));
  }

  await browser.close();
  console.log(`\nDone! ${rows.length} dealers → ${CSV_OUT}`);
})();
