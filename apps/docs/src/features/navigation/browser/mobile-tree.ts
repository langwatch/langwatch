/* The mobile drawer shows the left rail's own sections and tree, copied in when it opens. */

/** Fills the drawer from the rail, dropping ids and the rail's animated selection marker. */
export function fillMobileNav({ dialog }: { dialog: HTMLElement }) {
  const body = dialog.querySelector<HTMLElement>("[data-docs-mobile-body]");
  const rail = document.querySelector<HTMLElement>(".docs-left-rail");
  if (!body || !rail) return;
  const copy = document.createDocumentFragment();
  for (const child of rail.children) copy.append(child.cloneNode(true));
  copy.querySelectorAll(".docs-nav-indicator").forEach((marker) => marker.remove());
  copy.querySelectorAll<HTMLElement>("[data-indicator-ready]").forEach((tree) => {
    delete tree.dataset.indicatorReady;
  });
  copy.querySelectorAll("[id]").forEach((element) => {
    element.removeAttribute("id");
    if (element.getAttribute("tabindex") === "-1") element.removeAttribute("tabindex");
  });
  body.replaceChildren(copy);
}
