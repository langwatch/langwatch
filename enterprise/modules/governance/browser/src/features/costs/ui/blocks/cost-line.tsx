// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box } from "@chakra-ui/react";
import { type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_SPARK_STROKE,
  CHART_TOOLTIP_CONTENT,
  CHART_TOOLTIP_LABEL,
} from "../../model/chart-theme.ts";
import { fmtCount, formatDayTick } from "../../model/cost-figure-format.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { AXIS_TICK, CHART_MARGIN, EmptyPanel, GRID_STROKE } from "./cost-chart-parts.tsx";

/** One spiky line, for counts rather than money. */
export function CostLine({
  points,
  height = "220px",
  format = fmtCount,
  interval,
  empty,
}: {
  points: { day: string; value: number }[];
  height?: string;
  format?: (value: number) => string;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  if (points.length === 0) return <EmptyPanel height={height} unanswered={false} empty={empty} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="cost-line-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SPARK_STROKE} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_SPARK_STROKE} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value) => format(Number(value))}
            labelFormatter={(label) => formatDayTick(String(label), interval)}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={CHART_SPARK_STROKE}
            strokeWidth={1.5}
            fill="url(#cost-line-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
