/**
 * The pull side of metrics: a reader the scrape door collects through, and the
 * text exposition it answers with. Cumulative temporality throughout, which is
 * the only thing a Prometheus scrape can read.
 */
import type { Attributes } from "@opentelemetry/api";
import {
  DataPointType,
  MetricReader,
  type MetricData,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";

import { PROMETHEUS_CONTENT_TYPE, type PrometheusExposition } from "./prometheus-metrics-door.ts";

/** Collects on demand rather than on a timer — the scrape decides when. */
export class PrometheusPullReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  async read(): Promise<PrometheusExposition> {
    const { resourceMetrics } = await this.collect();
    return { body: renderExposition(resourceMetrics), contentType: PROMETHEUS_CONTENT_TYPE };
  }
}

export function renderExposition(metrics: ResourceMetrics): string {
  const lines = metrics.scopeMetrics.flatMap((scope) => scope.metrics.flatMap(renderMetric));
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function renderMetric(metric: MetricData): string[] {
  const name = metricName(metric);
  const header = [
    `# HELP ${name} ${escapeHelp(metric.descriptor.description)}`,
    `# TYPE ${name} ${prometheusType(metric)}`,
  ];

  if (metric.dataPointType === DataPointType.HISTOGRAM) {
    return [...header, ...metric.dataPoints.flatMap((point) => histogramLines(name, point))];
  }

  if (metric.dataPointType === DataPointType.EXPONENTIAL_HISTOGRAM) {
    // No explicit boundaries to name buckets by, so only the summary is honest.
    return [
      ...header,
      ...metric.dataPoints.flatMap((point) => [
        `${name}_sum${labels(point.attributes)} ${point.value.sum ?? 0}`,
        `${name}_count${labels(point.attributes)} ${point.value.count}`,
      ]),
    ];
  }

  return [
    ...header,
    ...metric.dataPoints.map((point) => `${name}${labels(point.attributes)} ${point.value}`),
  ];
}

function histogramLines(
  name: string,
  point: { attributes: Attributes; value: Histogram },
): string[] {
  const { boundaries, counts } = point.value.buckets;
  let cumulative = 0;
  const buckets = counts.map((count, index) => {
    cumulative += count;
    const bound = index < boundaries.length ? String(boundaries[index]) : "+Inf";
    return `${name}_bucket${labels(point.attributes, { le: bound })} ${cumulative}`;
  });

  return [
    ...buckets,
    `${name}_sum${labels(point.attributes)} ${point.value.sum ?? 0}`,
    `${name}_count${labels(point.attributes)} ${point.value.count}`,
  ];
}

/** The shape `@opentelemetry/sdk-metrics` aggregates an explicit-bucket histogram into. */
type Histogram = Readonly<{
  buckets: Readonly<{ boundaries: number[]; counts: number[] }>;
  sum?: number;
  count: number;
}>;

/** `_total` on a monotonic sum is what makes `rate()` read it as a counter. */
function metricName(metric: MetricData): string {
  const base = sanitise(metric.descriptor.name);
  const monotonic = metric.dataPointType === DataPointType.SUM && metric.isMonotonic;
  return monotonic && !base.endsWith("_total") ? `${base}_total` : base;
}

function prometheusType(metric: MetricData): string {
  if (metric.dataPointType === DataPointType.HISTOGRAM) return "histogram";
  if (metric.dataPointType === DataPointType.EXPONENTIAL_HISTOGRAM) return "histogram";
  if (metric.dataPointType === DataPointType.SUM && metric.isMonotonic) return "counter";
  return "gauge";
}

function labels(attributes: Attributes, extra: Record<string, string> = {}): string {
  const pairs = [
    ...Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${sanitise(key)}="${escapeLabel(String(value))}"`),
    ...Object.entries(extra).map(([key, value]) => `${key}="${escapeLabel(value)}"`),
  ];

  return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
}

const sanitise = (name: string): string => name.replace(/[^a-zA-Z0-9_:]/g, "_");

const escapeLabel = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const escapeHelp = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
