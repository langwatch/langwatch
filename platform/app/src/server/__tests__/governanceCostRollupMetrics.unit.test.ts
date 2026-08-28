/**
 * @vitest-environment node
 *
 * The label set on the ADR-128 cost rollup lag gauge.
 *
 * Pinned rather than left to the call site because the comparator runs once
 * per tenant: a label set that omits the tenant does not merely lose detail,
 * it makes the series wrong, because every tenant's write lands on the series
 * the last one wrote and the highest lag in the fleet is invisible behind
 * whichever tenant happened to report last.
 *
 * Decision: ADR-128.
 */
import { type Gauge, register } from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";

import { setGovernanceCostRollupLagSeconds } from "../metrics";

const LAG_METRIC = "langwatch_governance_cost_rollup_lag_seconds";

function lagGauge(): Gauge<string> {
  return register.getSingleMetric(LAG_METRIC) as Gauge<string>;
}

async function lagSeries(): Promise<
  Array<{ labels: Record<string, string | number>; value: number }>
> {
  return (await lagGauge().get()).values;
}

describe("governance cost rollup lag gauge", () => {
  beforeEach(() => {
    lagGauge().reset();
  });

  describe("given two tenants report lag on the same lane", () => {
    it("keeps a separate series for each rather than overwriting", async () => {
      setGovernanceCostRollupLagSeconds({
        tenantId: "proj_one",
        costSource: "gateway",
        seconds: 30,
      });
      setGovernanceCostRollupLagSeconds({
        tenantId: "proj_two",
        costSource: "gateway",
        seconds: 900,
      });

      const series = await lagSeries();
      expect(series).toHaveLength(2);
      // The stalled tenant has to stay visible behind the healthy one.
      expect(series.find((s) => s.labels.tenant_id === "proj_one")?.value).toBe(
        30,
      );
      expect(series.find((s) => s.labels.tenant_id === "proj_two")?.value).toBe(
        900,
      );
    });
  });

  describe("given one tenant reports lag on both lanes", () => {
    it("labels every series with its tenant and its lane", async () => {
      setGovernanceCostRollupLagSeconds({
        tenantId: "proj_one",
        costSource: "gateway",
        seconds: 30,
      });
      setGovernanceCostRollupLagSeconds({
        tenantId: "proj_one",
        costSource: "pulled",
        seconds: 60,
      });

      const series = await lagSeries();
      expect(series).toHaveLength(2);
      expect(
        new Set(series.map((s) => Object.keys(s.labels).sort().join(","))),
      ).toEqual(new Set(["cost_source,tenant_id"]));
    });
  });
});
