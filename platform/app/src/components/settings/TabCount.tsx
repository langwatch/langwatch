import { Badge } from "@chakra-ui/react";

/**
 * How many things are behind a tab, said the same way on every tab.
 *
 * The members area used to say it two ways in one row: "Invitations (0)"
 * carried its count in parentheses whether or not there was anything to
 * count, and "Join requests" carried none at all until something arrived. So
 * two lists sitting side by side were labelled by two different rules, and
 * the tab with nothing in it was the one that looked broken — a reader cannot
 * tell "nobody has asked" from "this label forgot its number".
 *
 * A zero IS an answer, and it is the answer an administrator checking on a
 * quiet week is looking for. So the count shows at every value including
 * zero.
 *
 * What it does NOT do is show a zero it has not confirmed. `undefined` means
 * the count has not arrived, and a badge that reads 0 for a moment and then
 * flips to 7 has told the reader something false on the way — so nothing is
 * drawn until there is a number to draw.
 */
/**
 * The palette for each condition. Grey is the default and stays the default:
 * a row of tabs where every badge is coloured has no colour left to mean
 * anything, so a tab only spends one when the count itself carries a
 * condition — how many directories are connected, and whether they are working.
 */
const TONE_PALETTE = {
  neutral: "gray",
  good: "green",
  warning: "orange",
  bad: "red",
} as const;

export function TabCount({
  value,
  tone = "neutral",
  title,
  "data-testid": testId,
}: {
  /** The count, or undefined while it is still being read. */
  value: number | undefined;
  /**
   * The condition the count is in, where the count has one. Most tabs have
   * none — a number of groups is not healthy or unhealthy — and those stay
   * grey.
   */
  tone?: keyof typeof TONE_PALETTE;
  /** What the colour means, in words, for the reader who does not see it. */
  title?: string;
  "data-testid"?: string;
}) {
  if (value === undefined) return null;

  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={TONE_PALETTE[tone]}
      title={title}
      // Tabular figures so a count ticking 9 → 10 does not shift the label
      // beside it, and a fixed minimum so single digits are not narrower
      // circles than double ones.
      fontVariantNumeric="tabular-nums"
      minWidth="1.5em"
      justifyContent="center"
      data-testid={testId}
    >
      {value}
    </Badge>
  );
}
