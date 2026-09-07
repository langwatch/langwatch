/**
 * The width every control in a band's action row takes.
 *
 * Buttons that hug their labels turn a row of equal offers into a ragged line
 * of different-sized things, and the eye reads the widest one as the important
 * one. A fixed width says they are alternatives: add an address, or connect
 * any of these providers.
 *
 * The number is arithmetic, not taste. The band's column is 820px less its
 * padding, so a row of four of these plus a hairline and four gaps has to come
 * in under about 770: 4 × 172 + 48 + 1 = 737, which leaves room to spare and
 * keeps the row on ONE line at every desktop width. A wider button wrapped the
 * connect group onto a second line and left the divider dangling at the break,
 * which is the bug this number exists to prevent — widen it and that returns.
 */
export const SETTINGS_ACTION_BUTTON_WIDTH = "172px";
