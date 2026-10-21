/** Offline Russian/Kazakh localization, loaded before the application modules. */
const I18n = (() => {
  const STORAGE_KEY = 'flortte_language';
  const messages = typeof KAZAKH_MESSAGES === 'undefined' ? {} : KAZAKH_MESSAGES;
  let language = 'ru';
  let saved;
  try { saved = globalThis.localStorage.getItem(STORAGE_KEY); } catch (_) { /* Optional persistence. */ }
  if (['ru', 'kk'].includes(saved)) language = saved;
  try {
    const requested = new URL(globalThis.location.href).searchParams.get('lang');
    if (['ru', 'kk'].includes(requested)) language = requested;
  } catch (_) {
    // Non-browser consumers can use the saved language without a URL.
  }

  function t(message, ...values) {
    const tagged = Array.isArray(message);
    const key = tagged
      ? message.map((part, index) => part + (index < values.length ? '${' + index + '}' : '')).join('')
      : String(message);
    const translated = language === 'kk' && Object.hasOwn(messages, key) ? messages[key] : key;
    // Plain strings, including user-supplied values, are never interpolated.
    return tagged ? translated.replace(/\$\{(\d+)\}/g, (_, index) => String(values[Number(index)])) : translated;
  }

  function translateDocument(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.parentElement?.tagName)) continue;
      const text = node.nodeValue;
      const key = text.trim();
      if (Object.hasOwn(messages, key)) node.nodeValue = text.replace(key, () => t(key));
    }
    root.querySelectorAll('[title], [aria-label], [placeholder], input[value]').forEach(element => {
      ['title', 'aria-label', 'placeholder', 'value'].forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (value !== null && Object.hasOwn(messages, value)) element.setAttribute(attribute, t(value));
      });
    });
    document.documentElement.lang = language;
  }

  function init() {
    translateDocument();
    document.querySelectorAll('.language-select').forEach(select => {
      select.value = language;
      select.addEventListener('change', () => {
        const next = select.value;
        if (!['ru', 'kk'].includes(next) || next === language) return;
        try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* URL preserves this session's choice. */ }
        const url = new URL(location.href);
        url.searchParams.set('lang', next);
        // Restart at the menu so cached gesture names and all new messages agree.
        location.replace(url.href);
      });
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
  return { t, translateDocument, get language() { return language; }, get locale() { return language === 'kk' ? 'kk-KZ' : 'ru-RU'; } };
})();
