/**
 * The fold over a span whose input the privacy rule dropped at the command. The worker's
 * content-drop test proves the recorded event carries no input; this, what the fold makes of it.
 * @see specs/data-privacy/content-drop.feature
 */
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./trace-summary-test.fixtures.ts";

const fold = TraceSummaryFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

const KEPT = { "langwatch.output": "the answer", "gen_ai.request.model": "gpt-5-mini" };

describe("given the trace summary folds a span", () => {
  describe("when the span's input was dropped before it was recorded", () => {
    /** @scenario The trace-level computed input is cleared when input is dropped */
    it("derives no computed input, keeping the computed output a captured span also gets", () => {
      const captured = fold.handleTraceSpanReceived(
        createSpanReceivedEvent({
          attributes: { ...KEPT, "langwatch.input": "the secret question" },
        }),
        fold.init(),
      );
      const dropped = fold.handleTraceSpanReceived(
        createSpanReceivedEvent({ attributes: KEPT }),
        fold.init(),
      );

      expect(captured.computedInput).toBeTruthy();
      expect(dropped.computedInput).toBeNull();
      expect(dropped.computedOutput).toBe(captured.computedOutput);
      expect(dropped.computedOutput).toBeTruthy();
    });
  });
});
