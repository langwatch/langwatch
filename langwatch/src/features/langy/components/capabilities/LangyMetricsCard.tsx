/**
 * Analytics capability card (`get_analytics`).
 *
 * Reuses the streaming slice's StreamingStatCard (rolling NumberTicker) so a
 * queried metric lands as a headline figure that springs up from zero, matching
 * the reference's metrics statcard. Reads only — the deep link opens Analytics.
 */
import { Text } from "@chakra-ui/react";
import type { LangyTurnMetric } from "../../hooks/useLangyTurnSignals";
import { StreamingStatCard } from "../StreamingStatCard";
import {
  extractToolText,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

function parseAnalytics(output: unknown): {
  metric: string | null;
  aggregation: string | null;
  latest: number | null;
  points: number;
  empty: boolean;
} {
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

export function LangyMetricsCard({
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const { metric, aggregation, latest, points, empty } = parseAnalytics(output);
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
      {empty || metrics.length === 0 ? (
        <Text textStyle="xs" color="fg.muted">
          No data for this period.
        </Text>
      ) : (
        <StreamingStatCard metrics={metrics} />
      )}
    </LangyCapabilityCard>
  );
}
