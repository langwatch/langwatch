/**
 * Analytics capability card (`get_analytics`).
 *
 * Reuses the streaming slice's StreamingStatCard (rolling NumberTicker) so a
 * queried metric lands as a headline figure that springs up from zero, matching
 * the reference's metrics statcard. Reads only — the deep link opens Analytics.
 */
import { asJsonDocument } from "@langwatch/cli-cards";
import { Text } from "@chakra-ui/react";
import type { LangyTurnMetric } from "../../hooks/useLangyTurnSignals";
import { StreamingStatCard } from "../StreamingStatCard";
import {
  extractToolText,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

type ParsedAnalytics = {
  metric: string | null;
  aggregation: string | null;
  latest: number | null;
  points: number;
  empty: boolean;
};

/** Recognise the JSON returned by `langwatch analytics query --format json`. */
function parseAnalyticsJson(output: unknown): ParsedAnalytics | null {
  const document = asJsonDocument(output);
  if (!document || typeof document !== "object") return null;
  const period = (document as { currentPeriod?: unknown }).currentPeriod;
  if (!Array.isArray(period)) return null;
  const metadata = document as {
    metric?: unknown;
    aggregation?: unknown;
  };
  const values: number[] = [];
  for (const point of period) {
    if (!point || typeof point !== "object") continue;
    for (const [key, value] of Object.entries(point)) {
      if (key === "date" || typeof value !== "number") continue;
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return {
    metric: typeof metadata.metric === "string" ? metadata.metric : null,
    aggregation:
      typeof metadata.aggregation === "string" ? metadata.aggregation : null,
    // A time-series card's primary number is the requested period total, not
    // its final partial bucket (which would make “77 traces” look like “2”).
    latest: values.reduce((sum, value) => sum + value, 0),
    points: period.length,
    empty: period.length === 0,
  };
}

function parseAnalytics(output: unknown): ParsedAnalytics {
  const json = parseAnalyticsJson(output);
  if (json) return json;
  const text = extractToolText(output);
  const header = text.match(/#\s*Analytics:\s*([^\s(]+)\s*(?:\(([^)]+)\))?/i);
  const metric = header ? header[1]! : null;
  const aggregation = header && header[2] ? header[2]! : null;
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
  return { metric, aggregation, latest, points: values.length, empty };
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

/** Shared guard for capability rendering — help/error text is an activity receipt. */
export function hasRenderableAnalyticsResult(output: unknown): boolean {
  return !isUnreadable(parseAnalytics(output));
}

export function LangyMetricsCard({
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const parsed = parseAnalytics(output);
  const { metric, aggregation, latest, points, empty } = parsed;
  const metricFromInput =
    input && typeof input === "object"
      ? ((input as { metric?: unknown }).metric as string | undefined)
      : undefined;
  const label = metric ?? metricFromInput ?? "metric";

  const metrics: LangyTurnMetric[] = [];
  if (latest != null) {
    metrics.push({ value: latest, label: aggregation ?? label });
  }
  if (points > 0) {
    metrics.push({ value: points, label: points === 1 ? "point" : "points" });
  }

  return (
    <LangyCapabilityCard
      tone="read"
      surface="analytics"
      overline="Analytics"
      title={label}
      projectSlug={projectSlug}
    >
      {isUnreadable(parsed) ? (
        <Text textStyle="xs" color="fg.muted">
          Couldn&apos;t read this result. Open Analytics to see it.
        </Text>
      ) : empty || metrics.length === 0 ? (
        <Text textStyle="xs" color="fg.muted">
          No data for this period.
        </Text>
      ) : (
        <StreamingStatCard metrics={metrics} />
      )}
    </LangyCapabilityCard>
  );
}
