/**
 * How the last runs of a row went, oldest first.
 *
 * One bar per run, or per execution, depending on what the row stands for.
 * Height and colour both come from the same pass rate through the one colour
 * helper, so a short bar and a red bar always say the same thing, and a rate
 * that reads amber in the text beside it cannot read green here.
 *
 * The bars are drawn softer than the text, at the one shared opacity, because
 * they are a glance at history rather than the row's headline: the percentage
 * is, and it stays at full strength.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import type { TrendPoint } from "@langwatch/scenario-contract";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design";
import { formatPassRate, PASS_RATE_BAR_OPACITY, passRateColor } from "./pass-rate-color";

/** How tall the tallest bar is drawn, and so how tall the row of them is. */
const TREND_HEIGHT = 16;

/** The height a bar has at nothing, so a total failure is still visible. */
const TREND_FLOOR = 6;

const TREND_BAR_WIDTH = "5px";

/** What one bar says on hover, so a shape can be read as a number. */
function barTitle(passRate: number | null): string {
  return passRate === null ? "no verdict" : formatPassRate(passRate);
}

function barHeight(passRate: number | null): number {
  if (passRate === null) return TREND_FLOOR;
  const clamped = Math.max(0, Math.min(100, passRate));
  return TREND_FLOOR + (clamped / 100) * (TREND_HEIGHT - TREND_FLOOR);
}

export type TrendSparklineProps = {
  /** Oldest first, as every producer of a trend hands them over. */
  bars: TrendPoint[];
  /** What one bar stands for, which is what the hover says. */
  per: "run" | "execution";
};

export function TrendSparkline({ bars, per }: TrendSparklineProps) {
  if (bars.length === 0) {
    return (
      <Text as="span" fontSize="11px" color={FG_MUTED}>
        no runs
      </Text>
    );
  }

  const noun = per === "run" ? "runs" : "executions";

  return (
    <HStack
      gap="3px"
      height={`${TREND_HEIGHT}px`}
      alignItems="flex-end"
      title={`Last ${bars.length} ${noun}, oldest first`}
      opacity={PASS_RATE_BAR_OPACITY}
      data-testid="trend-sparkline"
    >
      {bars.map((bar) => (
        <Box
          key={bar.key}
          width={TREND_BAR_WIDTH}
          height={`${barHeight(bar.passRate)}px`}
          borderRadius="1px"
          title={barTitle(bar.passRate)}
          background={passRateColor(bar.passRate)}
          flexShrink={0}
          data-testid="trend-sparkline-bar"
        />
      ))}
    </HStack>
  );
}
