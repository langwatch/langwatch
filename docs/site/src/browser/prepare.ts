export function prepareControls() {
  document.querySelectorAll<HTMLElement>(".docs-left-rail").forEach((rail) => {
    rail.scrollTop = 0;
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const bottom = active.getBoundingClientRect().bottom - rail.getBoundingClientRect().top;
      if (bottom > rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight + 32;
    }
  });
  const banner = document.querySelector<HTMLElement>("[data-docs-banner]");
  try {
    if (banner && localStorage.getItem(`lw-docs:${banner.dataset.docsBanner}`) === "dismissed")
      banner.remove();
  } catch {
    /* Storage is optional. */
  }

  document
    .querySelectorAll<HTMLButtonElement>(
      "[data-docs-copy], .docs-agent-start button, [data-docs-page-copy], [data-docs-page-menu]",
    )
    .forEach((button) => {
      button.disabled = false;
    });
  document.querySelectorAll<HTMLDetailsElement>(".docs-examples").forEach((details) => {
    details.open = matchMedia("(min-width: 90rem)").matches;
  });
}
