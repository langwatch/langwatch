import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LangyRestMetricsOtelService } from "../langy-rest-metrics-otel.service.ts";

let meter: RecordingMeterProvider;

beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});

afterEach(() => {
  meter.uninstall();
});

describe("LangyRestMetricsOtelService", () => {
  describe("when a turn result is ingested", () => {
    it("counts it by outcome", () => {
      const metrics = LangyRestMetricsOtelService.create();

      metrics.internal.turnResult("completed");
      metrics.internal.turnResult("completed");

      expect(meter.valueOf("langwatch_langy_turn_results_total", { outcome: "completed" })).toBe(2);
    });
  });

  describe("when a session key revoke is refused", () => {
    it("counts it under the revoke_refused op", () => {
      const metrics = LangyRestMetricsOtelService.create();

      metrics.internal.sessionKeyRevokeRefused();

      expect(meter.valueOf("langwatch_langy_session_keys_total", { op: "revoke_refused" })).toBe(1);
    });
  });

  describe("when a relay stream closes", () => {
    it("adds its frame count under the result", () => {
      const metrics = LangyRestMetricsOtelService.create();

      metrics.relayFrames.frames("applied", 7);

      expect(meter.valueOf("langwatch_langy_relay_frames_total", { result: "applied" })).toBe(7);
    });
  });
});
