async function loadResultsFileList() {
  const select = document.getElementById('results-file-select');
  const current = select.value;
  const data = await Api.get('/api/results/list');
  select.innerHTML = '';
  for (const f of data.files) {
    const opt = document.createElement('option');
    opt.value = f.file;
    opt.textContent = `${f.name} (${f.rowCount} rows)`;
    select.appendChild(opt);
  }
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
  return data.files;
}

function renderResultsTable(rows) {
  const tbody = document.querySelector('#results-table tbody');
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.name || ''}</td>
      <td>${r.city || ''}</td>
      <td><span class="badge badge-${r.status}">${r.status}</span></td>
      <td>${r.notes || ''}</td>
    </tr>`
    )
    .join('');
}

function renderResultsCounts(counts) {
  document.getElementById('results-counts').innerHTML = Object.entries(counts || {})
    .map(([k, v]) => `<span class="badge badge-${k}">${k}: ${v}</span>`)
    .join('');
}

async function loadSelectedResults() {
  const select = document.getElementById('results-file-select');
  const statusEl = document.getElementById('results-status');
  if (!select.value) {
    renderResultsTable([]);
    renderResultsCounts({});
    return;
  }
  try {
    const data = await Api.get(`/api/results?file=${encodeURIComponent(select.value)}`);
    renderResultsTable(data.rows);
    renderResultsCounts(data.counts);
    statusEl.textContent = '';
  } catch (e) {
    statusEl.textContent = e.message;
  }
}

window.refreshResultsList = async () => {
  await loadResultsFileList();
  await loadSelectedResults();
};

async function initResultsTab() {
  const select = document.getElementById('results-file-select');
  const refreshBtn = document.getElementById('results-refresh-btn');
  const retryBtn = document.getElementById('results-retry-btn');
  const statusEl = document.getElementById('results-status');

  await loadResultsFileList().catch((e) => { statusEl.textContent = e.message; });
  await loadSelectedResults();

  select.addEventListener('change', loadSelectedResults);
  refreshBtn.addEventListener('click', async () => {
    await loadResultsFileList();
    await loadSelectedResults();
  });

  retryBtn.addEventListener('click', async () => {
    if (!select.value) return;
    statusEl.textContent = 'Building retry CSV…';
    try {
      const data = await Api.post('/api/results/retry', { resultsFile: select.value });
      statusEl.textContent = `Retry CSV ready: ${data.rowCount} dealer(s).`;
      if (window.addRunCsvOption) window.addRunCsvOption(data.file, `Retry batch (${data.rowCount})`);
      switchTab('run');
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });
}
