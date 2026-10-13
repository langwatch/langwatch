import { type RefObject, useEffect } from "react";

/** The entry the menu marks as the page being shown. */
const ACTIVE_ENTRY_SELECTOR = '[aria-current="page"]';

/** Remembers scroll position per menu; module-scoped (new doc = reader arriving, not returning) */
const lastOffsetByMenu = new Map<string, number>();

/** Drops every remembered place. For tests, which share one module. */
export function forgetMenuScrollPositions(): void {
  lastOffsetByMenu.clear();
}

/** Keeps menu at reader's scroll position; brings active entry to top if out of view */
export function useMenuScrollPosition({
  regionRef,
  menuKey,
}: {
  regionRef: RefObject<HTMLElement | null>;
  menuKey: string;
}): void {
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const readerEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

    const remember = () => {
      lastOffsetByMenu.set(menuKey, region.scrollTop);
    };

    const stopRevealing = () => {
      observer.disconnect();
      for (const event of readerEvents) {
        region.removeEventListener(event, stopRevealing);
      }
    };

    const revealActiveEntry = () => {
      const active = region.querySelector<HTMLElement>(ACTIVE_ENTRY_SELECTOR);
      if (!active) return;

      const menu = region.getBoundingClientRect();
      const entry = active.getBoundingClientRect();
      const offset = entry.top - menu.top;
      const isInView = offset >= 0 && offset + entry.height <= menu.height;
      if (isInView) return;

      // The browser clamps this to the end of the menu, which is what
      // "as far as the menu can scroll" means for the last entries.
      region.scrollTop += offset;
    };

    region.scrollTop = lastOffsetByMenu.get(menuKey) ?? 0;
    revealActiveEntry();

    const observer = new MutationObserver(revealActiveEntry);
    observer.observe(region, { childList: true, subtree: true });
    region.addEventListener("scroll", remember, { passive: true });
    for (const event of readerEvents) {
      region.addEventListener(event, stopRevealing, { passive: true });
    }

    // Nothing is read back from the menu on the way out. React detaches the
    // node before it runs this, and a detached node reports a scroll of zero,
    // which would replace the place the reader had reached with the top.
    return () => {
      stopRevealing();
      region.removeEventListener("scroll", remember);
    };
  }, [regionRef, menuKey]);
}
