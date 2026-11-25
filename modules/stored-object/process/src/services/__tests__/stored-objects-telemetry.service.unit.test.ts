/**
 * Verifies the legacy index's telemetry counts stored_object_read_failures_total
 * through the OTel metrics facade.
 * @vitest-environment node
 */

import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoredObjectsTelemetryService } from "../stored-objects-telemetry.service.ts";

describe("given the legacy index publishes its read failures", () => {
  const telemetry = StoredObjectsTelemetryService.create();
  const meter = createRecordingMeterProvider();

  beforeEach(() => meter.install());
  afterEach(() => meter.uninstall());

  describe("when a read failure is recorded", () => {
    /** @scenario "Prometheus counts a storage read failure on the legacy index" */
    it("stored_object_read_failures_total increments without label", () => {
      telemetry.recordReadFailure();
      expect(meter.valueOf("stored_object_read_failures_total")).toBe(1);
    });
  });
});
