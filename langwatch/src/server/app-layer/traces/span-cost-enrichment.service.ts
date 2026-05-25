import type { PrismaClient } from "@prisma/client";
import { matchModelCostWithFallbacks } from "~/server/background/workers/collector/cost";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import { extractModelName } from "./utils/spanModel";

/**
 * Attribute keys that may contain model names (checked in priority order).
 */
const MODEL_ATTRIBUTE_KEYS = [
  "gen_ai.request.model",
  "gen_ai.response.model",
  "llm.model_name",
  "ai.model",
] as const;

/**
 * Dependencies for OtlpSpanCostEnrichmentService that can be injected for testing.
 */
export interface OtlpSpanCostEnrichmentServiceDependencies {
  getCustomModelCosts: (
    projectId: string,
  ) => Promise<MaybeStoredLLMModelCost[]>;
}

/**
 * Creates default dependencies from a Prisma client.
 */
export function createCostEnrichmentDeps(
  prisma: PrismaClient,
): OtlpSpanCostEnrichmentServiceDependencies {
  return {
    getCustomModelCosts: async (projectId: string) => {
      const records = await prisma.customLLMModelCost.findMany({
        where: { projectId },
      });
      return records.map((r) => ({
        id: r.id,
        projectId,
        model: r.model,
        regex: r.regex,
        inputCostPerToken: r.inputCostPerToken ?? undefined,
        outputCostPerToken: r.outputCostPerToken ?? undefined,
        cacheReadCostPerToken: r.cacheReadCostPerToken ?? undefined,
        cacheCreationCostPerToken: r.cacheCreationCostPerToken ?? undefined,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
    },
  };
}

/**
 * Service that enriches OTLP spans with custom LLM cost rates from the database.
 *
 * When a project has custom model pricing configured, this service sets
 * `langwatch.model.inputCostPerToken` and `langwatch.model.outputCostPerToken`
 * attributes on the span so the fold projection can use them for cost computation.
 *
 * This service should be applied BEFORE creating immutable events
 * in the event sourcing pipeline (alongside PII redaction).
 */
export class OtlpSpanCostEnrichmentService {
  private readonly deps: OtlpSpanCostEnrichmentServiceDependencies;

  constructor(deps: OtlpSpanCostEnrichmentServiceDependencies) {
    this.deps = deps;
  }

  /**
   * Enriches span with custom cost rates if a matching custom model cost exists.
   * Mutates the span in place (pushes new attributes).
   *
   * @param span - The OTLP span to enrich
   * @param tenantId - The project ID to look up custom costs for
   */
  async enrichSpan(span: OtlpSpan, tenantId: string): Promise<void> {
    const modelName = extractModelName(span, MODEL_ATTRIBUTE_KEYS);
    if (!modelName) return;

    const customCosts = await this.deps.getCustomModelCosts(tenantId);
    if (customCosts.length === 0) return;

    const matched = matchModelCostWithFallbacks(modelName, customCosts);
    if (!matched) return;

    span.attributes.push(
      {
        key: ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN,
        value: { doubleValue: matched.inputCostPerToken ?? 0 },
      },
      {
        key: ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN,
        value: { doubleValue: matched.outputCostPerToken ?? 0 },
      },
    );

    // Only emit cache-rate overrides when the custom cost defines them, so a
    // model without an explicit cache rate keeps falling back to the input
    // rate in the fold projection rather than being priced at zero.
    if (matched.cacheReadCostPerToken != null) {
      span.attributes.push({
        key: ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN,
        value: { doubleValue: matched.cacheReadCostPerToken },
      });
    }
    if (matched.cacheCreationCostPerToken != null) {
      span.attributes.push({
        key: ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN,
        value: { doubleValue: matched.cacheCreationCostPerToken },
      });
    }
  }

}
