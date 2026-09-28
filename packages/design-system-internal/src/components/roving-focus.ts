import type { KeyboardEvent } from "react";

const steps: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Arrow-key movement across a group of `[data-roving]` buttons (the tabs):
 * focuses the next one and answers its index, or undefined for any other key.
 */
export const moveRovingFocus = ({
  event,
}: {
  event: KeyboardEvent<HTMLElement>;
}): number | undefined => {
  const step = steps[event.key];
  const group = event.currentTarget.closest("[data-roving-group]");
  if (step === undefined || !group) return undefined;
  const items = Array.from(group.querySelectorAll<HTMLButtonElement>("[data-roving]"));
  const current = items.findIndex((item) => item === event.currentTarget);
  const next = (current + step + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
  return next;
};
