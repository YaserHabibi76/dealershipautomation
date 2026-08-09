async function initContactTab() {
  const form = document.getElementById('contact-form');
  const statusEl = document.getElementById('contact-status');

  try {
    const data = await Api.get('/api/contact');
    for (const [k, v] of Object.entries(data)) {
      if (form.elements[k]) form.elements[k].value = v;
    }
  } catch (e) {
    statusEl.textContent = e.message;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    statusEl.textContent = 'Saving…';
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await Api.put('/api/contact', payload);
      statusEl.textContent = 'Saved.';
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });
}
