// Final logo reveal hotfix.
// The gameplay logo must have exactly one obstruction: the black SVG rectangle.
// Do not crossfade a second full-logo SVG over it; that can create a visible
// white layer and makes the reveal visually inconsistent.
(() => {
  const reveal = () => {
    const frame = document.getElementById('logo-frame');
    const frag = document.getElementById('logo-frag');
    const full = document.getElementById('logo-full');
    if (!frame || !frag) return;

    // Never allow the secondary full-logo layer to render over the artwork.
    if (full) {
      full.innerHTML = '';
      full.style.display = 'none';
    }

    // Submit/timeout marks the frame as revealed. Remove ONLY the black
    // obstruction. The original white vector artwork underneath remains.
    if (frame.classList.contains('is-revealed')) {
      frag.querySelectorAll('.logo-obstruction').forEach((node) => node.remove());
    }
  };

  const observer = new MutationObserver(reveal);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  document.addEventListener('DOMContentLoaded', reveal);
})();
