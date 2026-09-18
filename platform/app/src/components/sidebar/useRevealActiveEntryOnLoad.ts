import { type RefObject, useEffect } from "react";

/** The entry the menu marks as the page being shown. */
const ACTIVE_ENTRY_SELECTOR = '[aria-current="page"]';

/**
 * Puts the active entry at the top of a scrolling menu when the menu first
 * renders, as far as the menu can scroll.
 *
 * A page opened by its address, a bookmark or a shared link leaves its entry
 * below the fold of a long menu. Revealing it is not enough on its own: the
 * reader lands there to look through the pages around it, so the entry goes
 * to the top and the rest of its group follows underneath.
 *
 * The menu grows after it first paints, because the gated groups arrive with
 * the queries behind them, and entries added above the active one push it back
 * down. So the reveal re-applies while the menu is still changing, and stops
 * for good the moment the reader takes the menu over: a wheel, a touch, a
 * pointer or a key inside it. Those are what tell a reader's scroll apart from
 * the menu's own, which is why the scroll position itself is not the signal.
 */
export function useRevealActiveEntryOnLoad(
  regionRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const readerEvents = [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ] as const;

    const stop = () => {
      observer.disconnect();
      for (const event of readerEvents) {
        region.removeEventListener(event, stop);
      }
    };

    const reveal = () => {
      const active = region.querySelector<HTMLElement>(ACTIVE_ENTRY_SELECTOR);
      if (!active) return;
      const offset =
        active.getBoundingClientRect().top - region.getBoundingClientRect().top;
      // The browser clamps this to the end of the menu, which is what
      // "as far as the menu can scroll" means for the last entries.
      region.scrollTop += offset;
    };

    const observer = new MutationObserver(reveal);
    observer.observe(region, { childList: true, subtree: true });
    for (const event of readerEvents) {
      region.addEventListener(event, stop, { passive: true });
    }
    reveal();

    return stop;
  }, [regionRef]);
}
