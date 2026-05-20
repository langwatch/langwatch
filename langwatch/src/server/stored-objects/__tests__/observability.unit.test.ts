/**
 * @vitest-environment node
 *
 * Verifies that all five stored_object_* Prometheus metrics are registered
 * with the correct names and label sets. These metrics are emitted by
 * StoredObjectsService and surfaced at /metrics via prom-client's default
 * registry.
 *
 * Tests import the metric accessor functions from metrics.ts and assert that
 * the underlying counters / histograms are registered in prom-client's global
 * register with the expected metric names and labelNames.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { register } from "prom-client";

import {
  getStoredObjectExtractCounter,
  getStoredObjectDedupHitCounter,
  getStoredObjectWriteFailureCounter,
  storedObjectReadFailureCounter,
  getStoredObjectSizeBytesHistogram,
} from "~/server/metrics";

describe("stored_object metrics are registered", () => {
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
    const metric = register.getSingleMetric(
      "stored_object_write_failures_total",
    );
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_write_failures_total");
  });

  it("registers stored_object_read_failures_total counter", () => {
    const metric = register.getSingleMetric(
      "stored_object_read_failures_total",
    );
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_read_failures_total");
  });

  it("registers stored_object_size_bytes histogram", () => {
    const metric = register.getSingleMetric("stored_object_size_bytes");
    expect(metric).toBeDefined();
    expect((metric as { name: string } | undefined)?.name).toBe("stored_object_size_bytes");
  });

  describe("when purpose-labelled metrics are recorded", () => {
    it("stored_object_extract_total carries purpose label", async () => {
      getStoredObjectExtractCounter("scenario_event").inc();
      const lines = await register.getSingleMetricAsString(
        "stored_object_extract_total",
      );
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_dedup_hit_total carries purpose label", async () => {
      getStoredObjectDedupHitCounter("scenario_event").inc();
      const lines = await register.getSingleMetricAsString(
        "stored_object_dedup_hit_total",
      );
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_write_failures_total carries purpose label", async () => {
      getStoredObjectWriteFailureCounter("scenario_event").inc();
      const lines = await register.getSingleMetricAsString(
        "stored_object_write_failures_total",
      );
      expect(lines).toContain('purpose="scenario_event"');
    });

    it("stored_object_read_failures_total increments without label", async () => {
      storedObjectReadFailureCounter.inc();
      const lines = await register.getSingleMetricAsString(
        "stored_object_read_failures_total",
      );
      expect(lines).toContain("stored_object_read_failures_total");
    });

    it("stored_object_size_bytes carries purpose label", async () => {
      getStoredObjectSizeBytesHistogram("scenario_event").observe(1024);
      const lines = await register.getSingleMetricAsString(
        "stored_object_size_bytes",
      );
      expect(lines).toContain('purpose="scenario_event"');
    });
  });
});
