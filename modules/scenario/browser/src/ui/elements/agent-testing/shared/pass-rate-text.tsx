/**
 * A pass rate as a plain coloured percentage.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Text } from "@langwatch/design-system/primitives";

import { formatPassRate, passRateColor } from "./pass-rate-color.ts";

export type PassRateTextProps = {
  /** 0 to 100, or null when nothing settled. */
  passRate: number | null;
  textStyle?: string;
};

export function PassRateText({ passRate, textStyle = "caption" }: PassRateTextProps) {
  return (
    <Text
      as="span"
      textStyle={textStyle}
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
