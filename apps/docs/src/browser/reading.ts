import { startAgentChoice } from "../features/shell/browser.ts";
/* Deferred reading enhancements, kept out of the bootstrap budget: speculative prefetch, the
   sidebar agent selection and the media island on pages that hold clips. */
import type { PrefetchRequest } from "./navigation.ts";

startAgentChoice();

const MAX_IN_FLIGHT = 2;
const HOVER_DWELL_MS = 80;
const VISIBLE_LINKS = 3;

let inFlight = 0;
let hovered: HTMLAnchorElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | null = null;

function allowed() {
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  return navigator.onLine && !saveData && inFlight < MAX_IN_FLIGHT;
}

/** Hands a likely destination to navigation, whose cache the click then reuses. */
function prefetch({ anchor }: { anchor: HTMLAnchorElement }) {
  if (!allowed()) return;
  const request: PrefetchRequest = { anchor };
  document.dispatchEvent(new CustomEvent("docs:prefetch", { detail: request }));
  if (!request.result) return;
  inFlight++;
  void request.result.catch(() => {}).finally(() => inFlight--);
}

function hoverIntent({ event }: { event: Event }) {
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  if (!anchor || anchor === hovered) return;
  clearTimeout(hoverTimer);
  hovered = anchor;
  hoverTimer = setTimeout(() => prefetch({ anchor }), HOVER_DWELL_MS);
}

function hoverEnd({ event }: { event: PointerEvent }) {
  const next = event.relatedTarget;
  if (!hovered || (next instanceof Node && hovered.contains(next))) return;
  clearTimeout(hoverTimer);
  hovered = null;
}

function observeLinks() {
  observer?.disconnect();
  let count = 0;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLAnchorElement)) continue;
      observer?.unobserve(entry.target);
      if (count++ < VISIBLE_LINKS) prefetch({ anchor: entry.target });
    }
  });
  document
    .querySelectorAll<HTMLAnchorElement>("#content a[href^='/']")
    .forEach((anchor) => observer?.observe(anchor));
}

document.addEventListener("pointerover", (event) => hoverIntent({ event }), { passive: true });
document.addEventListener("pointerout", (event) => hoverEnd({ event }), { passive: true });
document.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLAnchorElement) prefetch({ anchor: event.target });
});
/** Loads an island once a page holds what it enhances: clips. */
function enhanceWith({ name, selector }: { name: string; selector: string }) {
  if (!document.querySelector(selector)) return;
  if (document.querySelector(`script[data-island="${name}"]`)) return;
  const source = document.querySelector<HTMLMetaElement>(
    `meta[name="docs-island-${name}"]`,
  )?.content;
  if (!source) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = source;
  script.dataset.island = name;
  document.head.append(script);
}

function enhance() {
  observeLinks();
  enhanceWith({ name: "media", selector: "video[data-docs-clip]" });
}

document.addEventListener("docs:navigated", enhance);
enhance();
