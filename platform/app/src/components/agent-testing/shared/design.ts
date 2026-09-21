/**
 * The greys and the backgrounds the Agent Testing surface is drawn with.
 *
 * Secondary text and muted icons read in the same grey as the rest of the
 * product, so the page keeps the product's contrast rather than a lighter one
 * of its own. The sizes and the paddings are what make the surface compact.
 */

/** Secondary text and muted icons: the product's standard grey. */
export const FG_MUTED = "fg.muted";

export const TABLE_HEADER_BG = "bg.muted/50";

export const GROUP_HEADER_BG = "bg.muted/30";

export const ROW_HOVER_BG = "bg.muted/40";

/**
 * What a quiet control sets its shadow to inside a dialog.
 *
 * A dialog lifts every button it holds that does not read as a ghost, which
 * suits the actions at its foot and not the small controls in its body: an
 * add, an x or a lock is quiet, and a card under it reads as a second action.
 */
export const QUIET_BUTTON_SHADOW = "none";
