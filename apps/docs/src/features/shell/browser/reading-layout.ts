let observer: ResizeObserver | null = null;
function measureRails() {
  const header = document.querySelector("header")?.getBoundingClientRect().height ?? 72;
  document.querySelectorAll<HTMLElement>("[data-docs-rail]").forEach((rail) => {
    rail.toggleAttribute("data-fits-viewport", rail.offsetHeight <= innerHeight - header);
  });
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

let menusPrepared = false;
function prepareContextMenus(event: Event) {
  const target = event.target;
  if (
    menusPrepared ||
    !(target instanceof Element) ||
    !target.closest("[data-docs-theme], [data-docs-page-menu]")
  ) {
    return;
  }

  const source = document.querySelector<HTMLMetaElement>(
    'meta[name="docs-island-context-menus"]',
  )?.content;
  if (!source) {
    return;
  }

  const preload = document.createElement("link");
  preload.rel = "modulepreload";
  preload.href = source;
  menusPrepared = true;
  document.head.append(preload);
}

document.addEventListener("pointerover", prepareContextMenus);
document.addEventListener("focusin", prepareContextMenus);

document.addEventListener("keydown", (event) => {
  if (!event.altKey || !event.shiftKey || event.code !== "KeyC") return;
  if (event.ctrlKey || event.metaKey) return;
  if (
    event.target instanceof Element &&
    event.target.closest("input, textarea, select, [contenteditable]")
  )
    return;
  const button = document.querySelector<HTMLButtonElement>("[data-docs-page-copy]");
  if (!button || button.disabled) return;
  event.preventDefault();
  button.click();
});
