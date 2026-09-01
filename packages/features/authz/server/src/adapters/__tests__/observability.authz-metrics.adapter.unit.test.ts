/**
 * Spec: packages/features/authz/specs/grants-command-dispatch.feature
 */
import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { ObservabilityAuthzMetricsAdapter } from "../observability.authz-metrics.adapter";
import { ObservabilityAuthzRevocationAdapter } from "../observability.authz-revocation.adapter";

describe("ObservabilityAuthzMetricsAdapter", () => {
  describe("given a process registry", () => {
    /** @scenario "The two AuthZ series are described once for every process" */
    it("renders both series into the registry it was given, and no other", async () => {
      const registry = new Registry();
      const metrics = ObservabilityAuthzMetricsAdapter.create({ registry });

      metrics.revocationCounter("revocation").inc();
      metrics.engineGateReadFailureCounter().inc();

      const scrape = await registry.metrics();
      expect(scrape).toContain(
        'langwatch_authz_direct_projection_write_total{reason="revocation"} 1',
      );
      expect(scrape).toContain("authz_engine_gate_read_failures_total 1");
    });

    /** @scenario "The two AuthZ series are described once for every process" */
    it("keeps one cause per label rather than one series per cause", async () => {
      const registry = new Registry();
      const metrics = ObservabilityAuthzMetricsAdapter.create({ registry });

      metrics.revocationCounter("revocation").inc();
      metrics.revocationCounter("offboard").inc();
      metrics.revocationCounter("offboard").inc();

      const scrape = await registry.metrics();
      expect(scrape).toContain(
        'langwatch_authz_direct_projection_write_total{reason="offboard"} 2',
      );
      expect(scrape).toContain(
        'langwatch_authz_direct_projection_write_total{reason="revocation"} 1',
      );
    });
  });

  describe("when a process composes AuthZ twice over one registry", () => {
    /** @scenario "A second composition shares the series rather than refusing" */
    it("resolves the counters it already holds instead of refusing the second composition", async () => {
      const registry = new Registry();
      ObservabilityAuthzMetricsAdapter.create({ registry }).revocationCounter("revocation").inc();

      const second = ObservabilityAuthzMetricsAdapter.create({ registry });
      second.revocationCounter("revocation").inc();

      expect(await registry.metrics()).toContain(
        'langwatch_authz_direct_projection_write_total{reason="revocation"} 2',
      );
    });
  });
});

describe("ObservabilityAuthzRevocationAdapter", () => {
  describe("when a direct projection write happens", () => {
    /** @scenario "A queue-bypassing write is counted under its own cause" */
    it("counts it under the cause that made it, not under one series for both", async () => {
      const registry = new Registry();
      const metrics = ObservabilityAuthzMetricsAdapter.create({ registry });
      const telemetry = ObservabilityAuthzRevocationAdapter.create({
        counter: (reason) => metrics.revocationCounter(reason),
      });

      telemetry.record({ organizationId: "organization-1", reason: "offboard", grantCount: 3 });

      const scrape = await registry.metrics();
      expect(scrape).toContain(
        'langwatch_authz_direct_projection_write_total{reason="offboard"} 1',
      );
      expect(scrape).not.toContain(
        'langwatch_authz_direct_projection_write_total{reason="revocation"}',
      );
    });
  });
});
