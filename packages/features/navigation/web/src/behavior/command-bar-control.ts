/**
 * The way to open the palette from outside the provider's own subtree.
 *
 * WHY THIS IS NOT CONTEXT. The shell reaches the palette through the host port
 * — `commandBar()` answers with a shortcut, a way to open, and a trigger node —
 * and the host object is BUILT ABOVE the provider, because the provider itself
 * asks the host who the reader is and what address they are on. So the two
 * cannot both be resolved through React context in the same tree: one of them
 * has to be reachable without it, and "open the one palette this document has"
 * is the smaller of the two.
 *
 * It is a singleton because the palette is: one document, one Cmd+K, one
 * dialog. A second provider mounted anywhere would be the second search bar
 * this feature exists to prevent, so the last one to mount wins and the
 * unmounting one only clears the slot if it is still the one in it — the
 * ordering that survives a React remount, where the new provider registers
 * before the old one tears down.
 *
 * Everything INSIDE the provider still reads context, unchanged. This is only
 * the door in from the host's answer.
 */

export type CommandBarControl = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

let mounted: CommandBarControl | null = null;

/** Publishes the mounted palette. Returns the way to withdraw it. */
export function registerCommandBarControl(control: CommandBarControl): () => void {
  mounted = control;
  return () => {
    if (mounted === control) mounted = null;
  };
}

/**
 * Opens the palette, if this document has one.
 *
 * A no-op when nothing is mounted rather than a throw: the sidebar's Quick
 * Search row is drawn from the host's answer, and a host that answers with a
 * palette it has not mounted yet is a race, not a bug worth crashing a chrome
 * over.
 */
export function openCommandBar(): void {
  mounted?.open();
}

/** Whether a palette is mounted in this document. */
export function hasCommandBar(): boolean {
  return mounted !== null;
}
