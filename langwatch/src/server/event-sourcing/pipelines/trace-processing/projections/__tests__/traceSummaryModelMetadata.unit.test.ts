/**
 * @vitest-environment node
 *
 * Pins the trace-level model metadata stamp: the fold derives
 * `metadata.model` (primary = most recently used model, `models[0]`) and
 * `metadata.models` (the full set, most-recent-first) from its spans'
 * gen_ai model attributes. Regression: `trace.metadata.model` was null on
 * ALL traces because the model only ever lived at span level.
 *
 * User-provided `metadata.model` must keep winning over the stamp.
 */
import { describe, expect, it } from "vitest";
import { mapAttributesToMetadata } from "~/server/traces/mappers/trace-summary.mapper";
import {
  applySpanToAnalytics,
  TraceAnalyticsFoldProjection,
} from "../traceAnalytics.foldProjection";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

function llmSpan(id: string, model: string) {
  return createTestSpan({
    id,
    spanId: id,
    spanAttributes: {
      "gen_ai.request.model": model,
      "gen_ai.response.model": model,
      "langwatch.span.type": "llm",
    },
  });
}

describe("trace-level model metadata stamping", () => {
  describe("when a multi-model trace folds spans on three models", () => {
    it("stamps metadata.model with the primary and metadata.models with the full set", () => {
      let state = applySpanToSummary({
        state: createInitState(),
        span: llmSpan("s1", "claude-opus-5"),
      });
      state = applySpanToSummary({
        state,
        span: llmSpan("s2", "claude-sonnet-4-5"),
      });
      // The [1m] context-window suffix survives ingestion and stays distinct.
      state = applySpanToSummary({
        state,
        span: llmSpan("s3", "claude-opus-5[1m]"),
      });

      // Primary = most recently used model = models[0].
      expect(state.attributes["metadata.model"]).toBe("claude-opus-5[1m]");
      expect(JSON.parse(state.attributes["metadata.models"]!)).toEqual([
        "claude-opus-5[1m]",
        "claude-sonnet-4-5",
        "claude-opus-5",
      ]);
    });

    it("keeps the stamp in sync as later spans introduce new models", () => {
      let state = applySpanToSummary({
        state: createInitState(),
        span: llmSpan("s1", "claude-opus-5"),
      });
      expect(state.attributes["metadata.model"]).toBe("claude-opus-5");

      state = applySpanToSummary({
        state,
        span: llmSpan("s2", "claude-haiku-4-5"),
      });
      expect(state.attributes["metadata.model"]).toBe("claude-haiku-4-5");
      expect(JSON.parse(state.attributes["metadata.models"]!)).toEqual([
        "claude-haiku-4-5",
        "claude-opus-5",
      ]);
    });
  });

  describe("when the user provides metadata.model themselves", () => {
    it("does not clobber the user's value", () => {
      const userSpan = createTestSpan({
        id: "s1",
        spanId: "s1",
        spanAttributes: {
          "gen_ai.request.model": "claude-opus-5",
          "metadata.model": "my-custom-router",
        },
      });
      let state = applySpanToSummary({
        state: createInitState(),
        span: userSpan,
      });
      expect(state.attributes["metadata.model"]).toBe("my-custom-router");

      // A later span without user metadata still must not overwrite it.
      state = applySpanToSummary({
        state,
        span: llmSpan("s2", "claude-sonnet-4-5"),
      });
      expect(state.attributes["metadata.model"]).toBe("my-custom-router");
      expect(state.attributes["metadata.models"]).toBeUndefined();
    });
  });

  describe("when the trace has no model on any span", () => {
    it("stamps nothing", () => {
      const state = applySpanToSummary({
        state: createInitState(),
        span: createTestSpan({
          spanAttributes: { "langwatch.span.type": "agent" },
        }),
      });
      expect(state.attributes["metadata.model"]).toBeUndefined();
      expect(state.attributes["metadata.models"]).toBeUndefined();
    });
  });

  describe("slim analytics fold", () => {
    it("stamps the same metadata as the trace-summary fold", () => {
      const projection = new TraceAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      let state = projection.init();
      state = applySpanToAnalytics({ state, span: llmSpan("s1", "claude-opus-5") });
      state = applySpanToAnalytics({
        state,
        span: llmSpan("s2", "claude-sonnet-4-5"),
      });
      expect(state.attributes["metadata.model"]).toBe("claude-sonnet-4-5");
      expect(JSON.parse(state.attributes["metadata.models"]!)).toEqual([
        "claude-sonnet-4-5",
        "claude-opus-5",
      ]);
    });
  });

  describe("read-side metadata mapping", () => {
    it("surfaces model as a string and models as an array, hiding the stamp marker", () => {
      let state = applySpanToSummary({
        state: createInitState(),
        span: llmSpan("s1", "claude-opus-5"),
      });
      state = applySpanToSummary({
        state,
        span: llmSpan("s2", "claude-opus-5[1m]"),
      });

      const metadata = mapAttributesToMetadata(state.attributes, null, null);
      expect(metadata.model).toBe("claude-opus-5[1m]");
      expect(metadata.models).toEqual(["claude-opus-5[1m]", "claude-opus-5"]);
      expect(
        metadata["langwatch.reserved.model_metadata_stamped"],
      ).toBeUndefined();
    });
  });
});
