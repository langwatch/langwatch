import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  OtlpSpanCostEnrichmentService,
  type OtlpSpanCostEnrichmentServiceDependencies,
} from "../span-cost-enrichment.service";
import {
  matchModelCostWithFallbacks,
  stripProviderSubtype,
} from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";

function createTestSpan(
  attributes: Array<{ key: string; value: { stringValue?: string; doubleValue?: number } }> = [],
): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1000000, high: 0 },
    attributes,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createMockDeps(
  customCosts: MaybeStoredLLMModelCost[] = [],
): OtlpSpanCostEnrichmentServiceDependencies {
  return {
    getCustomModelCosts: vi.fn().mockResolvedValue(customCosts),
  };
}

describe("OtlpSpanCostEnrichmentService", () => {
  describe("enrichSpan", () => {
    describe("when span has gen_ai.request.model and project has custom pricing", () => {
      it("sets cost rate attributes on the span", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "gpt-4o",
          regex: "^gpt-4o$",
          inputCostPerToken: 0.000005,
          outputCostPerToken: 0.000015,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toContainEqual({
          key: "langwatch.model.inputCostPerToken",
          value: { doubleValue: 0.000005 },
        });
        expect(span.attributes).toContainEqual({
          key: "langwatch.model.outputCostPerToken",
          value: { doubleValue: 0.000015 },
        });
      });
    });

    describe("when span has no model attribute", () => {
      it("returns without querying the database", async () => {
        const deps = createMockDeps();
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "some.other.attr", value: { stringValue: "value" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(deps.getCustomModelCosts).not.toHaveBeenCalled();
        expect(span.attributes).toHaveLength(1);
      });
    });

    describe("when model does not match custom pricing", () => {
      it("does not set cost rate attributes", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "gpt-4o",
          regex: "^gpt-4o$",
          inputCostPerToken: 0.000005,
          outputCostPerToken: 0.000015,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "claude-3-5-sonnet" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toHaveLength(1);
      });
    });

    describe("when custom pricing has 0 rates", () => {
      it("sets them (fold projection handles computation)", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "free-model",
          regex: "^free-model$",
          inputCostPerToken: 0,
          outputCostPerToken: 0,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "free-model" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toContainEqual({
          key: "langwatch.model.inputCostPerToken",
          value: { doubleValue: 0 },
        });
        expect(span.attributes).toContainEqual({
          key: "langwatch.model.outputCostPerToken",
          value: { doubleValue: 0 },
        });
      });
    });

    describe("when project has no custom costs", () => {
      it("does not set cost rate attributes", async () => {
        const deps = createMockDeps([]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toHaveLength(1);
      });
    });

    describe("when model is found via gen_ai.response.model", () => {
      it("uses the response model for matching", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "gpt-4o-2024-08-06",
          regex: "^gpt-4o-2024-08-06$",
          inputCostPerToken: 0.000003,
          outputCostPerToken: 0.000010,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.response.model", value: { stringValue: "gpt-4o-2024-08-06" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toHaveLength(3);
      });
    });

    describe("when model has provider subtype prefix", () => {
      it("falls back to base provider match", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "openai/gpt-5-mini",
          regex: "^(openai\\/)?gpt-5-mini",
          inputCostPerToken: 0.00000025,
          outputCostPerToken: 0.000002,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "openai.responses/gpt-5-mini" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toContainEqual({
          key: "langwatch.model.inputCostPerToken",
          value: { doubleValue: 0.00000025 },
        });
      });
    });

    describe("when model has provider subtype and date suffix", () => {
      it("falls back to base provider and matches via prefix regex", async () => {
        const customCost: MaybeStoredLLMModelCost = {
          projectId: "project-1",
          model: "openai/gpt-5-mini",
          regex: "^(openai\\/)?gpt-5-mini",
          inputCostPerToken: 0.00000025,
          outputCostPerToken: 0.000002,
        };
        const deps = createMockDeps([customCost]);
        const service = new OtlpSpanCostEnrichmentService(deps);
        const span = createTestSpan([
          { key: "gen_ai.request.model", value: { stringValue: "openai.responses/gpt-5-mini-2025-08-07" } },
        ]);

        await service.enrichSpan(span, "project-1");

        expect(span.attributes).toContainEqual({
          key: "langwatch.model.inputCostPerToken",
          value: { doubleValue: 0.00000025 },
        });
      });
    });
  });
});

describe("stripProviderSubtype", () => {
  it("strips subtype from provider prefix", () => {
    expect(stripProviderSubtype("openai.responses/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  it("strips subtype from azure.chat prefix", () => {
    expect(stripProviderSubtype("azure.chat/gpt-4o")).toBe("azure/gpt-4o");
  });

  it("leaves model without subtype unchanged", () => {
    expect(stripProviderSubtype("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  it("leaves model without provider prefix unchanged", () => {
    expect(stripProviderSubtype("gpt-4o")).toBe("gpt-4o");
  });
});

describe("matchModelCostWithFallbacks", () => {
  const costs: MaybeStoredLLMModelCost[] = [
    {
      projectId: "",
      model: "openai/gpt-5-mini",
      regex: "^(openai\\/)?gpt-5-mini",
      inputCostPerToken: 0.00000025,
      outputCostPerToken: 0.000002,
    },
  ];

  describe("when model has provider subtype and date suffix", () => {
    it("matches openai.responses/gpt-5-mini-2025-08-07 via subtype stripping + prefix regex", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        costs,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when model has provider subtype only", () => {
    it("matches openai.responses/gpt-5-mini via subtype stripping", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini",
        costs,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when model has date suffix only", () => {
    it("matches gpt-5-mini-2025-08-07 via prefix regex", () => {
      const result = matchModelCostWithFallbacks(
        "gpt-5-mini-2025-08-07",
        costs,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when exact match exists", () => {
    it("prefers the exact match over fallbacks", () => {
      const costsWithExact: MaybeStoredLLMModelCost[] = [
        {
          projectId: "",
          model: "openai.responses/gpt-5-mini-2025-08-07",
          regex: "^openai\\.responses\\/gpt-5-mini-2025-08-07$",
          inputCostPerToken: 0.001,
          outputCostPerToken: 0.002,
        },
        ...costs,
      ];
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        costsWithExact,
      );
      expect(result?.model).toBe("openai.responses/gpt-5-mini-2025-08-07");
    });
  });

  describe("with real model costs from the registry", () => {
    const realCosts = getStaticModelCosts();

    it("matches openai.responses/gpt-5-mini-2025-08-07 to openai/gpt-5-mini", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        realCosts,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });

    it("matches dated model already in registry without date stripping", () => {
      const result = matchModelCostWithFallbacks(
        "gpt-4o-2024-11-20",
        realCosts,
      );
      expect(result?.model).toBe("openai/gpt-4o-2024-11-20");
    });

    describe("when model has non-standard date suffixes (@regression)", () => {
      it("matches gpt-5.2-20260315 (YYYYMMDD) to openai/gpt-5.2", () => {
        const result = matchModelCostWithFallbacks("gpt-5.2-20260315", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });

      it("matches gpt-5.2-0315 (MMDD) to openai/gpt-5.2", () => {
        const result = matchModelCostWithFallbacks("gpt-5.2-0315", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });

      it("matches gpt-5.2-03-15 (MM-DD) to openai/gpt-5.2", () => {
        const result = matchModelCostWithFallbacks("gpt-5.2-03-15", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });

      it("matches mistral-small-2603 (YYMM) to mistralai/mistral-small-2603", () => {
        const result = matchModelCostWithFallbacks("mistral-small-2603", realCosts);
        expect(result?.model).toBe("mistralai/mistral-small-2603");
      });
    });

    describe("when model specificity matters (@regression)", () => {
      it("matches gpt-5-mini to openai/gpt-5-mini, not openai/gpt-5", () => {
        const result = matchModelCostWithFallbacks("gpt-5-mini", realCosts);
        expect(result?.model).toBe("openai/gpt-5-mini");
      });

      it("matches gpt-5.2-chat to openai/gpt-5.2-chat, not openai/gpt-5.2", () => {
        const result = matchModelCostWithFallbacks("gpt-5.2-chat", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2-chat");
      });
    });

    describe("when model has provider subtype and non-standard date suffix (@regression)", () => {
      it("matches openai.responses/gpt-5.2-0315 to openai/gpt-5.2", () => {
        const result = matchModelCostWithFallbacks("openai.responses/gpt-5.2-0315", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });

      it("matches openai.responses/gpt-5.3-chat-latest to openai/gpt-5.3-chat", () => {
        const result = matchModelCostWithFallbacks("openai.responses/gpt-5.3-chat-latest", realCosts);
        expect(result?.model).toBe("openai/gpt-5.3-chat");
      });
    });

    describe("when exact model string is used", () => {
      it("matches gpt-5.2 exactly", () => {
        const result = matchModelCostWithFallbacks("gpt-5.2", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });

      it("matches openai/gpt-5.2 with vendor prefix", () => {
        const result = matchModelCostWithFallbacks("openai/gpt-5.2", realCosts);
        expect(result?.model).toBe("openai/gpt-5.2");
      });
    });
  });
});
