function switchTab(name) {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function initApp() {
  initContactTab();
  initSettingsTab();
  initDealersTab();
  initRunTab();
  initResultsTab();
}

window.addEventListener('DOMContentLoaded', () => {
  bootAuth(initApp);
});
