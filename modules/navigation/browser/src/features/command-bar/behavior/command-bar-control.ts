/** Opens palette outside provider; can't use Context since host is built above it; singleton */

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
 * Opens the palette, if this document has one: a no-op when nothing is
 * mounted, since a host answering with a palette it hasn't mounted yet is
 * a race, not a bug worth crashing a chrome over.
 */
export function openCommandBar(): void {
  mounted?.open();
}

/** Whether a palette is mounted in this document. */
export function hasCommandBar(): boolean {
  return mounted !== null;
}
