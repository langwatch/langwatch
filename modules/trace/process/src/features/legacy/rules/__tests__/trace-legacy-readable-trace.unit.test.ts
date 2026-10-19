import type { NormalizedSpan, TraceSummaryData } from "@langwatch/trace-contract";
import { NormalizedSpanKind, tracesTrpc } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { mapNormalizedSpansToSpans } from "../trace-legacy-span-mapping.rules.ts";
import { mapTraceSummaryToTrace } from "../trace-legacy-summary-mapping.rules.ts";

/**
 * `traces.getById` validates its answer against its declared output, and a refusal is the
 * drawer's error page. These are shapes ingest stores (as sent) that the strict trace shape
 * refuses; each must map to a trace the declared output accepts.
 */
const getByIdOutput = tracesTrpc.members.getById!.output!;

const traceCanonicalisation = TraceCanonicalisationService.create();

function makeNormalizedSpan(spanAttributes: Record<string, unknown>): NormalizedSpan {
  return {
    id: "span-row",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "project-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "stored-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: spanAttributes as NormalizedSpan["spanAttributes"],
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    cost: null,
    nonBilledCost: null,
  };
}

function makeSummary(attributes: Record<string, string> = {}): TraceSummaryData {
  const summary: Partial<TraceSummaryData> = {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 1000,
    computedIOSchemaVersion: "v1",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 2000,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes,
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    LastEventOccurredAt: 2000,
  };

  return summary as TraceSummaryData;
}

function readTrace({
  spanAttributes,
  summaryAttributes,
}: {
  spanAttributes: Record<string, unknown>;
  summaryAttributes?: Record<string, string>;
}) {
  return mapTraceSummaryToTrace({
    summary: makeSummary(summaryAttributes),
    spans: mapNormalizedSpansToSpans([makeNormalizedSpan(spanAttributes)]),
    projectId: "project-1",
    traceCanonicalisation,
  });
}

const storedChatShapes: [string, unknown[]][] = [
  ["an AI SDK step-start part", [{ role: "assistant", parts: [{ type: "step-start" }] }]],
  [
    "an AI SDK tool-<name> part",
    [{ role: "assistant", parts: [{ type: "tool-weather", toolCallId: "c1", state: "done" }] }],
  ],
  [
    "an Anthropic tool_use block",
    [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] }],
  ],
  ["an Anthropic thinking block", [{ role: "assistant", content: [{ type: "thinking" }] }]],
  ["a Gemini model role", [{ role: "model", content: "hi" }]],
  ["a LangChain human role", [{ role: "human", content: "hi" }]],
  ["an object content", [{ role: "user", content: { text: "hi" } }]],
  ["a bare string item", ["hello"]],
  ["a tool call with no id", [{ role: "assistant", tool_calls: [{ function: { name: "f" } }] }]],
  [
    "a tool call with object arguments",
    [
      {
        role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: { a: 1 } } }],
      },
    ],
  ],
];

describe("legacy trace read of stored shapes the strict trace shape refuses", () => {
  describe.each(storedChatShapes)("when a span's chat messages carry %s", (_, messages) => {
    it("answers a trace the getById output accepts, keeping the stored messages as json", () => {
      const trace = readTrace({ spanAttributes: { "gen_ai.output.messages": messages } });

      expect(getByIdOutput.validate(trace)).toBe(true);
      expect(trace.spans[0]?.output).toEqual({ type: "json", value: messages });
    });
  });

  describe("when a langwatch.input chat_messages wrapper carries a step-start part", () => {
    it("answers a trace the getById output accepts", () => {
      const value = [{ role: "user", content: [{ type: "step-start" }] }];
      const trace = readTrace({
        spanAttributes: { "langwatch.input": { type: "chat_messages", value } },
      });

      expect(getByIdOutput.validate(trace)).toBe(true);
      expect(trace.spans[0]?.input).toEqual({ type: "json", value });
    });
  });

  describe("when chat messages match the strict shape", () => {
    it("keeps them as chat_messages", () => {
      const messages = [{ role: "user", content: "hi" }];
      const trace = readTrace({ spanAttributes: { "gen_ai.input.messages": messages } });

      expect(getByIdOutput.validate(trace)).toBe(true);
      expect(trace.spans[0]?.input).toEqual({ type: "chat_messages", value: messages });
    });
  });

  describe.each(["embedding", "retriever", "prompt"])(
    "when a span was sent with the undeclared span type %s",
    (spanType) => {
      it("reads as a span, the stored type kept in params", () => {
        const trace = readTrace({ spanAttributes: { "langwatch.span.type": spanType } });

        expect(getByIdOutput.validate(trace)).toBe(true);
        expect(trace.spans[0]?.type).toBe("span");
        expect(trace.spans[0]?.params).toMatchObject({ langwatch: { span: { type: spanType } } });
      });
    },
  );

  describe("when a RAG chunk carries a scalar content", () => {
    it("keeps the span's contexts, the content as text", () => {
      const trace = readTrace({
        spanAttributes: {
          "langwatch.span.type": "rag",
          "langwatch.rag.contexts": [{ document_id: "d1", content: 42 }, "plain"],
        },
      });
      const parsed = getByIdOutput.safeParse(trace);

      expect(parsed.success).toBe(true);
      expect(parsed.data?.spans[0]).toMatchObject({
        type: "rag",
        contexts: [{ document_id: "d1", content: "42" }, { content: "plain" }],
      });
    });
  });

  describe("when stored labels and prompt ids are not all strings", () => {
    it("reads scalars as text and leaves out the rest", () => {
      const trace = readTrace({
        spanAttributes: {},
        summaryAttributes: {
          "langwatch.labels": JSON.stringify(["a", 1, true, null, { x: 1 }]),
          "langwatch.prompt_ids": JSON.stringify([7, null]),
        },
      });

      expect(getByIdOutput.validate(trace)).toBe(true);
      expect(trace.metadata.labels).toEqual(["a", "1", "true"]);
      expect(trace.metadata.prompt_ids).toEqual(["7"]);
    });
  });
});
