/**
 * The plotted answer.
 *
 * "Compare trace cost this week to last" is a question about a TREND, and the
 * metrics card answered it with two large decimals — `$0.41456935` against
 * `$0.16630300`. Both numbers were right and the answer was useless: the shape
 * of the change is the thing being asked for, and a shape needs a plot.
 *
 * Chart engine is recharts, which the whole Analytics surface already uses, via
 * Chakra's `useChart` — a theme-aware wrapper over that same recharts, so this
 * introduces a styling layer, not a second charting stack. Colours, number and
 * date formatting therefore come from the theme rather than from constants
 * hand-picked here, and the chart follows light/dark without being told.
 *
 * The card can also SAVE what it drew: a plot you can only look at once is a
 * screenshot, and the natural next thing after "show me the trend" is "keep
 * watching this". That is only offered when the agent supplied a graph
 * definition — the panel never invents one, because a graph it guessed at would
 * silently disagree with the plot above it the moment the dashboard refetched.
 */
import {
  Box,
  Button,
  HStack,
  Menu,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useChart } from "@chakra-ui/charts";
import { ArrowUpRight, LayoutDashboard, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";

import { toaster } from "~/components/ui/toaster";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { formatMoneyShort, Money } from "../Money";
import type { CapabilityCardInput } from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

interface TimeseriesPoint {
  t: string | number;
  v: number;
}
interface TimeseriesSeries {
  name: string;
  points: TimeseriesPoint[];
}
export interface TimeseriesPayload {
  series: TimeseriesSeries[];
  title?: string;
  unit?: "usd" | "count" | "ms" | "percent" | "tokens";
  comparison?: {
    label: string;
    value: number;
    baselineLabel: string;
    baseline: number;
  };
  graph?: unknown;
}

/** A row per x value, with one column per series — the shape recharts wants. */
function toWideRows(series: TimeseriesSeries[]): Record<string, unknown>[] {
  const byX = new Map<string, Record<string, unknown>>();
  for (const s of series) {
    for (const point of s.points) {
      const x = String(point.t);
      const row = byX.get(x) ?? { t: x };
      row[s.name] = point.v;
      byX.set(x, row);
    }
  }
  // Zero-fill: recharts breaks a line where a key is missing, which would read
  // as "no data" rather than "this series had none in that bucket".
  const rows = [...byX.values()];
  for (const row of rows) {
    for (const s of series) if (!(s.name in row)) row[s.name] = 0;
  }
  return rows;
}

/** Format one value for the axis and tooltip, per the declared unit. */
function valueFormatter(unit: TimeseriesPayload["unit"]) {
  switch (unit) {
    case "usd":
      return (v: number) => formatMoneyShort(v);
    case "ms":
      return (v: number) => (v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
    case "percent":
      return (v: number) => `${v.toFixed(1)}%`;
    default:
      return (v: number) => v.toLocaleString();
  }
}

/**
 * The largest single point across every series, and what share of the total it
 * accounts for.
 *
 * The spike is usually the answer. "Cost went up 154%" invites the next
 * question — WHEN, and was it one bad day or a steady climb — and a series that
 * puts two-thirds of its total in one bucket is telling a completely different
 * story from one that rose evenly. Calling it out turns the chart from a shape
 * into a finding.
 */
function peakOf(series: TimeseriesSeries[]): {
  t: string;
  v: number;
  share: number;
} | null {
  let best: { t: string; v: number } | null = null;
  let total = 0;
  for (const s of series) {
    for (const point of s.points) {
      if (!Number.isFinite(point.v)) continue;
      total += point.v;
      if (!best || point.v > best.v) best = { t: String(point.t), v: point.v };
    }
  }
  // A share needs a positive total to mean anything, and a single-point series
  // is trivially its own peak — neither is a finding worth drawing attention to.
  if (!best || total <= 0) return null;
  return { ...best, share: best.v / total };
}

/** The change between two figures, or null when the baseline cannot support one. */
function percentChange(value: number, baseline: number): number | null {
  // Dividing by a zero baseline yields Infinity, which renders as "∞%" and
  // means nothing — "up from nothing" is the honest reading, and the two raw
  // figures beside it already say that.
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline === 0) {
    return null;
  }
  return ((value - baseline) / Math.abs(baseline)) * 100;
}

/**
 * Is there anything to draw? A payload can satisfy the card's schema and still
 * have no points in it, and an axis with no line under it is a chart that says
 * nothing while looking like it says something.
 */
export function isPlottable(payload: unknown): payload is TimeseriesPayload {
  const series = (payload as TimeseriesPayload | undefined)?.series;
  return (
    Array.isArray(series) &&
    series.some((s) => Array.isArray(s?.points) && s.points.length > 0)
  );
}

export function LangyTimeseriesCard({ output, projectSlug }: CapabilityCardInput) {
  const payload = output as TimeseriesPayload | undefined;
  // Read before the guard: the guard narrows an unplottable payload away, and
  // an empty range still deserves the title it was asked under.
  const title = payload?.title;

  if (!isPlottable(payload)) {
    return (
      <LangyCapabilityCard
        tone="read"
        surface="analytics"
        overline="Analytics"
        title={title ?? "No data to plot"}
        projectSlug={projectSlug}
      >
        <Text textStyle="xs" color="fg.muted">
          Nothing in this range.
        </Text>
      </LangyCapabilityCard>
    );
  }

  return (
    <LangyCapabilityCard
      tone="read"
      surface="analytics"
      overline="Analytics"
      title={payload.title ?? "Over time"}
      projectSlug={projectSlug}
      deepLink={false}
      actions={<SaveToDashboard graph={payload.graph} title={payload.title} />}
    >
      <TimeseriesPlot payload={payload} />
    </LangyCapabilityCard>
  );
}

/**
 * The plot itself, without a card around it.
 *
 * Separate from the card so the declarative card's `chart` body draws the SAME
 * plot rather than a second implementation of one — and so the chart hooks sit
 * below the "is there anything to draw" guard instead of above it, where their
 * count depended on the payload.
 */
export function TimeseriesPlot({ payload }: { payload: TimeseriesPayload }) {
  const series = payload.series ?? [];
  const rows = useMemo(() => toWideRows(series), [series]);
  const peak = useMemo(() => peakOf(series), [series]);
  const format = valueFormatter(payload.unit);

  const chart = useChart({
    data: rows,
    series: series.map((s) => ({ name: s.name })),
  });

  return (
    <VStack align="stretch" gap={3}>
      {payload.comparison ? (
        <ComparisonHeadline
          comparison={payload.comparison}
          unit={payload.unit}
        />
      ) : null}

      <Box height="140px" width="full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              {chart.series.map((s, index) => (
                <linearGradient
                  key={String(s.name)}
                  id={`langy-ts-${chart.id}-${index}`}
                  x1="0" y1="0" x2="0" y2="1"
                >
                  <stop offset="0%" stopColor={chart.color(s.color)} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={chart.color(s.color)} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              stroke={chart.color("border.muted")}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey={chart.key("t")}
              tickLine={false}
              axisLine={false}
              tick={{ fill: chart.color("fg.subtle"), fontSize: 10 }}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: chart.color("fg.subtle"), fontSize: 10 }}
              tickFormatter={format}
            />
            <Tooltip
              cursor={{ stroke: chart.color("border.emphasized") }}
              // Value only: recharts already prints the series name beside
              // it, and returning the pair form fights v3's Formatter type
              // for a label we would be duplicating anyway.
              formatter={(value: ValueType | undefined) => format(Number(value ?? 0))}
              contentStyle={{
                background: chart.color("bg.panel"),
                border: `1px solid ${chart.color("border.muted")}`,
                borderRadius: 8,
                fontSize: 11,
              }}
            />
            {peak ? (
              <ReferenceDot
                x={peak.t}
                y={peak.v}
                r={3}
                fill={chart.color("orange.solid")}
                stroke={chart.color("bg.panel")}
                strokeWidth={1.5}
              />
            ) : null}
            {chart.series.map((s, index) => (
              <Area
                key={String(s.name)}
                type="monotone"
                isAnimationActive={false}
                dataKey={chart.key(s.name)}
                stroke={chart.color(s.color)}
                strokeWidth={1.5}
                fill={`url(#langy-ts-${chart.id}-${index})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>

      {peak ? (
        <HStack gap={1.5} color="fg.muted">
          <Box color="orange.fg" display="flex" flexShrink={0}>
            <TrendingUp size={12} />
          </Box>
          <Text textStyle="2xs">
            Peak {format(peak.v)} on {peak.t}
            {/* Only when it is genuinely concentrated. Announcing "18% of the
                total" on an even week is noise dressed as insight. */}
            {peak.share >= 0.4
              ? ` — ${Math.round(peak.share * 100)}% of the period`
              : ""}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  );
}

/** The headline the plot supports: both figures, and the direction between them. */
function ComparisonHeadline({
  comparison,
  unit,
}: {
  comparison: NonNullable<TimeseriesPayload["comparison"]>;
  unit: TimeseriesPayload["unit"];
}) {
  const change = percentChange(comparison.value, comparison.baseline);
  const up = change !== null && change > 0;
  const Icon = up ? TrendingUp : TrendingDown;

  const render = (value: number) =>
    unit === "usd" ? <Money amount={value} /> : <>{valueFormatter(unit)(value)}</>;

  return (
    <HStack gap={4} align="baseline" flexWrap="wrap">
      <VStack align="start" gap={0}>
        <Text textStyle="2xs" color="fg.subtle">
          {comparison.label}
        </Text>
        <Text textStyle="lg" fontWeight="600" color="fg">
          {render(comparison.value)}
        </Text>
      </VStack>
      <VStack align="start" gap={0}>
        <Text textStyle="2xs" color="fg.subtle">
          {comparison.baselineLabel}
        </Text>
        <Text textStyle="sm" color="fg.muted">
          {render(comparison.baseline)}
        </Text>
      </VStack>
      {change !== null ? (
        // Direction is stated, never coloured good/bad: whether rising cost is
        // bad depends on why it rose, and the card does not know.
        <HStack gap={1} color="fg.muted">
          <Icon size={13} />
          <Text textStyle="xs" fontWeight="560" fontVariantNumeric="tabular-nums">
            {up ? "+" : ""}
            {change.toFixed(1)}%
          </Text>
        </HStack>
      ) : null}
    </HStack>
  );
}

/**
 * Save the plot onto a dashboard — an existing one, or a new one named after it.
 *
 * Renders nothing without a graph definition. An "Add to dashboard" button that
 * saved a guessed query would produce a dashboard tile quietly disagreeing with
 * the card it came from, which is worse than not offering it.
 */
function SaveToDashboard({ graph, title }: { graph: unknown; title?: string }) {
  const { project } = useOrganizationTeamProject();
  const [saving, setSaving] = useState(false);
  const dashboards = api.dashboards.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && !!graph },
  );
  const createGraph = api.graphs.create.useMutation();
  const createDashboard = api.dashboards.create.useMutation();

  // ABOVE the guard. `useRouter` is a real hook, and sitting below an early
  // return it made the hook count depend on whether `project` had resolved —
  // so the first render with data threw "Rendered more hooks than during the
  // previous render", taking the whole panel down rather than just this card.
  const router = useRouter();

  if (!graph || !project?.id) return null;

  const name = title?.trim() || "Langy chart";

  const save = async (dashboardId: string) => {
    setSaving(true);
    try {
      await createGraph.mutateAsync({
        projectId: project.id,
        name,
        graph: JSON.stringify(graph),
        dashboardId,
      });
      toaster.create({
        type: "success",
        title: "Saved to dashboard",
        action: {
          label: "Open",
          // SPA navigation, never a location assignment. A full reload here
          // tears down the panel, the conversation and the streaming turn that
          // produced this chart — you would lose the thing you just saved from.
          onClick: () => {
            void router.push(
              `/${project.slug}/analytics/reports?dashboard=${dashboardId}`,
            );
          },
        },
      });
    } catch {
      toaster.create({ type: "error", title: "Couldn't save the chart" });
    } finally {
      setSaving(false);
    }
  };

  const saveToNew = async () => {
    setSaving(true);
    try {
      const dashboard = await createDashboard.mutateAsync({
        projectId: project.id,
        name,
      });
      await save(dashboard.id);
    } catch {
      toaster.create({ type: "error", title: "Couldn't create the dashboard" });
      setSaving(false);
    }
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="outline" loading={saving}>
          <LayoutDashboard size={12} /> Save to dashboard
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            {(dashboards.data ?? []).map((dashboard) => (
              <Menu.Item
                key={dashboard.id}
                value={dashboard.id}
                onClick={() => void save(dashboard.id)}
              >
                {dashboard.name}
              </Menu.Item>
            ))}
            {dashboards.data?.length ? <Menu.Separator /> : null}
            <Menu.Item value="__new" onClick={() => void saveToNew()}>
              <ArrowUpRight size={12} /> New dashboard
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
