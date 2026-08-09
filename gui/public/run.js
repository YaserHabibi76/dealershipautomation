let runEventSource = null;

async function populateRunCsvOptions() {
  const select = document.getElementById('run-csv-select');
  const current = select.value;
  const data = await Api.get('/api/dealers');
  select.innerHTML = '';
  for (const b of data.brands) {
    const opt = document.createElement('option');
    opt.value = b.brand;
    opt.textContent = `${b.label} (${b.rowCount})`;
    select.appendChild(opt);
  }
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}
window.refreshRunCsvOptions = populateRunCsvOptions;

window.addRunCsvOption = function addRunCsvOption(value, label) {
  const select = document.getElementById('run-csv-select');
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
  select.value = value;
  const form = document.getElementById('run-form');
  form.elements.csvSource.value = 'existing';
  updateCsvSourceUI(form);
};

function setRunButtons(active) {
  document.getElementById('run-start-btn').disabled = active;
  document.getElementById('run-stop-btn').disabled = !active;
}

function renderRunState(state) {
  setRunButtons(state.active);
  const progressWrap = document.getElementById('run-progress');
  const fill = document.getElementById('run-progress-fill');
  const label = document.getElementById('run-progress-label');
  const countsEl = document.getElementById('run-counts');

  if (state.type === 'bot' && (state.active || state.totalRows > 0)) {
    progressWrap.classList.remove('hidden');
    const pct = state.totalRows ? Math.round((state.currentIndex / state.totalRows) * 100) : 0;
    fill.style.width = `${pct}%`;
    label.textContent = state.active
      ? `${state.currentIndex}/${state.totalRows} — ${state.label}`
      : `Finished — ${state.currentIndex}/${state.totalRows} (exit code ${state.exitCode})`;
  } else {
    progressWrap.classList.add('hidden');
  }

  countsEl.innerHTML = Object.entries(state.counts || {})
    .map(([k, v]) => `<span class="badge badge-${k}">${k}: ${v}</span>`)
    .join('');
}

function appendLogLine(line) {
  const pre = document.getElementById('run-log');
  pre.textContent += line + '\n';
  pre.scrollTop = pre.scrollHeight;
}

function connectRunStream() {
  if (runEventSource) return;
  runEventSource = new EventSource('/api/run/stream');
  runEventSource.addEventListener('log', (ev) => {
    appendLogLine(JSON.parse(ev.data).line);
  });
  runEventSource.addEventListener('state', (ev) => {
    renderRunState(JSON.parse(ev.data));
  });
  runEventSource.addEventListener('done', async () => {
    setRunButtons(false);
    if (window.refreshResultsList) await window.refreshResultsList();
  });
}

function updateCsvSourceUI(form) {
  const uploading = form.elements.csvSource.value === 'upload';
  document.getElementById('run-upload-fields').classList.toggle('hidden', !uploading);
  form.elements.csvIn.disabled = uploading;
  form.elements.uploadFile.required = uploading;
}

function slugifyBrand(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function initRunTab() {
  await populateRunCsvOptions().catch(() => {});

  const form = document.getElementById('run-form');
  const stopBtn = document.getElementById('run-stop-btn');
  const statusEl = document.getElementById('run-form-status');

  try {
    const contact = await Api.get('/api/contact');
    for (const [k, v] of Object.entries(contact)) {
      if (form.elements[k]) form.elements[k].value = v;
    }
  } catch (e) {
    statusEl.textContent = e.message;
  }

  try {
    const settings = await Api.get('/api/settings');
    form.elements.headed.checked = !settings.headlessDefault;
  } catch {}

  form.querySelectorAll('input[name="csvSource"]').forEach((r) => {
    r.addEventListener('change', () => updateCsvSourceUI(form));
  });
  updateCsvSourceUI(form);

  connectRunStream();

  try {
    renderRunState(await Api.get('/api/run/status'));
  } catch {}

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    statusEl.textContent = '';
    document.getElementById('run-log').textContent = '';

    const contactPayload = {
      firstName: form.elements.firstName.value,
      lastName: form.elements.lastName.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value,
      message: form.elements.message.value,
    };

    try {
      await Api.put('/api/contact', contactPayload);
    } catch (e) {
      statusEl.textContent = `Contact info: ${e.message}`;
      return;
    }

    let csvIn;
    if (form.elements.csvSource.value === 'upload') {
      const file = form.elements.uploadFile.files[0];
      if (!file) {
        statusEl.textContent = 'Choose a CSV file to upload.';
        return;
      }
      const brand = slugifyBrand(form.elements.uploadBrand.value) || slugifyBrand(file.name) || `list-${Date.now()}`;
      statusEl.textContent = 'Uploading CSV…';
      try {
        const csvText = await file.text();
        const imported = await Api.post('/api/dealers/import', { brand, csvText, overwrite: true });
        csvIn = imported.brand;
        if (window.refreshDealersList) await window.refreshDealersList();
      } catch (e) {
        statusEl.textContent = e.message;
        return;
      }
    } else {
      csvIn = form.elements.csvIn.value;
    }

    const payload = {
      csvIn,
      dryRun: form.elements.dryRun.checked,
      headed: form.elements.headed.checked,
    };
    try {
      statusEl.textContent = '';
      await Api.post('/api/run/start', payload);
      setRunButtons(true);
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      await Api.post('/api/run/stop');
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });
}
