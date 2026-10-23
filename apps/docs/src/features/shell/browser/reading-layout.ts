import { sitePath } from "../../../lib/site-path.ts";
import { installSidebar } from "../../navigation/browser/sidebar.ts";

installSidebar();

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
document.addEventListener(
  "pointerdown",
  () => document.documentElement.setAttribute("data-docs-pointer", ""),
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Tab") document.documentElement.removeAttribute("data-docs-pointer");
  },
  true,
);
document.addEventListener("docs:navigated", prepareReadingLayout);

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" || !(event.target instanceof HTMLElement)) return;
  const container = event.target.closest("[data-docs-menu-root]");
  const isTrigger = event.target.matches("[data-docs-page-menu]");
  if (isTrigger && !container?.hasAttribute("data-mounted")) {
    event.preventDefault();
    event.target.click();
  }
});

let menusPrepared = false;
function prepareContextMenus(event: Event) {
  const target = event.target;
  if (menusPrepared || !(target instanceof Element) || !target.closest("[data-docs-page-menu]")) {
    return;
  }

  const source = document.querySelector<HTMLMetaElement>(
    'meta[name="docs-island-context-menus"]',
  )?.content;
  if (!source) {
    return;
  }

  menusPrepared = true;
  void preloadIsland({ source });
  /* The menu's brand logos load with it, so they are drawn the moment it opens. */
  for (const name of ["claude-code", "openai", "cursor"])
    new Image().src = sitePath({ path: `/images/logos/${name}.svg` });
}

function preloadModule({ href }: { href: string }) {
  if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.append(link);
}

/** Preloads an island with the chunks it imports: modulepreload alone fetches only the entry. */
async function preloadIsland({ source }: { source: string }) {
  const text = await fetch(source).then(
    (response) => response.text(),
    () => "",
  );
  preloadModule({ href: source });
  for (const [, chunk] of text.matchAll(/(?:from|import)\s*"(\.\/[^"]+\.js)"/g))
    if (chunk) preloadModule({ href: new URL(chunk, new URL(source, location.href)).pathname });
}

/* Search's scripts are fetched once a reader heads for it: the search button, or Meta or Ctrl
   held before K. A shortcut pressed sooner is still answered once the island arrives. */
let searchPrepared = false;
function prepareSearch() {
  const source = document.querySelector<HTMLMetaElement>(
    'meta[name="docs-island-search"]',
  )?.content;
  if (searchPrepared || !source) return;
  searchPrepared = true;
  void preloadIsland({ source });
}
function searchIntent({ event }: { event: Event }) {
  if (event instanceof KeyboardEvent) {
    if (event.key === "Meta" || event.key === "Control") prepareSearch();
  } else if (event.target instanceof Element && event.target.closest("[data-docs-search]"))
    prepareSearch();
}
for (const name of ["pointerover", "focusin", "touchstart", "keydown"])
  document.addEventListener(name, (event) => searchIntent({ event }), { passive: true });

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
