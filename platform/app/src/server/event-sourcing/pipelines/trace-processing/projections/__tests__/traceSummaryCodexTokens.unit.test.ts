import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

// codex Path B emits ONE authoritative per-turn rollup span (session_task.turn,
// carrying the model) AND a lower-level response span (handle_responses) that
// reports the SAME native gen_ai.usage. The codex extractor flags the response
// span with langwatch.reserved.skip_token_accumulation so the fold counts the
// turn's tokens exactly once.
describe("applySpanToSummary codex redundant-usage handling", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    extractSpy.mockRestore();
  });

  describe("given a turn whose rollup and response spans report the same usage", () => {
    describe("when both spans are folded into the trace summary", () => {
      /** @scenario "Codex turn tokens are counted once when two spans report the same usage" */
      it("counts the usage once, not twice", () => {
        const turnSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
          },
        });
        const responseSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
            "langwatch.reserved.skip_token_accumulation": "true",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: turnSpan });
        state = applySpanToSummary({ state, span: responseSpan });

        expect(state.totalPromptTokenCount).toBe(13297);
        expect(state.totalCompletionTokenCount).toBe(23);
      });
    });

    describe("when the redundant copy is not flagged (control)", () => {
      it("double-counts the usage", () => {
        const turnSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
          },
        });
        const unflaggedDuplicate = createTestSpan({
          spanAttributes: {
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: turnSpan });
        state = applySpanToSummary({ state, span: unflaggedDuplicate });

        expect(state.totalPromptTokenCount).toBe(26594);
      });
    });
  });

  describe("given a model call span", () => {
    describe("when it carries a reasoning effort setting", () => {
      /** @scenario "Reasoning effort is lifted onto the trace summary" */
      it("lifts gen_ai.request.reasoning_effort onto the trace summary attributes", () => {
        const span = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 20,
            "gen_ai.request.reasoning_effort": "high",
          },
        });

        const result = applySpanToSummary({ state: createInitState(), span });

        expect(result.attributes["gen_ai.request.reasoning_effort"]).toBe("high");
      });
    });

    describe("when no span carries a reasoning effort setting", () => {
      it("leaves the reasoning effort attribute absent", () => {
        const span = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 20,
          },
        });

        const result = applySpanToSummary({ state: createInitState(), span });

        expect(
          result.attributes["gen_ai.request.reasoning_effort"],
        ).toBeUndefined();
      });
    });
  });

  describe("given a flagged redundant span also reporting cache tokens", () => {
    describe("when it is folded into the trace summary", () => {
      it("excludes its cache tokens from the trace reserved sums", () => {
        const turnSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
            "gen_ai.usage.cache_read.input_tokens": 4480,
          },
        });
        const responseSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.usage.input_tokens": 13297,
            "gen_ai.usage.output_tokens": 23,
            "gen_ai.usage.cache_read.input_tokens": 4480,
            "langwatch.reserved.skip_token_accumulation": "true",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: turnSpan });
        state = applySpanToSummary({ state, span: responseSpan });

        expect(state.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
          "4480",
        );
      });
    });
  });
});
