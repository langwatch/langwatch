import { NON_BILLABLE_ATTR } from "@langwatch/span-normalisation";
import { describe, expect, it } from "vitest";

import {
  accumulateSpanTokens,
  deriveSpanPriceInput,
  deriveSpanRollupContribution,
  deriveSpanStorageCost,
  extractSpanCacheTokens,
  extractSpanModels,
  extractSpanTokenCounts,
  extractSpanTokenTiming,
  isSpanCostNonBillable,
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
  type SpanTokenAccumulationState,
} from "../../../index.ts";
import { deriveRagContextsWithIds, ragDocumentIdFor } from "../../../otlp-decoding/index.ts";

function span(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
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
    durationMs: 1000.4,
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
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

const llmAttributes = {
  "langwatch.span.type": "llm",
  "gen_ai.request.model": "gpt-req",
  "gen_ai.response.model": "gpt-resp",
  "gen_ai.usage.input_tokens": "1000",
  "gen_ai.usage.output_tokens": 500,
};

const emptyState = {
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
} satisfies SpanTokenAccumulationState;

describe("extractSpanModels", () => {
  it("lists the response model before the request model, dropping empties", () => {
    expect(extractSpanModels(span({ spanAttributes: llmAttributes }))).toEqual([
      "gpt-resp",
      "gpt-req",
    ]);
    expect(extractSpanModels(span({ spanAttributes: { "gen_ai.response.model": "" } }))).toEqual(
      [],
    );
  });
});

describe("extractSpanTokenCounts", () => {
  describe("when both semconv counts are present", () => {
    it("coerces them and ignores the estimated flag", () => {
      const counts = extractSpanTokenCounts(
        span({ spanAttributes: { ...llmAttributes, "langwatch.tokens.estimated": true } }),
      );
      expect(counts).toEqual({ promptTokens: 1000, completionTokens: 500, estimated: false });
    });
  });

  describe("when a count is missing", () => {
    it("honours the estimated flag", () => {
      const counts = extractSpanTokenCounts(
        span({
          spanAttributes: { "gen_ai.usage.input_tokens": 7, "langwatch.tokens.estimated": "true" },
        }),
      );
      expect(counts).toEqual({ promptTokens: 7, completionTokens: 0, estimated: true });
    });
  });
});

describe("extractSpanCacheTokens", () => {
  it("takes the first positive value of each key list", () => {
    const tokens = extractSpanCacheTokens(
      span({
        spanAttributes: {
          "gen_ai.usage.cache_read.input_tokens": 0,
          "gen_ai.usage.cached_tokens": 12,
          "gen_ai.usage.reasoning_tokens": "3",
        },
      }),
    );
    expect(tokens.cacheReadTokens).toBe(12);
    expect(tokens.reasoningTokens).toBe(3);
  });
});

describe("isSpanCostNonBillable", () => {
  it("lets a span-level marker override the resource default", () => {
    expect(
      isSpanCostNonBillable(
        span({
          resourceAttributes: { [NON_BILLABLE_ATTR]: "true" },
          spanAttributes: { [NON_BILLABLE_ATTR]: false },
        }),
      ),
    ).toBe(false);
    expect(
      isSpanCostNonBillable(span({ resourceAttributes: { [NON_BILLABLE_ATTR]: "true" } })),
    ).toBe(true);
  });
});

describe("deriveSpanStorageCost", () => {
  it("returns nulls for a zero cost and rounds a positive one to six places", () => {
    expect(deriveSpanStorageCost({ span: span(), spanCost: 0 })).toEqual({
      cost: null,
      nonBilledCost: null,
    });
    expect(deriveSpanStorageCost({ span: span(), spanCost: 0.12345678 })).toEqual({
      cost: 0.123457,
      nonBilledCost: null,
    });
  });
});

describe("extractSpanTokenTiming", () => {
  it("prefers stream events and falls back to the semconv attribute", () => {
    const fromEvents = extractSpanTokenTiming(
      span({
        events: [
          { name: "first_token", timeUnixMs: 1200, attributes: {} },
          { name: "last_token", timeUnixMs: 1800, attributes: {} },
        ],
      }),
    );
    expect(fromEvents).toEqual({ timeToFirstToken: 200, timeToLastToken: 800 });

    const fromAttribute = extractSpanTokenTiming(
      span({ spanAttributes: { "gen_ai.server.time_to_first_token": 150 } }),
    );
    expect(fromAttribute).toEqual({ timeToFirstToken: 150, timeToLastToken: null });
  });
});

describe("accumulateSpanTokens", () => {
  it("adds the priced span into the trace totals", () => {
    const result = accumulateSpanTokens({
      state: emptyState,
      span: span({ spanAttributes: llmAttributes }),
      spanCost: 0.5,
      spanUnpriced: false,
      totalDurationMs: 1000,
    });
    expect(result).toMatchObject({
      totalPromptTokenCount: 1000,
      totalCompletionTokenCount: 500,
      totalCost: 0.5,
      nonBilledCost: null,
      tokensPerSecond: 500,
    });
  });

  describe("when the span is a redundant usage copy", () => {
    it("adds neither tokens nor cost", () => {
      const result = accumulateSpanTokens({
        state: emptyState,
        span: span({
          spanAttributes: {
            ...llmAttributes,
            "langwatch.reserved.skip_token_accumulation": true,
          },
        }),
        spanCost: 0.5,
        spanUnpriced: false,
        totalDurationMs: 1000,
      });
      expect(result.totalCost).toBeNull();
      expect(result.totalPromptTokenCount).toBeNull();
    });
  });
});

describe("deriveSpanRollupContribution", () => {
  it("attributes an erroring root span's cost, tokens and duration", () => {
    const contribution = deriveSpanRollupContribution({
      span: span({
        statusCode: NormalizedStatusCode.ERROR,
        resourceAttributes: { [NON_BILLABLE_ATTR]: "true" },
        spanAttributes: llmAttributes,
      }),
      spanCost: 0.25,
    });
    expect(contribution).toEqual({
      model: "gpt-resp",
      spanType: "llm",
      spanCount: 1,
      traceCount: 1,
      errorCount: 1,
      costSum: 0.25,
      nonBilledCostSum: 0.25,
      durationSum: 1000,
      promptTokensSum: 1000,
      completionTokensSum: 500,
      cacheReadTokensSum: 0,
      cacheWriteTokensSum: 0,
      reasoningTokensSum: 0,
    });
  });

  it("gives a child span no trace, error or duration share", () => {
    const contribution = deriveSpanRollupContribution({
      span: span({ parentSpanId: "parent", statusCode: NormalizedStatusCode.ERROR }),
      spanCost: 0,
    });
    expect(contribution).toMatchObject({
      model: "",
      spanType: "",
      traceCount: 0,
      errorCount: 0,
      durationSum: 0,
    });
  });
});

describe("deriveRagContextsWithIds", () => {
  it("keeps an existing id and hashes the content of an entry without one", () => {
    const contexts = deriveRagContextsWithIds({
      "langwatch.rag.contexts": [{ document_id: "keep", content: "a" }, { content: "chunk" }],
    });
    expect(contexts).toEqual([
      { document_id: "keep", content: "a" },
      { content: "chunk", document_id: ragDocumentIdFor("chunk") },
    ]);
  });

  it("answers undefined when the span carries no contexts", () => {
    expect(deriveRagContextsWithIds({})).toBeUndefined();
  });
});

describe("deriveSpanPriceInput", () => {
  it("hands the price lookup the span's attributes, first model and token counts", () => {
    const priced = span({ spanAttributes: llmAttributes });

    expect(deriveSpanPriceInput(priced)).toEqual({
      attributes: priced.spanAttributes,
      model: "gpt-resp",
      promptTokens: 1000,
      completionTokens: 500,
    });
  });

  it("names no model when the span carries none", () => {
    expect(deriveSpanPriceInput(span()).model).toBeUndefined();
  });
});
