/**
 * The card that holds one prompt, and the tabs attached to its top edge.
 *
 * One set of values, shared, because the join between the two only disappears
 * when they agree exactly: the active tab takes the card's border colour and
 * width, its top radius, and the strip overlaps the card by exactly that border
 * width so no rule runs between a tab and the content it names.
 */
export const CARD_RADIUS = "lg";
export const CARD_BORDER_WIDTH = "1px";
export const CARD_BORDER_COLOR = "border.muted";

/** Room above the tabs, so they read as sitting on the page rather than filling it. */
export const TAB_STRIP_TOP_PADDING = 2;

/**
 * Space before the first tab.
 *
 * Wider than {@link CARD_RADIUS}, so a tab's left border starts past the card's
 * corner curve instead of inside it.
 */
export const TAB_STRIP_INLINE_PADDING = 3;
