export function prepareControls() {
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
