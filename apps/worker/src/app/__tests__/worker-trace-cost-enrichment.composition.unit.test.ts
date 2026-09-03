import type { ModelCost, ModelProviderService } from "@langwatch/model-provider-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceSpanCostEnrichmentPort } from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTraceCostEnrichment } from "../worker-trace-cost-enrichment.composition";
import { createWorkerTraceModelCostCatalogPort } from "../worker-trace-narrow-ports.composition";

/**
 * Spec: packages/features/trace/specs/record-time-cost-enrichment.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so nothing in this
 * process enriches a span. What has to be true today is that this composition
 * root can build the whole record-time pricing path out of a published
 * `ModelProviderService` — and that the path really does run THROUGH the narrow
 * port, because the port is what made the enrichment composable at all.
 */

function span(model: string, name = "test-span"): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name,
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes: [{ key: "gen_ai.request.model", value: { stringValue: model } }],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

const projectRule: ModelCost = {
  id: "cost-1",
  organizationId: "org-1",
  projectId: null,
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  model: "gpt-5-mini",
  regex: "^gpt-5-mini$",
  inputCostPerToken: 0.000_25,
  outputCostPerToken: 0.002,
  cacheReadCostPerToken: 0.000_025,
  cacheCreationCostPerToken: null,
  cacheCreation1hCostPerToken: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function catalogFromPublishedService(costs: ModelCost[] = [projectRule]): {
  modelCosts: ReturnType<typeof createWorkerTraceModelCostCatalogPort>;
  listCosts: ReturnType<typeof vi.fn>;
} {
  const listCosts = vi.fn(async (_input: { projectId: string }) => costs);
  const modelProviders = { listCosts } as unknown as ModelProviderService;
  return { modelCosts: createWorkerTraceModelCostCatalogPort(modelProviders), listCosts };
}

describe("createWorkerTraceCostEnrichment", () => {
  describe("given only a published model-provider service", () => {
    describe("when the enrichment graph is composed", () => {
      /** @scenario "Record-time cost enrichment composes from the catalog port alone" */
      it("answers the narrow port the record command names", () => {
        const { modelCosts } = catalogFromPublishedService();

        const graph = createWorkerTraceCostEnrichment({ modelCosts });

        expect(graph.spanCostEnrichmentPort()).toBeInstanceOf(TraceSpanCostEnrichmentPort);
      });

      /** @scenario "The composed path prices a span from the operator's own rules" */
      it("stamps the operator's rates on a span, through the port", async () => {
        const { modelCosts, listCosts } = catalogFromPublishedService();
        const graph = createWorkerTraceCostEnrichment({ modelCosts });
        const target = span("gpt-5-mini");

        await graph.spanCostEnrichmentPort().enrich(target, "project-7");

        expect(listCosts).toHaveBeenCalledWith({ projectId: "project-7" });
        expect(
          target.attributes
            .filter((attr) => attr.key.startsWith("langwatch.model."))
            .map((attr) => [attr.key, attr.value.doubleValue]),
        ).toEqual([
          ["langwatch.model.inputCostPerToken", 0.000_25],
          ["langwatch.model.outputCostPerToken", 0.002],
          ["langwatch.model.cacheReadCostPerToken", 0.000_025],
        ]);
      });

      /**
       * @scenario "An organization-scoped rule prices a project's spans"
       *
       * The rule above is stored against the ORGANIZATION and carries a null
       * legacy `projectId`. A read that filtered on the column would return
       * nothing and the span would be stored unpriced — which reads exactly
       * like a project that set no rules at all.
       */
      it("prices a span from a rule saved above the project", async () => {
        const { modelCosts } = catalogFromPublishedService();
        const graph = createWorkerTraceCostEnrichment({ modelCosts });
        const target = span("gpt-5-mini");

        await graph.spanCostEnrichmentPort().enrich(target, "project-7");

        expect(
          target.attributes.some((attr) => attr.key === "langwatch.model.inputCostPerToken"),
        ).toBe(true);
      });

      /** @scenario "A project with no rules leaves the span unpriced" */
      it("stamps nothing when the catalog is empty", async () => {
        const { modelCosts } = catalogFromPublishedService([]);
        const graph = createWorkerTraceCostEnrichment({ modelCosts });
        const target = span("gpt-5-mini");

        await graph.spanCostEnrichmentPort().enrich(target, "project-7");

        expect(target.attributes.map((attr) => attr.key)).toEqual(["gen_ai.request.model"]);
      });
    });
  });
});
