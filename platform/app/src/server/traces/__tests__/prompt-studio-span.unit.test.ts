import { describe, expect, it } from "vitest";
import type { StoredTraceSpan } from "~/server/app-layer/traces/repositories/span-storage.repository";
import {
  type PromptStudioSpanRow,
  promptStudioRowFromStoredSpan,
  promptStudioSpanFromTrace,
} from "../prompt-studio-span";

function row({
  spanId,
  parentSpanId = null,
  startTime,
  attributes = {},
}: {
  spanId: string;
  parentSpanId?: string | null;
  startTime: number;
  attributes?: Record<string, unknown>;
}): PromptStudioSpanRow {
  return {
    SpanId: spanId,
    TraceId: "trace-1",
    ParentSpanId: parentSpanId,
    SpanName: spanId,
    SpanAttributes: attributes,
    StartTime: startTime,
    EndTime: startTime + 10,
    DurationMs: 10,
    StatusCode: 1,
    StatusMessage: null,
  };
}

const llm = { "langwatch.span.type": "llm" };

describe("promptStudioSpanFromTrace()", () => {
  describe("when the requested span is not in the trace", () => {
    it("returns null", () => {
      expect(
        promptStudioSpanFromTrace({
          rows: [row({ spanId: "a", startTime: 1, attributes: llm })],
          spanId: "missing",
        }),
      ).toBeNull();
    });
  });

  describe("when the requested span is not an llm span", () => {
    it("loads its closest descendant llm before a later sibling", () => {
      const result = promptStudioSpanFromTrace({
        rows: [
          row({ spanId: "root", startTime: 0 }),
          row({ spanId: "compile", parentSpanId: "root", startTime: 1 }),
          row({
            spanId: "sibling-llm",
            parentSpanId: "root",
            startTime: 2,
            attributes: llm,
          }),
          row({ spanId: "wrapper", parentSpanId: "compile", startTime: 3 }),
          row({
            spanId: "child-llm",
            parentSpanId: "wrapper",
            startTime: 4,
            attributes: llm,
          }),
        ],
        spanId: "compile",
      });

      expect(result?.spanId).toBe("child-llm");
    });

    it("skips a sibling llm that started before it and falls back to the earliest llm", () => {
      const result = promptStudioSpanFromTrace({
        rows: [
          row({ spanId: "earlier-llm", startTime: 1, attributes: llm }),
          row({ spanId: "compile", startTime: 5 }),
          row({
            spanId: "nested-llm",
            parentSpanId: "earlier-llm",
            startTime: 2,
            attributes: llm,
          }),
        ],
        spanId: "compile",
      });

      expect(result?.spanId).toBe("earlier-llm");
    });
  });

  describe("when the llm span carries no prompt reference", () => {
    it("takes the reference from the span that compiled the prompt before it", () => {
      const result = promptStudioSpanFromTrace({
        rows: [
          row({ spanId: "root", startTime: 0 }),
          row({
            spanId: "compile",
            parentSpanId: "root",
            startTime: 1,
            attributes: {
              "langwatch.prompt.handle": "pizza-prompt",
              "langwatch.prompt.version.number": "3",
            },
          }),
          row({
            spanId: "call",
            parentSpanId: "root",
            startTime: 2,
            attributes: { ...llm, "gen_ai.request.model": "gpt-5-mini" },
          }),
        ],
        spanId: "call",
      });

      expect(result?.llmConfig.model).toBe("gpt-5-mini");
      expect(result?.promptHandle).toBe("pizza-prompt");
    });
  });
});

describe("promptStudioRowFromStoredSpan()", () => {
  describe("when the stored attributes hold number-like strings", () => {
    const stored: StoredTraceSpan = {
      spanId: "llm-1",
      traceId: "trace-1",
      parentSpanId: null,
      name: "llm",
      spanAttributes: {
        "langwatch.span.type": "llm",
        "gen_ai.request.seed": "0042",
        "gen_ai.request.temperature": "1.50",
        "custom.flag": "true",
        "custom.json": '{ "a": 1 }',
      },
      startTimeUnixMs: 1,
      endTimeUnixMs: 11,
      durationMs: 10,
      statusCode: 1,
      statusMessage: null,
    };

    it("keeps every stored string unchanged", () => {
      expect(promptStudioRowFromStoredSpan(stored).SpanAttributes).toEqual({
        "langwatch.span.type": "llm",
        "gen_ai.request.seed": "0042",
        "gen_ai.request.temperature": "1.50",
        "custom.flag": "true",
        "custom.json": '{ "a": 1 }',
      });
    });

    it("hands the stored strings on to the llm config", () => {
      const result = promptStudioSpanFromTrace({
        rows: [promptStudioRowFromStoredSpan(stored)],
        spanId: "llm-1",
      });

      expect(result?.llmConfig.seed).toBe("0042");
      expect(result?.llmConfig.temperature).toBe("1.50");
    });
  });
});
