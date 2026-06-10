import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useFocusSectionStore } from "../../../stores/focusSectionStore";

/**
 * Wires an accordion stack to the cross-component focus pipeline:
 *
 *   1. Subscribes to `useFocusSectionStore.pending`.
 *   2. When a request matches `traceId` AND the requested section is
 *      one this stack renders, expands the section, scrolls it into
 *      view, then publishes a `glow` payload that the caller renders
 *      via `<SectionFocusGlow>`.
 *
 * Returning the glow payload (instead of mounting the overlay here)
 * lets the caller control where the overlay lives in the JSX tree —
 * the summary accordions render their own overlay sibling, and the
 * span-detail accordions render theirs. The hook is the brain; the
 * overlay is the visual.
 */
export function useSectionFocusGlow({
  traceId,
  sections,
  openSections,
  setOpenSections,
  containerRef,
}: {
  traceId: string;
  sections: readonly string[];
  openSections: string[];
  setOpenSections: (next: string[]) => void;
  containerRef: RefObject<HTMLElement | null>;
}) {
  const pendingFocus = useFocusSectionStore((s) => s.pending);
  const clearFocus = useFocusSectionStore((s) => s.clear);
  const [glow, setGlow] = useState<{
    target: HTMLElement;
    nonce: number;
  } | null>(null);
  const handleGlowDone = useCallback(() => setGlow(null), []);
  // Refs so the effect can read latest open-state without re-running
  // (and thus retriggering scroll) every time the list reference changes.
  const openSectionsRef = useRef(openSections);
  openSectionsRef.current = openSections;
  const setOpenSectionsRef = useRef(setOpenSections);
  setOpenSectionsRef.current = setOpenSections;

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.traceId !== traceId) return;
    if (!sections.includes(pendingFocus.section)) return;
    const currentOpen = openSectionsRef.current;
    setOpenSectionsRef.current(
      currentOpen.includes(pendingFocus.section)
        ? currentOpen
        : [...currentOpen, pendingFocus.section],
    );
    const glowSection = pendingFocus.section;
    const glowNonce = pendingFocus.nonce;
    const root = containerRef.current;
    if (!root) return;
    let observer: MutationObserver | null = null;
    let bailTimer = 0;
    const tryScrollAndGlow = () => {
      const el = root.querySelector<HTMLElement>(
        `[data-section="${glowSection}"]`,
      );
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Mount the overlay AFTER the scroll starts so the pulse lands
      // on the section already in view rather than ticking out
      // mid-scroll. The nonce keys the overlay so a re-click
      // remounts + restarts the keyframe.
      setGlow({ target: el, nonce: glowNonce });
      clearFocus();
      return true;
    };
    // Two rAFs so the accordion has actually expanded before we measure
    // + scroll. The first flushes the open-state setState; layout
    // commits on the second.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (tryScrollAndGlow()) return;
        // The target section isn't in the DOM yet — common when the
        // span tab just mounted and `useSpanDetail` is still loading
        // (the skeleton renders instead of the accordion stack). Watch
        // for the section to appear, then run the same scroll+glow.
        observer = new MutationObserver(() => {
          if (tryScrollAndGlow()) {
            observer?.disconnect();
            window.clearTimeout(bailTimer);
          }
        });
        observer.observe(root, { childList: true, subtree: true });
        // Safety net so we don't keep observing forever if the section
        // never shows up (wrong trace, focus request to a section this
        // stack doesn't render, etc.). 5s is generous for slow detail
        // queries on dev infra.
        bailTimer = window.setTimeout(() => {
          observer?.disconnect();
          clearFocus();
        }, 5000);
      });
    });
    return () => {
      observer?.disconnect();
      window.clearTimeout(bailTimer);
    };
  }, [pendingFocus, traceId, sections, containerRef, clearFocus]);

  return { glow, handleGlowDone };
}
