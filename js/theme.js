/** Apply the saved appearance before the stylesheet loads. */
(() => {
  const key = 'flortte_theme';
  const root = document.documentElement;
  try {
    if (localStorage.getItem(key) === 'dark') root.dataset.mode = 'dark';
  } catch (_) {}

  document.addEventListener('DOMContentLoaded', () => {
    const selectors = document.querySelectorAll('.theme-select');
    const sync = () => selectors.forEach(select => { select.value = root.dataset.mode || 'light'; });
    sync();
    selectors.forEach(select => select.addEventListener('change', () => {
      root.dataset.mode = select.value;
      sync();
      try { localStorage.setItem(key, select.value); } catch (_) {}
    }));
  });
})();
