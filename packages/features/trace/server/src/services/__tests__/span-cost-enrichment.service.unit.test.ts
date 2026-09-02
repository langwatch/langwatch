import type { ModelCost } from "@langwatch/model-provider-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { TraceModelCostCatalogPort } from "../../ports/trace-model-cost-catalog.port";
import { OtlpSpanCostEnrichmentService } from "../span-cost-enrichment.service";

/**
 * Spec: packages/features/trace/specs/record-time-cost-enrichment.feature
 *
 * The pins here are LITERALS, not reads of the application's source. Every one
 * of them fails silently in the direction of billing: a span enriched from the
 * wrong rule, or from no rule at all, is stored with a cost attribute that no
 * reader can tell apart from a correct one.
 */

function span(
  attributes: Array<{ key: string; value: { stringValue?: string; doubleValue?: number } }> = [],
  name = "test-span",
): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name,
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function cost(overrides: Partial<ModelCost> & { model: string; regex: string }): ModelCost {
  return {
    id: `cost-${overrides.model}`,
    organizationId: "org-1",
    projectId: "project-1",
    scopeType: "PROJECT",
    scopeId: "project-1",
    inputCostPerToken: null,
    outputCostPerToken: null,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function catalog(costs: ModelCost[]): {
  port: TraceModelCostCatalogPort;
  listCosts: ReturnType<typeof vi.fn>;
} {
  const listCosts = vi.fn(async (_input: { projectId: string }) => costs);
  class Fake extends TraceModelCostCatalogPort {
    listCosts(input: { projectId: string }): Promise<ModelCost[]> {
      return listCosts(input) as Promise<ModelCost[]>;
    }
  }
  return { port: new Fake(), listCosts };
}

function rates(enriched: OtlpSpan): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attr of enriched.attributes) {
    if (attr.key.startsWith("langwatch.model.")) result[attr.key] = attr.value.doubleValue;
  }
  return result;
}

describe("OtlpSpanCostEnrichmentService", () => {
  describe("given a project with a matching cost rule", () => {
    describe("when a span naming the model is enriched", () => {
      /** @scenario "A matched rule stamps both token rates" */
      it("stamps the input and output rates under the fold's own attribute keys", async () => {
        const { port } = catalog([
          cost({
            model: "gpt-4o",
            regex: "^gpt-4o$",
            inputCostPerToken: 0.000_005,
            outputCostPerToken: 0.000_015,
          }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({
          "langwatch.model.inputCostPerToken": 0.000_005,
          "langwatch.model.outputCostPerToken": 0.000_015,
        });
      });

      /** @scenario "A rule that leaves a cache rate unset stamps no cache rate" */
      it("omits a cache rate the rule does not define, rather than stamping zero", async () => {
        const { port } = catalog([
          cost({
            model: "gpt-4o",
            regex: "^gpt-4o$",
            inputCostPerToken: 0.000_005,
            outputCostPerToken: 0.000_015,
            cacheReadCostPerToken: 0.000_001,
          }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({
          "langwatch.model.inputCostPerToken": 0.000_005,
          "langwatch.model.outputCostPerToken": 0.000_015,
          "langwatch.model.cacheReadCostPerToken": 0.000_001,
        });
      });

      /** @scenario "Every cache rate the rule defines is stamped" */
      it("stamps all three cache rates when the rule defines all three", async () => {
        const { port } = catalog([
          cost({
            model: "claude",
            regex: "^claude",
            inputCostPerToken: 3,
            outputCostPerToken: 15,
            cacheReadCostPerToken: 0.3,
            cacheCreationCostPerToken: 3.75,
            cacheCreation1hCostPerToken: 6,
          }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([
          { key: "gen_ai.request.model", value: { stringValue: "claude-sonnet-4-6" } },
        ]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({
          "langwatch.model.inputCostPerToken": 3,
          "langwatch.model.outputCostPerToken": 15,
          "langwatch.model.cacheReadCostPerToken": 0.3,
          "langwatch.model.cacheCreationCostPerToken": 3.75,
          "langwatch.model.cacheCreation1hCostPerToken": 6,
        });
      });

      /** @scenario "A rule with only one token rate stamps the other as zero" */
      it("stamps a hard zero for a token rate the rule leaves unset", async () => {
        const { port } = catalog([
          cost({ model: "gpt-4o", regex: "^gpt-4o$", outputCostPerToken: 0.000_015 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({
          "langwatch.model.inputCostPerToken": 0,
          "langwatch.model.outputCostPerToken": 0.000_015,
        });
      });
    });
  });

  describe("given a span carrying several model attributes", () => {
    describe("when the enrichment picks one", () => {
      /**
       * @scenario "The request model wins over the response model"
       *
       * The twin the other way round is token estimation, which reads
       * `gen_ai.response.model` FIRST. The two orders are deliberate and this
       * pin is what keeps a well-meaning "make them consistent" from repricing
       * every span whose provider answers with a dated model id.
       */
      it("reads gen_ai.request.model before gen_ai.response.model", async () => {
        const { port } = catalog([
          cost({ model: "requested", regex: "^requested$", inputCostPerToken: 1 }),
          cost({ model: "answered", regex: "^answered$", inputCostPerToken: 2 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([
          { key: "gen_ai.response.model", value: { stringValue: "answered" } },
          { key: "gen_ai.request.model", value: { stringValue: "requested" } },
        ]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)["langwatch.model.inputCostPerToken"]).toBe(1);
      });

      /** @scenario "The four generic model keys are read in order" */
      it("falls through request, response, llm.model_name and ai.model in that order", async () => {
        const keys = [
          "gen_ai.request.model",
          "gen_ai.response.model",
          "llm.model_name",
          "ai.model",
        ];
        const matched: string[] = [];
        for (const [index, key] of keys.entries()) {
          const { port } = catalog([
            cost({ model: "m", regex: "^m$", inputCostPerToken: index + 1 }),
          ]);
          const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
          // Every key AFTER this one also carries a model, so a reader that
          // takes the last match rather than the first would stamp a
          // different rate.
          const target = span([
            { key, value: { stringValue: "m" } },
            ...keys.slice(index + 1).map((later) => ({
              key: later,
              value: { stringValue: "unpriced" },
            })),
          ]);

          await service.enrichSpan({ span: target, tenantId: "project-1" });
          matched.push(String(rates(target)["langwatch.model.inputCostPerToken"]));
        }

        expect(matched).toEqual(["1", "2", "3", "4"]);
      });
    });
  });

  describe("given a span whose only model attribute is the bare `model`", () => {
    describe("when the span is one of the two coding-agent spans", () => {
      /** @scenario "A coding-agent span may name its model under a bare `model`" */
      it("enriches claude_code.llm_request and session_task.turn", async () => {
        for (const name of ["claude_code.llm_request", "session_task.turn"]) {
          const { port } = catalog([
            cost({ model: "sonnet", regex: "^sonnet$", inputCostPerToken: 7 }),
          ]);
          const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
          const target = span([{ key: "model", value: { stringValue: "sonnet" } }], name);

          await service.enrichSpan({ span: target, tenantId: "project-1" });

          expect(rates(target)["langwatch.model.inputCostPerToken"]).toBe(7);
        }
      });
    });

    describe("when the span is any other span", () => {
      /**
       * @scenario "A generic span's bare `model` never activates a cost rule"
       *
       * `model` is a common attribute key far outside coding-agent telemetry,
       * and what this service writes outranks even a reported cost. Reading it
       * everywhere would turn a customer's existing rule live against traffic
       * it never matched, with no migration and no signal.
       */
      it("leaves the span untouched", async () => {
        const { port, listCosts } = catalog([
          cost({ model: "sonnet", regex: "^sonnet$", inputCostPerToken: 7 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "model", value: { stringValue: "sonnet" } }], "my-llm-call");

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({});
        expect(listCosts).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the fallback cascade", () => {
    describe("when the raw model name does not match a rule", () => {
      /** @scenario "The matcher falls back in a fixed order" */
      it.each([
        ["raw", "gpt-4o", "^gpt-4o$"],
        ["case-normalized", "GPT-4O", "^gpt-4o$"],
        ["provider-prefixed", "openai/gpt-4o", "^gpt-4o$"],
        ["subtype-stripped", "openai.responses/gpt-4o", "^openai/gpt-4o$"],
        ["bedrock-enveloped", "eu.anthropic.claude-haiku-4-5-v1:0", "^anthropic/claude-haiku-4-5$"],
        ["litellm-bedrock", "bedrock/us.anthropic.claude-haiku-4-5-v1:0", "^anthropic/claude"],
        ["quantized", "deepseek-ai/deepseek-v3-fp8", "^deepseek/deepseek-v3$"],
      ])("matches a %s model name", async (_shape, model, regex) => {
        const { port } = catalog([cost({ model: "rule", regex, inputCostPerToken: 42 })]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: model } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)["langwatch.model.inputCostPerToken"]).toBe(42);
      });

      /**
       * @scenario "The raw name is tried against every rule before any
       * transformed name is tried against any rule"
       *
       * The rule that only matches the SUBTYPE-STRIPPED name is listed FIRST,
       * so a matcher that ran the passes in the other order — every candidate
       * name against one rule, rule by rule — would pick it. Swapping those
       * two loops bills the span at the other rule's rate and leaves nothing
       * behind to show that it happened.
       */
      it("prefers a rule matching the raw name over one matching only the stripped name", async () => {
        const { port } = catalog([
          cost({ model: "stripped-only", regex: "^openai/gpt-4o$", inputCostPerToken: 1 }),
          cost({ model: "raw", regex: "^openai\\.responses/gpt-4o$", inputCostPerToken: 2 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([
          { key: "gen_ai.request.model", value: { stringValue: "openai.responses/gpt-4o" } },
        ]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)["langwatch.model.inputCostPerToken"]).toBe(2);
      });
    });

    describe("when a rule's regex is unsafe", () => {
      /** @scenario "A rule whose regex can backtrack catastrophically never matches" */
      it("skips the rule instead of running it against the model name", async () => {
        const { port } = catalog([
          cost({ model: "evil", regex: "(a+)+$", inputCostPerToken: 1 }),
          cost({ model: "safe", regex: "^aaaa$", inputCostPerToken: 2 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: "aaaa" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)["langwatch.model.inputCostPerToken"]).toBe(2);
      });
    });
  });

  describe("given a span with no model attribute", () => {
    describe("when enrichment runs", () => {
      /** @scenario "A span with no model never reads the catalog" */
      it("does not read the project's cost rules at all", async () => {
        const { port, listCosts } = catalog([
          cost({ model: "gpt-4o", regex: "^gpt-4o$", inputCostPerToken: 1 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "http.method", value: { stringValue: "POST" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(listCosts).not.toHaveBeenCalled();
        expect(rates(target)).toEqual({});
      });
    });
  });

  describe("given a project with no matching rule", () => {
    describe("when enrichment runs", () => {
      /** @scenario "An unmatched model is left unpriced" */
      it("leaves the span without cost attributes", async () => {
        const { port } = catalog([
          cost({ model: "gpt-4o", regex: "^gpt-4o$", inputCostPerToken: 1 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([
          { key: "gen_ai.request.model", value: { stringValue: "claude-opus-4-5" } },
        ]);

        await service.enrichSpan({ span: target, tenantId: "project-1" });

        expect(rates(target)).toEqual({});
      });
    });
  });

  describe("given the catalog read", () => {
    describe("when enrichment runs for a project", () => {
      /**
       * @scenario "The catalog is read for the ingesting project"
       *
       * The port's implementation resolves the PROJECT -> TEAM -> ORGANIZATION
       * cascade behind this one id. Passing anything but the tenant here would
       * price the span against another project's rules.
       */
      it("asks the catalog port for the tenant's own rules", async () => {
        const { port, listCosts } = catalog([
          cost({ model: "gpt-4o", regex: "^gpt-4o$", inputCostPerToken: 1 }),
        ]);
        const service = OtlpSpanCostEnrichmentService.create({ modelCosts: port });
        const target = span([{ key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } }]);

        await service.enrichSpan({ span: target, tenantId: "project-9" });

        expect(listCosts).toHaveBeenCalledWith({ projectId: "project-9" });
      });
    });
  });
});
