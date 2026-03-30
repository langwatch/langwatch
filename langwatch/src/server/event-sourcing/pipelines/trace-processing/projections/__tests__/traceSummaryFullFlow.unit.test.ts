import { describe, expect, it } from "vitest";
import { NormalizedSpanKind } from "../../schemas/spans";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

/**
 * Full-flow integration tests that exercise the entire applySpanToSummary
 * pipeline with realistic post-canonicalization NormalizedSpan objects.
 *
 * These tests do NOT mock TraceIOExtractionService — they use the real
 * service to verify end-to-end behavior for each SDK's span structure.
 */

describe("traceSummary full-flow integration", () => {
  describe("given a Vercel AI SDK trace", () => {
    describe("when processing 4 spans (root + ai.generateText + ai.generateText.doGenerate + ai.toolCall)", () => {
      it("accumulates cost, tokens, models, I/O, and span count", () => {
        const rootSpan = createTestSpan({
          id: "root-1",
          traceId: "vercel-trace-1",
          spanId: "root-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          name: "app-handler",
          kind: NormalizedSpanKind.SERVER,
          resourceAttributes: {
            "telemetry.sdk.name": "ai",
            "telemetry.sdk.version": "4.0.0",
            "service.name": "my-app",
          },
          spanAttributes: {
            "langwatch.input": "What is the weather in Tokyo?",
            "langwatch.output": "The weather in Tokyo is sunny, 22C.",
          },
          instrumentationScope: { name: "ai", version: "4.0.0" },
        });

        const generateTextSpan = createTestSpan({
          id: "gen-text-1",
          traceId: "vercel-trace-1",
          spanId: "gen-text-1",
          parentSpanId: "root-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 4500,
          durationMs: 3400,
          name: "ai.generateText",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.input.messages": [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "What is the weather in Tokyo?" },
            ],
            "gen_ai.output.messages": [
              {
                role: "assistant",
                content: "The weather in Tokyo is sunny, 22C.",
              },
            ],
          },
          instrumentationScope: { name: "ai", version: "4.0.0" },
        });

        const doGenerateSpan = createTestSpan({
          id: "do-gen-1",
          traceId: "vercel-trace-1",
          spanId: "do-gen-1",
          parentSpanId: "gen-text-1",
          startTimeUnixMs: 1200,
          endTimeUnixMs: 4400,
          durationMs: 3200,
          name: "ai.generateText.doGenerate",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.response.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 150,
            "gen_ai.usage.output_tokens": 80,
            "gen_ai.input.messages": [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "What is the weather in Tokyo?" },
            ],
            "gen_ai.output.messages": [
              {
                role: "assistant",
                content: "The weather in Tokyo is sunny, 22C.",
              },
            ],
          },
          instrumentationScope: { name: "ai", version: "4.0.0" },
        });

        const toolCallSpan = createTestSpan({
          id: "tool-1",
          traceId: "vercel-trace-1",
          spanId: "tool-1",
          parentSpanId: "gen-text-1",
          startTimeUnixMs: 2000,
          endTimeUnixMs: 3000,
          durationMs: 1000,
          name: "ai.toolCall",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "tool",
            "gen_ai.tool.name": "getWeather",
            "gen_ai.tool.call.arguments": '{"city":"Tokyo"}',
            "gen_ai.tool.call.result": '{"temp":22,"condition":"sunny"}',
          },
          instrumentationScope: { name: "ai", version: "4.0.0" },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: rootSpan });
        state = applySpanToSummary({ state, span: generateTextSpan });
        state = applySpanToSummary({ state, span: doGenerateSpan });
        state = applySpanToSummary({ state, span: toolCallSpan });

        expect(state.spanCount).toBe(4);
        expect(state.totalPromptTokenCount).toBe(150);
        expect(state.totalCompletionTokenCount).toBe(80);
        expect(state.totalCost).not.toBeNull();
        expect(state.totalCost).toBeGreaterThan(0);
        expect(state.models).toContain("gpt-5-mini");
        expect(state.computedInput).toBe(
          "What is the weather in Tokyo?",
        );
        expect(state.computedOutput).toBe(
          "The weather in Tokyo is sunny, 22C.",
        );
        expect(state.containsErrorStatus).toBe(false);
        expect(state.occurredAt).toBe(1000);
        expect(state.totalDurationMs).toBe(4000);
        expect(state.attributes["sdk.name"]).toBe("ai");
        expect(state.attributes["service.name"]).toBe("my-app");
      });
    });
  });

  describe("given a Mastra AI trace", () => {
    describe("when processing 3 spans (agent_run root + model_step + tool_call)", () => {
      it("uses root langwatch.input/output for I/O, accumulates tokens and models", () => {
        const agentRunSpan = createTestSpan({
          id: "agent-run-1",
          traceId: "mastra-trace-1",
          spanId: "agent-run-1",
          parentSpanId: null,
          startTimeUnixMs: 2000,
          endTimeUnixMs: 8000,
          durationMs: 6000,
          name: "agent_run",
          kind: NormalizedSpanKind.INTERNAL,
          resourceAttributes: {
            "telemetry.sdk.name": "@mastra/otel",
            "service.name": "mastra-agent",
          },
          spanAttributes: {
            "langwatch.input": "Tell me about quantum computing",
            "langwatch.output":
              "Quantum computing uses qubits that can exist in superposition.",
          },
          instrumentationScope: {
            name: "@mastra/otel",
            version: "1.0.0",
          },
        });

        const modelStepSpan = createTestSpan({
          id: "model-step-1",
          traceId: "mastra-trace-1",
          spanId: "model-step-1",
          parentSpanId: "agent-run-1",
          startTimeUnixMs: 2100,
          endTimeUnixMs: 6000,
          durationMs: 3900,
          name: "model_step",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.response.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 200,
            "gen_ai.usage.output_tokens": 120,
            "gen_ai.input.messages": [
              { role: "user", content: "Tell me about quantum computing" },
            ],
            "gen_ai.output.messages": [
              {
                role: "assistant",
                content:
                  "Quantum computing uses qubits that can exist in superposition.",
              },
            ],
          },
          instrumentationScope: {
            name: "@mastra/otel",
            version: "1.0.0",
          },
        });

        const toolCallSpan = createTestSpan({
          id: "tool-1",
          traceId: "mastra-trace-1",
          spanId: "tool-1",
          parentSpanId: "agent-run-1",
          startTimeUnixMs: 6100,
          endTimeUnixMs: 7800,
          durationMs: 1700,
          name: "tool_call",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "tool",
            "gen_ai.tool.name": "search",
          },
          instrumentationScope: {
            name: "@mastra/otel",
            version: "1.0.0",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: agentRunSpan });
        state = applySpanToSummary({ state, span: modelStepSpan });
        state = applySpanToSummary({ state, span: toolCallSpan });

        // Root langwatch.input/output wins I/O
        expect(state.computedInput).toBe(
          "Tell me about quantum computing",
        );
        expect(state.computedOutput).toBe(
          "Quantum computing uses qubits that can exist in superposition.",
        );
        expect(state.outputFromRootSpan).toBe(true);
        expect(state.totalPromptTokenCount).toBe(200);
        expect(state.totalCompletionTokenCount).toBe(120);
        expect(state.models).toContain("gpt-5-mini");
        expect(state.spanCount).toBe(3);
        expect(state.attributes["sdk.name"]).toBe("@mastra/otel");
      });
    });
  });

  describe("given an Agno (OpenInference) trace", () => {
    describe("when processing 3 spans (agent root + LLM + tool)", () => {
      it("extracts user_id and conversation.id into attributes, computes I/O and cost", () => {
        const agentRootSpan = createTestSpan({
          id: "agno-root-1",
          traceId: "agno-trace-1",
          spanId: "agno-root-1",
          parentSpanId: null,
          startTimeUnixMs: 3000,
          endTimeUnixMs: 9000,
          durationMs: 6000,
          name: "agent",
          kind: NormalizedSpanKind.INTERNAL,
          resourceAttributes: {
            "telemetry.sdk.name": "openinference",
            "service.name": "agno-agent",
          },
          spanAttributes: {
            "langwatch.user.id": "user-42",
            "gen_ai.conversation.id": "conv-123",
            "langwatch.input": "Summarize the latest news",
            "langwatch.output":
              "Here is a summary of the latest news headlines.",
          },
          instrumentationScope: {
            name: "openinference.instrumentation.agno",
            version: "0.5.0",
          },
        });

        const llmSpan = createTestSpan({
          id: "agno-llm-1",
          traceId: "agno-trace-1",
          spanId: "agno-llm-1",
          parentSpanId: "agno-root-1",
          startTimeUnixMs: 3100,
          endTimeUnixMs: 7000,
          durationMs: 3900,
          name: "LLM",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.response.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 180,
            "gen_ai.usage.output_tokens": 95,
            "gen_ai.input.messages": [
              { role: "user", content: "Summarize the latest news" },
            ],
            "gen_ai.output.messages": [
              {
                role: "assistant",
                content:
                  "Here is a summary of the latest news headlines.",
              },
            ],
          },
          instrumentationScope: {
            name: "openinference.instrumentation.agno",
            version: "0.5.0",
          },
        });

        const toolSpan = createTestSpan({
          id: "agno-tool-1",
          traceId: "agno-trace-1",
          spanId: "agno-tool-1",
          parentSpanId: "agno-root-1",
          startTimeUnixMs: 7100,
          endTimeUnixMs: 8800,
          durationMs: 1700,
          name: "tool",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "tool",
            "gen_ai.tool.name": "news_fetcher",
          },
          instrumentationScope: {
            name: "openinference.instrumentation.agno",
            version: "0.5.0",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: agentRootSpan });
        state = applySpanToSummary({ state, span: llmSpan });
        state = applySpanToSummary({ state, span: toolSpan });

        // Attributes hoisted from span attributes
        expect(state.attributes["langwatch.user_id"]).toBe("user-42");
        expect(state.attributes["gen_ai.conversation.id"]).toBe("conv-123");

        // I/O from root span (langwatch.input/output)
        expect(state.computedInput).toBe("Summarize the latest news");
        expect(state.computedOutput).toBe(
          "Here is a summary of the latest news headlines.",
        );

        // Cost and tokens from LLM span
        expect(state.totalPromptTokenCount).toBe(180);
        expect(state.totalCompletionTokenCount).toBe(95);
        expect(state.totalCost).not.toBeNull();
        expect(state.totalCost).toBeGreaterThan(0);
        expect(state.models).toContain("gpt-5-mini");
        expect(state.spanCount).toBe(3);
      });
    });
  });

  describe("given a Strands trace", () => {
    describe("when processing 3 spans (invoke_agent root + chat + execute_tool)", () => {
      it("accumulates model, tokens, I/O, and span count", () => {
        const invokeAgentSpan = createTestSpan({
          id: "strands-root-1",
          traceId: "strands-trace-1",
          spanId: "strands-root-1",
          parentSpanId: null,
          startTimeUnixMs: 5000,
          endTimeUnixMs: 12000,
          durationMs: 7000,
          name: "invoke_agent",
          kind: NormalizedSpanKind.SERVER,
          resourceAttributes: {
            "telemetry.sdk.name": "strands",
            "service.name": "strands-agent",
          },
          spanAttributes: {
            "langwatch.input": "Calculate compound interest for $10000",
            "langwatch.output":
              "The compound interest for $10000 at 5% over 10 years is $6288.95.",
          },
          instrumentationScope: {
            name: "strands.telemetry.tracer",
            version: "0.1.0",
          },
        });

        const chatSpan = createTestSpan({
          id: "strands-chat-1",
          traceId: "strands-trace-1",
          spanId: "strands-chat-1",
          parentSpanId: "strands-root-1",
          startTimeUnixMs: 5100,
          endTimeUnixMs: 10000,
          durationMs: 4900,
          name: "chat",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "us.anthropic.claude-sonnet-4-20250514",
            "gen_ai.response.model": "us.anthropic.claude-sonnet-4-20250514",
            "gen_ai.usage.input_tokens": 300,
            "gen_ai.usage.output_tokens": 150,
            "gen_ai.input.messages": [
              {
                role: "user",
                content: "Calculate compound interest for $10000",
              },
            ],
            "gen_ai.output.messages": [
              {
                role: "assistant",
                content:
                  "The compound interest for $10000 at 5% over 10 years is $6288.95.",
              },
            ],
          },
          instrumentationScope: {
            name: "strands.telemetry.tracer",
            version: "0.1.0",
          },
        });

        const executeToolSpan = createTestSpan({
          id: "strands-tool-1",
          traceId: "strands-trace-1",
          spanId: "strands-tool-1",
          parentSpanId: "strands-root-1",
          startTimeUnixMs: 10100,
          endTimeUnixMs: 11500,
          durationMs: 1400,
          name: "execute_tool",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "tool",
            "gen_ai.tool.name": "calculator",
          },
          instrumentationScope: {
            name: "strands.telemetry.tracer",
            version: "0.1.0",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: invokeAgentSpan });
        state = applySpanToSummary({ state, span: chatSpan });
        state = applySpanToSummary({ state, span: executeToolSpan });

        expect(state.models).toContain(
          "us.anthropic.claude-sonnet-4-20250514",
        );
        expect(state.totalPromptTokenCount).toBe(300);
        expect(state.totalCompletionTokenCount).toBe(150);
        expect(state.computedInput).toBe(
          "Calculate compound interest for $10000",
        );
        expect(state.computedOutput).toBe(
          "The compound interest for $10000 at 5% over 10 years is $6288.95.",
        );
        expect(state.spanCount).toBe(3);
        expect(state.occurredAt).toBe(5000);
        expect(state.totalDurationMs).toBe(7000);
        expect(state.attributes["sdk.name"]).toBe("strands");
      });
    });
  });
});
