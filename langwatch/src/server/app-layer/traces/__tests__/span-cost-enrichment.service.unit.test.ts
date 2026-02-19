import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  OtlpSpanCostEnrichmentService,
  type OtlpSpanCostEnrichmentServiceDependencies,
} from "../span-cost-enrichment.service";

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
    matchModelCost: vi.fn((model: string, costs: MaybeStoredLLMModelCost[]) => {
      return costs.find((c) => new RegExp(c.regex).test(model));
    }),
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
  });
});
