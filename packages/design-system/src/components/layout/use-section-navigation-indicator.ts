import { useLayoutEffect, useRef } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";

const TRANSITION = "transform 180ms ease-out, height 180ms ease-out";
type MarkerPosition = { transform: string; height: string; href: string };
const retiringMarkers = new Map<string, MarkerPosition>();

/** One marker follows current links, including entries supplied through a group's extra slot. */
export function useSectionNavigationIndicator() {
  const markerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const list = marker?.parentElement;
    if (!list || !marker) return;

    let positioned = resumeMarker(list, marker, reducedMotion);
    let resuming = positioned;
    let frame = 0;
    let destination: string | null = null;
    const rememberDestination = (event: MouseEvent) => {
      destination = navigationDestination(event);
    };
    list.addEventListener("click", rememberDestination, true);
    let observedLink: Element | null = null;
    const resize = new ResizeObserver(update);

    function update() {
      if (!list || !marker || resuming) return;

      const active = observeActiveLink(list, resize, observedLink);
      observedLink = active;
      positioned = positionMarker({ active, list, marker, positioned, reducedMotion });
    }

    const mutations = new MutationObserver(update);
    mutations.observe(list, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    resize.observe(list);
    if (resuming) {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          resuming = false;
          update();
        });
      });
    } else {
      update();
    }

    return () => {
      cancelAnimationFrame(frame);
      if (destination) handOffMarker(list, marker, destination);
      list.removeEventListener("click", rememberDestination, true);
      mutations.disconnect();
      resize.disconnect();
    };
  }, [reducedMotion]);

  return markerRef;
}

// Lazy routes can replace the rail across commits. Briefly retain the painted
// position so the incoming rail continues from it, even during an interrupted slide.
function handOffMarker(list: HTMLElement, marker: HTMLElement, href: string) {
  const label = list.closest("nav")?.getAttribute("aria-label");
  if (!label || marker.style.visibility !== "visible") return;
  const painted = getComputedStyle(marker);
  const position = { transform: painted.transform, height: painted.height, href };
  retiringMarkers.set(label, position);
  setTimeout(() => {
    if (retiringMarkers.get(label) === position) retiringMarkers.delete(label);
  }, 1000);
}

function resumeMarker(list: HTMLElement, marker: HTMLElement, reducedMotion: boolean) {
  const label = list.closest("nav")?.getAttribute("aria-label");
  const position = label ? retiringMarkers.get(label) : void 0;
  if (!label || !position || reducedMotion) return false;
  if (list.querySelector('a[aria-current="page"]')?.getAttribute("href") !== position.href)
    return false;
  retiringMarkers.delete(label);
  marker.style.transition = "none";
  marker.style.transform = position.transform;
  marker.style.height = position.height;
  marker.style.visibility = "visible";
  marker.getBoundingClientRect();
  marker.style.transition = TRANSITION;
  return true;
}

function observeActiveLink(list: HTMLElement, resize: ResizeObserver, previous: Element | null) {
  const active = list.querySelector('a[aria-current="page"]');
  if (active === previous) return active;
  if (previous) resize.unobserve(previous);
  if (active) resize.observe(active);
  return active;
}

function positionMarker({
  active,
  list,
  marker,
  positioned,
  reducedMotion,
}: {
  active: Element | null;
  list: HTMLElement;
  marker: HTMLElement;
  positioned: boolean;
  reducedMotion: boolean;
}) {
  if (!active) {
    marker.style.visibility = "hidden";
    return false;
  }

  const item = active.getBoundingClientRect();
  const container = list.getBoundingClientRect();
  const inset = Number.parseFloat(getComputedStyle(list).paddingLeft) || 0;
  const x = item.left - container.left - inset;
  const y = item.top - container.top + 8;

  if (!positioned) marker.style.transition = "none";
  marker.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  marker.style.height = `${Math.max(0, item.height - 16)}px`;
  marker.style.visibility = item.height > 0 ? "visible" : "hidden";

  // Establish the initial position before enabling motion between later selections.
  if (!positioned) marker.getBoundingClientRect();
  marker.style.transition = reducedMotion ? "none" : TRANSITION;
  return true;
}

function navigationDestination(event: MouseEvent): string | null {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (event.button !== 0 || modified) return null;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  return link?.getAttribute("href") ?? null;
}
