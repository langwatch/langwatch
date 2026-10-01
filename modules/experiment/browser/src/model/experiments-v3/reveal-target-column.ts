/**
 * Bring a column into view after something off screen happened to it.
 */

/**
 * The column is written to state first and painted on a later frame, so the
 * first look can miss it. A handful of frames covers the paint without
 * outliving the action that asked for it.
 */
const MAX_FRAMES = 10;

/**
 * The column's own attribute selector.
 */
const targetColumnSelector = (targetId: string): string =>
  `[data-target-column="${CSS.escape(targetId)}"]`;

/**
 * The name this column shows in its own header, or null when it is not on screen.
 */
export function targetColumnLabel(targetId: string): string | null {
  if (typeof document === "undefined") return null;
  const header = document.querySelector(`${targetColumnSelector(targetId)} [data-target-name]`);
  return header?.getAttribute("data-target-name") || null;
}

export function revealTargetColumn(targetId: string, frame = 0): void {
  if (typeof document === "undefined") return;

  const header = document.querySelector(targetColumnSelector(targetId));
  if (!header) {
    // Giving up in silence is right: scrolling is a courtesy, never the point
    // of the action, and an action that succeeded must not report a failure
    // because the view could not follow it.
    if (frame >= MAX_FRAMES) return;
    requestAnimationFrame(() => revealTargetColumn(targetId, frame + 1));
    return;
  }

  header.scrollIntoView?.({
    behavior: "smooth",
    // Horizontal only. The reader's vertical position is theirs, and yanking
    // it to the header would lose the rows they were reading.
    block: "nearest",
    inline: "center",
  });
}
