import type { SeriesInputType } from "@langwatch/analytics-browser/surfaces/analytics-registry";
import type { TimeseriesBucket } from "@langwatch/analytics-contract";
// The single canonical encoder for `getTimeseries` bucket keys (ADR-034
// app-layer module). Reused — not re-implemented — so this reader can never
// drift from how the app-layer writes the value. Pure helper; safe client-side.
import { buildSeriesName } from "@langwatch/analytics-contract";
import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { nowInstant } from "@langwatch/time";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import type { RecentItem } from "../../../../../behavior/home-api.ts";
import { homeApi } from "../../../../../behavior/home-api.ts";
import { formatMilliseconds } from "../../../../../model/format-milliseconds.ts";
import { formatMoney } from "../../../../../model/format-money.ts";
import { useProjectHomeHost } from "../../../../../model/project-home-host.ts";
import { buildAttentionInbox, type CountedSignal } from "../attention-inbox.ts";
import { getBriefingMock, useBriefingMock } from "../mocks/briefing-mocks.ts";
import type { BriefingData, ScenarioBar, StatusCell } from "../types.ts";

/**
 * Derives Langy's home briefing from the project's REAL signals.
 * See specs/home/langy-briefing.feature.
 */

const MAX_BARS = 4;
/** How long a briefing read stays fresh before a background (no-flicker) refetch. */
const BRIEFING_STALE_MS = 60_000;
/**
 * Near-realtime: the live signals repoll on this cadence while the page is
 * visible (react-query pauses interval refetches for hidden tabs by default).
 */
const BRIEFING_POLL_MS = 30_000;
/**
 * How long cached reads survive an unmount. Long enough that stepping into a
 * trace and back to the home re-paints instantly from cache, then refreshes in
 * the background — the "cache" half of progressive loading.
 */
const BRIEFING_CACHE_MS = 10 * 60_000;

export interface LangyBriefingResult {
  data: BriefingData | null;
  statusCells: StatusCell[];
  recentItems: RecentItem[];
  /** First paint, before even the fast scenario roll-up has settled. */
  isLoading: boolean;
  /** The slow analytics roll-up hasn't landed yet — its section loads inline. */
  isAnalyticsLoading: boolean;
  /** A background refetch is in flight while cached data is still on screen. */
  isRefreshing: boolean;
}

interface ScenarioSummary {
  scenarioSetId: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  lastRunTimestamp?: number | null;
}

interface ScenarioTotals {
  passed: number;
  failed: number;
  total: number;
}

function percentDelta(
  current: number | undefined,
  previous: number | undefined,
): string | undefined {
  if (current === undefined || previous === undefined || previous <= 0) return undefined;
  const percent = ((current - previous) / previous) * 100;
  if (!Number.isFinite(percent) || Math.abs(percent) < 0.5) return undefined;
  const magnitude =
    Math.abs(percent) >= 10
      ? Math.round(Math.abs(percent))
      : Math.round(Math.abs(percent) * 10) / 10;
  return `${percent > 0 ? "+" : "−"}${magnitude}%`;
}

function costLikeTone(delta: string | undefined): "good" | "bad" | undefined {
  if (delta === undefined) return undefined;
  return delta.startsWith("+") ? "bad" : "good";
}

function developmentMockDelta(label: string, isDevelopment: boolean): string | undefined {
  if (!isDevelopment) return undefined;
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  const percent = (hash % 37) - 18;
  if (percent === 0) return "+2%";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

function buildHeadline({
  canViewAnalytics,
  canViewTraces,
  hasScenarios,
  hasTraces,
  isAnalyticsLoading,
  isAttentionLoading,
  recentCount,
  receiptCount,
  totals,
}: {
  canViewAnalytics: boolean;
  canViewTraces: boolean;
  hasScenarios: boolean;
  hasTraces: boolean;
  isAnalyticsLoading: boolean;
  isAttentionLoading: boolean;
  recentCount: number;
  receiptCount: number;
  totals: ScenarioTotals;
}): { headline: string; quiet: boolean } {
  if (receiptCount > 0) {
    const subject = receiptCount === 1 ? "signal needs" : "signals need";
    return {
      headline: `${receiptCount} ${subject} attention. Changed errors and repeated evidence are prioritized first.`,
      quiet: false,
    };
  }
  if (isAttentionLoading || isAnalyticsLoading) {
    return {
      headline: "Comparing error shapes and latency with the prior 30 days…",
      quiet: false,
    };
  }
  if (hasScenarios && totals.failed > 0) {
    return {
      headline: `${totals.passed} of ${totals.total} scenarios passing. ${totals.failed} need a look.`,
      quiet: false,
    };
  }
  if (hasScenarios) {
    return {
      headline:
        "No supported error or latency change is asking for attention. Recent scenarios are passing.",
      quiet: false,
    };
  }
  if (hasTraces) {
    const canCompare = canViewAnalytics || canViewTraces;
    return {
      headline: canCompare
        ? "No supported error or latency change is asking for attention right now."
        : "Trace activity is available, but this view cannot compare errors or latency with your current access.",
      quiet: false,
    };
  }
  if (recentCount > 0) {
    return { headline: "Here's where you left off, and what's moved since.", quiet: false };
  }
  return {
    headline: "Your project is quiet. Send a trace and I'll start watching for what changes.",
    quiet: true,
  };
}

function buildScenarioBars(sets: ScenarioSummary[]): ScenarioBar[] {
  return [...sets]
    .toSorted((a, b) => (b.lastRunTimestamp ?? 0) - (a.lastRunTimestamp ?? 0))
    .slice(0, MAX_BARS)
    .map((summary) => ({
      id: summary.scenarioSetId,
      label: summary.scenarioSetId,
      status: summary.failedCount > 0 ? "fail" : "pass",
      fillPct: summary.totalCount > 0 ? (summary.passedCount / summary.totalCount) * 100 : 0,
      statLabel: `${summary.passedCount}/${summary.totalCount} pass`,
    }));
}

function buildScenarioCells({
  hasScenarios,
  setCount,
  slug,
  totals,
}: {
  hasScenarios: boolean;
  setCount: number;
  slug: string | undefined;
  totals: ScenarioTotals;
}): StatusCell[] {
  if (!hasScenarios) return [];
  return [
    {
      label: "Pass rate",
      value: `${Math.round((totals.passed / totals.total) * 100)}%`,
      tone: totals.failed > 0 ? "bad" : "good",
      link: slug ? `/${slug}/simulations` : undefined,
    },
    { label: "Passing", value: String(totals.passed), tone: "neutral" },
    {
      label: "Failing",
      value: String(totals.failed),
      tone: totals.failed > 0 ? "bad" : "good",
    },
    { label: "Scenario sets", value: String(setCount), tone: "vanity" },
  ];
}

function buildAnalyticsCells({
  cost,
  isDevelopment,
  p50Latency,
  previousCost,
  previousP50Latency,
  previousTokens,
  previousTraces,
  previousUsers,
  threads,
  tokens,
  traces,
  users,
}: {
  cost: number | undefined;
  isDevelopment: boolean;
  p50Latency: number | undefined;
  previousCost: number | undefined;
  previousP50Latency: number | undefined;
  previousTokens: number | undefined;
  previousTraces: number | undefined;
  previousUsers: number | undefined;
  threads: number | undefined;
  tokens: number | undefined;
  traces: number | undefined;
  users: number | undefined;
}): StatusCell[] {
  const cells: StatusCell[] = [];
  if (p50Latency !== undefined && p50Latency > 0) {
    const delta =
      percentDelta(p50Latency, previousP50Latency) ??
      developmentMockDelta("p50 latency", isDevelopment);
    cells.push({
      label: "p50 latency",
      value: formatMilliseconds(p50Latency),
      tone: "vanity",
      delta,
      deltaTone: costLikeTone(delta),
    });
  }
  if (cost !== undefined && cost > 0) {
    const delta =
      percentDelta(cost, previousCost) ?? developmentMockDelta("Cost / 24h", isDevelopment);
    cells.push({
      label: "Cost / 24h",
      value: formatMoney({ amount: cost, currency: "USD" }),
      tone: "vanity",
      delta,
      deltaTone: costLikeTone(delta),
    });
  }
  if (traces !== undefined && traces > 0) {
    cells.push({
      label: "Traces · threads",
      value: `${Math.round(traces)} · ${Math.round(threads ?? 0)}`,
      tone: "vanity",
      delta:
        percentDelta(traces, previousTraces) ??
        developmentMockDelta("Traces · threads", isDevelopment),
      deltaTone: "neutral",
    });
  }
  if (users !== undefined && users > 0) {
    cells.push({
      label: "Users",
      value: String(Math.round(users)),
      tone: "vanity",
      delta: percentDelta(users, previousUsers) ?? developmentMockDelta("Users", isDevelopment),
      deltaTone: "neutral",
    });
  }
  if (tokens !== undefined && tokens > 0) {
    cells.push({
      label: "Total tokens",
      value: new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(tokens),
      tone: "vanity",
      delta:
        percentDelta(tokens, previousTokens) ?? developmentMockDelta("Total tokens", isDevelopment),
      deltaTone: "neutral",
    });
  }
  return cells;
}

function buildSuggestions({
  cost,
  failedScenarios,
  hasScenarios,
  p50Latency,
  receiptCount,
}: {
  cost: number | undefined;
  failedScenarios: number;
  hasScenarios: boolean;
  p50Latency: number | undefined;
  receiptCount: number;
}): string[] {
  const suggestions: string[] = [];
  if (receiptCount > 0) suggestions.push("What changed in my errors?");
  if (p50Latency !== undefined && p50Latency > 0) {
    suggestions.push(`Why is p50 latency ${formatMilliseconds(p50Latency)}?`);
  }
  if (hasScenarios && failedScenarios > 0) {
    suggestions.push(`Why are ${failedScenarios} scenarios failing?`);
  }
  if (cost !== undefined && cost > 0) suggestions.push("Where is my cost going?");
  return suggestions.slice(0, 3);
}

function briefingAskHint(hasScenarios: boolean, hasTraces: boolean): string | undefined {
  if (hasScenarios) return '"what changed this week?"';
  if (hasTraces) return '"what changed in my errors?"';
  return undefined;
}

function briefingSince(hasScenarios: boolean, hasTraces: boolean): string {
  if (hasScenarios) return "since yesterday";
  if (hasTraces) return "last 30 days";
  return "last 24 hours";
}

function readAnalyticsMetrics({
  buckets,
  canViewCost,
  series,
}: {
  buckets: TimeseriesBucket[] | undefined;
  canViewCost: boolean;
  series: SeriesInputType[];
}) {
  const read = (metric: string, aggregation: string) =>
    readSummaryMetric({ buckets, series, metric, aggregation });

  return {
    traces: read("metadata.trace_id", "cardinality"),
    threads: read("metadata.thread_id", "cardinality"),
    users: read("metadata.user_id", "cardinality"),
    tokens: read("performance.total_tokens", "sum"),
    cost: canViewCost ? read("performance.total_cost", "sum") : undefined,
    p50Latency: read("performance.completion_time", "median"),
  };
}

function buildBriefingData({
  bars,
  cost,
  hasScenarios,
  hasTraces,
  headline,
  p50Latency,
  quiet,
  receipts,
  setCount,
  slug,
  totals,
}: {
  bars: ScenarioBar[];
  cost: number | undefined;
  hasScenarios: boolean;
  hasTraces: boolean;
  headline: string;
  p50Latency: number | undefined;
  quiet: boolean;
  receipts: NonNullable<BriefingData["receipts"]>;
  setCount: number;
  slug: string | undefined;
  totals: ScenarioTotals;
}): BriefingData {
  const setNoun = setCount === 1 ? "set" : "sets";
  return {
    since: briefingSince(hasScenarios, hasTraces),
    headline,
    quiet,
    receiptsLabel: receipts.length > 0 ? "Anomalies" : undefined,
    receipts: receipts.length > 0 ? receipts : undefined,
    pills: hasScenarios ? [{ label: `${setCount} scenario ${setNoun}` }] : undefined,
    scenariosLabel: hasScenarios ? "Recent scenario runs" : undefined,
    bars: bars.length > 0 ? bars : undefined,
    judge: hasScenarios
      ? {
          pass: totals.passed,
          regressions: totals.failed,
          note: `across ${setCount} ${setNoun}`,
        }
      : undefined,
    askHint: briefingAskHint(hasScenarios, hasTraces),
    suggestions: buildSuggestions({
      cost,
      failedScenarios: totals.failed,
      hasScenarios,
      p50Latency,
      receiptCount: receipts.length,
    }),
    sessionHref: hasScenarios && slug ? `/${slug}/simulations` : undefined,
  };
}

function resolveBriefingMock(
  mockKey: string | null,
): { kind: "live" } | { kind: "mock"; result: LangyBriefingResult } {
  if (!mockKey) return { kind: "live" };
  const mock = getBriefingMock(mockKey);
  if (!mock) return { kind: "live" };
  return {
    kind: "mock",
    result: {
      data: mock.data,
      statusCells: mock.statusCells,
      recentItems: [],
      isLoading: false,
      isAnalyticsLoading: false,
      isRefreshing: false,
    },
  };
}

function briefingLoadState({
  analytics,
  canViewAnalytics,
  canViewTraces,
  currentErrorShapes,
  errorAnalytics,
  previousErrorShapes,
  recent,
  summaries,
}: {
  analytics: { hasData: boolean; isFetching: boolean; isLoading: boolean };
  canViewAnalytics: boolean;
  canViewTraces: boolean;
  currentErrorShapes: { hasData: boolean; isFetching: boolean; isLoading: boolean };
  errorAnalytics: { hasData: boolean; isFetching: boolean; isLoading: boolean };
  previousErrorShapes: { hasData: boolean; isFetching: boolean; isLoading: boolean };
  recent: { isFetching: boolean };
  summaries: { hasData: boolean; isFetching: boolean; isLoading: boolean };
}) {
  const isLoading = summaries.isLoading && !summaries.hasData;
  const isAnalyticsLoading = canViewAnalytics && analytics.isLoading && !analytics.hasData;
  const isAttentionLoading =
    (canViewAnalytics && errorAnalytics.isLoading && !errorAnalytics.hasData) ||
    (canViewTraces &&
      ((currentErrorShapes.isLoading && !currentErrorShapes.hasData) ||
        (previousErrorShapes.isLoading && !previousErrorShapes.hasData)));
  const hasActiveFetch =
    summaries.isFetching ||
    recent.isFetching ||
    analytics.isFetching ||
    errorAnalytics.isFetching ||
    currentErrorShapes.isFetching ||
    previousErrorShapes.isFetching;

  return {
    isLoading,
    isAnalyticsLoading,
    isAttentionLoading,
    isRefreshing: !isLoading && !isAnalyticsLoading && !isAttentionLoading && hasActiveFetch,
  };
}

/**
 * Reads one series' value back out of a `getTimeseries` `currentPeriod`.
 * Returns `undefined` when the metric never appears, so a missing signal
 * omits the cell instead of showing a fabricated 0.
 */
export function readSummaryMetric({
  buckets,
  series,
  metric,
  aggregation,
}: {
  buckets: TimeseriesBucket[] | undefined;
  series: SeriesInputType[];
  metric: string;
  aggregation: string;
}): number | undefined {
  if (!buckets) return undefined;
  const index = series.findIndex((s) => s.metric === metric && s.aggregation === aggregation);
  if (index < 0) return undefined;
  const key = buildSeriesName(series[index]!, index);
  let sum = 0;
  let seen = false;
  for (const bucket of buckets) {
    const raw = bucket[key];
    if (typeof raw === "number") {
      sum += raw;
      seen = true;
    }
  }
  return seen ? sum : undefined;
}

/**
 * Read a grouped metric from the same `getTimeseries` response. Counts are
 * accumulated by group across buckets, so this also remains correct if the
 * briefing later moves away from the current single `full` bucket.
 */
export function readGroupedSummaryMetric({
  buckets,
  series,
  groupBy,
  metric,
  aggregation,
}: {
  buckets: TimeseriesBucket[] | undefined;
  series: SeriesInputType[];
  groupBy: string;
  metric: string;
  aggregation: string;
}): CountedSignal[] | undefined {
  if (!buckets) return undefined;
  const index = series.findIndex(
    (item) => item.metric === metric && item.aggregation === aggregation,
  );
  if (index < 0) return undefined;
  const seriesName = buildSeriesName(series[index]!, index);
  const counts = new Map<string, number>();
  let sawGroupedData = false;

  for (const bucket of buckets) {
    const grouped = bucket[groupBy];
    if (!grouped || typeof grouped !== "object") continue;
    sawGroupedData = true;
    for (const [value, metrics] of Object.entries(grouped)) {
      const count = metrics[seriesName];
      if (typeof count !== "number") continue;
      counts.set(value, (counts.get(value) ?? 0) + count);
    }
  }

  if (!sawGroupedData) return undefined;
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .toSorted((a, b) => b.count - a.count);
}

export function useLangyBriefing(): LangyBriefingResult {
  const host = useProjectHomeHost();
  const project = host.project();
  const hasPermission = (permission: string) => host.hasPermission(permission);
  const canViewCost = hasPermission("cost:view");
  const canViewAnalytics = hasPermission("analytics:view");
  const canViewTraces = hasPermission("traces:view");
  const { isDevelopment } = useUiDeployment();

  // Dev-only: the switcher at the top of the home can pin the briefing to a
  // mocked data state. While one is active the real queries stay disabled.
  const mockKey = useBriefingMock();
  const queriesEnabled = Boolean(project?.id) && !mockKey;

  const summaries = homeApi.scenarios.getExternalSetSummaries.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: queriesEnabled,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      // Keep the last roll-up on screen through a refetch so the card never
      // blanks and re-fills (see specs/home/langy-briefing.feature).
      placeholderData: keepPreviousData,
    },
  );

  const recent = homeApi.home.getRecentItems.useQuery(
    { projectId: project?.id ?? "", limit: 12 },
    {
      enabled: queriesEnabled,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      placeholderData: keepPreviousData,
    },
  );

  // Real analytics for the vanity strip. Memoised so the 30-day window (and
  // thus the query key) is stable for the lifetime of the mount — a fresh
  // `Date.now()` every render would spin the query forever.
  const analyticsWindow = useMemo(() => {
    const endDate = nowInstant().epochMilliseconds;
    return {
      startDate: endDate - 30 * 24 * 60 * 60 * 1000,
      endDate,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }, []);

  // Series order matters: each value lands in the `currentPeriod` bucket under
  // `{index}/{metric}/{aggregation}` (see `buildSeriesName`), so we read it
  // back out by the same index. Raw totals stay available for the quiet overview;
  // the inbox itself only consumes period-over-period p50 latency.
  const analyticsSeries = useMemo<SeriesInputType[]>(() => {
    const series: SeriesInputType[] = [
      { metric: "metadata.trace_id", aggregation: "cardinality" },
      { metric: "metadata.thread_id", aggregation: "cardinality" },
      { metric: "metadata.user_id", aggregation: "cardinality" },
      { metric: "performance.total_tokens", aggregation: "sum" },
    ];
    if (canViewCost) {
      series.push({ metric: "performance.total_cost", aggregation: "sum" });
    }
    series.push({
      metric: "performance.completion_time",
      aggregation: "median",
    });
    return series;
  }, [canViewCost]);

  const analytics = homeApi.analytics.getTimeseries.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: analyticsWindow.startDate,
      endDate: analyticsWindow.endDate,
      filters: {},
      timeZone: analyticsWindow.timeZone,
      timeScale: "full",
      series: analyticsSeries,
    },
    {
      // A dev mock must still win — don't fetch while one is pinned.
      enabled: queriesEnabled && canViewAnalytics,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      placeholderData: keepPreviousData,
    },
  );

  // Error-scoped trace names reveal a repeated cross-trace SIGNAL and carry
  // current + previous periods in one response. They never prove causality;
  // the copy below says that explicitly.
  const errorSeries = useMemo<SeriesInputType[]>(
    () => [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    [],
  );

  const errorAnalytics = homeApi.analytics.getTimeseries.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: analyticsWindow.startDate,
      endDate: analyticsWindow.endDate,
      filters: { "traces.error": ["true"] },
      timeZone: analyticsWindow.timeZone,
      timeScale: "full",
      series: errorSeries,
      groupBy: "traces.trace_name",
    },
    {
      enabled: queriesEnabled && canViewAnalytics,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      placeholderData: keepPreviousData,
    },
  );

  // Exact error-message facet counts provide the "shape" comparison. The API
  // is already time-windowed; errorMessage is non-empty only on errored traces,
  // so it needs no inferred filter or new backend endpoint.
  const currentErrorShapes = homeApi.traces.facetValues.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: analyticsWindow.startDate,
        to: analyticsWindow.endDate,
      },
      facetKey: "errorMessage",
      limit: 50,
      offset: 0,
    },
    {
      enabled: queriesEnabled && canViewTraces,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      placeholderData: keepPreviousData,
    },
  );

  const previousErrorShapes = homeApi.traces.facetValues.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: analyticsWindow.startDate - (analyticsWindow.endDate - analyticsWindow.startDate),
        to: analyticsWindow.startDate,
      },
      facetKey: "errorMessage",
      limit: 50,
      offset: 0,
    },
    {
      enabled: queriesEnabled && canViewTraces,
      staleTime: BRIEFING_STALE_MS,
      gcTime: BRIEFING_CACHE_MS,
      placeholderData: keepPreviousData,
    },
  );

  return useMemo<LangyBriefingResult>(() => {
    const mock = resolveBriefingMock(mockKey);
    if (mock.kind === "mock") return mock.result;

    const slug = project?.slug;
    const sets = summaries.data ?? [];
    const recentItems = recent.data ?? [];
    // Progressive load: the card appears as soon as the fast scenario roll-up
    // (Postgres) settles. The slower analytics roll-up and the recent-items
    // rail fill in their OWN sections as they arrive, rather than holding the
    // whole card behind the slowest query.
    const { isAnalyticsLoading, isAttentionLoading, isLoading, isRefreshing } = briefingLoadState({
      analytics: {
        hasData: Boolean(analytics.data),
        isFetching: analytics.isFetching,
        isLoading: analytics.isLoading,
      },
      canViewAnalytics,
      canViewTraces,
      currentErrorShapes: {
        hasData: Boolean(currentErrorShapes.data),
        isFetching: currentErrorShapes.isFetching,
        isLoading: currentErrorShapes.isLoading,
      },
      errorAnalytics: {
        hasData: Boolean(errorAnalytics.data),
        isFetching: errorAnalytics.isFetching,
        isLoading: errorAnalytics.isLoading,
      },
      previousErrorShapes: {
        hasData: Boolean(previousErrorShapes.data),
        isFetching: previousErrorShapes.isFetching,
        isLoading: previousErrorShapes.isLoading,
      },
      recent: { isFetching: recent.isFetching },
      summaries: {
        hasData: Boolean(summaries.data),
        isFetching: summaries.isFetching,
        isLoading: summaries.isLoading,
      },
    });

    const totals = sets.reduce(
      (acc, s) => ({
        passed: acc.passed + s.passedCount,
        failed: acc.failed + s.failedCount,
        total: acc.total + s.totalCount,
      }),
      { passed: 0, failed: 0, total: 0 },
    );

    const hasScenarios = totals.total > 0;
    const recentCount = recent.data?.length ?? 0;

    // Real analytics for the last 30 days, read straight out of the
    // `currentPeriod` bucket by series index (see `readSummaryMetric`). Read
    // BEFORE the headline: a project with traffic but no scenarios must get a
    // read about its ACTUAL volume, never a "quiet project" line.
    const { cost, p50Latency, threads, tokens, traces, users } = readAnalyticsMetrics({
      buckets: analytics.data?.currentPeriod,
      canViewCost,
      series: analyticsSeries,
    });
    const hasTraces = traces !== undefined && traces > 0;
    const {
      cost: previousCost,
      p50Latency: previousP50Latency,
      tokens: previousTokens,
      traces: previousTraces,
      users: previousUsers,
    } = readAnalyticsMetrics({
      buckets: analytics.data?.previousPeriod,
      canViewCost,
      series: analyticsSeries,
    });

    const sharedTraceNames = readGroupedSummaryMetric({
      buckets: errorAnalytics.data?.currentPeriod,
      series: errorSeries,
      groupBy: "traces.trace_name",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    });
    const errorTraces = sharedTraceNames?.reduce((total, signal) => total + signal.count, 0);

    const receipts = buildAttentionInbox({
      slug,
      currentErrorShapes: currentErrorShapes.data?.values,
      previousErrorShapes: previousErrorShapes.data?.values,
      previousErrorShapesComplete: previousErrorShapes.data
        ? previousErrorShapes.data.totalDistinct <= previousErrorShapes.data.values.length
        : undefined,
      sharedTraceNames,
      errorTraces,
      p50Latency,
      previousP50Latency,
    });

    const { headline, quiet } = buildHeadline({
      canViewAnalytics,
      canViewTraces,
      hasScenarios,
      hasTraces,
      isAnalyticsLoading,
      isAttentionLoading,
      recentCount,
      receiptCount: receipts.length,
      totals,
    });
    const bars = buildScenarioBars(sets);
    const scenarioCells = buildScenarioCells({
      hasScenarios,
      setCount: sets.length,
      slug,
      totals,
    });
    const analyticsCells = buildAnalyticsCells({
      cost,
      isDevelopment,
      p50Latency,
      previousCost,
      previousP50Latency,
      previousTokens,
      previousTraces,
      previousUsers,
      threads,
      tokens,
      traces,
      users,
    });

    const statusCells: StatusCell[] = [...scenarioCells, ...analyticsCells];

    const data = buildBriefingData({
      bars,
      cost,
      hasScenarios,
      hasTraces,
      headline,
      p50Latency,
      quiet,
      receipts,
      setCount: sets.length,
      slug,
      totals,
    });

    return {
      data,
      statusCells,
      recentItems,
      isLoading,
      isAnalyticsLoading,
      isRefreshing,
    };
  }, [
    mockKey,
    project?.slug,
    summaries.data,
    summaries.isLoading,
    summaries.isFetching,
    recent.data,
    recent.isFetching,
    analytics.data,
    analytics.isLoading,
    analytics.isFetching,
    errorAnalytics.data,
    errorAnalytics.isLoading,
    errorAnalytics.isFetching,
    currentErrorShapes.data,
    currentErrorShapes.isLoading,
    currentErrorShapes.isFetching,
    previousErrorShapes.data,
    previousErrorShapes.isLoading,
    previousErrorShapes.isFetching,
    errorSeries,
    analyticsSeries,
    canViewAnalytics,
    canViewCost,
    canViewTraces,
    isDevelopment,
  ]);
}
