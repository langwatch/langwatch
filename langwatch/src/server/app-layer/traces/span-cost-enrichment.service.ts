import { matchingLLMModelCost } from "~/server/background/workers/collector/cost";
import { prisma } from "~/server/db";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

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
  getCustomModelCosts: (projectId: string) => Promise<MaybeStoredLLMModelCost[]>;
  matchModelCost: typeof matchingLLMModelCost;
}

/** Cached default dependencies, lazily initialized */
let cachedDefaultDependencies: OtlpSpanCostEnrichmentServiceDependencies | null = null;

function getDefaultDependencies(): OtlpSpanCostEnrichmentServiceDependencies {
  if (!cachedDefaultDependencies) {
    cachedDefaultDependencies = {
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
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
        }));
      },
      matchModelCost: matchingLLMModelCost,
    };
  }
  return cachedDefaultDependencies;
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

  constructor(deps: Partial<OtlpSpanCostEnrichmentServiceDependencies> = {}) {
    this.deps = { ...getDefaultDependencies(), ...deps };
  }

  /**
   * Enriches span with custom cost rates if a matching custom model cost exists.
   * Mutates the span in place (pushes new attributes).
   *
   * @param span - The OTLP span to enrich
   * @param tenantId - The project ID to look up custom costs for
   */
  async enrichSpan(span: OtlpSpan, tenantId: string): Promise<void> {
    const modelName = this.extractModelName(span);
    if (!modelName) return;

    const customCosts = await this.deps.getCustomModelCosts(tenantId);
    if (customCosts.length === 0) return;

    const matched = this.deps.matchModelCost(modelName, customCosts);
    if (!matched) return;

    span.attributes.push(
      {
        key: "langwatch.model.inputCostPerToken",
        value: { doubleValue: matched.inputCostPerToken ?? 0 },
      },
      {
        key: "langwatch.model.outputCostPerToken",
        value: { doubleValue: matched.outputCostPerToken ?? 0 },
      },
    );
  }

  private extractModelName(span: OtlpSpan): string | null {
    for (const key of MODEL_ATTRIBUTE_KEYS) {
      for (const attr of span.attributes) {
        if (
          attr.key === key &&
          typeof attr.value.stringValue === "string" &&
          attr.value.stringValue.length > 0
        ) {
          return attr.value.stringValue;
        }
      }
    }
    return null;
  }
}
