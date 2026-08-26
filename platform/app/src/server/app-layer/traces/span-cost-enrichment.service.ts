import type { PrismaClient } from "~/generated/prisma/client";
import {
  getCustomLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "~/server/modelProviders/llmModelCost";
import { matchModelCostWithFallbacks } from "~/server/tracer/collector/cost";
import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  ATTR_KEYS,
  CLAUDE_CODE_LLM_REQUEST_SPAN_NAME,
  CODEX_TURN_SPAN_NAME,
} from "@langwatch/trace-contract";
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
 * The same keys plus the bare `model`, used only for the spans named below.
 *
 * Enrichment runs on the raw OTLP span, before canonicalisation, and the
 * coding agents that export their own telemetry name the model under a bare
 * `model` and nothing else. Without it a custom cost rule silently does
 * nothing to exactly the traffic whose pricing a customer is most likely to
 * want to override.
 *
 * `model` is also a very common generic attribute key far outside coding-agent
 * telemetry, and what this service writes sits at priority 1 in
 * computeSpanCost, above even a reported cost. Reading it from every span
 * would let a customer's existing cost rule start pricing spans it never
 * matched before, at whatever rate they set, with no migration and no signal
 * that a dormant rule went live. So the loose key is scoped to the two spans
 * that need it.
 */
const CODING_AGENT_MODEL_ATTRIBUTE_KEYS = [...MODEL_ATTRIBUTE_KEYS, "model"] as const;

/**
 * The coding-agent spans that carry their model under a bare `model`. Both
 * names come from the extractors that own them, so a rename cannot leave this
 * gate silently matching nothing.
 */
const CODING_AGENT_MODEL_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE_CODE_LLM_REQUEST_SPAN_NAME,
  CODEX_TURN_SPAN_NAME,
]);

/**
 * Dependencies for OtlpSpanCostEnrichmentService that can be injected for testing.
 */
export interface OtlpSpanCostEnrichmentServiceDependencies {
  getCustomModelCosts: (projectId: string) => Promise<MaybeStoredLLMModelCost[]>;
}

/**
 * Creates default dependencies from a Prisma client.
 *
 * Custom costs resolve through the PROJECT -> TEAM -> ORGANIZATION scope
 * cascade, so a cost saved at any tier prices this project's spans. Org- and
 * team-scoped rows carry a null legacy projectId column and are invisible to
 * a plain { where: { projectId } } lookup.
 */
export function createCostEnrichmentDeps(
  prisma: PrismaClient,
): OtlpSpanCostEnrichmentServiceDependencies {
  return {
    getCustomModelCosts: (projectId: string) =>
      getCustomLLMModelCosts({ projectId, prismaClient: prisma }),
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
    const modelName = extractModelName(
      span,
      CODING_AGENT_MODEL_SPAN_NAMES.has(span.name)
        ? CODING_AGENT_MODEL_ATTRIBUTE_KEYS
        : MODEL_ATTRIBUTE_KEYS,
    );
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
    if (matched.cacheCreation1hCostPerToken != null) {
      span.attributes.push({
        key: ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_1H_COST_PER_TOKEN,
        value: { doubleValue: matched.cacheCreation1hCostPerToken },
      });
    }
  }
}
