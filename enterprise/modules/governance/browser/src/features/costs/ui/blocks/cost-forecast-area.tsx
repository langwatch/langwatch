// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box } from "@chakra-ui/react";
import { type ReactNode, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { projectionSpan, seriesKeysOf, widenBuckets } from "../../model/chart-series.ts";
import { CHART_TOOLTIP_CONTENT, CHART_TOOLTIP_LABEL } from "../../model/chart-theme.ts";
import { fmtMoney, formatDayTick } from "../../model/cost-figure-format.ts";
import { type DailyBucket } from "../../model/sample-series.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import {
  AXIS_TICK,
  CHART_MARGIN,
  ChartLegend,
  EmptyPanel,
  GRID_STROKE,
  PROJECTION_INK,
} from "./cost-chart-parts.tsx";
import { ForecastDefs, defsId } from "./forecast-defs.tsx";

/**
 * Stacked area over the measured months and the months still to come.
 *
 * TELLING THE TWO APART IS THE WHOLE JOB. The panel used to draw both halves
 * in one flat fill and rely on a dashed line and the word "projected" to say
 * which was which — a caption doing work the drawing should do, and a reader
 * skimming the row saw one continuous block of spend running past today. The
 * two regions are now different objects to the eye before any label is read:
 * each series is filled through a gradient that drops hard at the boundary,
 * so the projected months are ghosted against solid measured ones, and the
 * projected span carries a diagonal hatch over the top of it.
 *
 * The hatch is the older convention and the one that survives a screenshot at
 * any size: fills flatten when an image is scaled down, and a texture does
 * not. Both signals rather than either, because this chart says money will be
 * spent that has not been, and that claim should be hard to miss.
 *
 * The gradient offsets are computed from the boundary's INDEX, not its date:
 * a category axis spaces its points evenly, so the split sits at a known
 * fraction of the plot's width whatever the interval folds the months into.
 */
/**
 * One stacked area per series, each painted from the gradients `ForecastDefs`
 * laid down for it.
 *
 * Returns the ARRAY rather than a fragment, and is called as a plain function
 * rather than rendered as `<ForecastAreas />`. Recharts inspects the type of
 * each child of a chart to decide what it is; an array it walks through, but
 * a fragment or a wrapper component is not an `Area` as far as that
 * inspection is concerned, and the series silently vanish.
 */
function forecastAreas(keys: { key: string; label: string }[]) {
  return keys.map((k) => (
    <Area
      key={k.key}
      type="monotone"
      dataKey={k.key}
      stackId="cost"
      stroke={`url(#${defsId("cost-forecast-line", k.key)})`}
      strokeWidth={1.5}
      fill={`url(#${defsId("cost-forecast-fill", k.key)})`}
      fillOpacity={1}
      isAnimationActive={false}
    />
  ));
}

export function CostForecastArea({
  buckets,
  projectedFromDay,
  height = "220px",
  interval,
  empty,
}: {
  /** Null is a read that never answered; empty is one that found nothing. */
  buckets: DailyBucket[] | null;
  projectedFromDay: string | null;
  height?: string;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const drawn = useMemo(() => buckets ?? [], [buckets]);
  const keys = useMemo(() => seriesKeysOf(drawn), [drawn]);
  const rows = useMemo(() => widenBuckets(drawn, keys), [drawn, keys]);
  const projection = useMemo(
    () => projectionSpan(rows, projectedFromDay),
    [projectedFromDay, rows],
  );
  const lastDay = rows[rows.length - 1]?.day;
  const splitAt = projection?.at ?? null;
  if (buckets === null || rows.length === 0 || keys.length === 0)
    return <EmptyPanel height={height} unanswered={buckets === null} empty={empty} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={CHART_MARGIN}>
          {ForecastDefs({ keys, splitAt })}
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtMoney} width={58} />
          <Tooltip
            formatter={(value, name) => [
              fmtMoney(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => formatDayTick(String(label), interval)}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
          />
          {ChartLegend({ keys })}
          {projection && lastDay && (
            <ReferenceArea
              x1={projection.from}
              x2={String(lastDay)}
              fill="url(#cost-forecast-hatch)"
              fillOpacity={1}
            />
          )}
          {projection && (
            <ReferenceLine
              x={projection.from}
              stroke={PROJECTION_INK}
              strokeDasharray="4 4"
              label={{
                value: "projected",
                position: "insideTopRight",
                fontSize: 10,
                fill: PROJECTION_INK,
              }}
            />
          )}
          {forecastAreas(keys)}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
