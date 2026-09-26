// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Text, VStack } from "@chakra-ui/react";
import { type ReactNode } from "react";
import { Legend } from "recharts";

import { CHART_AXIS_TICK, CHART_GRID_STROKE } from "../../model/chart-theme.ts";

export const AXIS_TICK = CHART_AXIS_TICK;
export const GRID_STROKE = CHART_GRID_STROKE;

/**
 * Plot margins shared by every chart on this screen.
 *
 * The right side carries half a tick label rather than the 8px the charts used
 * to have. A period tick is centred on its point, and the last point sits on
 * the plot's right edge, so the overhang was being clipped — "Q3 2026" came
 * out as "Q3 202" with the last digit sliced off. One constant so the four
 * charts cannot drift apart on it.
 */
export const CHART_MARGIN = { top: 8, right: 30, bottom: 0, left: 0 } as const;

/**
 * The two reasons a panel has nothing to draw, kept apart on purpose.
 *
 * A read that answered with no rows measured the window and found it empty.
 * A read that never answered — still in flight, or never allowed to run —
 * measured nothing at all. "Nothing in this window yet" is a result, so
 * showing it for the second case reports a finding the screen does not have.
 * `null` rows mean unanswered; an empty array means measured-and-empty.
 */
export function EmptyPanel({
  height,
  unanswered,
  empty,
}: {
  height: string;
  unanswered: boolean;
  /**
   * What this particular panel says when it has nothing to draw. Every panel
   * on the Costs page passes one — a bare "Not available." names neither the
   * panel nor what would fill it, and a reader's next move on reading it is to
   * report a bug against a screen behaving exactly as designed. The fallback
   * below is for a caller that has not been given its own words yet.
   */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  if (empty) return <>{empty(unanswered)}</>;
  return (
    <VStack align="center" justify="center" height={height} color="fg.muted">
      <Text fontSize="sm">{unanswered ? "Not available." : "Nothing in this window yet."}</Text>
    </VStack>
  );
}

/**
 * The slate ink for a quantity that is NOT a measurement of what happened.
 *
 * Two marks on this screen mean that, and they share it on purpose: the
 * forecast's projected span, and the edge of a bar whose period holds a figure
 * we do not have. A hex rather than a token because the chart palette has no
 * hue for "not a measurement" — every palette hue carries a figure, and a
 * figure is the one thing neither of these marks is — and no Chakra semantic
 * token names the idea either; `fg.muted` is an ink for text, which the
 * mark-colour guard rightly refuses on a drawn shape. `CHART_SEAT_CONTRACT_FILL`
 * in `chartTheme` is the same slate for the same reason.
 */
export const PROJECTION_INK = "#94a3b8";
/**
 * Called as a plain function at the call sites below, not rendered as
 * `<ChartLegend />`. Recharts inspects the *type* of each direct child to
 * decide what it is, and a custom wrapper component is not a `Legend` as far
 * as that inspection is concerned — wrapping this in JSX makes the legend
 * silently disappear. Calling it returns the `Legend` element itself, which is
 * what Recharts needs to see.
 */
export function ChartLegend({ keys }: { keys: { key: string; label: string }[] }) {
  return (
    <Legend
      wrapperStyle={{ fontSize: 11 }}
      iconType="circle"
      formatter={(value: string) => keys.find((k) => k.key === value)?.label ?? value}
    />
  );
}
