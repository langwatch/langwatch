import { Box, HStack, Heading, Spacer, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getHexColorForString } from "~/utils/rotatingColors";

/**
 * Wire shape returned by `api.activityMonitor.spendOverTime` — see
 * Sergey's lane-S touch list (item 3). Daily UTC buckets, one row per
 * bucket, with a flat `series` array per row carrying spend per group
 * (team / user / model). The chart pivots this into Recharts'
 * "wide" data shape (one column per series) under the hood so a key
 * with no spend on a given day still renders 0 in the stacked area.
 */
export interface SpendOverTimeBucket {
  bucketIso: string;
  points: Array<{ key: string; label: string; spendUsd: number }>;
}

export type GroupBy = "team" | "user" | "model";

const GROUP_LABEL: Record<GroupBy, string> = {
  team: "team",
  user: "user",
  model: "model",
};

/**
 * Stacked-area chart showing daily spend bucketed by group (team /
 * user / model). Answers the admin's "how is AI usage trending across
 * the org" question at a glance. Each series carries a stable hash-
 * derived color (see `getHexColorForString`) so the same team paints
 * the same hue across every governance surface.
 *
 * Empty state is honest: when `buckets` is empty (no events in
 * window) we render the empty-state copy, not a fake-flat-line chart.
 */
export function SpendOverTimeChart({
  buckets,
  groupBy,
  emptyHint,
}: {
  buckets: SpendOverTimeBucket[] | undefined;
  groupBy: GroupBy;
  emptyHint?: string;
}) {
  const { rows, seriesKeys } = useMemo(() => {
    if (!buckets || buckets.length === 0) {
      return { rows: [], seriesKeys: [] as Array<{ key: string; label: string }> };
    }
    const labelByKey = new Map<string, string>();
    for (const bucket of buckets) {
      for (const s of bucket.points) {
        if (!labelByKey.has(s.key)) labelByKey.set(s.key, s.label);
      }
    }
    const seriesKeys = [...labelByKey.entries()].map(([key, label]) => ({
      key,
      label,
    }));
    const rows = buckets.map((bucket) => {
      const row: Record<string, number | string> = { day: bucket.bucketIso };
      for (const k of seriesKeys) {
        row[k.key] = 0;
      }
      for (const s of bucket.points) {
        row[s.key] = s.spendUsd;
      }
      return row;
    });
    return { rows, seriesKeys };
  }, [buckets]);

  return (
    <VStack align="stretch" gap={2}>
      <HStack>
        <Heading size="sm">Spend over time, by {GROUP_LABEL[groupBy]}</Heading>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          stacked daily spend · last 30 days
        </Text>
      </HStack>
      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="lg"
        padding={3}
        height="280px"
      >
        {rows.length === 0 ? (
          <VStack
            align="center"
            justify="center"
            height="100%"
            color="fg.muted"
            gap={1}
          >
            <Text fontSize="sm">No spend in this window yet.</Text>
            {emptyHint && (
              <Text fontSize="xs">{emptyHint}</Text>
            )}
          </VStack>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                {seriesKeys.map((s) => {
                  const color = getHexColorForString(s.label);
                  return (
                    <linearGradient
                      key={s.key}
                      id={`spend-fill-${s.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickFormatter={formatDayTick}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickFormatter={(v: number) => `$${numeral(v).format("0,0.[00]")}`}
                width={60}
              />
              <Tooltip
                formatter={(value, name) => {
                  const label =
                    seriesKeys.find((s) => s.key === String(name))?.label ??
                    String(name);
                  return [`$${Number(value).toFixed(4)}`, label];
                }}
                labelFormatter={(label) => formatDayTick(label as string)}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                iconType="circle"
                formatter={(value: string) =>
                  seriesKeys.find((s) => s.key === value)?.label ?? value
                }
              />
              {seriesKeys.map((s) => {
                const color = getHexColorForString(s.label);
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId="spend"
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#spend-fill-${s.key})`}
                    isAnimationActive={false}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Box>
    </VStack>
  );
}

function formatDayTick(day: string | number): string {
  const s = String(day);
  // Sergey's wire shape returns ISO-day (`2026-04-15`) or full ISO; both
  // start with YYYY-MM-DD, so a simple split works.
  const parts = s.slice(0, 10).split("-");
  if (parts.length !== 3) return s;
  return `${parts[1]}/${parts[2]}`;
}
