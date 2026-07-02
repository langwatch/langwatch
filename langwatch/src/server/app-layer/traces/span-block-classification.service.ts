import { coerceToNumber } from "~/utils/coerceToNumber";
import type {
  OtlpInstrumentationScope,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  type Category,
  CLASSIFIER_VERSION,
  SPAN_ATTR_BLOCKS,
  SPAN_ATTR_CLASSIFIER_VERSION,
} from "./block-classification/categories";
import {
  type ClassifiedBlock,
  classifyBlocks,
} from "./block-classification/blockClassifier.service";
import {
  allocateCategoryCosts,
  type TierPrices,
  type TokenBlock,
  type UsagePools,
} from "./block-classification/costAllocation.service";
import { detectCodingAgentHarness } from "./block-classification/harnessDetection";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import type { TokenizerClient } from "../clients/tokenizer/tokenizer.client";
import { extractModelName } from "./utils/spanModel";

/**
 * Attribute keys checked for model name (priority order) — shared with cost
 * enrichment and token estimation so the tokenizer and the price registry see
 * the same model this span was costed against.
 */
const MODEL_ATTRIBUTE_KEYS = [
  "gen_ai.request.model",
  "gen_ai.response.model",
  "llm.model_name",
  "ai.model",
] as const;

/**
 * Dependencies for OtlpSpanBlockClassificationService that can be injected for
 * testing. Mirrors OtlpSpanTokenEstimationService: a `countTokens`-only slice of
 * the tokenizer, so the hot path stays a pure-CPU tokenize with no other I/O.
 */
export interface OtlpSpanBlockClassificationServiceDependencies {
  tokenizer: Pick<TokenizerClient, "countTokens">;
  /**
   * Resolves per-tier rates for a model from the static cost registry, used only
   * when the span carries no custom `langwatch.model.*` rates. Injected (rather
   * than imported) so this hot-path service stays decoupled from the
   * prisma-backed cost module — the composition root supplies the registry-backed
   * implementation; unit tests may omit it. Returning `null` prices every tier at
   * 0 (tokens still allocated, cost totals stay 0 until a rate is known).
   */
  resolveModelPrices?: (model: string) => TierPrices | null;
}

/**
 * Ingest-time content-block classification enrichment (ADR-033 Decision 1).
 *
 * For coding-agent CLI spans (Claude Code, Codex) that carry captured message
 * content, this classifies every content block into a cost category, tokenizes
 * each block, and allocates the span's provider-reported usage across those
 * categories cache-tier aware (Decision 2). It then pushes onto the span:
 *
 *   - `langwatch.reserved.blocks.classification` — bounded per-block detail
 *     (`{idx, category, tokens, cacheTier}`), the drill-down / audit trail.
 *   - `langwatch.reserved.blocks.classifier_version` — replay/audit stamp.
 *   - `langwatch.reserved.blockcat.<category>.tokens` / `.cost_usd` — per-category
 *     running totals the trace fold rolls up into `TraceSummary`.
 *
 * Runs SERIAL, after PII redaction / cost enrichment / token estimation (it
 * consumes their outputs — per-tier rates and populated usage tokens) and before
 * content drop and the attribute cap. It never throws to the ingestion caller:
 * absent or unparseable content is skipped silently, and the command wraps this
 * in its own try/catch (ADR-033 "Ingestion never fails on classification").
 *
 * Analytics only — these numbers never feed billing, quotas, or plan limits.
 */
export class OtlpSpanBlockClassificationService {
  private readonly deps: OtlpSpanBlockClassificationServiceDependencies;

  constructor(deps: OtlpSpanBlockClassificationServiceDependencies) {
    this.deps = deps;
  }

  /**
   * Classifies the span's content blocks and pushes the classification / category
   * attributes. Mutates the span in place. Returns silently (never throws) when
   * the span is not coding-agent traffic or carries no attributable content.
   */
  async classifySpanBlocks({
    span,
    instrumentationScope,
    tenantId: _tenantId,
  }: {
    span: OtlpSpan;
    instrumentationScope?: OtlpInstrumentationScope | null;
    /** Reserved for future per-project kill-switch parity with token estimation. */
    tenantId?: string;
  }): Promise<void> {
    // 1. Harness gate — classification only runs on coding-agent CLI traffic.
    const harness = detectCodingAgentHarness({
      instrumentationScopeName: instrumentationScope?.name ?? null,
      spanAttributes: this.spanAttributesRecord(span),
    });
    if (!harness) return;

    // 2. Content extraction — the same attribute surface token estimation reads.
    const inputMessages = this.parseMessages(span, [
      ATTR_KEYS.LANGWATCH_INPUT,
      ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
    ]);
    const outputMessages = this.parseMessages(span, [
      ATTR_KEYS.LANGWATCH_OUTPUT,
      ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
    ]);
    const tools = this.parseJsonAttribute(span, ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS);
    if (inputMessages === null && outputMessages === null) return;

    // 3. Classify content parts into cost categories (pure, deterministic).
    const { input, output, lastInputCacheBreakpointIndex } = classifyBlocks({
      inputMessages: inputMessages ?? [],
      outputMessages: outputMessages ?? [],
      tools: tools ?? undefined,
    });
    if (input.length === 0 && output.length === 0) return;

    // 4. Per-block token estimate — real tokenizer counts, not byte proxies
    //    (ADR-033 exact-tokens constraint). Pool totals below re-scale these to
    //    provider truth, so within-pool the split is tokenizer-grade.
    const model = extractModelName(span, MODEL_ATTRIBUTE_KEYS) ?? "";
    const inputBlocks = await this.toTokenBlocks({ blocks: input, model });
    const outputBlocks = await this.toTokenBlocks({ blocks: output, model });

    // 5. Provider-reported usage pools + per-tier rates already stamped upstream.
    const pools = this.extractUsagePools(span);
    const prices = this.resolveTierPrices({ span, model });

    // 6. Allocate cache-tier aware and push the classification attributes.
    const { categoryTotals, blocks } = allocateCategoryCosts({
      inputBlocks,
      outputBlocks,
      lastCacheBreakpointIndex: lastInputCacheBreakpointIndex,
      pools,
      prices,
    });

    this.pushClassificationAttributes({ span, blocks, categoryTotals });
  }

  private async toTokenBlocks({
    blocks,
    model,
  }: {
    blocks: ClassifiedBlock[];
    model: string;
  }): Promise<TokenBlock[]> {
    const out: TokenBlock[] = [];
    for (const block of blocks) {
      const tokens =
        (await this.deps.tokenizer.countTokens(model, block.text)) ?? 0;
      out.push({ idx: block.idx, category: block.category, tokens });
    }
    return out;
  }

  private pushClassificationAttributes({
    span,
    blocks,
    categoryTotals,
  }: {
    span: OtlpSpan;
    blocks: ReturnType<typeof allocateCategoryCosts>["blocks"];
    categoryTotals: ReturnType<typeof allocateCategoryCosts>["categoryTotals"];
  }): void {
    const pending: OtlpSpan["attributes"] = [
      {
        key: SPAN_ATTR_BLOCKS,
        value: { stringValue: JSON.stringify(blocks) },
      },
      {
        key: SPAN_ATTR_CLASSIFIER_VERSION,
        value: { intValue: CLASSIFIER_VERSION },
      },
    ];

    // Per-category running totals — only for categories with a nonzero token
    // allocation, stringified so they ride the existing attribute transport.
    for (const [category, total] of Object.entries(categoryTotals)) {
      if (!total || total.tokens <= 0) continue;
      pending.push({
        key: blockCategoryTokensAttr(category as Category),
        value: { stringValue: String(total.tokens) },
      });
      pending.push({
        key: blockCategoryCostAttr(category as Category),
        value: { stringValue: String(total.costUsd) },
      });
    }

    span.attributes.push(...pending);
  }

  /** Flattens span attributes into a primitive-valued map for harness detection. */
  private spanAttributesRecord(span: OtlpSpan): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const attr of span.attributes) {
      if (attr.key in record) continue; // first wins
      const v = attr.value;
      record[attr.key] =
        v.stringValue ?? v.boolValue ?? v.intValue ?? v.doubleValue ?? undefined;
    }
    return record;
  }

  /**
   * Parses the first present message attribute (priority order) into a message
   * array. Handles the `{ type: "chat_messages", value: [...] }` structured
   * wrapper and bare arrays. Returns null when no attribute is present or none
   * parses — the caller then skips classification silently.
   */
  private parseMessages(
    span: OtlpSpan,
    keys: readonly string[],
  ): unknown[] | null {
    for (const key of keys) {
      const raw = this.getStringAttribute(span, key);
      if (!raw) continue;
      const messages = this.messagesFromJson(raw);
      if (messages !== null) return messages;
    }
    return null;
  }

  private messagesFromJson(jsonStr: string): unknown[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (obj.type === "chat_messages" && Array.isArray(obj.value)) {
        return obj.value;
      }
      if (Array.isArray(obj.messages)) return obj.messages;
    }
    return null;
  }

  private parseJsonAttribute(span: OtlpSpan, key: string): unknown | null {
    const raw = this.getStringAttribute(span, key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private extractUsagePools(span: OtlpSpan): UsagePools {
    const num = (...keys: string[]): number => {
      for (const key of keys) {
        const n = coerceToNumber(this.getNumericAttribute(span, key));
        if (n !== null && n > 0) return n;
      }
      return 0;
    };
    return {
      inputTokens: num(
        ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS,
      ),
      outputTokens: num(
        ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS,
      ),
      cacheReadTokens: num(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        "gen_ai.usage.cached_tokens",
      ),
      cacheCreationTokens: num(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
      ),
    };
  }

  /**
   * Resolves per-tier rates the same way `computeSpanCost` does, so Σ per-category
   * cost reconciles to the span's real (token×rate) cost: custom enrichment rates
   * first (`langwatch.model.*`), then the injected registry resolver. A cache rate
   * that is absent falls back to the input rate (counted, not discounted).
   */
  private resolveTierPrices({
    span,
    model,
  }: {
    span: OtlpSpan;
    model: string;
  }): TierPrices {
    const attr = (key: string): number | null =>
      coerceToNumber(this.getNumericAttribute(span, key));

    const customInput = attr(ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN);
    const customOutput = attr(ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN);
    if (customInput !== null || customOutput !== null) {
      const inputRate = customInput ?? 0;
      return {
        inputCostPerToken: inputRate,
        outputCostPerToken: customOutput ?? 0,
        cacheReadCostPerToken:
          attr(ATTR_KEYS.LANGWATCH_MODEL_CACHE_READ_COST_PER_TOKEN) ?? inputRate,
        cacheCreationCostPerToken:
          attr(ATTR_KEYS.LANGWATCH_MODEL_CACHE_CREATION_COST_PER_TOKEN) ??
          inputRate,
      };
    }

    if (model && this.deps.resolveModelPrices) {
      return this.deps.resolveModelPrices(model) ?? {};
    }

    return {};
  }

  private getStringAttribute(span: OtlpSpan, key: string): string | null {
    for (const attr of span.attributes) {
      if (attr.key === key && typeof attr.value.stringValue === "string") {
        return attr.value.stringValue;
      }
    }
    return null;
  }

  private getNumericAttribute(span: OtlpSpan, key: string): unknown {
    for (const attr of span.attributes) {
      if (attr.key !== key) continue;
      const v = attr.value;
      return v.intValue ?? v.doubleValue ?? v.stringValue ?? null;
    }
    return null;
  }
}
