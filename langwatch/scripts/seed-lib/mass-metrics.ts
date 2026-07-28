/**
 * The mass seeder's metric story: months of OTLP metric series, built
 * deterministically (same now + months → same points) and shaped like a real
 * production workload — diurnal traffic, slow growth, error rate trending
 * down, latency trending down as quality trends up in the trace timeline.
 *
 * Pure — no I/O. The output is OTLP/JSON ExportMetricsServiceRequest batches
 * (one per day) for the REAL /api/otel/v1/metrics endpoint: metrics have no
 * ingest-age guard, so backdated series go through the production boundary
 * without any bypass.
 */
import { DAY_MS, mulberry32, utcDayStart } from "./seed-primitives";

/** Filter key for projection checks: every seeded point carries this scope. */
export const MASS_METRICS_SCOPE = "langwatch.seed.mass";

const HOUR_MS = 60 * 60_000;
const MODELS = ["gpt-5-mini", "gpt-4.1-mini"] as const;
const LATENCY_BOUNDS = [0.25, 0.5, 1, 2, 4, 8] as const;

interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

interface NumberDataPoint {
  attributes: OtlpAttribute[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  asInt?: string;
  asDouble?: number;
}

interface HistogramDataPoint {
  attributes: OtlpAttribute[];
  startTimeUnixNano: string;
  timeUnixNano: string;
  count: string;
  sum: number;
  bucketCounts: string[];
  explicitBounds: number[];
  min: number;
  max: number;
}

type OtlpMetric =
  | {
      name: string;
      description: string;
      unit: string;
      sum: {
        dataPoints: NumberDataPoint[];
        aggregationTemporality: 1;
        isMonotonic: boolean;
      };
    }
  | {
      name: string;
      description: string;
      unit: string;
      gauge: { dataPoints: NumberDataPoint[] };
    }
  | {
      name: string;
      description: string;
      unit: string;
      histogram: { dataPoints: HistogramDataPoint[]; aggregationTemporality: 1 };
    };

export interface MassMetricsBatch {
  dayStart: number;
  pointCount: number;
  /** An OTLP/JSON ExportMetricsServiceRequest for one day. */
  request: {
    resourceMetrics: Array<{
      resource: { attributes: OtlpAttribute[] };
      scopeMetrics: Array<{
        scope: { name: string; version: string };
        metrics: OtlpMetric[];
      }>;
    }>;
  };
}

export interface MassMetrics {
  days: number;
  firstDayStart: number;
  lastDayStart: number;
  totalPoints: number;
  batches: MassMetricsBatch[];
}

export interface MassMetricsOptions {
  months: number;
  now: number;
}

const DAYS_PER_MONTH = 30;

function attr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function nano(epochMs: number): string {
  return (BigInt(epochMs) * 1_000_000n).toString();
}

/** Traffic shape: quiet nights, a working-hours plateau, slow overall growth. */
function trafficLevel({
  hour,
  trend,
  random,
}: {
  hour: number;
  trend: number;
  random: () => number;
}): number {
  const daylight = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 15));
  const diurnal = 0.2 + 0.8 * daylight;
  const growth = 1 + trend * 1.2;
  return diurnal * growth * (0.85 + random() * 0.3);
}

function latencyHistogram({
  attributes,
  startMs,
  endMs,
  requests,
  meanSeconds,
}: {
  attributes: OtlpAttribute[];
  startMs: number;
  endMs: number;
  requests: number;
  meanSeconds: number;
}): HistogramDataPoint {
  const mids = LATENCY_BOUNDS.map((bound, index) =>
    index === 0 ? bound / 2 : (LATENCY_BOUNDS[index - 1]! + bound) / 2,
  ).concat(LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1]! * 1.5);
  const weights = mids.map((mid) =>
    Math.exp(-((Math.log(mid) - Math.log(meanSeconds)) ** 2) / 0.9),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const bucketCounts = weights.map((weight) =>
    Math.round((weight / totalWeight) * requests),
  );
  const count = bucketCounts.reduce((sum, value) => sum + value, 0);
  const sum = bucketCounts.reduce(
    (total, value, index) => total + value * mids[index]!,
    0,
  );
  return {
    attributes,
    startTimeUnixNano: nano(startMs),
    timeUnixNano: nano(endMs),
    count: String(count),
    sum: Number(sum.toFixed(3)),
    bucketCounts: bucketCounts.map(String),
    explicitBounds: [...LATENCY_BOUNDS],
    min: Number((meanSeconds * 0.18).toFixed(3)),
    max: Number((meanSeconds * 4.6).toFixed(3)),
  };
}

export function buildMassMetrics(options: MassMetricsOptions): MassMetrics {
  const months = Math.max(1, Math.floor(options.months));
  const days = months * DAYS_PER_MONTH;
  const lastDayStart = utcDayStart(options.now) - DAY_MS;
  const firstDayStart = lastDayStart - (days - 1) * DAY_MS;

  const batches: MassMetricsBatch[] = [];
  let totalPoints = 0;

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const dayStart = firstDayStart + dayIndex * DAY_MS;
    const trend = dayIndex / Math.max(1, days - 1);
    const random = mulberry32(0x51ed270b ^ (dayIndex * 6_007));

    const tokenPoints: NumberDataPoint[] = [];
    const costPoints: NumberDataPoint[] = [];
    const durationPoints: HistogramDataPoint[] = [];
    const requestPoints: NumberDataPoint[] = [];
    const userPoints: NumberDataPoint[] = [];

    for (let hour = 0; hour < 24; hour++) {
      const startMs = dayStart + hour * HOUR_MS;
      const endMs = startMs + HOUR_MS;
      const level = trafficLevel({ hour, trend, random });

      for (const model of MODELS) {
        // The workload migrates onto the newer model over the window.
        const modelShare =
          model === "gpt-5-mini" ? 0.35 + trend * 0.45 : 0.65 - trend * 0.45;
        const requests = Math.max(1, Math.round(140 * level * modelShare));
        const inputTokens = Math.round(requests * (150 + random() * 60));
        const outputTokens = Math.round(requests * (55 + random() * 45));
        const modelAttr = attr("gen_ai.request.model", model);

        tokenPoints.push(
          {
            attributes: [modelAttr, attr("gen_ai.token.type", "input")],
            startTimeUnixNano: nano(startMs),
            timeUnixNano: nano(endMs),
            asInt: String(inputTokens),
          },
          {
            attributes: [modelAttr, attr("gen_ai.token.type", "output")],
            startTimeUnixNano: nano(startMs),
            timeUnixNano: nano(endMs),
            asInt: String(outputTokens),
          },
        );

        const perTokenCost = model === "gpt-5-mini" ? 0.9e-6 : 1.7e-6;
        costPoints.push({
          attributes: [modelAttr],
          startTimeUnixNano: nano(startMs),
          timeUnixNano: nano(endMs),
          asDouble: Number(
            ((inputTokens + outputTokens * 3) * perTokenCost).toFixed(6),
          ),
        });

        // Latency improves over the window; the newer model is faster.
        const meanSeconds =
          (model === "gpt-5-mini" ? 1.6 : 2.4) - trend * 0.7 + random() * 0.2;
        durationPoints.push(
          latencyHistogram({
            attributes: [modelAttr],
            startMs,
            endMs,
            requests,
            meanSeconds: Math.max(0.35, meanSeconds),
          }),
        );
      }

      const routeRequests = Math.max(2, Math.round(220 * level));
      const errorShare = Math.max(0.004, 0.05 - trend * 0.038);
      const throttleShare = 0.012 + random() * 0.01;
      const errors = Math.round(routeRequests * errorShare);
      const throttles = Math.round(routeRequests * throttleShare);
      const route = attr("http.route", "/api/chat");
      requestPoints.push(
        {
          attributes: [route, attr("http.response.status_code", "200")],
          startTimeUnixNano: nano(startMs),
          timeUnixNano: nano(endMs),
          asInt: String(routeRequests - errors - throttles),
        },
        {
          attributes: [route, attr("http.response.status_code", "429")],
          startTimeUnixNano: nano(startMs),
          timeUnixNano: nano(endMs),
          asInt: String(throttles),
        },
        {
          attributes: [route, attr("http.response.status_code", "500")],
          startTimeUnixNano: nano(startMs),
          timeUnixNano: nano(endMs),
          asInt: String(errors),
        },
      );

      userPoints.push({
        attributes: [],
        startTimeUnixNano: nano(startMs),
        timeUnixNano: nano(endMs),
        asInt: String(Math.max(1, Math.round(46 * level))),
      });
    }

    const metrics: OtlpMetric[] = [
      {
        name: "gen_ai.client.token.usage",
        description: "Tokens consumed by LLM calls",
        unit: "{token}",
        sum: {
          dataPoints: tokenPoints,
          aggregationTemporality: 1,
          isMonotonic: true,
        },
      },
      {
        name: "gen_ai.client.cost",
        description: "Estimated LLM spend",
        unit: "USD",
        sum: {
          dataPoints: costPoints,
          aggregationTemporality: 1,
          isMonotonic: true,
        },
      },
      {
        name: "gen_ai.client.operation.duration",
        description: "LLM call duration",
        unit: "s",
        histogram: { dataPoints: durationPoints, aggregationTemporality: 1 },
      },
      {
        name: "app.requests",
        description: "Chat API requests by status",
        unit: "{request}",
        sum: {
          dataPoints: requestPoints,
          aggregationTemporality: 1,
          isMonotonic: true,
        },
      },
      {
        name: "app.active_users",
        description: "Users active in the hour",
        unit: "{user}",
        gauge: { dataPoints: userPoints },
      },
    ];

    const pointCount =
      tokenPoints.length +
      costPoints.length +
      durationPoints.length +
      requestPoints.length +
      userPoints.length;
    totalPoints += pointCount;

    batches.push({
      dayStart,
      pointCount,
      request: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                attr("service.name", "support-copilot"),
                attr("deployment.environment.name", "production"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: MASS_METRICS_SCOPE, version: "1" },
                metrics,
              },
            ],
          },
        ],
      },
    });
  }

  return { days, firstDayStart, lastDayStart, totalPoints, batches };
}
