/**
 * End-to-end session tracking over the REAL fold path (ADR-033 PR C): OTLP
 * spans go through `applySpanToSummary` (the same code ingestion runs), and the
 * resulting trace summaries feed `rollupSessions`. These are the spec-scenario
 * anchors — binding them here (rather than on pre-folded attribute fixtures)
 * means a regression anywhere in the fold's step extraction, harness stamping,
 * or thread-id accumulation fails the scenarios, not just the rollup unit
 * tests.
 */
import { describe, expect, it } from "vitest";
import { rollupSessions } from "~/server/app-layer/traces/session-rollup/sessionRollup.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

const CODEX_SCOPE = { name: "codex_cli_rs", version: null };

/** Fold a sequence of steps (startMs, inputTokens) into one trace summary. */
function foldSession({
  threadId,
  inputTokensBySteps,
  scope = CODEX_SCOPE,
}: {
  threadId: string;
  inputTokensBySteps: number[];
  scope?: { name: string; version: string | null };
}) {
  let state = createInitState();
  inputTokensBySteps.forEach((inputTokens, i) => {
    const span = createTestSpan({
      startTimeUnixMs: 1000 * (i + 1),
      instrumentationScope: scope,
      spanAttributes: {
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.conversation.id": threadId,
        "gen_ai.usage.input_tokens": inputTokens,
        "gen_ai.usage.output_tokens": 20,
      },
    });
    state = applySpanToSummary({ state, span });
  });
  return state;
}

describe("session rollup over the fold path", () => {
  describe("given multiple coding-agent spans of one session folded and rolled up", () => {
    describe("when the spans are processed through the fold", () => {
      /** @scenario "Steps of a session are accumulated into a session view" */
      it("counts every step and carries the session's category totals", () => {
        const summary = foldSession({
          threadId: "sess-e2e-1",
          inputTokensBySteps: [4000, 9000, 15_000],
        });

        const views = rollupSessions({
          traces: [{ attributes: summary.attributes }],
        });

        expect(views).toHaveLength(1);
        expect(views[0]!.stepCount).toBe(3);
        expect(views[0]!.threadId).toBe("sess-e2e-1");
        expect(views[0]!.harness).toBe("codex");
      });
    });
  });

  describe("given a session whose context grows, sharply drops, then regrows from the lower base", () => {
    describe("when the spans are processed through the fold", () => {
      /** @scenario "A compaction event is detected when the session context re-bases" */
      it("records exactly one compaction event", () => {
        const summary = foldSession({
          threadId: "sess-e2e-2",
          inputTokensBySteps: [
            10_000, 50_000, 100_000, 150_000, 180_000, 60_000, 65_000, 70_000,
          ],
        });

        const views = rollupSessions({
          traces: [{ attributes: summary.attributes }],
        });

        expect(views[0]!.compactionEvents).toBe(1);
      });
    });
  });

  describe("given large main-thread steps with one small interleaved subagent step", () => {
    describe("when the spans are processed through the fold", () => {
      /** @scenario "A small parallel step does not fire a compaction event" */
      it("records no compaction event", () => {
        const summary = foldSession({
          threadId: "sess-e2e-3",
          inputTokensBySteps: [150_000, 160_000, 8000, 185_000],
        });

        const views = rollupSessions({
          traces: [{ attributes: summary.attributes }],
        });

        expect(views[0]!.compactionEvents).toBe(0);
      });
    });
  });
});
