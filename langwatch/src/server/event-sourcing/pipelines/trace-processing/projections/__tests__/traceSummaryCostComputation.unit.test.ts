import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedSpanKind, NormalizedStatusCode } from "../../schemas/spans";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  applySpanToSummary,
  createTraceSummaryFoldProjection,
  type TraceSummaryData,
} from "../traceSummary.foldProjection";

const traceSummaryProjection = createTraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function createInitState(): TraceSummaryData {
  return traceSummaryProjection.init();
}

function createTestSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: "parent-1",
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    ...overrides,
  };
}

describe("applySpanToSummary cost computation", () => {
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

  describe("when span has custom cost rates and tokens", () => {
    it("computes cost from custom rates", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      // 100 * 0.000005 + 50 * 0.000015 = 0.0005 + 0.00075 = 0.00125
      expect(result.totalCost).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when span has model and tokens but no custom rates", () => {
    it("uses static registry for cost computation", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 1000,
          "gen_ai.usage.output_tokens": 500,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      // gpt-4o is in the static registry, so cost should be computed
      // The exact value depends on the JSON file, but it should be > 0
      expect(result.totalCost).not.toBeNull();
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when model is not in static registry", () => {
    it("returns cost as 0 (null in state)", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "totally-unknown-model-xyz-12345",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when no tokens are present", () => {
    it("returns cost as null", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when no model is present", () => {
    it("falls back to SDK cost if available", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.span.cost": 0.005,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeCloseTo(0.005, 6);
    });
  });

  describe("when no model and no SDK cost", () => {
    it("returns cost as null", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when span is a guardrail with cost in output", () => {
    it("extracts guardrail cost from langwatch.output object", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "USD" },
          },
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeCloseTo(0.0042, 6);
    });

    it("ignores guardrail cost when currency is not USD", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "EUR" },
          },
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeNull();
    });

    it("ignores guardrail cost when output is a string", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": "not-json",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalCost).toBeNull();
    });
  });

  describe("when token counts are strings", () => {
    it("coerces string tokens and computes cost from static registry", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": "100",
          "gen_ai.usage.output_tokens": "50",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.totalPromptTokenCount).toBe(100);
      expect(result.totalCompletionTokenCount).toBe(50);
      expect(result.totalCost).not.toBeNull();
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("when custom rates have only inputCostPerToken", () => {
    it("computes cost using only input rate", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
          "langwatch.model.inputCostPerToken": 0.00001,
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      // 100 * 0.00001 + 50 * 0 = 0.001
      expect(result.totalCost).toBeCloseTo(0.001, 6);
    });
  });
});

describe("applySpanToSummary guardrail blocking detection", () => {
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

  describe("when guardrail span has passed=false", () => {
    it("sets blockedByGuardrail to true", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": { passed: false },
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.blockedByGuardrail).toBe(true);
    });
  });

  describe("when guardrail span has passed=true", () => {
    it("keeps blockedByGuardrail as false", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": { passed: true },
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.blockedByGuardrail).toBe(false);
    });
  });

  describe("when non-guardrail span is processed", () => {
    it("does not set blockedByGuardrail", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.blockedByGuardrail).toBe(false);
    });
  });
});

describe("applySpanToSummary per-role cost/latency accumulation", () => {
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

  describe("given an agent span tagged role 'Agent' with child LLM spans", () => {
    describe("when the fold processes the agent span then its child LLM spans", () => {
      it("accumulates LLM costs into scenarioRoleCosts['Agent']", () => {
        const agentSpan = createTestSpan({
          spanId: "agent-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          spanAttributes: {
            "scenario.role": "Agent",
          },
        });

        const llmSpan1 = createTestSpan({
          spanId: "llm-1",
          parentSpanId: "agent-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 3100,
          durationMs: 2000,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 42,
            "gen_ai.usage.output_tokens": 0,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        const llmSpan2 = createTestSpan({
          spanId: "llm-2",
          parentSpanId: "agent-1",
          startTimeUnixMs: 3200,
          endTimeUnixMs: 5000,
          durationMs: 1800,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 79,
            "gen_ai.usage.output_tokens": 52,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: agentSpan });
        state = applySpanToSummary({ state, span: llmSpan1 });
        state = applySpanToSummary({ state, span: llmSpan2 });

        // LLM1 cost: 42 * 0.000005 + 0 * 0.000015 = 0.00021
        // LLM2 cost: 79 * 0.000005 + 52 * 0.000015 = 0.000395 + 0.00078 = 0.001175
        const expectedCost = 0.00021 + 0.001175;
        expect(state.scenarioRoleCosts?.["Agent"]).toBeCloseTo(expectedCost, 6);
      });

      it("sets scenarioRoleLatencies['Agent'] to the agent span duration", () => {
        const agentSpan = createTestSpan({
          spanId: "agent-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          spanAttributes: {
            "scenario.role": "Agent",
          },
        });

        const llmSpan = createTestSpan({
          spanId: "llm-1",
          parentSpanId: "agent-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 3100,
          durationMs: 2000,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: agentSpan });
        state = applySpanToSummary({ state, span: llmSpan });

        // Only the agent span (which has the role) contributes to latency
        expect(state.scenarioRoleLatencies?.["Agent"]).toBe(4000);
      });
    });
  });

  describe("given multiple roles in one trace", () => {
    describe("when User, Agent, and Judge each have child LLM spans", () => {
      it("accumulates costs separately per role", () => {
        const userSpan = createTestSpan({
          spanId: "user-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 2000,
          durationMs: 1000,
          spanAttributes: { "scenario.role": "User" },
        });

        const userLlm = createTestSpan({
          spanId: "user-llm-1",
          parentSpanId: "user-1",
          startTimeUnixMs: 1050,
          endTimeUnixMs: 1950,
          durationMs: 900,
          spanAttributes: {
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 10,
            "langwatch.model.inputCostPerToken": 0.00001,
            "langwatch.model.outputCostPerToken": 0.00003,
          },
        });

        const agentSpan = createTestSpan({
          spanId: "agent-1",
          parentSpanId: null,
          startTimeUnixMs: 2000,
          endTimeUnixMs: 6000,
          durationMs: 4000,
          spanAttributes: { "scenario.role": "Agent" },
        });

        const agentLlm = createTestSpan({
          spanId: "agent-llm-1",
          parentSpanId: "agent-1",
          startTimeUnixMs: 2100,
          endTimeUnixMs: 4000,
          durationMs: 1900,
          spanAttributes: {
            "gen_ai.usage.input_tokens": 200,
            "gen_ai.usage.output_tokens": 50,
            "langwatch.model.inputCostPerToken": 0.00001,
            "langwatch.model.outputCostPerToken": 0.00003,
          },
        });

        const judgeSpan = createTestSpan({
          spanId: "judge-1",
          parentSpanId: null,
          startTimeUnixMs: 6000,
          endTimeUnixMs: 7000,
          durationMs: 1000,
          spanAttributes: { "scenario.role": "Judge" },
        });

        const judgeLlm = createTestSpan({
          spanId: "judge-llm-1",
          parentSpanId: "judge-1",
          startTimeUnixMs: 6050,
          endTimeUnixMs: 6950,
          durationMs: 900,
          spanAttributes: {
            "gen_ai.usage.input_tokens": 300,
            "gen_ai.usage.output_tokens": 20,
            "langwatch.model.inputCostPerToken": 0.00001,
            "langwatch.model.outputCostPerToken": 0.00003,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: userSpan });
        state = applySpanToSummary({ state, span: userLlm });
        state = applySpanToSummary({ state, span: agentSpan });
        state = applySpanToSummary({ state, span: agentLlm });
        state = applySpanToSummary({ state, span: judgeSpan });
        state = applySpanToSummary({ state, span: judgeLlm });

        // User: 100*0.00001 + 10*0.00003 = 0.001 + 0.0003 = 0.0013
        expect(state.scenarioRoleCosts?.["User"]).toBeCloseTo(0.0013, 6);
        // Agent: 200*0.00001 + 50*0.00003 = 0.002 + 0.0015 = 0.0035
        expect(state.scenarioRoleCosts?.["Agent"]).toBeCloseTo(0.0035, 6);
        // Judge: 300*0.00001 + 20*0.00003 = 0.003 + 0.0006 = 0.0036
        expect(state.scenarioRoleCosts?.["Judge"]).toBeCloseTo(0.0036, 6);
      });
    });
  });

  describe("given deeply nested spans", () => {
    describe("when an LLM span is a grandchild of an agent span via a tool span", () => {
      it("attributes the LLM cost to the agent role", () => {
        const agentSpan = createTestSpan({
          spanId: "agent-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          spanAttributes: { "scenario.role": "Agent" },
        });

        const toolSpan = createTestSpan({
          spanId: "tool-1",
          parentSpanId: "agent-1",
          startTimeUnixMs: 1500,
          endTimeUnixMs: 4500,
          durationMs: 3000,
          spanAttributes: {},
        });

        const llmSpan = createTestSpan({
          spanId: "llm-1",
          parentSpanId: "tool-1",
          startTimeUnixMs: 2000,
          endTimeUnixMs: 4000,
          durationMs: 2000,
          spanAttributes: {
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
            "langwatch.model.inputCostPerToken": 0.0001,
            "langwatch.model.outputCostPerToken": 0.0001,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: agentSpan });
        state = applySpanToSummary({ state, span: toolSpan });
        state = applySpanToSummary({ state, span: llmSpan });

        // LLM cost: 100*0.0001 + 50*0.0001 = 0.01 + 0.005 = 0.015
        expect(state.scenarioRoleCosts?.["Agent"]).toBeCloseTo(0.015, 6);
      });
    });
  });

  describe("given child LLM spans arrive BEFORE their parent agent span", () => {
    describe("when the agent span arrives after LLM spans", () => {
      it("retroactively assigns LLM costs to the agent role", () => {
        // This reproduces the real production ordering where OTel exports
        // child spans before parent spans complete
        const llmSpan1 = createTestSpan({
          spanId: "llm-1",
          parentSpanId: "agent-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 3100,
          durationMs: 2000,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 42,
            "gen_ai.usage.output_tokens": 10,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        const llmSpan2 = createTestSpan({
          spanId: "llm-2",
          parentSpanId: "agent-1",
          startTimeUnixMs: 3200,
          endTimeUnixMs: 5000,
          durationMs: 1800,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 79,
            "gen_ai.usage.output_tokens": 52,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        // Agent span arrives LAST
        const agentSpan = createTestSpan({
          spanId: "agent-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          spanAttributes: {
            "scenario.role": "Agent",
          },
        });

        let state = createInitState();
        // Process in out-of-order: LLM children first, agent parent last
        state = applySpanToSummary({ state, span: llmSpan1 });
        state = applySpanToSummary({ state, span: llmSpan2 });
        state = applySpanToSummary({ state, span: agentSpan });

        // LLM1 cost: 42 * 0.000005 + 10 * 0.000015 = 0.00021 + 0.00015 = 0.00036
        // LLM2 cost: 79 * 0.000005 + 52 * 0.000015 = 0.000395 + 0.00078 = 0.001175
        const expectedCost = 0.00036 + 0.001175;
        expect(state.scenarioRoleCosts?.["Agent"]).toBeCloseTo(expectedCost, 6);
        expect(state.scenarioRoleLatencies?.["Agent"]).toBe(4000);
      });
    });
  });

  describe("given a trace without scenario roles", () => {
    describe("when spans have no scenario.role attribute", () => {
      it("leaves scenarioRoleCosts and scenarioRoleLatencies empty", () => {
        const span = createTestSpan({
          spanId: "span-1",
          parentSpanId: null,
          spanAttributes: {
            "gen_ai.request.model": "gpt-4o",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
            "langwatch.model.inputCostPerToken": 0.000005,
            "langwatch.model.outputCostPerToken": 0.000015,
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span });

        expect(state.scenarioRoleCosts).toEqual({});
        expect(state.scenarioRoleLatencies).toEqual({});
      });
    });
  });
});
