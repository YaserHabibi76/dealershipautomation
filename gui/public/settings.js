async function initSettingsTab() {
  const form = document.getElementById('settings-form');
  const statusEl = document.getElementById('settings-status');
  const keyStateEl = document.getElementById('settings-key-state');

  async function refresh() {
    const data = await Api.get('/api/settings');
    form.elements.headlessDefault.checked = !!data.headlessDefault;
    keyStateEl.textContent = data.hasKey
      ? 'A CapSolver key is currently set. Leave the field blank to keep it.'
      : 'No CapSolver key set — CAPTCHA-protected forms will be reported as CAPTCHA_BLOCKED.';
  }

  try {
    await refresh();
  } catch (e) {
    statusEl.textContent = e.message;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    statusEl.textContent = 'Saving…';
    const payload = { headlessDefault: form.elements.headlessDefault.checked };
    const key = form.elements.capsolverApiKey.value.trim();
    if (key) payload.capsolverApiKey = key;
    try {
      await Api.put('/api/settings', payload);
      form.elements.capsolverApiKey.value = '';
      statusEl.textContent = 'Saved.';
      await refresh();
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });
}
