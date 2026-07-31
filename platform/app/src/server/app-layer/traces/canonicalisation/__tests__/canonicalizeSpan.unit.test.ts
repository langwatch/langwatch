import { describe, expect, it } from "vitest";
import { canonicalSpanSchema } from "~/server/event-sourcing/trace-processing/schema";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "../../ingest/normalizedSpan";
import { canonicalizeSpan } from "../canonicalizeSpan";

const START_MS = 1_700_000_000_000;

function normalizedSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return {
    id: "record-1",
    tenantId: "project-1",
    traceId: "5afd4fa2030c898be40aa16645a652e0",
    spanId: "21a94d346206ed31",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: START_MS,
    endTimeUnixMs: START_MS + 500,
    durationMs: 500,
    name: "chat-completion",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "langwatch", version: "1.0.0" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

function canonicalize(overrides: Partial<NormalizedSpan> = {}) {
  return canonicalizeSpan({
    normalized: normalizedSpan(overrides),
    piiRedactionLevel: "ESSENTIAL",
    occurredAt: START_MS,
    acceptedAt: START_MS + 10,
  });
}

describe("given a normalized span crossing into the recordSpan command", () => {
  describe("when it is canonicalized", () => {
    it("satisfies the schema the command declares as its input", () => {
      const result = canonicalSpanSchema.safeParse(canonicalize());

      expect(result.success).toBe(true);
    });

    it("lifts the trace id to the top level the id resolver reads", () => {
      // The whole outage: `spanReceived`'s id resolver is `(d) => d.traceId`,
      // and the raw envelope carries it at `d.span.traceId`.
      expect(canonicalize().traceId).toBe("5afd4fa2030c898be40aa16645a652e0");
    });

    it("names the span kind rather than passing its OTLP ordinal through", () => {
      expect(canonicalize({ kind: NormalizedSpanKind.CLIENT }).kind).toBe(
        "CLIENT",
      );
    });

    it("names the status code rather than passing its ordinal through", () => {
      expect(
        canonicalize({ statusCode: NormalizedStatusCode.ERROR }).statusCode,
      ).toBe("ERROR");
    });

    it("defaults an unreported status to unset", () => {
      expect(canonicalize({ statusCode: null }).statusCode).toBe("UNSET");
    });
  });

  describe("when the span reports token usage", () => {
    it("reads the canonical gen_ai usage keys", () => {
      const span = canonicalize({
        spanAttributes: {
          "gen_ai.usage.input_tokens": 120,
          "gen_ai.usage.output_tokens": 30,
          "gen_ai.usage.reasoning_tokens": 8,
        },
      });

      expect(span.usage.inputTokens).toBe(120);
      expect(span.usage.outputTokens).toBe(30);
      expect(span.usage.reasoningTokens).toBe(8);
    });

    it("keeps a reported zero distinct from an unreported count", () => {
      const span = canonicalize({
        spanAttributes: { "gen_ai.usage.input_tokens": 0 },
      });

      expect(span.usage.inputTokens).toBe(0);
      expect(span.usage.outputTokens).toBeNull();
    });
  });

  describe("when the span carries a LangWatch metrics blob", () => {
    it("reads the Python SDK's snake_case fields", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.metrics": {
            prompt_tokens: 11,
            completion_tokens: 5,
            cost: 0.002,
          },
        },
      });

      expect(span.usage.inputTokens).toBe(11);
      expect(span.usage.outputTokens).toBe(5);
      expect(span.cost.cost).toBe(0.002);
    });

    it("unwraps the TypeScript SDK's json envelope", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.metrics": {
            type: "json",
            value: { promptTokens: 7, completionTokens: 3 },
          },
        },
      });

      expect(span.usage.inputTokens).toBe(7);
      expect(span.usage.outputTokens).toBe(3);
    });
  });

  describe("when the span carries SDK timing", () => {
    it("turns a first-token instant into an offset from the span start", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.timestamps": { first_token_at: START_MS + 800 },
        },
      });

      expect(span.timeToFirstTokenMs).toBe(800);
    });

    it("ignores a first-token instant that predates the span start", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.timestamps": { first_token_at: START_MS - 50 },
        },
      });

      expect(span.timeToFirstTokenMs).toBeNull();
    });

    it("prefers a reported duration attribute over the timestamps blob", () => {
      const span = canonicalize({
        spanAttributes: {
          "gen_ai.server.time_to_first_token": 500,
          "langwatch.timestamps": { first_token_at: START_MS + 800 },
        },
      });

      expect(span.timeToFirstTokenMs).toBe(500);
    });
  });

  describe("when the span declares explicit input and output", () => {
    it("marks the LangWatch keys as explicit and unwraps their value", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.input": { type: "text", value: "hello" },
          "langwatch.output": { type: "text", value: "hi back" },
        },
      });

      expect(span.io).toEqual({
        inputText: "hello",
        inputIsExplicit: true,
        outputText: "hi back",
        outputIsExplicit: true,
      });
    });

    it("falls back to a non-semantic key without claiming it is explicit", () => {
      const span = canonicalize({
        spanAttributes: { "input.value": "implicit" },
      });

      expect(span.io.inputText).toBe("implicit");
      expect(span.io.inputIsExplicit).toBe(false);
    });
  });

  describe("when an attribute holds a parsed JSON object", () => {
    it("re-serialises it so the attribute map stays schema-valid", () => {
      const span = canonicalize({
        spanAttributes: { "langwatch.params": { a: 1 } },
      });

      expect(span.attributes["langwatch.params"]).toBe('{"a":1}');
      expect(canonicalSpanSchema.safeParse(span).success).toBe(true);
    });

    it("keeps scalars and scalar arrays as themselves", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.labels": ["a", "b"],
          "a.number": 0,
          "a.bool": false,
        },
      });

      expect(span.attributes["langwatch.labels"]).toEqual(["a", "b"]);
      expect(span.attributes["a.number"]).toBe(0);
      expect(span.attributes["a.bool"]).toBe(false);
    });
  });

  describe("when the span records an exception", () => {
    it("prefers the exception event's message over the attribute copy", () => {
      const span = canonicalize({
        spanAttributes: { "exception.message": "from attribute" },
        events: [
          {
            name: "exception",
            timeUnixMs: START_MS + 10,
            attributes: { "exception.message": "from event" },
          },
        ],
      });

      expect(span.exceptionMessage).toBe("from event");
    });
  });

  describe("when the span identifies a managed prompt", () => {
    it("reads the prompt id and its version", () => {
      const span = canonicalize({
        spanAttributes: {
          "langwatch.prompt.id": "prompt-1",
          "langwatch.prompt.version.id": "version-1",
          "langwatch.prompt.version.number": 3,
        },
      });

      expect(span.prompt).toEqual({
        promptId: "prompt-1",
        versionId: "version-1",
        versionNumber: 3,
      });
    });

    it("reports no prompt when none is identified", () => {
      expect(canonicalize().prompt).toBeNull();
    });
  });
});
