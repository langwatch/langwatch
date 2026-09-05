/**
 * Verifies that all five stored_object_* Prometheus metrics are registered with the correct names and label sets. These metrics are
 * emitted by StoredObjectsService through its telemetry port and surfaced at /metrics via prom-client's default registry.
 * @vitest-environment node
 */

import { register } from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";

import { PrometheusStoredObjectsTelemetryAdapter } from "../prometheus.stored-objects-telemetry.adapter";

describe("stored_object metrics are registered", () => {
  const telemetry = PrometheusStoredObjectsTelemetryAdapter.create();

  beforeEach(() => {
    register.resetMetrics();
  });

  /** @scenario "Prometheus metrics emit for ingest, dedup, write and read failures, and size distribution" */
  it("registers stored_object_extract_total counter", () => {
    const metric = register.getSingleMetric("stored_object_extract_total");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_extract_total");
  });

  it("registers stored_object_dedup_hit_total counter", () => {
    const metric = register.getSingleMetric("stored_object_dedup_hit_total");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_dedup_hit_total");
  });

  it("registers stored_object_write_failures_total counter", () => {
    const metric = register.getSingleMetric("stored_object_write_failures_total");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe(
      "stored_object_write_failures_total",
    );
  });

  it("registers stored_object_read_failures_total counter", () => {
    const metric = register.getSingleMetric("stored_object_read_failures_total");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe(
      "stored_object_read_failures_total",
    );
  });

  it("registers stored_object_size_bytes histogram", () => {
    const metric = register.getSingleMetric("stored_object_size_bytes");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_size_bytes");
  });

  describe("when purpose-labelled metrics are recorded", () => {
    it("stored_object_extract_total carries purpose label", async () => {
      telemetry.recordExtract("scenario_event");
      const lines = await register.getSingleMetricAsString("stored_object_extract_total");
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_dedup_hit_total carries purpose label", async () => {
      telemetry.recordDedupHit("scenario_event");
      const lines = await register.getSingleMetricAsString("stored_object_dedup_hit_total");
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_write_failures_total carries purpose label", async () => {
      telemetry.recordWriteFailure("scenario_event");
      const lines = await register.getSingleMetricAsString("stored_object_write_failures_total");
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_read_failures_total increments without label", async () => {
      telemetry.recordReadFailure();
      const lines = await register.getSingleMetricAsString("stored_object_read_failures_total");
      expect(lines).toContain("stored_object_read_failures_total");
    });

    it("stored_object_size_bytes carries purpose label", async () => {
      telemetry.observeSizeBytes("scenario_event", 1024);
      const lines = await register.getSingleMetricAsString("stored_object_size_bytes");
      expect(lines).toContain('purpose="scenario_event"');
    });
  });
});
