import { matchingLLMModelCost } from "~/server/background/workers/collector/cost";
import type { PrismaClient } from "@prisma/client";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

const DATE_SUFFIX_RE = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Strips the provider subtype from a model string.
 * Example: "openai.responses/gpt-5-mini" → "openai/gpt-5-mini"
 */
export function stripProviderSubtype(model: string): string {
  const slashIdx = model.indexOf("/");
  if (slashIdx === -1) return model;
  const provider = model.slice(0, slashIdx);
  if (!provider.includes(".")) return model;
  return provider.split(".")[0] + model.slice(slashIdx);
}

/**
 * Strips a trailing date suffix (-YYYY-MM-DD) from a model string.
 * Example: "gpt-5-mini-2025-08-07" → "gpt-5-mini"
 */
export function stripDateSuffix(model: string): string {
  return model.replace(DATE_SUFFIX_RE, "");
}

/**
 * Tries to match a model against cost entries using cascading fallbacks:
 * 1. Exact model string (e.g. "openai.responses/gpt-5-mini-2025-08-07")
 * 2. Strip provider subtype (e.g. "openai/gpt-5-mini-2025-08-07")
 * 3. Strip date suffix (e.g. "openai.responses/gpt-5-mini")
 * 4. Strip both (e.g. "openai/gpt-5-mini")
 */
export function matchModelCostWithFallbacks(
  model: string,
  costs: MaybeStoredLLMModelCost[],
  matchFn: typeof matchingLLMModelCost,
): MaybeStoredLLMModelCost | undefined {
  const strippedSubtype = stripProviderSubtype(model);
  const strippedDate = stripDateSuffix(model);
  const strippedBoth = stripProviderSubtype(strippedDate);

  const candidates = [model, strippedSubtype, strippedDate, strippedBoth];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const match = matchFn(candidate, costs);
    if (match) return match;
  }

  return undefined;
}

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
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      }));
    },
    matchModelCost: matchingLLMModelCost,
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
    const modelName = this.extractModelName(span);
    if (!modelName) return;

    const customCosts = await this.deps.getCustomModelCosts(tenantId);
    if (customCosts.length === 0) return;

    const matched = matchModelCostWithFallbacks(modelName, customCosts, this.deps.matchModelCost);
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
