import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { metric } from "../aggregate";
import { createMetricDataPointStorageProjection } from "../projections/metricDataPointStorage";
import { buildMetricRollups } from "../rollup/buildRollups";
import type { CanonicalMetricDataPoint } from "../schema";
import { gaugeMetric, point, prepare, requestForMetric } from "./fixtures";

/**
 * The one behaviour this rewrite must never regress: an OTLP metric of value
 * `0` is a real observation, and a falsy check anywhere on its way from the
 * wire to a written row would silently discard it. Each scenario below
 * exercises a different stage of the pipeline the old code's incident
 * touched — canonicalisation, the map projection's write, and the rollup
 * recompute.
 */
describe("zero-value survival", () => {
  describe("when the project sends a gauge data point whose value is 0", () => {
    /** @scenario "A gauge reading of zero survives canonicalisation" */
    it("reports a double value of 0, not absent", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [{ timeUnixNano: "1700000000000000000", asDouble: 0 }],
          }),
        }),
      });

      expect(result.rejectedDataPoints).toBe(0);
      expect(result.accepted).toHaveLength(1);
      const canonical = result.accepted[0]!.dataPoint;
      expect(canonical.valueType).toBe("double");
      expect(canonical.valueDouble).toBe(0);
      expect(canonical.valueDouble).not.toBeNull();
    });

    /** @scenario "A gauge reading of zero survives canonicalisation" */
    it("also holds for the integer encoding of zero", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [{ timeUnixNano: "1700000000000000000", asInt: "0" }],
          }),
        }),
      });

      const canonical = result.accepted[0]!.dataPoint;
      expect(canonical.valueType).toBe("int");
      expect(canonical.valueInt).toBe("0");
    });
  });

  describe("when a data point whose value is 0 is received as an event", () => {
    /** @scenario "A zero value survives into the map projection's written row" */
    it("the metricDataPointStorage projection writes a row whose value is 0", async () => {
      const written: CanonicalMetricDataPoint[][] = [];
      const store: AppendStore<CanonicalMetricDataPoint> = {
        kind: "append",
        async writeBatch(
          records: readonly CanonicalMetricDataPoint[],
          _context: BatchContext,
        ) {
          written.push([...records]);
        },
      };
      const projection = createMetricDataPointStorageProjection({ store });

      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [{ timeUnixNano: "1700000000000000000", asDouble: 0 }],
          }),
        }),
      });
      const canonical = result.accepted[0]!.dataPoint;

      const outcome = await projection.apply({
        tenantId: canonical.tenantId,
        events: [metric.events.dataPointReceived(canonical)],
      });

      expect(outcome.written).toBe(1);
      expect(written).toHaveLength(1);
      expect(written[0]![0]!.valueDouble).toBe(0);
      expect(written[0]![0]!.valueType).toBe("double");
    });
  });

  describe("when a bucket of points includes one whose value is 0", () => {
    /** @scenario "A zero-valued point contributes to its rollup bucket" */
    it("the rollup bucket's count includes that point and its sum reflects the zero", () => {
      const rows = buildMetricRollups({
        points: [
          point({ timeUnixMs: 1_000, valueDouble: 5 }),
          point({ timeUnixMs: 2_000, valueDouble: 0 }),
          point({ timeUnixMs: 3_000, valueDouble: 3 }),
        ],
      });

      expect(rows).toHaveLength(1);
      // count is a decimal string over every source point, including the
      // zero-valued one — a naive `if (value)` skip would produce "2" here.
      expect(rows[0]!.count).toBe("3");
      expect(rows[0]!.sourcePointCount).toBe(3);
      expect(rows[0]!.sum).toBe(8);
      expect(rows[0]!.min).toBe(0);
    });

    /** @scenario "A zero-valued point contributes to its rollup bucket" */
    it("a lone zero-valued gauge sample is not treated as valueless", () => {
      const rows = buildMetricRollups({
        points: [point({ timeUnixMs: 1_000, valueDouble: 0 })],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.gaugeLast).toBe(0);
      expect(rows[0]!.count).toBe("1");
    });
  });
});
