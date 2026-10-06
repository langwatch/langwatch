/**
 * The span detail read offers a cost mapping for an unpriced model with token usage.
 * @see specs/traces-v2/span-unmapped-cost-suggestion.feature
 */
import type { ModelCost, ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { baseSpanSchema, lLMSpanSchema, type Span } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { openProtections } from "../../repositories/clickhouse/__tests__/open-protections.ts";
import { SpanCostSuggestionService } from "../../services/span-cost-suggestion.service.ts";
import type { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import type { TracesSpanReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const PROJECT_ID = "project-1";
const TRACE_ID = "trace-1";
const SPAN_ID = "span-1";
const UNPRICED_MODEL = "vertex_ai/gemini-3-pro-preview";

function customRule(regex: string): ModelCost {
  return {
    id: "cost-1",
    organizationId: "org-1",
    projectId: PROJECT_ID,
    scopeType: "PROJECT",
    scopeId: PROJECT_ID,
    model: "custom",
    regex,
    inputCostPerToken: 0.000001,
    outputCostPerToken: 0.000002,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function llmSpan({
  model,
  promptTokens,
  completionTokens,
  cost,
}: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}): Span {
  const shared = {
    span_id: SPAN_ID,
    trace_id: TRACE_ID,
    timestamps: { started_at: 1_000, finished_at: 1_010 },
    metrics: {
      ...(promptTokens === undefined ? {} : { prompt_tokens: promptTokens }),
      ...(completionTokens === undefined ? {} : { completion_tokens: completionTokens }),
      ...(cost === undefined ? {} : { cost }),
    },
  };
  return model === undefined
    ? baseSpanSchema.parse({ ...shared, type: "llm" })
    : lLMSpanSchema.parse({ ...shared, type: "llm", model });
}

async function readDetail({ span, rules = [] }: { span: Span; rules?: ModelCost[] }) {
  const listCosts = vi.fn(async () => rules);
  const app = createTraceAppHarness({
    protections: createApiFixture<TraceViewerProtectionService>(
      { resolve: async () => openProtections },
      "protections",
    ),
    spanCostSuggestions: SpanCostSuggestionService.create({
      modelProviders: createApiFixture<ModelProviderApi>({ listCosts }, "modelProviders"),
    }),
    traces: {
      spans: createApiFixture<TracesSpanReader>(
        { findSpanById: async () => span, getSpanEvents: async () => [] },
        "spans",
      ),
    },
  });
  const detail = await app.readSpanDetailForViewer({
    projectId: PROJECT_ID,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    viewerUserId: "viewer-1",
  });
  return { detail, listCosts };
}

describe("TraceModule.readSpanDetailForViewer cost suggestion", () => {
  /** @scenario Span with model and tokens but no cost shows a cost mapping suggestion */
  it("suggests the model when it has tokens, no cost and no matching rule", async () => {
    const { detail, listCosts } = await readDetail({
      span: llmSpan({ model: UNPRICED_MODEL, promptTokens: 10, completionTokens: 5 }),
    });

    expect(detail.costSuggestion).toEqual({ model: UNPRICED_MODEL });
    expect(listCosts).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  /** @scenario Span with a computed cost shows no suggestion */
  it("offers no suggestion when a cost was computed, without reading the rules", async () => {
    const { detail, listCosts } = await readDetail({
      span: llmSpan({ model: UNPRICED_MODEL, promptTokens: 10, completionTokens: 5, cost: 0.002 }),
    });

    expect(detail.costSuggestion).toBeNull();
    expect(listCosts).not.toHaveBeenCalled();
  });

  /** @scenario Span without token counts shows no suggestion */
  it("offers no suggestion when the span carries no token counts", async () => {
    const { detail, listCosts } = await readDetail({ span: llmSpan({ model: UNPRICED_MODEL }) });

    expect(detail.costSuggestion).toBeNull();
    expect(listCosts).not.toHaveBeenCalled();
  });

  /** @scenario Span without a model shows no suggestion */
  it("offers no suggestion when the span names no model", async () => {
    const { detail } = await readDetail({
      span: llmSpan({ promptTokens: 10, completionTokens: 5 }),
    });

    expect(detail.costSuggestion).toBeNull();
  });

  /** @scenario Span whose model a custom cost rule already matches shows no suggestion */
  it("offers no suggestion when a project rule matches the model", async () => {
    const { detail } = await readDetail({
      span: llmSpan({ model: UNPRICED_MODEL, promptTokens: 10, completionTokens: 5 }),
      rules: [customRule("^vertex_ai/gemini-3-pro-preview$")],
    });

    expect(detail.costSuggestion).toBeNull();
  });

  /** @scenario Span whose model the catalogue already prices shows no suggestion */
  it("offers no suggestion when the static catalogue prices the model", async () => {
    const { detail } = await readDetail({
      span: llmSpan({ model: "openai/gpt-5-mini", promptTokens: 10, completionTokens: 5 }),
    });

    expect(detail.costSuggestion).toBeNull();
  });
});
