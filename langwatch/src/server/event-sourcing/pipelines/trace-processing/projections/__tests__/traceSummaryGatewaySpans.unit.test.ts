import { describe, expect, it } from "vitest";
import {
  GATEWAY_SPANS_OVERFLOW_ATTR,
  MAX_GATEWAY_SPANS,
  appendGatewaySpan,
  buildGatewaySpanEntry,
  parseGatewaySpans,
  type GatewaySpanEntry,
} from "../services/gateway-spans.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";
import { NormalizedStatusCode } from "../../schemas/spans";

function gatewaySpan(requestId: string, extra: Record<string, unknown> = {}) {
  return createTestSpan({
    spanId: `span-${requestId}`,
    spanAttributes: {
      "langwatch.gateway_request_id": requestId,
      "langwatch.virtual_key_id": "vk-1",
      "gen_ai.request.model": "openai/gpt-5-mini",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 20,
      ...extra,
    },
  });
}

describe("trace summary gateway span bookkeeping", () => {
  describe("when gateway spans fold into one trace", () => {
    /** @scenario N requests under one client traceparent produce N spend records */
    it("keeps one entry per request, each under its own id", () => {
      let state = createInitState();
      state = applySpanToSummary({ state, span: gatewaySpan("req-1") });
      state = applySpanToSummary({ state, span: gatewaySpan("req-2") });
      state = applySpanToSummary({ state, span: gatewaySpan("req-3") });

      const entries = parseGatewaySpans(state.attributes);
      expect(entries.map((e) => e.requestId)).toEqual([
        "req-1",
        "req-2",
        "req-3",
      ]);
      // The first-wins attribute still only carries the first request; the
      // list is what preserves the rest.
      expect(state.attributes["langwatch.gateway_request_id"]).toBe("req-1");
    });

    it("re-applying the same span does not duplicate its entry", () => {
      let state = createInitState();
      state = applySpanToSummary({ state, span: gatewaySpan("req-1") });
      state = applySpanToSummary({ state, span: gatewaySpan("req-1") });

      expect(parseGatewaySpans(state.attributes)).toHaveLength(1);
    });

    it("non-gateway spans produce no entry", () => {
      const state = applySpanToSummary({
        state: createInitState(),
        span: createTestSpan({
          spanAttributes: { "gen_ai.usage.input_tokens": 5 },
        }),
      });
      expect(parseGatewaySpans(state.attributes)).toHaveLength(0);
    });
  });

  describe("what one entry carries", () => {
    it("carries per-span token classes including cache read and write", () => {
      const state = applySpanToSummary({
        state: createInitState(),
        span: gatewaySpan("req-1", {
          "gen_ai.usage.cache_read.input_tokens": 20540,
          "gen_ai.usage.cache_creation.input_tokens": 22994,
        }),
      });

      const [entry] = parseGatewaySpans(state.attributes);
      expect(entry).toMatchObject({
        requestId: "req-1",
        virtualKeyId: "vk-1",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 20540,
        cacheWriteTokens: 22994,
      });
    });

    /** @scenario The provider id rides the spend record when the span carries it */
    it("carries the model provider id when stamped, empty otherwise", () => {
      let state = applySpanToSummary({
        state: createInitState(),
        span: gatewaySpan("req-1", {
          "langwatch.model_provider_id": "mp-123",
        }),
      });
      state = applySpanToSummary({ state, span: gatewaySpan("req-2") });

      const entries = parseGatewaySpans(state.attributes);
      expect(entries[0]!.modelProviderId).toBe("mp-123");
      expect(entries[1]!.modelProviderId).toBe("");
    });

    /** @scenario A failed request keeps its rich error class and http status */
    it("keeps the error class and upstream http status on failure", () => {
      const span = createTestSpan({
        statusCode: NormalizedStatusCode.ERROR,
        spanAttributes: {
          "langwatch.gateway_request_id": "req-err",
          "langwatch.virtual_key_id": "vk-1",
          "error.type": "provider_timeout",
          "http.response.status_code": 504,
        },
      });
      const state = applySpanToSummary({ state: createInitState(), span });

      const [entry] = parseGatewaySpans(state.attributes);
      expect(entry).toMatchObject({
        status: "error",
        errorClass: "provider_timeout",
        httpStatus: 504,
      });
    });

    /** @scenario Spend records anchor to request time, not ingest time */
    it("anchors occurred-at to the span's own start time", () => {
      const span = gatewaySpan("req-1");
      const state = applySpanToSummary({ state: createInitState(), span });
      const [entry] = parseGatewaySpans(state.attributes);
      expect(entry!.occurredAtMs).toBe(span.startTimeUnixMs);
      expect(entry!.durationMs).toBe(
        span.endTimeUnixMs - span.startTimeUnixMs,
      );
    });
  });

  describe("bounds and garbage tolerance", () => {
    it("caps the list and raises the overflow flag past the cap", () => {
      const attributes: Record<string, string> = {};
      for (let i = 0; i < MAX_GATEWAY_SPANS + 5; i++) {
        appendGatewaySpan(attributes, entryFixture(`req-${i}`));
      }
      expect(parseGatewaySpans(attributes)).toHaveLength(MAX_GATEWAY_SPANS);
      expect(attributes[GATEWAY_SPANS_OVERFLOW_ATTR]).toBe("true");
    });

    it("parses garbage as an empty list instead of throwing", () => {
      expect(
        parseGatewaySpans({ "langwatch.reserved.gateway_spans": "{not json" }),
      ).toEqual([]);
      expect(
        parseGatewaySpans({
          "langwatch.reserved.gateway_spans": JSON.stringify([{ nope: 1 }]),
        }),
      ).toEqual([]);
    });

    it("builds no entry when the gateway markers are missing", () => {
      expect(
        buildGatewaySpanEntry({
          span: createTestSpan({
            spanAttributes: { "langwatch.virtual_key_id": "vk-1" },
          }),
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          model: "m",
        }),
      ).toBeNull();
    });
  });
});

function entryFixture(requestId: string): GatewaySpanEntry {
  return {
    requestId,
    virtualKeyId: "vk-1",
    model: "m",
    modelProviderId: "",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.001,
    status: "success",
    errorClass: "",
    httpStatus: 0,
    endUserId: "",
    occurredAtMs: 1000,
    durationMs: 10,
  };
}
