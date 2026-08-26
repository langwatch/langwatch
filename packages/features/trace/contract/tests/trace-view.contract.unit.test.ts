import { describe, expect, it } from "vitest";
import {
  conversationContextSchema,
  spanDetailSchema,
  spanLangwatchSignalsSchema,
  traceHeaderSchema,
  traceResourceInfoSchema,
} from "../src";

describe("trace view contract", () => {
  it("keeps trace header defaults used by cached and older responses", () => {
    const header = traceHeaderSchema.parse({
      traceId: "trace-1",
      timestamp: 1,
      name: "trace",
      serviceName: "service",
      origin: "sdk",
      conversationId: null,
      userId: null,
      durationMs: 2,
      spanCount: 1,
      status: "ok",
      models: [],
      totalCost: null,
      totalTokens: 0,
      inputTokens: null,
      outputTokens: null,
      tokensEstimated: false,
      traceName: "trace",
      rootSpanType: null,
      scenarioRunId: null,
      attributes: {},
    });

    expect(header).toMatchObject({
      containsPrompt: false,
      nonBilledCost: 0,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
    });
  });

  it("keeps privacy, arbitrary detail values, and resource scope nullability", () => {
    const detail = spanDetailSchema.parse({
      spanId: "span-1",
      parentSpanId: null,
      name: "span",
      type: "llm",
      startTimeMs: 1,
      endTimeMs: 2,
      durationMs: 1,
      status: "ok",
      events: [],
      contentPrivacy: {
        input: { state: "visible", visibleTo: null },
        output: { state: "restricted", visibleTo: "Admins" },
        system: { state: "dropped", visibleTo: null },
        tools: { state: "visible", visibleTo: null },
      },
      params: { provider: { nested: true } },
    });
    const resources = traceResourceInfoSchema.parse({
      rootSpanId: null,
      resourceAttributes: {},
      scope: null,
      spans: [],
    });

    expect(detail.contentPrivacy?.output).toEqual({
      state: "restricted",
      visibleTo: "Admins",
    });
    expect(resources.scope).toBeNull();
  });

  it("locks the public response fields used by trace transports", () => {
    expect(Object.keys(traceHeaderSchema.shape)).toEqual([
      "traceId",
      "timestamp",
      "name",
      "serviceName",
      "origin",
      "conversationId",
      "userId",
      "durationMs",
      "spanCount",
      "status",
      "error",
      "input",
      "output",
      "inputRedacted",
      "outputRedacted",
      "inputVisibleTo",
      "outputVisibleTo",
      "redactedByVisibilityWindow",
      "models",
      "totalCost",
      "nonBilledCost",
      "totalTokens",
      "inputTokens",
      "outputTokens",
      "tokensEstimated",
      "ttft",
      "traceName",
      "rootSpanType",
      "scenarioRunId",
      "containsPrompt",
      "selectedPromptId",
      "selectedPromptSpanId",
      "lastUsedPromptId",
      "lastUsedPromptVersionNumber",
      "lastUsedPromptVersionId",
      "lastUsedPromptSpanId",
      "attributes",
      "privacy",
    ]);
    expect(Object.keys(spanDetailSchema.shape)).toEqual([
      "spanId",
      "parentSpanId",
      "name",
      "type",
      "startTimeMs",
      "endTimeMs",
      "durationMs",
      "status",
      "model",
      "vendor",
      "input",
      "output",
      "inputRedacted",
      "outputRedacted",
      "inputVisibleTo",
      "outputVisibleTo",
      "contentPrivacy",
      "piiAnalysisIncomplete",
      "restrictedAttributes",
      "error",
      "metrics",
      "params",
      "events",
      "costSuggestion",
    ]);
    expect(Object.keys(spanLangwatchSignalsSchema.shape)).toEqual(["spanId", "signals"]);
    expect(Object.keys(conversationContextSchema.shape)).toEqual([
      "conversationId",
      "total",
      "turns",
    ]);
    expect(Object.keys(traceResourceInfoSchema.shape)).toEqual([
      "rootSpanId",
      "resourceAttributes",
      "scope",
      "spans",
    ]);
  });
});
