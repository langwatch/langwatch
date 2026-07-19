import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { SeriesInputType } from "~/server/analytics/registry";
import type { TimeseriesBucket } from "~/server/analytics/types";
// The single canonical encoder for `getTimeseries` bucket keys (ADR-034
// app-layer module). Reused — not re-implemented — so this reader can never
// drift from how the app-layer writes the value. Pure helper; safe client-side.
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import type { RecentItem } from "~/server/home/types";
import { api } from "~/utils/api";
import { formatMilliseconds } from "~/utils/formatMilliseconds";
import { formatMoney } from "~/utils/formatMoney";
import {
  buildAttentionInbox,
  type AttentionInboxSignals,
  type CountedSignal,
} from "../attentionInbox";
import { getBriefingMock, useBriefingMock } from "../mocks/briefingMocks";
import type { BriefingData, ScenarioBar, StatusCell } from "../types";

/**
 * Derives Langy's home briefing from the project's REAL signals.
 *
 * The scenario suite roll-up (`scenarios.getExternalSetSummaries`) leads the
 * card — pass / fail / total per set, with the last-run time — which is enough
 * to say how many scenarios are passing and which sets need a look, and to
 * colour a status strip.
 *
 * A project without scenarios still has traces, so we ALSO read the real
 * analytics roll-up (`analytics.getTimeseries`, the same proven path
 * `TracesOverview` uses) for the vanity strip: p50 latency, cost, trace ·
 * thread counts over the last 30 days. Each cell is omitted when its metric is
 * missing rather than showing a fake 0 — honest degradation, so a live project
 * shows real numbers and a quiet one shows only what it actually has.
 *
 * The attention inbox compares current and prior error-message facets, looks
 * for a trace-name signal shared by multiple errors, and compares current and
 * prior p50 latency. One-off maxima and raw totals stay in the quiet overview;
 * they do not become insight cards. Every row links to the exact Trace Explorer
 * query behind it and can hand that same evidence to Langy.
 *
 * What we deliberately DON'T invent: a pass→fail "regression" diff (no endpoint
 * exists yet — we say "failing", the honest word for a current fail count), and
 * a Langy-drafted PR / "goal → PR" loop (no queryable artifact yet). Those
 * sections stay absent until there is data behind them, rather than shipping a
 * number that isn't real. See specs/home/langy-briefing.feature.
 */

const MAX_BARS = 4;
/** How long a briefing read stays fresh before a background (no-flicker) refetch. */
const BRIEFING_STALE_MS = 60_000;
/**
 * Near-realtime: the live signals repoll on this cadence while the page is
 * visible (react-query pauses interval refetches for hidden tabs by default).
 * `keepPreviousData` makes each landing seamless; the overview cells pulse
 * when a figure actually changed.
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

/** Backwards-compatible name for callers/tests of the briefing derivation. */
export const buildBriefingReceipts = buildAttentionInbox;
export type ReceiptSignals = AttentionInboxSignals;

/**
 * Reads one series' value back out of a `getTimeseries` `currentPeriod`. The
 * lookup key is derived from the app-layer's canonical `buildSeriesName`
 * encoder (`{index}/{metric}/{aggregation}`, `index` = the series' position in
 * the request) rather than re-spelled here, so it cannot drift from how the
 * value was written. Returns `undefined` when that metric never appears in any
 * bucket, so a missing signal degrades to an omitted cell rather than a
 * fabricated 0. With `timeScale: "full"` there is a single bucket, so the sum
 * is a passthrough of that one value.
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
  const index = series.findIndex(
    (s) => s.metric === metric && s.aggregation === aggregation,
  );
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
    .sort((a, b) => b.count - a.count);
}

export function useLangyBriefing(): LangyBriefingResult {
  const { project, hasPermission } = useOrganizationTeamProject();
  const canViewCost = hasPermission("cost:view");
  const canViewAnalytics = hasPermission("analytics:view");
  const canViewTraces = hasPermission("traces:view");

  // Dev-only: the switcher at the top of the home can pin the briefing to a
  // mocked data state. While one is active the real queries stay disabled.
  const mockKey = useBriefingMock();

  const summaries = api.scenarios.getExternalSetSummaries.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id && !mockKey,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      // Keep the last roll-up on screen through a refetch so the card never
      // blanks and re-fills (see specs/home/langy-briefing.feature).
      keepPreviousData: true,
    },
  );

  const recent = api.home.getRecentItems.useQuery(
    { projectId: project?.id ?? "", limit: 12 },
    {
      enabled: !!project?.id && !mockKey,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      keepPreviousData: true,
    },
  );

  // Real analytics for the vanity strip. Memoised so the 30-day window (and
  // thus the query key) is stable for the lifetime of the mount — a fresh
  // `Date.now()` every render would spin the query forever.
  const analyticsWindow = useMemo(() => {
    const endDate = Date.now();
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

  const analytics = api.analytics.getTimeseries.useQuery(
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
      enabled: !!project?.id && !mockKey && canViewAnalytics,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      keepPreviousData: true,
    },
  );

  // Error-scoped trace names reveal a repeated cross-trace SIGNAL and carry
  // current + previous periods in one response. They never prove causality;
  // the copy below says that explicitly.
  const errorSeries = useMemo<SeriesInputType[]>(
    () => [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    [],
  );

  const errorAnalytics = api.analytics.getTimeseries.useQuery(
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
      enabled: !!project?.id && !mockKey && canViewAnalytics,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      keepPreviousData: true,
    },
  );

  // Exact error-message facet counts provide the "shape" comparison. The API
  // is already time-windowed; errorMessage is non-empty only on errored traces,
  // so it needs no inferred filter or new backend endpoint.
  const currentErrorShapes = api.tracesV2.facetValues.useQuery(
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
      enabled: !!project?.id && !mockKey && canViewTraces,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      refetchInterval: BRIEFING_POLL_MS,
      keepPreviousData: true,
    },
  );

  const previousErrorShapes = api.tracesV2.facetValues.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from:
          analyticsWindow.startDate -
          (analyticsWindow.endDate - analyticsWindow.startDate),
        to: analyticsWindow.startDate,
      },
      facetKey: "errorMessage",
      limit: 50,
      offset: 0,
    },
    {
      enabled: !!project?.id && !mockKey && canViewTraces,
      staleTime: BRIEFING_STALE_MS,
      cacheTime: BRIEFING_CACHE_MS,
      keepPreviousData: true,
    },
  );

  return useMemo<LangyBriefingResult>(() => {
    if (mockKey) {
      const mock = getBriefingMock(mockKey);
      if (mock) {
        return {
          data: mock.data,
          statusCells: mock.statusCells,
          recentItems: [],
          isLoading: false,
          isAnalyticsLoading: false,
          isRefreshing: false,
        };
      }
    }

    const slug = project?.slug;
    const sets = summaries.data ?? [];
    const recentItems = recent.data ?? [];
    // Progressive load: the card appears as soon as the fast scenario roll-up
    // (Postgres) settles. The slower analytics roll-up (ClickHouse) and the
    // recent-items rail then fill in their OWN sections as they arrive, rather
    // than holding the whole card behind the slowest query. The heavy compute
    // stays on the backend (the aggregation is server-side and server-cached);
    // the client only reads the cached results and formats them.
    const isLoading = summaries.isLoading && !summaries.data;
    // Analytics is the slow read; its section (the overview + receipts) shows its
    // own inline loading until it lands, and the headline holds a neutral line so
    // it never flashes a false "quiet" before the real volume is known.
    const isAnalyticsLoading =
      canViewAnalytics && analytics.isLoading && !analytics.data;
    const isAttentionLoading =
      (canViewAnalytics && errorAnalytics.isLoading && !errorAnalytics.data) ||
      (canViewTraces &&
        ((currentErrorShapes.isLoading && !currentErrorShapes.data) ||
          (previousErrorShapes.isLoading && !previousErrorShapes.data)));
    // A background refetch while cached data is still on screen — the card stays
    // put and shows a subtle hint rather than a skeleton swap (Task: refetch
    // flicker). `keepPreviousData` keeps `isLoading` false through the refetch.
    const isRefreshing =
      !isLoading &&
      !isAnalyticsLoading &&
      !isAttentionLoading &&
      (summaries.isFetching ||
        recent.isFetching ||
        analytics.isFetching ||
        errorAnalytics.isFetching ||
        currentErrorShapes.isFetching ||
        previousErrorShapes.isFetching);

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
    const buckets = analytics.data?.currentPeriod;
    const readMetric = (metric: string, aggregation: string) =>
      readSummaryMetric({
        buckets,
        series: analyticsSeries,
        metric,
        aggregation,
      });

    const traces = readMetric("metadata.trace_id", "cardinality");
    const threads = readMetric("metadata.thread_id", "cardinality");
    const users = readMetric("metadata.user_id", "cardinality");
    const tokens = readMetric("performance.total_tokens", "sum");
    const cost = canViewCost
      ? readMetric("performance.total_cost", "sum")
      : undefined;
    const p50Latency = readMetric("performance.completion_time", "median");
    const hasTraces = traces !== undefined && traces > 0;

    const readPrevMetric = (metric: string, aggregation: string) =>
      readSummaryMetric({
        buckets: analytics.data?.previousPeriod,
        series: analyticsSeries,
        metric,
        aggregation,
      });
    const previousP50Latency = readPrevMetric(
      "performance.completion_time",
      "median",
    );
    const previousCost = canViewCost
      ? readPrevMetric("performance.total_cost", "sum")
      : undefined;
    const previousTraces = readPrevMetric("metadata.trace_id", "cardinality");
    const previousUsers = readPrevMetric("metadata.user_id", "cardinality");
    const previousTokens = readPrevMetric("performance.total_tokens", "sum");

    // Period-over-period % change, shown only when it's real: a previous
    // period that existed, and a shift big enough to mean something.
    const pctDelta = (
      current: number | undefined,
      previous: number | undefined,
    ): string | undefined => {
      if (current === undefined || previous === undefined || previous <= 0)
        return undefined;
      const pct = ((current - previous) / previous) * 100;
      if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return undefined;
      const magnitude =
        Math.abs(pct) >= 10
          ? Math.round(Math.abs(pct))
          : Math.round(Math.abs(pct) * 10) / 10;
      return `${pct > 0 ? "+" : "−"}${magnitude}%`;
    };
    /** For metrics where creeping UP is the problem (latency, cost). */
    const costLikeTone = (
      delta: string | undefined,
    ): "good" | "bad" | undefined =>
      delta === undefined ? undefined : delta.startsWith("+") ? "bad" : "good";
    /**
     * DEV-ONLY mock: a fresh project has no previous 30-day window, so real
     * deltas are honestly absent — which makes the treatment invisible while
     * designing. Development fills the gap with a deterministic figure
     * derived from the label (stable across renders); production NEVER mocks.
     */
    const devMockDelta = (label: string): string | undefined => {
      if (process.env.NODE_ENV !== "development") return undefined;
      let hash = 0;
      for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
      const pct = (hash % 37) - 18;
      if (pct === 0) return "+2%";
      return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
    };

    const sharedTraceNames = readGroupedSummaryMetric({
      buckets: errorAnalytics.data?.currentPeriod,
      series: errorSeries,
      groupBy: "traces.trace_name",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    });
    const errorTraces = sharedTraceNames?.reduce(
      (total, signal) => total + signal.count,
      0,
    );

    const receipts = buildBriefingReceipts({
      slug,
      currentErrorShapes: currentErrorShapes.data?.values,
      previousErrorShapes: previousErrorShapes.data?.values,
      previousErrorShapesComplete: previousErrorShapes.data
        ? previousErrorShapes.data.totalDistinct <=
          previousErrorShapes.data.values.length
        : undefined,
      sharedTraceNames,
      errorTraces,
      p50Latency,
      previousP50Latency,
    });

    // The headline leads with actionable change, not volume. "Supported signal"
    // is deliberate: an empty inbox means these inputs found nothing, not that
    // every possible failure mode has been disproven.
    let headline: string;
    let quiet = false;
    if (receipts.length > 0) {
      headline = `${receipts.length} ${receipts.length === 1 ? "signal needs" : "signals need"} attention. Changed errors and repeated evidence are prioritized first.`;
    } else if (isAttentionLoading || isAnalyticsLoading) {
      headline = "Comparing error shapes and latency with the prior 30 days…";
    } else if (hasScenarios && totals.failed > 0) {
      headline = `${totals.passed} of ${totals.total} scenarios passing. ${totals.failed} need a look.`;
    } else if (hasScenarios) {
      headline =
        "No supported error or latency change is asking for attention. Recent scenarios are passing.";
    } else if (hasTraces) {
      headline =
        canViewAnalytics || canViewTraces
          ? "No supported error or latency change is asking for attention right now."
          : "Trace activity is available, but this view cannot compare errors or latency with your current access.";
    } else if (recentCount > 0) {
      headline = "Here's where you left off, and what's moved since.";
    } else {
      // The sheet renders QuietHeadline for this state (typed invitation);
      // the string is the reduced fallback and what tests/mocks assert on.
      headline =
        "Your project is quiet. Send a trace and I'll start watching for what changes.";
      quiet = true;
    }

    // Scenario bars: one per set, most-recently-run first.
    const bars: ScenarioBar[] = [...sets]
      .sort((a, b) => (b.lastRunTimestamp ?? 0) - (a.lastRunTimestamp ?? 0))
      .slice(0, MAX_BARS)
      .map((s) => {
        const failing = s.failedCount > 0;
        return {
          id: s.scenarioSetId,
          label: s.scenarioSetId,
          // "fail", not "regression": we only know the CURRENT fail count, not
          // that it changed pass→fail (no diff endpoint exists yet).
          status: failing ? "fail" : "pass",
          fillPct: s.totalCount > 0 ? (s.passedCount / s.totalCount) * 100 : 0,
          statLabel: `${s.passedCount}/${s.totalCount} pass`,
        };
      });

    const scenarioCells: StatusCell[] = hasScenarios
      ? [
          {
            label: "Pass rate",
            value: `${Math.round((totals.passed / totals.total) * 100)}%`,
            tone: totals.failed > 0 ? "bad" : "good",
            link: slug ? `/${slug}/simulations` : undefined,
          },
          {
            label: "Passing",
            value: String(totals.passed),
            tone: "neutral",
          },
          {
            label: "Failing",
            value: String(totals.failed),
            tone: totals.failed > 0 ? "bad" : "good",
          },
          {
            label: "Scenario sets",
            value: String(sets.length),
            tone: "vanity",
          },
        ]
      : [];

    // Omit any cell whose metric is missing or zero rather than showing a fake
    // figure. Order mirrors the design target (p50 → cost → traces·threads).
    const analyticsCells: StatusCell[] = [];
    if (p50Latency !== undefined && p50Latency > 0) {
      const delta =
        pctDelta(p50Latency, previousP50Latency) ?? devMockDelta("p50 latency");
      analyticsCells.push({
        label: "p50 latency",
        value: formatMilliseconds(p50Latency),
        tone: "vanity",
        delta,
        deltaTone: costLikeTone(delta),
      });
    }
    if (cost !== undefined && cost > 0) {
      const delta = pctDelta(cost, previousCost) ?? devMockDelta("Cost / 24h");
      analyticsCells.push({
        label: "Cost / 24h",
        value: formatMoney({ amount: cost, currency: "USD" }),
        tone: "vanity",
        delta,
        deltaTone: costLikeTone(delta),
      });
    }
    if (traces !== undefined && traces > 0) {
      analyticsCells.push({
        label: "Traces · threads",
        value: `${Math.round(traces)} · ${Math.round(threads ?? 0)}`,
        tone: "vanity",
        delta:
          pctDelta(traces, previousTraces) ?? devMockDelta("Traces · threads"),
        deltaTone: "neutral",
      });
    }
    if (users !== undefined && users > 0) {
      analyticsCells.push({
        label: "Users",
        value: String(Math.round(users)),
        tone: "vanity",
        delta: pctDelta(users, previousUsers) ?? devMockDelta("Users"),
        deltaTone: "neutral",
      });
    }
    if (tokens !== undefined && tokens > 0) {
      analyticsCells.push({
        label: "Total tokens",
        value: new Intl.NumberFormat("en", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(tokens),
        tone: "vanity",
        delta:
          pctDelta(tokens, previousTokens) ?? devMockDelta("Total tokens"),
        deltaTone: "neutral",
      });
    }

    const statusCells: StatusCell[] = [...scenarioCells, ...analyticsCells];

    const data: BriefingData = {
      since: hasScenarios
        ? "since yesterday"
        : hasTraces
          ? "last 30 days"
          : "last 24 hours",
      headline,
      quiet,
      receiptsLabel: receipts.length > 0 ? "Anomalies" : undefined,
      receipts: receipts.length > 0 ? receipts : undefined,
      pills: hasScenarios
        ? [
            {
              label: `${sets.length} scenario ${sets.length === 1 ? "set" : "sets"}`,
            },
          ]
        : undefined,
      scenariosLabel: hasScenarios ? "Recent scenario runs" : undefined,
      bars: bars.length > 0 ? bars : undefined,
      judge: hasScenarios
        ? {
            pass: totals.passed,
            regressions: totals.failed,
            note: `across ${sets.length} ${sets.length === 1 ? "set" : "sets"}`,
          }
        : undefined,
      askHint: hasScenarios
        ? '"what changed this week?"'
        : hasTraces
          ? '"what changed in my errors?"'
          : undefined,
      // One-click asks, built from what the project actually shows right now.
      suggestions: [
        ...(receipts.length > 0 ? ["What changed in my errors?"] : []),
        ...(p50Latency !== undefined && p50Latency > 0
          ? [`Why is p50 latency ${formatMilliseconds(p50Latency)}?`]
          : []),
        ...(hasScenarios && totals.failed > 0
          ? [`Why are ${totals.failed} scenarios failing?`]
          : []),
        ...(cost !== undefined && cost > 0
          ? ["Where is my cost going?"]
          : []),
      ].slice(0, 3),
      sessionHref: hasScenarios && slug ? `/${slug}/simulations` : undefined,
    };

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
    recent.isLoading,
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
  ]);
}
