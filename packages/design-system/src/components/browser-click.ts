import type { MouseEvent } from "react";

/** A click the browser keeps: a new tab, a new window, a download. */
export function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return true;
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
