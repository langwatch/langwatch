// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box } from "@chakra-ui/react";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { type ReactNode, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { seriesKeysOf, widenBuckets } from "../../model/chart-series.ts";
import {
  CHART_TOOLTIP_CONTENT,
  CHART_TOOLTIP_CURSOR,
  CHART_TOOLTIP_LABEL,
} from "../../model/chart-theme.ts";
import { fmtMoney, formatDayTick } from "../../model/cost-figure-format.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import {
  AXIS_TICK,
  CHART_MARGIN,
  ChartLegend,
  EmptyPanel,
  GRID_STROKE,
} from "./cost-chart-parts.tsx";
import {
  WITHHELD_TOOLTIP_NOTE,
  dayOfBarPayload,
  type StackedBucket,
  withheldDaysOf,
  withheldShapeFor,
} from "./withheld-bar-shape.tsx";

/**
 * Stacked bars over the time axis — the shape the cost-evolution panels want.
 *
 * `grouped` puts the series side by side instead of on top of one another, for
 * the one panel whose series must never be added together: seats bought
 * against seats assigned. Stacking those draws a bar of bought-plus-assigned,
 * a height nobody holds, and the gap between them is the whole point of the
 * chart (ADR-128 §16).
 */
export function CostStackedBars({
  buckets,
  height = "220px",
  format = fmtMoney,
  showLegend = true,
  interval,
  grouped = false,
  colorFor,
  empty,
  onSelectSeries,
}: {
  /**
   * Null while unanswered. A bucket flagged `withheld` is drawn faded with a
   * dashed edge and its tooltip says why: its bar is the sum of the days that
   * held a figure, which is short by however much was left out, and a short
   * bar drawn like a whole one reads as a cheap period. A withheld bucket
   * with no figure at all gets a dashed stand-in where its bar would be, so
   * it is never an empty slot. See `withheldBarShape`.
   */
  buckets: StackedBucket[] | null;
  height?: string;
  format?: (value: number) => string;
  showLegend?: boolean;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** Draw the series side by side rather than summed into one bar. */
  grouped?: boolean;
  /**
   * A colour for a series, overriding the label's hash.
   *
   * The hash is right for panels whose series are open-ended — teams, models,
   * agents — because it gives the same name the same hue on every screen. It
   * is wrong for a chart of exactly two series that exist to be compared:
   * "Seats bought" and "Seats assigned" hashed to two blues a reader had to
   * consult the legend to separate, on the one chart whose entire content is
   * the gap between them.
   */
  colorFor?: (key: string) => string | undefined;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
  /**
   * Called with a series key and a bucket when a reader clicks that series in
   * that bucket. Unset on every panel that has nothing to open, which is most
   * of them, and the bars then carry no pointer and no handler at all.
   *
   * The bar is the target rather than a row of controls under the chart: a
   * reader chasing a bucket that stands out is already pointing at it, and a
   * control row under a chart is a shape nothing else on this screen has.
   */
  onSelectSeries?: (key: string, bucket: string) => void;
}) {
  const keys = useMemo(() => seriesKeysOf(buckets ?? []), [buckets]);
  const rows = useMemo(() => widenBuckets(buckets ?? [], keys), [buckets, keys]);
  const { withheldDays, emptyDays } = useMemo(() => withheldDaysOf(buckets ?? []), [buckets]);

  if (buckets === null) return <EmptyPanel height={height} unanswered empty={empty} />;
  // A window can come back full of days and empty of series — every day
  // present, nothing spent on any of them. That has rows but nothing to draw,
  // and drawing it anyway leaves bare axes that read as a broken chart.
  if (rows.length === 0 || keys.length === 0)
    return <EmptyPanel height={height} unanswered={false} empty={empty} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value, name) => [
              format(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => {
              const period = formatDayTick(String(label), interval);
              return withheldDays.has(String(label))
                ? `${period} · ${WITHHELD_TOOLTIP_NOTE}`
                : period;
            }}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
            cursor={CHART_TOOLTIP_CURSOR}
          />
          {showLegend && ChartLegend({ keys })}
          {keys.map((k, index) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              // No stack id at all when grouped: recharts reads a shared one
              // as "these add up", which is exactly the claim the seat chart
              // must not make.
              stackId={grouped ? undefined : "cost"}
              fill={colorFor?.(k.key) ?? getHexColorForString(k.label)}
              isAnimationActive={false}
              shape={withheldShapeFor({
                withheldDays,
                emptyDays,
                drawsEmptyMark: index === 0,
              })}
              cursor={onSelectSeries ? "pointer" : undefined}
              onClick={
                onSelectSeries
                  ? (data) => {
                      // The widened row rides along as `payload`, so the
                      // bucket comes off the row itself rather than out of an
                      // index into `rows` — an index would silently point at
                      // the wrong bucket the moment a series is missing from
                      // one.
                      const day = dayOfBarPayload(data);
                      if (typeof day === "string") onSelectSeries(k.key, day);
                    }
                  : undefined
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
