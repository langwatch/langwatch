/**
 * Whether a control can take focus now: not disabled, hidden, inert or in a disabled fieldset.
 * `aria-hidden` is not tested: a stacked modal sets it on the dialog below while it is paused.
 */
export function isFocusable(element: HTMLElement): boolean {
  if (element.matches(":disabled") || element.closest("fieldset:disabled")) return false;
  if (element.closest("[hidden], [inert]")) return false;
  if (element instanceof HTMLInputElement && element.type === "hidden") return false;
  return element.getClientRects().length > 0;
}

/** The first focusable match of `selector` under `root`. */
export function firstFocusable(root: HTMLElement | null, selector: string): HTMLElement | null {
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(isFocusable) ?? null;
}
