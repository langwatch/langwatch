import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

describe("applySpanToSummary attribute forwarding", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when span has gen_ai.agent.name", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.name": "weather-agent",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.agent.name"]).toBe("weather-agent");
    });
  });

  describe("when span has gen_ai.agent.id", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.id": "agent-123",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.agent.id"]).toBe("agent-123");
    });
  });

  describe("when span has gen_ai.provider.name", () => {
    it("forwards to trace summary attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.provider.name": "openai",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["gen_ai.provider.name"]).toBe("openai");
    });
  });

  describe("when multiple spans provide agent info", () => {
    it("keeps first-wins semantics", () => {
      const span1 = createTestSpan({
        spanAttributes: {
          "gen_ai.agent.name": "first-agent",
        },
      });

      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "gen_ai.agent.name": "second-agent",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      expect(state.attributes["gen_ai.agent.name"]).toBe("first-agent");
    });
  });

  describe("when span has langwatch.prompt.id", () => {
    it("hoists to langwatch.prompt_ids as JSON array", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.prompt.id": "team/sample-prompt:3",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(JSON.parse(state.attributes["langwatch.prompt_ids"]!)).toEqual([
        "team/sample-prompt:3",
      ]);
    });

    it("does not keep per-span langwatch.prompt.id at trace level", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.prompt.id": "team/sample-prompt:3",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.prompt.id"]).toBeUndefined();
    });
  });

  describe("when multiple spans have different langwatch.prompt.id", () => {
    it("combines all prompt IDs into langwatch.prompt_ids array", () => {
      const span1 = createTestSpan({
        spanAttributes: {
          "langwatch.prompt.id": "team/prompt-a:1",
        },
      });

      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "langwatch.prompt.id": "team/prompt-b:2",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      expect(JSON.parse(state.attributes["langwatch.prompt_ids"]!)).toEqual([
        "team/prompt-a:1",
        "team/prompt-b:2",
      ]);
    });
  });

  describe("when multiple spans have the same langwatch.prompt.id", () => {
    it("deduplicates in langwatch.prompt_ids", () => {
      const span1 = createTestSpan({
        spanAttributes: {
          "langwatch.prompt.id": "team/sample-prompt:3",
        },
      });

      const span2 = createTestSpan({
        id: "span-2",
        spanId: "span-2",
        spanAttributes: {
          "langwatch.prompt.id": "team/sample-prompt:3",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      expect(JSON.parse(state.attributes["langwatch.prompt_ids"]!)).toEqual([
        "team/sample-prompt:3",
      ]);
    });
  });

  describe("when span has langwatch.prompt.id without colon", () => {
    it("does not hoist it (not a valid handle:version format)", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.prompt.id": "just-a-uuid",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.prompt_ids"]).toBeUndefined();
    });
  });

  // Regression for iter-110 Sergey finding: `gateway_budget_ledger_events`
  // CH table count=0 despite the gatewayBudgetSync reactor firing. Root
  // cause: the attribute accumulator's SPAN_ATTR_MAPPINGS allowlist didn't
  // include the two AI Gateway markers that the reactor reads, so they
  // never reached foldState.attributes and the reactor early-returned on
  // `!virtualKeyId || !gatewayRequestId` for every trace.
  describe("when span has AI Gateway markers", () => {
    it("forwards langwatch.virtual_key_id to trace attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.virtual_key_id": "vk_live_abc123",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.virtual_key_id"]).toBe(
        "vk_live_abc123",
      );
    });

    it("forwards langwatch.gateway_request_id to trace attributes", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.gateway_request_id": "req_01HZX0ABCDEF",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.gateway_request_id"]).toBe(
        "req_01HZX0ABCDEF",
      );
    });

    it("forwards both markers together so the gatewayBudgetSync reactor can fold", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.virtual_key_id": "vk_live_matrix_openai",
          "langwatch.gateway_request_id": "req_01HZX0XYZ",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      // Shape the reactor's early-return check expects.
      expect(state.attributes["langwatch.virtual_key_id"]).toBeTruthy();
      expect(state.attributes["langwatch.gateway_request_id"]).toBeTruthy();
    });
  });
});
