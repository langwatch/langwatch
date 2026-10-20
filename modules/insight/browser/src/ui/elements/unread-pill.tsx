import { Box } from "@langwatch/design-system/primitives";
import type { InsightTone } from "@langwatch/insight-contract";

import { TONE_PRESENTATION } from "../../model/insight-presentation.ts";

/** Text that reads on each verdict colour: white on red and green, dark on amber. */
const PILL_TEXT: Record<InsightTone, string> = {
  bad: "red.contrast",
  watch: "yellow.contrast",
  good: "green.contrast",
};

/**
 * The unread count, like an email app, in the colour of the most urgent unseen verdict: red
 * for Act now, amber for Check this, green only for older good news. Draws nothing at zero.
 */
export function UnreadPill({
  count,
  tone,
  size = "sm",
}: {
  count: number;
  tone: InsightTone;
  size?: "sm" | "xs";
}) {
  if (count <= 0) return null;
  return (
    <Box
      as="span"
      aria-label={`${count} unread`}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      minWidth={size === "xs" ? "14px" : "18px"}
      height={size === "xs" ? "14px" : "16px"}
      paddingX={size === "xs" ? "3px" : "5px"}
      borderRadius="full"
      textStyle="micro"
      fontWeight="bold"
      fontVariantNumeric="tabular-nums"
      color={PILL_TEXT[tone]}
      background={TONE_PRESENTATION[tone].color}
    >
      {count}
    </Box>
  );
}
