import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION,
  EVALUATOR_LOOP_BLOCKED_METRIC_NAME,
  EVALUATOR_LOOP_BLOCKED_REASON_LABEL,
  OtelTraceEvaluationLoopMetricsAdapter,
} from "../otel.trace-evaluation-loop-metrics.adapter";

describe("OtelTraceEvaluationLoopMetricsAdapter", () => {
  let metrics: RecordingMeterProvider;

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    metrics.install();
  });

  afterEach(() => {
    metrics.uninstall();
  });

  describe("given the series two processes write", () => {
    /** @scenario "The loop-guard series keeps the name the application writes" */
    it("keeps the application's series name, help text and label", () => {
      expect(EVALUATOR_LOOP_BLOCKED_METRIC_NAME).toBe("langwatch_evaluator_loop_blocked_total");
      expect(EVALUATOR_LOOP_BLOCKED_METRIC_DESCRIPTION).toBe(
        "Number of online-evaluator dispatches blocked by the loop guards",
      );
      expect(EVALUATOR_LOOP_BLOCKED_REASON_LABEL).toBe("reason");
    });
  });

  describe("given a dispatch refused by a loop guard", () => {
    describe("when the refusal is recorded", () => {
      /** @scenario "A blocked evaluator dispatch is counted under its own reason" */
      it("counts it under the guard's own reason", () => {
        const adapter = OtelTraceEvaluationLoopMetricsAdapter.create();

        adapter.loopBlocked("depth_direct");
        adapter.loopBlocked("depth_direct");
        adapter.loopBlocked("parent_in_subtree");

        expect(
          metrics.valueOf("langwatch_evaluator_loop_blocked_total", { reason: "depth_direct" }),
        ).toBe(2);
        expect(
          metrics.valueOf("langwatch_evaluator_loop_blocked_total", {
            reason: "parent_in_subtree",
          }),
        ).toBe(1);
      });

      /** @scenario "The loop-guard series keeps the name the application writes" */
      it("declares the help text an operator reads on the panel", () => {
        OtelTraceEvaluationLoopMetricsAdapter.create().loopBlocked("depth_direct");

        expect(metrics.descriptionOf("langwatch_evaluator_loop_blocked_total")).toBe(
          "Number of online-evaluator dispatches blocked by the loop guards",
        );
      });
    });
  });
});
