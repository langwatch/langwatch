import { describe, expect, it } from "vitest";
import { buildMassMetrics, type MassMetricsBatch } from "../mass-metrics";
import { DAY_MS } from "../seed-primitives";

const NOW = Date.UTC(2026, 6, 23, 12, 0, 0);

type MetricByName = Record<
  string,
  Extract<
    MassMetricsBatch["request"]["resourceMetrics"][0]["scopeMetrics"][0]["metrics"][number],
    object
  >
>;

function metricsByName(batch: MassMetricsBatch): MetricByName {
  const byName: MetricByName = {};
  for (const metric of batch.request.resourceMetrics[0]!.scopeMetrics[0]!
    .metrics) {
    byName[metric.name] = metric;
  }
  return byName;
}

function statusTotal(batch: MassMetricsBatch, status: string): number {
  const metric = metricsByName(batch)["app.requests"]!;
  if (!("sum" in metric)) throw new Error("app.requests must be a sum");
  return metric.sum.dataPoints
    .filter((point) =>
      point.attributes.some(
        (attr) =>
          attr.key === "http.response.status_code" &&
          attr.value.stringValue === status,
      ),
    )
    .reduce((total, point) => total + Number(point.asInt), 0);
}

describe("buildMassMetrics", () => {
  describe("given a three-month window", () => {
    const metrics = buildMassMetrics({ months: 3, now: NOW });

    // @scenario "Three months of metric series go through the real metrics endpoint"
    it("emits one OTLP batch per completed day with hourly points for every series", () => {
      expect(metrics.days).toBe(90);
      expect(metrics.batches).toHaveLength(90);
      expect(metrics.lastDayStart).toBeLessThan(NOW);
      expect(metrics.firstDayStart).toBe(metrics.lastDayStart - 89 * DAY_MS);

      const first = metricsByName(metrics.batches[0]!);
      const gauge = first["app.active_users"]!;
      if (!("gauge" in gauge)) throw new Error("active_users must be a gauge");
      expect(gauge.gauge.dataPoints).toHaveLength(24);

      const tokens = first["gen_ai.client.token.usage"]!;
      if (!("sum" in tokens)) throw new Error("token.usage must be a sum");
      // 24 hours x 2 models x input/output.
      expect(tokens.sum.dataPoints).toHaveLength(24 * 4);
      for (const point of tokens.sum.dataPoints) {
        expect(point.asInt).toMatch(/^\d+$/);
        expect(point.startTimeUnixNano).toMatch(/^\d+$/);
        expect(Number(BigInt(point.timeUnixNano) / 1_000_000n)).toBeLessThanOrEqual(
          metrics.batches[0]!.dayStart + DAY_MS,
        );
      }

      const requests = first["app.requests"]!;
      if (!("sum" in requests)) throw new Error("app.requests must be a sum");
      // 24 hours x 3 status codes.
      expect(requests.sum.dataPoints).toHaveLength(24 * 3);
    });

    it("keeps histogram points internally consistent", () => {
      const duration = metricsByName(metrics.batches[10]!)[
        "gen_ai.client.operation.duration"
      ]!;
      if (!("histogram" in duration)) {
        throw new Error("operation.duration must be a histogram");
      }
      for (const point of duration.histogram.dataPoints) {
        expect(point.bucketCounts).toHaveLength(
          point.explicitBounds.length + 1,
        );
        const total = point.bucketCounts.reduce(
          (sum, count) => sum + Number(count),
          0,
        );
        expect(total).toBe(Number(point.count));
        expect(point.sum).toBeGreaterThan(0);
      }
    });

    it("tells an improving story: traffic grows while the error share falls", () => {
      const firstDay = metrics.batches[0]!;
      const lastDay = metrics.batches[89]!;
      const share = (batch: MassMetricsBatch) =>
        statusTotal(batch, "500") /
        (statusTotal(batch, "200") +
          statusTotal(batch, "429") +
          statusTotal(batch, "500"));
      expect(share(lastDay)).toBeLessThan(share(firstDay));
      expect(statusTotal(lastDay, "200")).toBeGreaterThan(
        statusTotal(firstDay, "200"),
      );
    });

    it("is deterministic and counts its own points honestly", () => {
      expect(buildMassMetrics({ months: 3, now: NOW })).toEqual(metrics);
      const counted = metrics.batches.reduce(
        (sum, batch) => sum + batch.pointCount,
        0,
      );
      expect(counted).toBe(metrics.totalPoints);
      const actual = metrics.batches.reduce((sum, batch) => {
        for (const metric of batch.request.resourceMetrics[0]!.scopeMetrics[0]!
          .metrics) {
          if ("sum" in metric) sum += metric.sum.dataPoints.length;
          else if ("gauge" in metric) sum += metric.gauge.dataPoints.length;
          else sum += metric.histogram.dataPoints.length;
        }
        return sum;
      }, 0);
      expect(actual).toBe(metrics.totalPoints);
    });
  });

  describe("given a single month", () => {
    it("clamps to at least one month", () => {
      expect(buildMassMetrics({ months: 0, now: NOW }).days).toBe(30);
    });
  });
});
