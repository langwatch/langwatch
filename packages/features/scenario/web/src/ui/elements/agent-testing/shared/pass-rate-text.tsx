/**
 * A pass rate as a plain coloured percentage.
 *
 * Not a pill. Every grouping of the Results tab states its result the same
 * way, and a boxed pill repeated down a column read as clutter: the cost and
 * the duration it also carried belong to the run itself, where a total is a
 * total rather than a sum of whatever happened to load.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Text } from "@chakra-ui/react";
import { formatPassRate, passRateColor } from "./pass-rate-color";

export type PassRateTextProps = {
  /** 0 to 100, or null when nothing settled. */
  passRate: number | null;
  fontSize?: string;
};

export function PassRateText({ passRate, fontSize = "12px" }: PassRateTextProps) {
  return (
    <Text
      as="span"
      fontSize={fontSize}
      fontWeight="semibold"
      textAlign="right"
      whiteSpace="nowrap"
      fontVariantNumeric="tabular-nums"
      color={passRateColor(passRate)}
      data-testid="pass-rate-text"
    >
      {formatPassRate(passRate)}
    </Text>
  );
}
