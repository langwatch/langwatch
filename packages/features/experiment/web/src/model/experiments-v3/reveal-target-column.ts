/**
 * Bring a column into view after something off screen happened to it.
 *
 * A column Langy adds lands to the right of every column already there, which
 * on a wide workbench is past the edge of the table. The change was real and
 * saved and the reader saw nothing move, so the work read as nothing
 * happening. Scrolling to it is what makes an agent's edit land the way a
 * person's does: you see the thing that changed.
 *
 * `inline: "center"` rather than the drawer helper's right-edge maths, because
 * the Langy panel is docked over the right of the table and a column parked
 * against that edge sits underneath it.
 */

/**
 * The column is written to state first and painted on a later frame, so the
 * first look can miss it. A handful of frames covers the paint without
 * outliving the action that asked for it.
 */
const MAX_FRAMES = 10;

/**
 * The column's own attribute selector.
 *
 * A target id is any non-empty string, so a quote or a backslash in one would
 * end the attribute value early and make `querySelector` throw. That throw
 * would travel out of an action that already applied its change, so the caller
 * would read a save as a failure and do it again.
 */
const targetColumnSelector = (targetId: string): string =>
  `[data-target-column="${CSS.escape(targetId)}"]`;

/**
 * The name this column shows in its own header, or null when it is not on
 * screen. Read rather than derived: every candidate carries the same prompt
 * handle, so only the disambiguated form tells them apart, and computing it a
 * second time is how something ends up naming a different column than the
 * header does.
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
