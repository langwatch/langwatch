import { startNavigation } from "./navigation.ts";

import "./islands.css";
import "../app/docs.css";
import "../features/navigation/ui/nav.css";

/** Enables server-disabled controls and applies stored dismissals; reruns after navigation. */
function prepareControls() {
  try {
    document.querySelectorAll<HTMLElement>("[data-docs-banner]").forEach((notice) => {
      if (localStorage.getItem(`lw-docs:${notice.dataset.docsBanner}`) === "dismissed")
        notice.remove();
    });
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

export function loadIsland({ name, trigger }: { name: string; trigger?: HTMLElement }) {
  const replay = () => {
    if (trigger?.isConnected) trigger.click();
  };
  const loading = document.querySelector<HTMLScriptElement>(`script[data-island="${name}"]`);
  /* An island still loading (an idle one, say) replays the click that came first. */
  if (loading) {
    if (loading.dataset.loaded === undefined) loading.addEventListener("load", replay);
    return;
  }
  const source = document.querySelector<HTMLMetaElement>(
    `meta[name="docs-island-${name}"]`,
  )?.content;
  if (!source) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = source;
  script.dataset.island = name;
  script.addEventListener("load", () => {
    script.dataset.loaded = "";
    replay();
  });
  script.addEventListener("error", () => script.remove());
  document.head.append(script);
}

prepareControls();
startNavigation();
if (document.querySelector('meta[name="docs-not-found"]')) loadIsland({ name: "redirect" });
document.addEventListener("docs:navigated", prepareControls);
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const controls = [
    ["[data-docs-search]", "search"],
    ["#try-it-button", "playground"],
    ["[data-docs-copy], [data-docs-page-copy], [data-docs-prompt]", "copy"],
    ["[role=tab]", "tabs"],
    ["[data-docs-page-menu]", "context-menus"],
    ["[data-docs-mobile], [data-docs-mobile-close]", "menus"],
    ["[data-docs-video]", "media"],
    ["[data-scope=accordion] button, [data-docs-tooltip]", "disclosures"],
    [".docs-skill-prompt", "skill-prompts"],
    [
      '[data-docs-theme], [data-docs-agent], [aria-label="Dismiss announcement"], [data-docs-dismiss], nav[aria-label="Page navigation"] button[aria-expanded]',
      "controls",
    ],
  ];
  for (const [selector, name] of controls) {
    const trigger = event.target.closest<HTMLElement>(selector);
    if (!trigger) continue;
    loadIsland({ name, trigger });
    break;
  }
});
/* The page's inline key listener marks a search shortcut, even one pressed before this ran. */
const searchRequested = () => {
  if ((window as { docsSearchKey?: number }).docsSearchKey) loadIsland({ name: "search" });
};
searchRequested();
addEventListener("keydown", searchRequested);

const enhanceReading = () => {
  loadIsland({ name: "toc" });
  loadIsland({ name: "tabs" });
  loadIsland({ name: "reading" });
};
if ("requestIdleCallback" in window) window.requestIdleCallback(enhanceReading, { timeout: 1000 });
else setTimeout(enhanceReading, 100);
for (const eventName of ["pointerover", "focusin"])
  document.addEventListener(eventName, (event) => {
    const trigger =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-docs-tooltip]")
        : null;
    if (trigger) loadIsland({ name: "disclosures", trigger });
  });
