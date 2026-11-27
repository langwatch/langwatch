// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type AnalyticsApi,
  type AnalyticsSeries,
  type AnalyticsTimeseriesBucket,
  buildSeriesName,
} from "@langwatch/analytics-contract";

import {
  countCapped,
  MAX_MODELS,
  type TraceWeek,
  weekStartOf,
} from "../rules/digest-week.rules.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A finished week's numbers hardly move, so one organization's members share one read. */
export const REMEMBER_MS = 30 * 60 * 1000;
export const MAX_REMEMBERED = 5_000;
/** Reads in flight at once in this process, however many sends ask. */
const MAX_CONCURRENT_READS = 8;

const NO_TRACES: TraceWeek = {
  traces: 0,
  errors: 0,
  tokens: 0,
  costUsd: 0,
  p50Ms: 0,
  p95Ms: 0,
  models: {},
};

const TOTALS = {
  traces: { metric: "metadata.trace_id", aggregation: "cardinality" },
  errors: {
    metric: "metadata.trace_id",
    aggregation: "cardinality",
    filters: { "traces.error": ["true"] },
  },
  tokens: { metric: "performance.total_tokens", aggregation: "sum" },
  costUsd: { metric: "performance.total_cost", aggregation: "sum" },
  p50Ms: { metric: "performance.completion_time", aggregation: "median" },
  p95Ms: { metric: "performance.completion_time", aggregation: "p95" },
} as const satisfies Record<string, AnalyticsSeries>;
type TotalKey = keyof typeof TOTALS;
const TOTAL_KEYS = Object.keys(TOTALS) as TotalKey[];
const TOTAL_SERIES: AnalyticsSeries[] = TOTAL_KEYS.map((key) => TOTALS[key]);
/** The bucket key each total comes back under. */
const TOTAL_NAME = Object.fromEntries(
  TOTAL_KEYS.map((key, index) => [key, buildSeriesName(TOTALS[key], index)]),
) as Record<TotalKey, string>;

const TRACES_ONLY: AnalyticsSeries[] = [TOTALS.traces];
const TRACES_NAME = buildSeriesName(TOTALS.traces, 0);
const MODEL_GROUP = "metadata.model";

const numberAt = (bucket: AnalyticsTimeseriesBucket | undefined, name: string): number => {
  const value = bucket?.[name];
  return typeof value === "number" ? value : 0;
};

type Deps = Readonly<{
  analytics: Pick<AnalyticsApi, "getTimeseries">;
  now: () => number;
}>;

type Remembered<Value> = { at: number; settled: boolean; value: Promise<Value> };

/**
 * A project's trace numbers for a week, read from analytics when an email needs them instead of
 * folded span by span: the platform's span traffic never writes a digest row.
 *
 * A project's week is read at most once per process per half hour, whoever asks (single flight,
 * so the members of an organization sent at once share one read), and at most
 * {@link MAX_CONCURRENT_READS} reads run at a time. The week sent costs two reads (totals, and the
 * model breakdown for a project that had traces); the week before costs one, traces only.
 */
export class DigestTraceReadService {
  static create(deps: Deps): DigestTraceReadService {
    return new DigestTraceReadService(deps);
  }

  readonly #weeks = new Map<string, Remembered<TraceWeek>>();
  readonly #previous = new Map<string, Remembered<number>>();
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  private constructor(private readonly deps: Deps) {}

  /** The week's numbers; a failed read throws, and is not remembered, so the send retries. */
  getProjectWeek(input: {
    organizationId: string;
    projectId: string;
    isoWeek: string;
  }): Promise<TraceWeek> {
    return this.#remember(this.#weeks, input, () => this.#readWeek(input));
  }

  /** The week before's trace count alone; a failed read throws and is not remembered. */
  getPreviousTraces(input: {
    organizationId: string;
    projectId: string;
    isoWeek: string;
  }): Promise<number> {
    return this.#remember(this.#previous, input, () => this.#readTraces(input));
  }

  #remember<Value>(
    store: Map<string, Remembered<Value>>,
    {
      organizationId,
      projectId,
      isoWeek,
    }: { organizationId: string; projectId: string; isoWeek: string },
    read: () => Promise<Value>,
  ): Promise<Value> {
    const key = `${organizationId}:${projectId}:${isoWeek}`;
    const known = store.get(key);
    // A pending read is always shared; the TTL applies to settled results only.
    if (known && (!known.settled || this.deps.now() - known.at < REMEMBER_MS)) return known.value;
    store.delete(key);
    if (store.size >= MAX_REMEMBERED) this.#evictOldestSettled(store);
    const value = read();
    const entry: Remembered<Value> = { at: this.deps.now(), settled: false, value };
    store.set(key, entry);
    value
      .then(() => {
        entry.settled = true;
        entry.at = this.deps.now();
      })
      .catch(() => {
        if (store.get(key) === entry) store.delete(key);
      });
    return value;
  }

  /** The oldest settled entry goes (a Map iterates in insertion order); pending ones never do. */
  #evictOldestSettled<Value>(store: Map<string, Remembered<Value>>): void {
    for (const [key, entry] of store) {
      if (!entry.settled) continue;
      store.delete(key);
      return;
    }
  }

  async #limited<Value>(read: () => Promise<Value>): Promise<Value> {
    // A finishing read hands its slot straight to the next waiter, so the count never overshoots.
    if (this.#running < MAX_CONCURRENT_READS) this.#running += 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      return await read();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#running -= 1;
    }
  }

  /** `[start, end)` of the week: analytics' `endDate` is exclusive, so the next week starts where this ends. */
  #window({ projectId, isoWeek }: { projectId: string; isoWeek: string }) {
    const startDate = weekStartOf(isoWeek);
    return {
      projectId,
      startDate,
      endDate: startDate + WEEK_MS,
      timeZone: "UTC",
      timeScale: "full" as const,
      shouldSkipPreviousPeriod: true,
      filters: {},
    };
  }

  async #readTraces(input: { projectId: string; isoWeek: string }): Promise<number> {
    const result = await this.#limited(() =>
      this.deps.analytics.getTimeseries({ ...this.#window(input), series: TRACES_ONLY }),
    );
    return numberAt(result.currentPeriod[0], TRACES_NAME);
  }

  async #readWeek(input: { projectId: string; isoWeek: string }): Promise<TraceWeek> {
    const window = this.#window(input);
    const totals = (
      await this.#limited(() =>
        this.deps.analytics.getTimeseries({ ...window, series: TOTAL_SERIES }),
      )
    ).currentPeriod[0];
    const read = (key: TotalKey) => numberAt(totals, TOTAL_NAME[key]);
    if (!read("traces")) return NO_TRACES;
    const grouped = (
      await this.#limited(() =>
        this.deps.analytics.getTimeseries({
          ...window,
          series: TRACES_ONLY,
          groupBy: MODEL_GROUP,
        }),
      )
    ).currentPeriod[0]?.[MODEL_GROUP];
    return {
      traces: read("traces"),
      errors: read("errors"),
      tokens: Math.round(read("tokens")),
      costUsd: read("costUsd"),
      p50Ms: read("p50Ms"),
      p95Ms: read("p95Ms"),
      models: modelsOf(grouped),
    };
  }
}

function modelsOf(grouped: unknown): Record<string, number> {
  if (grouped === null || typeof grouped !== "object") return {};
  let models: Record<string, number> = {};
  const entries = Object.entries(grouped as Record<string, Record<string, number>>)
    .map(([model, metrics]) => [model, metrics[TRACES_NAME] ?? 0] as const)
    .filter(([model, count]) => model !== "" && count > 0)
    .toSorted(([, left], [, right]) => right - left);
  for (const [model, count] of entries) {
    models = countCapped({ counts: models, key: model, by: count, cap: MAX_MODELS });
  }
  return models;
}
