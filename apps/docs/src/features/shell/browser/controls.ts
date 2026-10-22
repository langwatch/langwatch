document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button) return;
  if (button.matches("[data-docs-agent]")) {
    const region = button.closest(".docs-agent-start");
    region
      ?.querySelectorAll("[data-docs-agent]")
      .forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
    const name = region?.querySelector("[data-docs-agent-name]");
    if (name) name.textContent = button.dataset.docsAgent ?? "";
  }
  if (button.matches('[aria-label="Dismiss announcement"], [data-docs-dismiss]')) {
    const banner = button.closest<HTMLElement>("[data-docs-banner]");
    if (banner) {
      try {
        localStorage.setItem(`lw-docs:${banner.dataset.docsBanner}`, "dismissed");
      } catch {
        /* Storage is optional. */
      }
      banner.remove();
    }
  }
  if (button.matches('nav[aria-label="Page navigation"] button[aria-expanded]'))
    toggleGroup({ button });
});

function toggleGroup({ button }: { button: HTMLButtonElement }) {
  const panel = button.nextElementSibling;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  const icon = button.querySelector("svg");
  if (icon) icon.style.transform = open ? "rotate(90deg)" : "";
  if (panel instanceof HTMLElement) panel.hidden = !open;
}
