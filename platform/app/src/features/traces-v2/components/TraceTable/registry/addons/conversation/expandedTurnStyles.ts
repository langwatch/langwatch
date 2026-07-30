/**
 * Background for an expanded conversation. The whole block — the group's
 * main row plus every turn row, in both the compact (column-aligned) and
 * comfortable (chat) layouts — paints this one recessed surface so the
 * expanded conversation reads as a single cohesive unit and never loses its
 * colour when the cursor moves off a sub-part of it.
 *
 * `EXPANDED_BG` is the Chakra token for normal cells. `EXPANDED_BG_CSS` is
 * the same colour as a raw CSS var, applied inline to the sticky first
 * column — the table shell forces that column's background via a high-
 * specificity rule that a token prop can't override, so it needs the inline
 * value to stay in step with the rest of the block instead of seaming into
 * a different shade.
 */
export const EXPANDED_BG = "bg.subtle";
export const EXPANDED_BG_CSS = "var(--chakra-colors-bg-subtle)";
