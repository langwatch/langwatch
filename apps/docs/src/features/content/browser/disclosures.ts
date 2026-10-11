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
  panel.hidden = !open;
  panel.style.height = open ? "auto" : "";
  const item = button.closest('[data-part="item"]');
  item?.querySelectorAll<HTMLElement>("[data-state]").forEach((node) => {
    if (node.closest('[data-part="item"]') === item) node.dataset.state = open ? "open" : "closed";
  });
}
export function installDisclosures() {
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
