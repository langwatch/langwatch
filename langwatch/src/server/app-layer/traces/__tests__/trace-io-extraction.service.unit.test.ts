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
      it("returns null from the semantic path — fallback happens in callers", () => {
        // This is the key invariant: `extractRichIOFromSpan` must NOT return a
        // non-null result for pure-fallback cases. Otherwise ranking logic
        // (`extractLastOutput`, `accumulateIO`) would treat a random
        // `{foo:"bar"}` span as equivalent to a span with a real `content`
        // match and let the former shadow the latter.
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { foo: "bar", baz: 123 },
          },
        });

        expect(service.extractRichIOFromSpan(span, "input")).toBeNull();
      });

      it("extractFallbackIOFromSpan returns a stringified representation", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { foo: "bar", baz: 123 },
          },
        });

        const fb = service.extractFallbackIOFromSpan(span, "input");

        expect(fb).not.toBeNull();
        expect(fb!.source).toBe("langwatch");
        expect(fb!.raw).toEqual({ foo: "bar", baz: 123 });
        expect(JSON.parse(fb!.text)).toEqual({ foo: "bar", baz: 123 });
      });

      it("extractFirstInput falls back to stringified payload when no semantic match exists", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": { foo: "bar", baz: 123 },
          },
        });

        const result = service.extractFirstInput([span]);

        expect(result).not.toBeNull();
        expect(JSON.parse(result!.text)).toEqual({ foo: "bar", baz: 123 });
      });
    });

    describe("ranking: fallback must never shadow a semantic match on another span", () => {
      it("extractLastOutput prefers the span with a semantic content match even when another span is fallback-only", () => {
        // Span A has real content. Span B has an unrecognized shape. Without
        // the semantic/fallback split, B could shadow A by finishing later.
        const spanA = createTestSpan({
          spanId: "a",
          startTimeUnixMs: 100,
          endTimeUnixMs: 200,
          spanAttributes: {
            "langwatch.output": { content: "the real answer" },
          },
        });
        const spanB = createTestSpan({
          spanId: "b",
          startTimeUnixMs: 150,
          endTimeUnixMs: 300,
          spanAttributes: {
            "langwatch.output": { totally: "unknown", shape: true },
          },
        });

        const result = service.extractLastOutput([spanA, spanB]);

        expect(result).not.toBeNull();
        expect(result!.text).toBe("the real answer");
      });
    });

    describe("when langwatch.output wraps the real payload in a single unknown key", () => {
      it("recurses through the wrapper and extracts the inner content", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": {
              data: { content: "COMPANY_ANALYSIS", formatName: "standard" },
            },
          },
        });

        const result = service.extractRichIOFromSpan(span, "output");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("COMPANY_ANALYSIS");
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

    describe("when langwatch.input is a JSON-encoded string with 'message' and 'history'", () => {
      it("parses the JSON and extracts the message field", () => {
        const payload = {
          message:
            "I think you should have some options for me to easily select, like 1, 2, 3",
          history: [
            { role: "user", content: "decide my dinner tonight" },
            { role: "assistant", content: "some long suggestion" },
          ],
          thread_id: "c9d826f2-d1d1-4807-a3f8-77a016883b14",
        };
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": JSON.stringify(payload),
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe(JSON.stringify(payload));
        expect(result!.source).toBe("langwatch");
      });
    });

    describe("when langwatch.input is a non-JSON string that contains braces", () => {
      it("returns the raw string without erroring", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.input": "{not really json",
          },
        });

        const result = service.extractRichIOFromSpan(span, "input");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("{not really json");
      });
    });

    describe("when langwatch.output is a JSON-encoded string with 'output' key", () => {
      it("returns the raw string as-is (strings bypass heuristic extraction)", () => {
        const encoded = JSON.stringify({
          output: "The answer is 42",
          trace_id: "abc",
        });
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": encoded,
          },
        });

        const result = service.extractRichIOFromSpan(span, "output");

        expect(result).not.toBeNull();
        expect(result!.text).toBe(encoded);
      });
    });

    describe("when langwatch.output is deeply nested under multiple wrapper keys", () => {
      it("recurses through every single-key wrapper to find the content", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": {
              outer: { middle: { inner: { content: "found at depth 4" } } },
            },
          },
        });

        const result = service.extractRichIOFromSpan(span, "output");

        expect(result).not.toBeNull();
        expect(result!.text).toBe("found at depth 4");
      });
    });

    describe("when langwatch.output is a wrapper whose value is a non-empty primitive", () => {
      it("semantic path returns null; extractLastOutput falls back to stringified", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { customWrapper: "the actual answer" },
          },
        });

        // Heuristic can't extract — we don't know which key holds the answer.
        expect(service.extractRichIOFromSpan(span, "output")).toBeNull();

        // But the caller still gets a stringified fallback rather than null.
        const lastOutput = service.extractLastOutput([span]);
        expect(lastOutput).not.toBeNull();
        expect(lastOutput!.text).toBe(
          '{"customWrapper":"the actual answer"}',
        );
      });
    });

    describe("when langwatch.output is an object with a circular reference", () => {
      it("does not crash — returns null since stringification is not possible", () => {
        const obj: Record<string, unknown> = { name: "loop" };
        obj.self = obj;
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": obj,
          },
        });

        // Should not throw — the try/catch around JSON.stringify handles it.
        expect(service.extractRichIOFromSpan(span, "output")).toBeNull();
        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });
    });

    describe("when langwatch.output is an empty object or empty array", () => {
      it("returns null for an empty object — nothing meaningful to render", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": {},
          },
        });

        expect(service.extractRichIOFromSpan(span, "output")).toBeNull();
        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });

      it("returns null for an empty array", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": [],
          },
        });

        expect(service.extractRichIOFromSpan(span, "output")).toBeNull();
        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });
    });

    describe("when langwatch.output is a wrapper with only empty leaves", () => {
      it("returns null for { data: {} } — fallback must not surface useless payloads", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { data: {} },
          },
        });

        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });

      it("returns null for { result: [] }", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { result: [] },
          },
        });

        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });

      it("returns null for deeply nested empty leaves like { a: { b: '' } }", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { a: { b: "" } },
          },
        });

        expect(service.extractFallbackIOFromSpan(span, "output")).toBeNull();
      });

      it("still surfaces a wrapper that has at least one meaningful leaf", () => {
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.output": { data: { nested: "real" } },
          },
        });

        const fb = service.extractFallbackIOFromSpan(span, "output");
        expect(fb).not.toBeNull();
        expect(fb!.text).toBe('{"data":{"nested":"real"}}');
      });
    });
  });
});
