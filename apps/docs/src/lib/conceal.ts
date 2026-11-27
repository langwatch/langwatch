/**
 * Hides or shows a panel. A `data-docs-findable` one hides as `hidden="until-found"`, so the
 * browser's find-in-page can still reach and open it.
 */
export function conceal({ panel, hidden }: { panel: HTMLElement; hidden: boolean }) {
  if (!hidden) panel.removeAttribute("hidden");
  else if (panel.hasAttribute("data-docs-findable")) panel.setAttribute("hidden", "until-found");
  else panel.hidden = true;
}
