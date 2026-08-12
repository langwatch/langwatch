import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

// Codex exec changed from a response-only usage shape to a response plus turn
// rollup. The response is a conditional duplicate: it counts unless the same
// trace also carries an authoritative turn span.
describe("applySpanToSummary codex conditional redundant-usage handling", () => {
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

  const usage = {
    "gen_ai.request.model": "gpt-5-mini",
    "gen_ai.usage.input_tokens": 13297,
    "gen_ai.usage.output_tokens": 23,
    "gen_ai.usage.cache_read.input_tokens": 4480,
  };

  const turnSpan = () =>
    createTestSpan({
      name: "session_task.turn",
      spanId: "turn",
      spanAttributes: {
        ...usage,
        "langwatch.reserved.token_accumulation_authority": "true",
      },
    });

  const responseSpan = () =>
    createTestSpan({
      name: "handle_responses",
      spanId: "response",
      spanAttributes: {
        ...usage,
        "langwatch.reserved.token_accumulation_candidate": "true",
      },
    });

  describe("given candidate and authority spans report the same usage", () => {
    /** @scenario "Repeated token usage is counted once" */
    it.each([
      ["rollup then response", [turnSpan(), responseSpan()]],
      ["response then rollup", [responseSpan(), turnSpan()]],
    ])("counts the usage once for %s arrival", (_name, spans) => {
      const baseline = applySpanToSummary({
        state: createInitState(),
        span: turnSpan(),
      });
      let state = createInitState();
      for (const span of spans) state = applySpanToSummary({ state, span });

      expect(state.totalPromptTokenCount).toBe(13297);
      expect(state.totalCompletionTokenCount).toBe(23);
      expect(state.totalCost).toBe(baseline.totalCost);
      expect(state.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "4480",
      );
      for (const span of spans) {
        expect(span.spanAttributes["gen_ai.usage.input_tokens"]).toBe(13297);
        expect(span.spanAttributes["gen_ai.usage.output_tokens"]).toBe(23);
      }
    });
  });

  describe("given a response candidate without an authority", () => {
    /** @scenario "A single token usage report remains countable" */
    it("counts a candidate when no turn rollup exists", () => {
      const state = applySpanToSummary({
        state: createInitState(),
        span: responseSpan(),
      });

      expect(state.totalPromptTokenCount).toBe(13297);
      expect(state.totalCompletionTokenCount).toBe(23);
      expect(state.totalCost).not.toBeNull();
      expect(state.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "4480",
      );
      expect(state.attributes["langwatch.reserved.context_size_tokens"]).toBe(
        "4480",
      );
    });

    it("recovers from a malformed reserved running total", () => {
      const initial = createInitState();
      initial.attributes["langwatch.reserved.cache_read_tokens"] = "invalid";

      const state = applySpanToSummary({
        state: initial,
        span: responseSpan(),
      });

      expect(state.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "4480",
      );
    });
  });

  describe("given multiple candidates and one authority", () => {
    it("uses the authoritative rollup when multiple candidate spans are present", () => {
      const secondResponse = createTestSpan({
        name: "handle_responses",
        spanId: "response-2",
        spanAttributes: {
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 500,
          "gen_ai.usage.output_tokens": 5,
          "langwatch.reserved.token_accumulation_candidate": "true",
        },
      });
      let state = createInitState();
      for (const span of [responseSpan(), secondResponse, turnSpan()]) {
        state = applySpanToSummary({ state, span });
      }

      expect(state.totalPromptTokenCount).toBe(13297);
      expect(state.totalCompletionTokenCount).toBe(23);
    });
  });

  describe("given candidate and authority usage differs", () => {
    it.each([
      ["candidate then authority", false],
      ["authority then candidate", true],
    ])("does not synthesize token components for %s", (_name, reverse) => {
      const candidate = createTestSpan({
        name: "handle_responses",
        spanId: "unequal-response",
        spanAttributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 10,
          "langwatch.reserved.token_accumulation_candidate": "true",
        },
      });
      const authority = createTestSpan({
        name: "session_task.turn",
        spanId: "unequal-turn",
        spanAttributes: {
          "gen_ai.usage.input_tokens": 90,
          "gen_ai.usage.output_tokens": 20,
          "langwatch.reserved.token_accumulation_authority": "true",
        },
      });
      const spans = reverse
        ? [authority, candidate]
        : [candidate, authority];
      let state = createInitState();
      for (const span of spans) state = applySpanToSummary({ state, span });

      expect(state.totalPromptTokenCount).toBe(90);
      expect(state.totalCompletionTokenCount).toBe(20);
    });
  });

  describe("given a zero-token authority", () => {
    it("treats an observed zero-token authority as authoritative", () => {
      const candidate = createTestSpan({
        name: "handle_responses",
        spanId: "cache-candidate",
        spanAttributes: {
          "gen_ai.usage.input_tokens": 0,
          "gen_ai.usage.output_tokens": 0,
          "gen_ai.usage.cache_read.input_tokens": 500,
          "langwatch.reserved.token_accumulation_candidate": "true",
        },
      });
      const authority = createTestSpan({
        name: "session_task.turn",
        spanId: "zero-authority",
        spanAttributes: {
          "gen_ai.usage.input_tokens": 0,
          "gen_ai.usage.output_tokens": 0,
          "langwatch.reserved.token_accumulation_authority": "true",
        },
      });
      let state = createInitState();
      for (const span of [candidate, authority]) {
        state = applySpanToSummary({ state, span });
      }

      expect(state.totalPromptTokenCount).toBeNull();
      expect(state.totalCompletionTokenCount).toBeNull();
      expect(
        state.attributes["langwatch.reserved.cache_read_tokens"],
      ).toBeUndefined();
    });
  });

  describe("given an authority is already hard-skipped", () => {
    it("keeps the unskipped candidate usage", () => {
      const skippedAuthority = turnSpan();
      skippedAuthority.spanAttributes[
        "langwatch.reserved.skip_token_accumulation"
      ] = "true";
      let state = createInitState();
      for (const span of [responseSpan(), skippedAuthority]) {
        state = applySpanToSummary({ state, span });
      }

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

        expect(result.attributes["gen_ai.request.reasoning_effort"]).toBe(
          "high",
        );
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
