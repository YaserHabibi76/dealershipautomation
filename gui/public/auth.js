async function bootAuth(onReady) {
  const gate = document.getElementById('login-gate');
  const shell = document.getElementById('app-shell');
  const loginForm = document.getElementById('login-form');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('logout-btn');

  async function checkSession() {
    const session = await Api.get('/api/session');
    if (session.authenticated) {
      gate.classList.add('hidden');
      shell.classList.remove('hidden');
      logoutBtn.classList.toggle('hidden', !session.required);
      onReady();
    } else {
      shell.classList.add('hidden');
      gate.classList.remove('hidden');
    }
  }

  loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    loginStatus.textContent = 'Signing in…';
    try {
      await Api.post('/api/login', { password: loginForm.elements.password.value });
      loginForm.reset();
      loginStatus.textContent = '';
      await checkSession();
    } catch (e) {
      loginStatus.textContent = e.message;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await Api.post('/api/logout');
    location.reload();
  });

  await checkSession();
}
