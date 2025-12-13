import { describe, expect, it } from "vitest";
import type { SpanData } from "../../schemas/commands";
import { traceIOExtractionService } from "../traceIOExtractionService";

function createSpan(
  spanId: string,
  attributes: Record<string, any>,
  parentSpanId: string | null = null,
): SpanData {
  return {
    id: `span:${spanId}`,
    aggregateId: "trace:test",
    tenantId: "project_test",
    traceId: "test-trace-id",
    spanId,
    traceFlags: 0,
    traceState: null,
    isRemote: false,
    parentSpanId,
    name: "test-span",
    kind: 1,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    attributes,
    events: [],
    links: [],
    status: { code: 1, message: null },
    resourceAttributes: {},
    instrumentationScope: { name: "test", version: null },
    durationMs: 1000,
    ended: true,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("TraceIOExtractionService", () => {
  describe("extractFirstInput", () => {
    describe("when LLM span has gen_ai.input.messages", () => {
      it("extracts chat messages format", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "llm",
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: "Hello world" },
            ]),
          }),
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("Hello world");
      });

      it("extracts text format", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "llm",
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: "Test input" },
            ]),
          }),
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("Test input");
      });
    });

    describe("when non-LLM span has langwatch.input", () => {
      it("extracts input from langwatch.input attribute", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "chain",
            "langwatch.input": JSON.stringify({
              type: "text",
              value: "Chain input text",
            }),
          }),
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("Chain input text");
      });

      it("extracts chat messages from langwatch.input", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "workflow",
            "langwatch.input": JSON.stringify({
              type: "chat_messages",
              value: [{ role: "user", content: "Workflow input" }],
            }),
          }),
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("Workflow input");
      });
    });

    describe("when no input found", () => {
      it("falls back to span name", () => {
        const spans = [
          {
            ...createSpan("span1", {}),
            name: "Workflow",
          },
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("Workflow");
      });
    });

    describe("when span has HTTP attributes", () => {
      it("returns HTTP method and target", () => {
        const spans = [
          createSpan("span1", {
            "http.method": "POST",
            "http.target": "/api/chat",
          }),
        ];

        const result = traceIOExtractionService.extractFirstInput(spans);

        expect(result).toBe("POST /api/chat");
      });
    });
  });

  describe("extractLastOutput", () => {
    describe("when LLM span has gen_ai.output.messages", () => {
      it("extracts chat messages format", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "llm",
            "gen_ai.output.messages": JSON.stringify([
              { role: "assistant", content: "Hello response" },
            ]),
          }),
        ];

        const result = traceIOExtractionService.extractLastOutput(spans);

        expect(result).toBe("Hello response");
      });
    });

    describe("when non-LLM span has langwatch.output", () => {
      it("extracts output from langwatch.output attribute", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "agent",
            "langwatch.output": JSON.stringify({
              type: "text",
              value: "Agent output text",
            }),
          }),
        ];

        const result = traceIOExtractionService.extractLastOutput(spans);

        expect(result).toBe("Agent output text");
      });

      it("extracts chat messages from langwatch.output", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.span.type": "chain",
            "langwatch.output": JSON.stringify({
              type: "chat_messages",
              value: [{ role: "assistant", content: "Chain output" }],
            }),
          }),
        ];

        const result = traceIOExtractionService.extractLastOutput(spans);

        expect(result).toBe("Chain output");
      });
    });

    describe("when no output found", () => {
      it("returns empty string", () => {
        const spans = [createSpan("span1", {})];

        const result = traceIOExtractionService.extractLastOutput(spans);

        expect(result).toBe("");
      });
    });

    describe("when multiple spans have output", () => {
      it("returns output from last-finishing span", () => {
        const spans = [
          {
            ...createSpan("span1", {
              "langwatch.span.type": "llm",
              "gen_ai.output.messages": JSON.stringify([
                { role: "assistant", content: "First output" },
              ]),
            }),
            endTimeUnixMs: 2000,
          },
          {
            ...createSpan("span2", {
              "langwatch.span.type": "llm",
              "gen_ai.output.messages": JSON.stringify([
                { role: "assistant", content: "Last output" },
              ]),
            }),
            endTimeUnixMs: 3000,
          },
        ];

        const result = traceIOExtractionService.extractLastOutput(spans);

        expect(result).toBe("Last output");
      });
    });
  });
});
