// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AnalyticsApi,
  type AnalyticsSeries,
  type AnalyticsTimeseriesBucket,
  buildSeriesName,
} from "@langwatch/analytics-contract";

import { countCapped, MAX_MODELS, weekStartOf } from "../rules/digest-week.rules.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a project's week is remembered, so each member's send of one organization reads once. */
const REMEMBER_MS = 10 * 60 * 1000;
const MAX_REMEMBERED = 5_000;

/** What analytics says a project's traces did in one week. */
export type TraceWeek = Readonly<{
  traces: number;
  errors: number;
  tokens: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
  /** Traces per model, the most used first. */
  models: Readonly<Record<string, number>>;
}>;

const NO_TRACES: TraceWeek = {
  traces: 0,
  errors: 0,
  tokens: 0,
  costUsd: 0,
  p50Ms: 0,
  p95Ms: 0,
  models: {},
};

const TOTALS: readonly AnalyticsSeries[] = [
  { metric: "metadata.trace_id", aggregation: "cardinality" },
  {
    metric: "metadata.trace_id",
    aggregation: "cardinality",
    filters: { "traces.error": ["true"] },
  },
  { metric: "performance.total_tokens", aggregation: "sum" },
  { metric: "performance.total_cost", aggregation: "sum" },
  { metric: "performance.completion_time", aggregation: "median" },
  { metric: "performance.completion_time", aggregation: "p95" },
];
const BY_MODEL: readonly AnalyticsSeries[] = [
  { metric: "metadata.trace_id", aggregation: "cardinality" },
];
const MODEL_GROUP = "metadata.model";

const numberAt = (
  bucket: AnalyticsTimeseriesBucket | undefined,
  series: AnalyticsSeries,
  index: number,
) => {
  const value = bucket?.[buildSeriesName(series, index)];
  return typeof value === "number" ? value : 0;
};

type Deps = Readonly<{
  analytics: Pick<AnalyticsApi, "getTimeseries">;
  now: () => number;
}>;

/**
 * A project's trace numbers for a week, read from analytics when an email needs them instead of
 * folded span by span: the platform's span traffic never writes a digest row. One call reads the
 * totals; a second, only for a project that had traces, reads its models.
 */
export class DigestTraceReadService {
  static create(deps: Deps): DigestTraceReadService {
    return new DigestTraceReadService(deps);
  }

  readonly #remembered = new Map<string, { at: number; week: Promise<TraceWeek> }>();

  private constructor(private readonly deps: Deps) {}

  projectWeek({ projectId, isoWeek }: { projectId: string; isoWeek: string }): Promise<TraceWeek> {
    const key = `${projectId}:${isoWeek}`;
    const now = this.deps.now();
    const known = this.#remembered.get(key);
    if (known && now - known.at < REMEMBER_MS) return known.week;
    if (this.#remembered.size >= MAX_REMEMBERED) this.#remembered.clear();
    const week = this.#read({ projectId, isoWeek });
    this.#remembered.set(key, { at: now, week });
    // A failed read is not remembered: the retry must ask again.
    week.catch(() => this.#remembered.delete(key));
    return week;
  }

  async #read({ projectId, isoWeek }: { projectId: string; isoWeek: string }): Promise<TraceWeek> {
    const window = {
      projectId,
      startDate: weekStartOf(isoWeek),
      endDate: weekStartOf(isoWeek) + WEEK_MS,
      timeZone: "UTC",
      timeScale: "full" as const,
      shouldSkipPreviousPeriod: true,
      filters: {},
    };
    const totals = (await this.deps.analytics.getTimeseries({ ...window, series: [...TOTALS] }))
      .currentPeriod[0];
    const [traces, errors, tokens, cost, median, p95] = TOTALS.map((series, index) =>
      numberAt(totals, series, index),
    );
    if (!traces) return NO_TRACES;
    const grouped = (
      await this.deps.analytics.getTimeseries({
        ...window,
        series: [...BY_MODEL],
        groupBy: MODEL_GROUP,
      })
    ).currentPeriod[0]?.[MODEL_GROUP];
    return {
      traces,
      errors: errors ?? 0,
      tokens: Math.round(tokens ?? 0),
      costUsd: cost ?? 0,
      p50Ms: median ?? 0,
      p95Ms: p95 ?? 0,
      models: modelsOf(grouped),
    };
  }
}

function modelsOf(grouped: unknown): Record<string, number> {
  if (grouped === null || typeof grouped !== "object") return {};
  const name = buildSeriesName(BY_MODEL[0]!, 0);
  let models: Record<string, number> = {};
  const entries = Object.entries(grouped as Record<string, Record<string, number>>)
    .map(([model, metrics]) => [model, metrics[name] ?? 0] as const)
    .filter(([model, count]) => model !== "" && count > 0)
    .toSorted(([, left], [, right]) => right - left);
  for (const [model, count] of entries) {
    models = countCapped({ counts: models, key: model, by: count, cap: MAX_MODELS });
  }
  return models;
}
