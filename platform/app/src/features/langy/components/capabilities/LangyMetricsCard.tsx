/**
 * Analytics capability card (`get_analytics`).
 *
 * Reuses the streaming slice's StreamingStatCard (rolling NumberTicker) so a
 * queried metric lands as a headline figure that springs up from zero, matching
 * the reference's metrics statcard. Reads only — the deep link opens Analytics.
 */

import { Text, VStack } from "@chakra-ui/react";
import { asJsonDocument } from "@langwatch/langy";
import type { LangyTurnMetric } from "../../hooks/useLangyTurnSignals";
import { formatMoneyShort } from "../Money";
import { StreamingStatCard } from "../StreamingStatCard";
import {
  type CapabilityCardInput,
  extractToolText,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";
import { describeFigure, humanMetric } from "./metricFigure";

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

/** Running totals over a period's buckets. */
class BucketTally {
  total: number | null = null;
  groupBy: string | null = null;
  readonly groupTotals = new Map<string, number>();

  add(value: number): void {
    this.total = (this.total ?? 0) + value;
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
      this.groupTotals.set(
        groupKey,
        (this.groupTotals.get(groupKey) ?? 0) + value,
      );
    }
  }

  groups(): AnalyticsGroup[] {
    return [...this.groupTotals.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Recognise the JSON returned by `langwatch analytics query --format json`.
 *
 * A bucket holds its measures in one of two shapes: flat
 * (`{ date, "0/metadata.trace_id/cardinality": 7 }`), or, when the query had a
 * `--group-by`, nested under the dimension
 * (`{ date, "metadata.model": { "gpt-5-mini": { "0/...": 7 } } }`). Both are
 * read, so a grouped count is the sum of its groups rather than zero.
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
  return {
    metric: stringOrNull(document.metric),
    aggregation: stringOrNull(document.aggregation),
    // A time-series card's primary number is the requested period total, not
    // its final partial bucket (which would make “77 traces” look like “2”).
    latest: tally.total,
    points: period.length,
    empty: period.length === 0 || tally.total == null,
    groupBy: tally.groupBy,
    groups: tally.groups(),
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
    if (!Number.isNaN(num) && /^-?[\d.,]+$/.test(last)) values.push(num);
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
 * Nothing recognisable at all: no analytics header, no data rows, and no
 * explicit "No data available" either. That is UNREADABLE output (e.g.
 * truncated upstream), and it must never render as the confident "No data for
 * this period" — a wrong definitive answer manufactured out of garbage.
 */
function isUnreadable(parsed: ParsedAnalytics): boolean {
  return !parsed.empty && parsed.metric == null && parsed.points === 0;
}

/** Most groups drawn as their own figure; the rest are in the total. */
const MAX_GROUPS_SHOWN = 3;

/**
 * Is this metric money? Read off the metric KEY the query names, not guessed
 * from the payload — `performance.total_cost` declares what it measures, and
 * rendering it as a bare `0.433` drops the one fact that makes the number
 * legible. (Sniffing which response field holds a cost would be the other
 * thing, and this is not that.)
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

/**
 * The figures the card draws. The headline is the period total. A grouped
 * query adds its largest groups beside it, each captioned by the group's own
 * name. The number of buckets the API answered with is not a figure anyone
 * asked for, so it is never drawn.
 */
function figuresOf(
  parsed: ParsedAnalytics,
  caption: string,
  money: boolean,
): LangyTurnMetric[] {
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

export function LangyMetricsCard({
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const parsed = parseAnalytics(output);
  const metricKey = parsed.metric ?? metricOfInput(input);
  const { title, caption } = describeFigure(metricKey, parsed.aggregation);
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
      {isUnreadable(parsed) ? (
        <Text textStyle="xs" color="fg.muted">
          Couldn&apos;t read this result. Open Analytics to see it.
        </Text>
      ) : parsed.empty || metrics.length === 0 ? (
        <Text textStyle="xs" color="fg.muted">
          No data for this period.
        </Text>
      ) : (
        <VStack align="stretch" gap={1.5}>
          <StreamingStatCard metrics={metrics} />
          {footnote ? (
            <Text textStyle="2xs" color="fg.subtle">
              {footnote}
            </Text>
          ) : null}
        </VStack>
      )}
    </LangyCapabilityCard>
  );
}
