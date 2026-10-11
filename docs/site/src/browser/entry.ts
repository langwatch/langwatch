import { startNavigation } from "./navigation.ts";
import { prepareControls } from "./prepare.ts";

import "./islands.css";
import "../docs.css";

export function loadIsland({ name, trigger }: { name: string; trigger?: HTMLElement }) {
  if (document.querySelector(`script[data-island="${name}"]`)) return;
  const source = document.querySelector<HTMLMetaElement>(
    `meta[name="docs-island-${name}"]`,
  )?.content;
  if (!source) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = source;
  script.dataset.island = name;
  script.addEventListener("load", () => {
    if (trigger?.isConnected) trigger.click();
  });
  script.addEventListener("error", () => script.remove());
  document.head.append(script);
}

prepareControls();
startNavigation();
document.addEventListener("docs:navigated", prepareControls);
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const controls = [
    ["[data-docs-search]", "search"],
    ["#try-it-button", "playground"],
    ["[data-docs-copy], [data-docs-page-copy], [data-docs-prompt]", "copy"],
    ["[role=tab], [data-docs-expand]", "tabs"],
    [
      "[data-docs-theme], [data-docs-page-menu], [data-docs-mobile], [data-docs-mobile-close]",
      "menus",
    ],
    ["[data-docs-video]", "media"],
    ["[data-scope=accordion] button, [data-docs-tooltip]", "disclosures"],
    ["button", "controls"],
  ];
  for (const [selector, name] of controls) {
    const trigger = event.target.closest<HTMLElement>(selector);
    if (!trigger) continue;
    loadIsland({ name, trigger });
    break;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    loadIsland({ name: "search" });
    document.dispatchEvent(new Event("docs:search"));
  }
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}

const enhanceReading = () => {
  loadIsland({ name: "toc" });
  loadIsland({ name: "tabs" });
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
