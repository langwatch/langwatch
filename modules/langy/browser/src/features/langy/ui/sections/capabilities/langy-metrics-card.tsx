/**
 * Analytics capability card (`get_analytics`).
 */

import { Text, VStack } from "@langwatch/design-system/primitives";
import { type LangyTurnMetric } from "@langwatch/langy-browser-kit";
import { asJsonDocument } from "@langwatch/langy-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

import { formatMoneyShort } from "../../../../../ui/elements/langy-money.tsx";
import { StreamingStatCard } from "../../../../../ui/sections/streaming-stat-card.tsx";
import {
  type CapabilityCardInput,
  extractToolText,
} from "../../../model/capabilities/capability-registry.ts";
import { describeFigure, humanMetric } from "../../../model/logic/metric-figure.ts";
import { LangyCapabilityCard } from "./langy-capability-card.tsx";

type AnalyticsGroup = { key: string; value: number };

type ParsedAnalytics = {
  metric: string | null;
  aggregation: string | null;
  latest: number | null;
  points: number;
  empty: boolean;
  /** The dimension a grouped query split by, e.g. `metadata.model`. */
  groupBy: string | null;
  /** Per-group totals over the period, largest first. */
  groups: AnalyticsGroup[];
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Sum of the finite numbers directly inside one object, or null if none. */
function sumNumbers(record: Record<string, unknown>): number | null {
  const values = Object.values(record).filter(isFiniteNumber);
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null;
}

/** Whether values add up across time buckets, and across groups. */
type Additivity = { acrossTime: boolean; acrossGroups: boolean };

const SUMMABLE_AGGREGATIONS = new Set(["sum", "count"]);
const DISTINCT_AGGREGATIONS = new Set(["cardinality", "terms"]);

/**
 * When an aggregation's values add up. Sums and counts always do; a distinct
 * count does across time only for trace ids, and never across groups. Averages,
 * extremes, medians and percentiles never do.
 */
function additivityOf(aggregation: string | null, metric: string | null): Additivity {
  if (aggregation == null || SUMMABLE_AGGREGATIONS.has(aggregation)) {
    return { acrossTime: true, acrossGroups: true };
  }
  if (DISTINCT_AGGREGATIONS.has(aggregation)) {
    return { acrossTime: metric === "metadata.trace_id", acrossGroups: false };
  }
  return { acrossTime: false, acrossGroups: false };
}

/** Running totals over a period's buckets, and how many values each holds. */
class BucketTally {
  total: number | null = null;
  valueCount = 0;
  groupBy: string | null = null;
  readonly groupTotals = new Map<string, number>();
  readonly groupCounts = new Map<string, number>();

  add(value: number): void {
    this.total = (this.total ?? 0) + value;
    this.valueCount += 1;
  }

  addBucket(bucket: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(bucket)) {
      if (key === "date") continue;
      if (isFiniteNumber(value)) this.add(value);
      else if (isRecord(value)) this.addGroups(key, value);
    }
  }

  addGroups(dimension: string, groups: Record<string, unknown>): void {
    for (const [groupKey, measures] of Object.entries(groups)) {
      const value = isRecord(measures) ? sumNumbers(measures) : null;
      if (value == null) continue;
      this.groupBy = dimension;
      this.add(value);
      this.groupTotals.set(groupKey, (this.groupTotals.get(groupKey) ?? 0) + value);
      this.groupCounts.set(groupKey, (this.groupCounts.get(groupKey) ?? 0) + 1);
    }
  }

  /**
   * The period's figure: the sum of what was read, where those values add up.
   * Otherwise only a single value is a figure: summing two averages is not
   * their average.
   */
  headline({ acrossTime, acrossGroups }: Additivity): number | null {
    if (this.valueCount === 1) return this.total;
    const summable = this.groupBy ? acrossGroups && acrossTime : acrossTime;
    return summable ? this.total : null;
  }

  /**
   * Per-group figures. A group's values are its time buckets, so it keeps a
   * figure when those add up, or when it was read once.
   */
  groups({ acrossTime }: Additivity): AnalyticsGroup[] {
    return [...this.groupTotals.entries()]
      .filter(([key]) => acrossTime || this.groupCounts.get(key) === 1)
      .map(([key, value]) => ({ key, value }))
      .toSorted((a, b) => b.value - a.value);
  }
}

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Recognise the JSON of `langwatch analytics query --format json`. A bucket is
 * flat (`{ date, "0/metadata.trace_id/cardinality": 7 }`) or, with `--group-by`,
 * nested under the dimension; both are read.
 */
function parseAnalyticsJson(output: unknown): ParsedAnalytics | null {
  const document = asJsonDocument(output);
  if (!isRecord(document)) return null;
  const period = document.currentPeriod;
  if (!Array.isArray(period)) return null;
  const tally = new BucketTally();
  for (const bucket of period) {
    if (isRecord(bucket)) tally.addBucket(bucket);
  }
  const aggregation = stringOrNull(document.aggregation);
  const metric = stringOrNull(document.metric);
  const additive = additivityOf(aggregation, metric);
  return {
    metric,
    aggregation,
    // A time-series card's primary number is the requested period total, not
    // its final partial bucket (which would make “77 traces” look like “2”).
    latest: tally.headline(additive),
    points: period.length,
    empty: period.length === 0 || tally.total == null,
    groupBy: tally.groupBy,
    groups: tally.groups(additive),
  };
}

function parseAnalytics(output: unknown): ParsedAnalytics {
  const json = parseAnalyticsJson(output);
  if (json) return json;
  const text = extractToolText(output);
  const header = text.match(/#\s*Analytics:\s*([^\s(]+)\s*(?:\(([^)]+)\))?/i);
  const metric = header ? header[1]! : null;
  const aggregation = header?.[2] || null;
  const empty = /No data available/i.test(text);

  // Table rows look like `| 2026-07-10 | 94 |` — collect the trailing numeric
  // column so the last non-null value becomes the headline figure.
  const values: number[] = [];
  for (const line of text.split("\n")) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    const last = cells[cells.length - 1]!;
    const num = Number(last.replace(/,/g, ""));
    const isNumericCell = !Number.isNaN(num) && /^-?[\d.,]+$/.test(last);
    if (isNumericCell) values.push(num);
  }
  const latest = values.length > 0 ? values[values.length - 1]! : null;
  return {
    metric,
    aggregation,
    latest,
    points: values.length,
    empty,
    groupBy: null,
    groups: [],
  };
}

/**
 * Nothing recognisable at all: no analytics header, no data rows, and no explicit "No
 * data available" either.
 */
function isUnreadable(parsed: ParsedAnalytics): boolean {
  return !parsed.empty && parsed.metric == null && parsed.points === 0;
}

/** Most groups drawn as their own figure; the rest are in the total. */
const MAX_GROUPS_SHOWN = 3;

/**
 * Is this metric money? Read off the metric KEY the query names, not guessed from the
 * payload — `performance.total_cost` declares what it measures, and rendering it as a
 * bare `0.433` drops the one fact that makes the number legible.
 */
function isMoneyMetric(key: string | undefined): boolean {
  return !!key && /cost|spend|price/i.test(key);
}

/**
 * The window the figures cover, when the query named one. A total with no
 * period attached invites the reader to assume it is all-time.
 */
function periodCaption(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const { startDate, endDate } = input as {
    startDate?: unknown;
    endDate?: unknown;
  };
  const start = asDay(startDate);
  const end = asDay(endDate);
  if (!start || !end) return undefined;
  return start === end ? start : `${start} → ${end}`;
}

/** One ISO day from an epoch or a date string, or undefined if unreadable. */
function asDay(value: unknown): string | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const epochMs = toEpochMs(value);
  if (Number.isNaN(epochMs)) return undefined;
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString().slice(0, 10);
}

/**
 * The figures the card draws: the period total, plus a grouped query's largest
 * groups captioned by their own names. The bucket count is never drawn.
 */
function figuresOf(parsed: ParsedAnalytics, caption: string, money: boolean): LangyTurnMetric[] {
  const format = money ? { format: formatMoneyShort } : {};
  const metrics: LangyTurnMetric[] = [];
  if (parsed.latest != null) {
    metrics.push({ value: parsed.latest, label: caption, ...format });
  }
  for (const group of parsed.groups.slice(0, MAX_GROUPS_SHOWN)) {
    metrics.push({ value: group.value, label: group.key, ...format });
  }
  return metrics;
}

/** "By model · 2026-09-01 → 2026-09-30", from whichever parts are known. */
function footnoteOf(parsed: ParsedAnalytics, input: unknown): string {
  const groupCaption =
    parsed.groupBy && parsed.groups.length > 0
      ? `By ${humanMetric(parsed.groupBy).toLowerCase()}`
      : undefined;
  return [groupCaption, periodCaption(input)].filter(Boolean).join(" · ");
}

function metricOfInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const metric = (input as { metric?: unknown }).metric;
  return typeof metric === "string" ? metric : undefined;
}

/** A line of muted copy standing in for the figures. */
function MetricsNote({ children }: { children: string }) {
  return (
    <Text textStyle="xs" color="fg.muted">
      {children}
    </Text>
  );
}

/** The card's body: the figures, or the sentence that says why there are none. */
function MetricsBody({
  parsed,
  metrics,
  footnote,
}: {
  parsed: ParsedAnalytics;
  metrics: LangyTurnMetric[];
  footnote: string;
}) {
  if (isUnreadable(parsed)) {
    return <MetricsNote>Couldn't read this result. Open Analytics to see it.</MetricsNote>;
  }
  if (parsed.empty) return <MetricsNote>No data for this period.</MetricsNote>;
  if (metrics.length === 0) {
    return (
      <MetricsNote>
        This result spans several periods or groups, so it has no single figure. Open Analytics to
        see each one.
      </MetricsNote>
    );
  }
  return (
    <VStack align="stretch" gap={1.5}>
      <StreamingStatCard metrics={metrics} />
      {footnote ? (
        <Text textStyle="2xs" color="fg.subtle">
          {footnote}
        </Text>
      ) : null}
    </VStack>
  );
}

export function LangyMetricsCard({ input, output, projectSlug }: CapabilityCardInput) {
  const parsed = parseAnalytics(output);
  const metricKey = parsed.metric ?? metricOfInput(input);
  const { title, caption } = describeFigure({
    metricKey,
    aggregation: parsed.aggregation,
  });
  const metrics = figuresOf(parsed, caption, isMoneyMetric(metricKey));
  const footnote = footnoteOf(parsed, input);

  return (
    <LangyCapabilityCard
      tone="read"
      surface="analytics"
      overline="Analytics"
      title={title}
      projectSlug={projectSlug}
      // No chip. It linked to the Analytics INDEX, which is not the query that
      // was just run — the user lands on an unrelated default view and has to
      // rebuild the question by hand. A link that does not carry the query is
      // worse than no link, because it looks like it would.
      deepLink={false}
    >
      <MetricsBody parsed={parsed} metrics={metrics} footnote={footnote} />
    </LangyCapabilityCard>
  );
}
