async function initDealersTab() {
  const listEl = document.getElementById('dealers-list');
  const importForm = document.getElementById('import-form');
  const importStatus = document.getElementById('import-status');

  async function refresh() {
    const data = await Api.get('/api/dealers');
    listEl.innerHTML = '';
    for (const b of data.brands) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3>${b.label}</h3>
        <p>${b.rowCount} dealers &middot; updated ${new Date(b.updatedAt).toLocaleString()}</p>
        <div class="row">
          ${b.hasScraper ? `<button data-brand="${b.brand}" class="scrape-btn">Scrape now</button>` : '<span class="hint">Import only</span>'}
        </div>
      `;
      listEl.appendChild(card);
    }
    listEl.querySelectorAll('.scrape-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Scraping… see Run tab';
        try {
          await Api.post(`/api/dealers/${btn.dataset.brand}/scrape`);
          switchTab('run');
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
          btn.textContent = 'Scrape now';
        }
      });
    });
    if (window.refreshRunCsvOptions) window.refreshRunCsvOptions();
  }

  await refresh().catch((e) => { importStatus.textContent = e.message; });

  importForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const brand = importForm.elements.brand.value.trim();
    const file = importForm.elements.file.files[0];
    if (!file) return;
    importStatus.textContent = 'Reading file…';
    try {
      const csvText = await file.text();
      await Api.post('/api/dealers/import', { brand, csvText });
      importStatus.textContent = 'Imported.';
      importForm.reset();
      await refresh();
    } catch (e) {
      importStatus.textContent = e.message;
    }
  });

  window.refreshDealersList = refresh;
}
