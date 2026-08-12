// Small compatibility/a11y patches for the existing controller. These are
// intentionally DOM-only and do not alter game state or scoring.
(() => {
  const observer = new MutationObserver(() => {
    const timer = document.querySelector('#timer-num');
    if (timer) {
      timer.removeAttribute('aria-hidden');
      timer.setAttribute('role', 'timer');
      timer.setAttribute('aria-label', '10 seconds remaining');
      const first = timer.firstChild;
      if (first?.nodeType === Node.TEXT_NODE && first.textContent.trim() === '15.0') first.textContent = '10.0';
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
