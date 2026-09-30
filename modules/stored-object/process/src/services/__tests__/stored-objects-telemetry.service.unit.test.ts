/**
 * Verifies the stored_object_read_failures_total Prometheus counter is registered and
 * incremented by the legacy index's telemetry, surfaced at /metrics via prom-client.
 * @vitest-environment node
 */

import { register } from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";

import { StoredObjectsTelemetryService } from "../stored-objects-telemetry.service.ts";

describe("given the legacy index publishes its read failures", () => {
  const telemetry = StoredObjectsTelemetryService.create();

  beforeEach(() => {
    register.resetMetrics();
  });

  /** @scenario "Prometheus counts a storage read failure on the legacy index" */
  it("registers stored_object_read_failures_total counter", () => {
    const metric = register.getSingleMetric("stored_object_read_failures_total");
    expect(metric).toBeDefined();
  });

  describe("when a read failure is recorded", () => {
    it("stored_object_read_failures_total increments without label", async () => {
      telemetry.recordReadFailure();
      const lines = await register.getSingleMetricAsString("stored_object_read_failures_total");
      expect(lines).toContain("stored_object_read_failures_total 1");
    });
  });
});
