import { slide } from "../../../lib/slide.ts";

function tooltipButton({ target }: { target: EventTarget | null }) {
  return target instanceof Element ? target.closest<HTMLElement>("[data-docs-tooltip]") : null;
}
function setTooltip({ button, open }: { button: HTMLElement | null; open: boolean }) {
  const tooltip = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
  if (tooltip) tooltip.hidden = !open;
}
function toggleAccordion({ button }: { button: HTMLElement }) {
  const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!panel) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  const item = button.closest('[data-part="item"]');
  item?.querySelectorAll<HTMLElement>("[data-state]").forEach((node) => {
    if (node.closest('[data-part="item"]') === item) node.dataset.state = open ? "open" : "closed";
  });
  panel.style.height = open ? "auto" : "";
  slide({ panel, open });
}
/** Marks an accordion item open whose panel find-in-page revealed while its trigger said shut. */
function syncRevealed({ panel }: { panel: HTMLElement }) {
  const item = panel.closest<HTMLElement>('[data-scope="accordion"][data-part="item"]');
  const button = item?.querySelector<HTMLElement>('[data-part="item-trigger"]');
  if (!item || !button || panel.hidden || button.getAttribute("aria-expanded") === "true") return;
  button.setAttribute("aria-expanded", "true");
  item.querySelectorAll<HTMLElement>("[data-state]").forEach((node) => {
    if (node.closest('[data-part="item"]') === item) node.dataset.state = "open";
  });
  panel.style.height = "auto";
}

/* The bootstrap loads this island on the first `beforematch`, after that one has fired. */
function syncAllRevealed() {
  document
    .querySelectorAll<HTMLElement>('[data-scope="accordion"][data-part="item-content"]')
    .forEach((panel) => syncRevealed({ panel }));
}

export function installDisclosures() {
  syncAllRevealed();
  /* `beforematch` fires before the browser removes `hidden`; sync on the next frame. */
  document.addEventListener("beforematch", (event) => {
    const panel =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-part="item-content"]')
        : null;
    if (panel) requestAnimationFrame(() => syncRevealed({ panel }));
  });
  document.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-scope="accordion"][data-part="item-trigger"]')
        : null;
    if (button) toggleAccordion({ button });
    setTooltip({ button: tooltipButton({ target: event.target }), open: true });
  });
  for (const name of ["focusin", "pointerover"])
    document.addEventListener(name, (event) =>
      setTooltip({ button: tooltipButton({ target: event.target }), open: true }),
    );
  for (const name of ["focusout", "pointerout"])
    document.addEventListener(name, (event) =>
      setTooltip({ button: tooltipButton({ target: event.target }), open: false }),
    );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
      document.querySelectorAll<HTMLElement>("[data-docs-tooltip-content]").forEach((tip) => {
        tip.hidden = true;
      });
  });
}

installDisclosures();
