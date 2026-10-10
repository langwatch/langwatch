import { Box } from "@langwatch/design-system/primitives";
import type { InsightTone } from "@langwatch/insight-contract";

import { TONE_PRESENTATION } from "../../model/insight-presentation.ts";

/** WARNING / WORTH A LOOK / GOOD NEWS: the verdict in words, on the verdict's colour. */
export function ToneBadge({ tone }: { tone: InsightTone }) {
  const { label, color } = TONE_PRESENTATION[tone];
  return (
    <Box
      as="span"
      flexShrink={0}
      borderRadius="sm"
      paddingX="6px"
      paddingY="2px"
      fontSize="9px"
      fontWeight="bold"
      letterSpacing="0.08em"
      textTransform="uppercase"
      color="white"
      background={color}
    >
      {label}
    </Box>
  );
}

/** The small verdict dot the bell lists new insights with. */
export function ToneDot({ tone }: { tone: InsightTone }) {
  return (
    <Box
      as="span"
      flexShrink={0}
      width="8px"
      height="8px"
      borderRadius="full"
      background={TONE_PRESENTATION[tone].color}
    />
  );
}
