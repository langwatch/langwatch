import { type RefObject, useEffect } from "react";

/** The entry the menu marks as the page being shown. */
const ACTIVE_ENTRY_SELECTOR = '[aria-current="page"]';

/**
 * Where each menu was left, by the menu it belongs to.
 *
 * Opening a page builds the column again from nothing, so the menu that comes
 * back is not the menu the reader scrolled, and without this it returns to its
 * start every time. A value in the module and not in storage: a new document is
 * a reader arriving rather than returning, and an arriving reader gets the
 * reveal below instead of the place someone left the menu yesterday.
 */
const lastOffsetByMenu = new Map<string, number>();

/** Drops every remembered place. For tests, which share one module. */
export function forgetMenuScrollPositions(): void {
  lastOffsetByMenu.clear();
}

/**
 * Keeps a scrolling menu where the reader put it, and brings the open page's
 * entry to the top of the menu when that entry would otherwise be out of view.
 *
 * The menu moves for one reason only: the reader cannot see the page they are
 * on. A page near the start of the menu is already in view, so the menu stays
 * at its start and Quick Search and the first group heading stay on screen. A
 * page reached by its address, a bookmark or a shared link can sit below the
 * fold of a long menu, and revealing it is not enough on its own: the reader
 * lands there to look through the pages around it, so the entry goes to the top
 * and the rest of its group follows underneath.
 *
 * The menu grows after it first paints, because the gated groups arrive with
 * the queries behind them, and entries added above the active one can push it
 * out of view. So the reveal re-applies while the menu is still changing, and
 * stops for good the moment the reader takes the menu over: a wheel, a touch, a
 * pointer or a key inside it. Those are what tell a reader's scroll apart from
 * the menu's own, which is why the scroll position itself is not the signal.
 */
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

    const readerEvents = [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ] as const;

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
