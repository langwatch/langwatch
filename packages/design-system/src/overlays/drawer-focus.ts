import { useLayoutEffect, useRef } from "react";

import { isFocusable } from "./focusable.ts";

/**
 * Focus return for the non-modal drawer, which Chakra leaves to the page. The opener is a live
 * element held in memory, never in an address. A drawer unmounted while open hands it on until
 * the commit settles: a drawer mounted then, or one still loading, takes it; else it is restored.
 */

type FocusResolver = () => HTMLElement | null;

interface Session {
  opener: HTMLElement | null;
  done: boolean;
}

interface Handoff {
  opener: HTMLElement | null;
  finalFocusEl: FocusResolver | undefined;
}

let handoff: Handoff | null = null;
let reservations = 0;

const OVERLAY_SCOPES = ["dialog", "drawer", "popover", "menu", "select", "combobox"];
const OPEN_OVERLAY = OVERLAY_SCOPES.map(
  (scope) => `[data-scope="${scope}"][data-part="content"][data-state="open"]`,
).join(",");
const CLOSING_OVERLAY = '[data-part="content"][data-state="closed"]';

function canReceiveFocus(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest(CLOSING_OVERLAY)) return false;
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) return false;
  return isFocusable(element);
}

/** Focus that moved on by choice, or into an overlay opened since, is not ours to take back. */
function focusIsOwnedElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return !active.closest(CLOSING_OVERLAY);
}

function restoreFocus({ opener, finalFocusEl }: Handoff): void {
  if (focusIsOwnedElsewhere()) return;
  const candidates = [finalFocusEl?.() ?? null, opener];
  const target = candidates.find(
    (candidate): candidate is HTMLElement => candidate != null && canReceiveFocus(candidate),
  );
  if (!target) return;
  const overlays = Array.from(document.querySelectorAll(OPEN_OVERLAY));
  if (overlays.some((overlay) => !overlay.contains(target))) return;
  target.focus({ preventScroll: true });
}

function settle(): void {
  if (!handoff || reservations > 0) return;
  const pending = handoff;
  handoff = null;
  restoreFocus(pending);
}

function takeOpener({ previous }: { previous: Session | null }): HTMLElement | null {
  if (previous && !previous.done) {
    previous.done = true;
    return previous.opener;
  }
  if (handoff) {
    const { opener } = handoff;
    handoff = null;
    return opener;
  }
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Restores focus when a non-modal drawer closes: the live `finalFocusEl`, else the element
 * focused as it opened. The returned `onExitComplete` runs the caller's, then restores once.
 */
export function useDrawerFocusRestore({
  open,
  modal,
  finalFocusEl,
  onExitComplete,
}: {
  open: boolean;
  modal: boolean;
  finalFocusEl: FocusResolver | undefined;
  onExitComplete: (() => void) | undefined;
}): () => void {
  const session = useRef<Session | null>(null);
  const latest = useRef({ open, modal, finalFocusEl });
  useLayoutEffect(() => {
    latest.current = { open, modal, finalFocusEl };
  });
  useLayoutEffect(
    () => () => {
      const current = session.current;
      if (!current || current.done) return;
      current.done = true;
      if (latest.current.modal) return;
      handoff = { opener: current.opener, finalFocusEl: latest.current.finalFocusEl };
      queueMicrotask(settle);
    },
    [],
  );
  useLayoutEffect(() => {
    if (!open) return;
    session.current = { opener: takeOpener({ previous: session.current }), done: false };
  }, [open]);
  return () => {
    onExitComplete?.();
    const current = session.current;
    if (!current || current.done || latest.current.open) return;
    current.done = true;
    if (latest.current.modal) return;
    restoreFocus({ opener: current.opener, finalFocusEl: latest.current.finalFocusEl });
  };
}

/**
 * Held by whatever stands in for a drawer that is still loading, so the drawer it replaced does
 * not restore focus to the page in between.
 */
export function useReserveDrawerFocus(): void {
  useLayoutEffect(() => {
    reservations += 1;
    return () => {
      reservations -= 1;
      queueMicrotask(settle);
    };
  }, []);
}
