// Translations. The English text is its own key: t('Find best fit') gives
// the phrase in the chosen language, or the English itself when there's no
// translation for it yet, so anything not yet translated just stays English.
// {name} in a phrase is filled in from values: t('Fit {n} of {total}', { n, total }).
//
// Each language is a file in lang/ that calls I18n.add with its phrases (see
// lang/zh.js), loaded after this one. index.html is translated as the page
// starts (translatePage, called from app.js): each text node, title,
// aria-label and placeholder whose English is in the dictionary, matched with
// its spaces and line breaks squeezed. Text that app.js sets goes through t().
//
// The language: the one picked (feets-lang), else the browser's if feets has
// it, else English. Picking one reloads the page in it.
const I18n = (() => {
  const LANGUAGES = { en: 'English', fr: 'Français', zh: '中文' };
  const HTML_LANG = { en: 'en', fr: 'fr', zh: 'zh-CN' };
  const phrases = {};

  let lang = null;
  try { lang = localStorage.getItem('feets-lang'); } catch {}
  if (!LANGUAGES[lang]) {
    const wanted = (navigator.languages || [navigator.language || '']).map(l => l.toLowerCase().split('-')[0]);
    lang = wanted.find(l => LANGUAGES[l]) || 'en';
  }
  document.documentElement.lang = HTML_LANG[lang];

  function add(code, dict) {
    phrases[code] = Object.assign(phrases[code] || {}, dict);
  }

  function t(english, values) {
    const text = (phrases[lang] && phrases[lang][english]) || english;
    return values ? text.replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all)) : text;
  }

  const squeeze = text => text.replace(/\s+/g, ' ').trim();
  const ATTRIBUTES = ['title', 'aria-label', 'placeholder'];

  function translatePage(root = document.body) {
    const dict = phrases[lang];
    if (!dict) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (node.parentElement.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const key = squeeze(node.nodeValue);
      if (!key || !dict[key]) continue;
      // Keep the spaces either side, so it still sits apart from its neighbours.
      const [, before, , after] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
      node.nodeValue = before + dict[key] + after;
    }
    for (const el of root.querySelectorAll(ATTRIBUTES.map(a => `[${a}]`).join())) {
      for (const a of ATTRIBUTES) {
        const key = el.hasAttribute(a) && squeeze(el.getAttribute(a));
        if (key && dict[key]) el.setAttribute(a, dict[key]);
      }
    }
  }

  // A language picker: a <select> that reloads the page in the one picked.
  function picker() {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Language');
    for (const [code, name] of Object.entries(LANGUAGES)) select.append(new Option(name, code));
    select.value = lang;
    select.onchange = () => {
      try { localStorage.setItem('feets-lang', select.value); } catch {}
      location.reload();
    };
    return select;
  }

  return { t, add, translatePage, picker, get lang() { return lang; } };
})();
const t = I18n.t;
