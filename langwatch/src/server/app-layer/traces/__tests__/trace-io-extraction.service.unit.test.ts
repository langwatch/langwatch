import { describe, expect, it } from "vitest";
import {
  TraceIOExtractionService,
} from "../trace-io-extraction.service";
import type { NormalizedSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/spans";

const service = new TraceIOExtractionService();

function createTestSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: null,
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

describe("TraceIOExtractionService", () => {
  describe("extractRichIOFromSpan", () => {
    describe("when langwatch.input is a JSON object with 'input' key", () => {
      it("extracts the text from the input key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { input: "🐥" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("🐥");
        expect(result!.source).toBe("langwatch");
      });
    });

    describe("when langwatch.input is a JSON object with 'question' key", () => {
      it("extracts the text from the question key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { question: "What is 2+2?" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("What is 2+2?");
      });
    });

    describe("when langwatch.input is a JSON object with 'query' key", () => {
      it("extracts the text from the query key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { query: "search term" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("search term");
      });
    });

    describe("when langwatch.output is a JSON object with 'output' key", () => {
      it("extracts the text from the output key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { output: "The answer is 4" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "output");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("The answer is 4");
      });
    });

    describe("when langwatch.input is a JSON object with 'answer' key", () => {
      it("extracts the text from the answer key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { answer: "42" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("42");
      });
    });

    describe("when langwatch.input is a plain string", () => {
      it("returns the string directly", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": "hello world",
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("hello world");
      });
    });

    describe("when langwatch.input is a JSON object with nested inputs", () => {
      it("extracts text from LangChain-style inputs wrapper", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { inputs: { input: "nested hello" } },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("nested hello");
      });
    });

    describe("when langwatch.input is a JSON object with no recognized keys", () => {
      it("returns null", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { foo: "bar", baz: 123 },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).toBeNull();
      });
    });

    describe("when langwatch.input has message-like structure", () => {
      it("prefers message extraction over plain JSON extraction", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { content: "message content", input: "other" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("message content");
      });
    });

    describe("when langwatch.input has 'prompt' key (Haystack)", () => {
      it("extracts the text from the prompt key", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { prompt: "Tell me about AI" },
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("Tell me about AI");
      });
    });
  });
});
