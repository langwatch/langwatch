let observer: ResizeObserver | null = null;
function measureRails() {
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? 72;
  document.querySelectorAll<HTMLElement>("[data-docs-rail]").forEach((rail) => {
    rail.toggleAttribute("data-fits-viewport", rail.offsetHeight <= innerHeight - header);
  });
}
function revealActivePage() {
  if (location.hash || !matchMedia("(min-width: 64rem)").matches || scrollY > 0) return;
  const active = document.querySelector<HTMLElement>('.docs-left-rail [aria-current="page"]');
  if (!active) return;
  const bounds = active.getBoundingClientRect();
  if (bounds.bottom > innerHeight)
    window.scrollBy({ top: bounds.bottom - innerHeight + 32, behavior: "instant" });
}
export function prepareReadingLayout() {
  observer?.disconnect();
  observer = new ResizeObserver(measureRails);
  document
    .querySelectorAll<HTMLElement>("[data-docs-rail]")
    .forEach((rail) => observer?.observe(rail));
  measureRails();
  void document.fonts.ready.then(() => {
    measureRails();
    revealActivePage();
  });
  const modifier = document.querySelector("[data-docs-modifier]");
  const icon = document.querySelector("[data-docs-command-icon] svg");
  if (/Mac|iPhone|iPad/.test(navigator.platform) && modifier && icon)
    modifier.replaceChildren(icon.cloneNode(true));
}
window.addEventListener("resize", measureRails);
document.addEventListener("docs:navigated", prepareReadingLayout);

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" || !(event.target instanceof HTMLElement)) return;
  const container = event.target.closest("[data-docs-menu-root]");
  const isTrigger = event.target.matches("[data-docs-page-menu], [data-docs-theme]");
  if (isTrigger && !container?.hasAttribute("data-mounted")) {
    event.preventDefault();
    event.target.click();
  }
});
