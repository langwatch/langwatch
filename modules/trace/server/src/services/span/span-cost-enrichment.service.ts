import { matchModelCost, type ModelCostRate } from "@langwatch/model-provider-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import {
  ATTR_KEYS,
  CLAUDE_CODE_LLM_REQUEST_SPAN_NAME,
  CODEX_TURN_SPAN_NAME,
} from "@langwatch/trace-contract";
import type { TraceModelCostCatalog } from "../../app/trace.members.ts";
import { SpanModelNameService } from "./span-model-name.service.ts";

/**
 * Attribute keys that may contain model names (checked in priority order).
 * REQUEST model wins; PRICED against what customer requested.
 */
const MODEL_ATTRIBUTE_KEYS = [
  "gen_ai.request.model",
  "gen_ai.response.model",
  "llm.model_name",
  "ai.model",
] as const;

/**
 * Same keys plus bare `model`, used only for coded spans. Scoped to avoid
 * silently activating dormant cost rules on unrelated spans with generic `model`.
 */
const CODING_AGENT_MODEL_ATTRIBUTE_KEYS = [...MODEL_ATTRIBUTE_KEYS, "model"] as const;

/**
 * Coding-agent spans that carry model under bare `model`. Rename-safe
 * because names come from extractors.
 */
const CODING_AGENT_MODEL_SPAN_NAMES: ReadonlySet<string> = new Set([
  CLAUDE_CODE_LLM_REQUEST_SPAN_NAME,
  CODEX_TURN_SPAN_NAME,
]);

/**
 * Enriches OTLP spans with custom LLM cost rates from project rules.
 */
export class OtlpSpanCostEnrichmentService {
  /**
   * The application constructs this with `new` over a `getCustomModelCosts`
   * function it builds in its adapter; here the same read is the narrow port
   * Trace declares. `service-classes` requires a strict feature package to
   * expose construction through a static factory, and `service-quality`
   * requires the constructor to be private once it has one.
   */
  static create(deps: { modelCosts: TraceModelCostCatalog }): OtlpSpanCostEnrichmentService {
    return new OtlpSpanCostEnrichmentService(deps.modelCosts, SpanModelNameService.create());
  }

  private constructor(
    private readonly modelCosts: TraceModelCostCatalog,
    private readonly modelNames: SpanModelNameService,
  ) {}

  /**
   * Enriches the span with custom cost rates when a matching custom model cost
   * exists. Mutates the span in place (pushes new attributes).
   *
   * The catalog read is skipped entirely for a span with no model name, which
   * is most spans: this runs on every ingested span, and the read is a scope
   * cascade over three tiers.
   */
  async enrichSpan({ span, tenantId }: { span: OtlpSpan; tenantId: string }): Promise<void> {
    const modelName = this.modelNames.tryExtractModelName(
      span,
      CODING_AGENT_MODEL_SPAN_NAMES.has(span.name)
        ? CODING_AGENT_MODEL_ATTRIBUTE_KEYS
        : MODEL_ATTRIBUTE_KEYS,
    );
    if (!modelName) {
      return;
    }

    const customCosts = await this.listRates(tenantId);
    if (customCosts.length === 0) {
      return;
    }

    const matched = matchModelCost(modelName, customCosts);
    if (!matched) {
      return;
    }

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

  /**
   * Rate handling: stored rows use null, catalog uses undefined. Scope cascade is the port's.
   */
  private async listRates(tenantId: string): Promise<ModelCostRate[]> {
    const costs = await this.modelCosts.listCosts({ projectId: tenantId });

    return costs.map((cost) => ({
      model: cost.model,
      regex: cost.regex,
      inputCostPerToken: cost.inputCostPerToken ?? void 0,
      outputCostPerToken: cost.outputCostPerToken ?? void 0,
      cacheReadCostPerToken: cost.cacheReadCostPerToken ?? void 0,
      cacheCreationCostPerToken: cost.cacheCreationCostPerToken ?? void 0,
      cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken ?? void 0,
    }));
  }
}
