import { coerceToNumber } from "~/utils/coerceToNumber";
import { createLogger } from "~/utils/logger/server";
import type {
  OtlpInstrumentationScope,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { KILL_SWITCH_CACHE_TTL_MS } from "../../featureFlag/constants";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { TokenizerClient } from "../clients/tokenizer/tokenizer.client";
import {
  type ClassifiedBlock,
  classifyBlocks,
} from "./block-classification/blockClassifier.service";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  type Category,
  CLASSIFIER_VERSION,
  MAX_TOKENIZED_CHARS_PER_BLOCK,
  SPAN_ATTR_BLOCKCAT_PREFIX,
  SPAN_ATTR_BLOCKS,
  SPAN_ATTR_CLASSIFIER_VERSION,
} from "./block-classification/categories";
import {
  allocateCategoryCosts,
  type TierPrices,
  type TokenBlock,
  type UsagePools,
} from "./block-classification/costAllocation.service";
import { detectCodingAgentHarness } from "./block-classification/harnessDetection";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import { resolveCustomTierRates } from "./model-cost-matching";
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
/** Kill-switch flags, mirroring OtlpSpanTokenEstimationService so classification
 * is operable the same way its sibling is: a global switch disables it fleet-wide
 * and a per-project switch disables it for one misbehaving tenant. */
const GLOBAL_KILL_SWITCH_KEY = "block-classification-killswitch";
const PROJECT_KILL_SWITCH_KEY = "block-classification-project-killswitch";

export interface OtlpSpanBlockClassificationServiceDependencies {
  tokenizer: Pick<TokenizerClient, "countTokens">;
  /** Global + per-project kill switch. Omitted in unit tests (no switch). */
  featureFlagService?: FeatureFlagServiceInterface;
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
 * content drop. It runs AFTER the ingest attribute cap by design: that cap
 * guards against oversized CUSTOMER payloads, while everything this service
 * pushes is system-generated and self-bounded (MAX_CLASSIFIED_BLOCKS_PER_SPAN
 * caps the detail blob; category keys are a fixed enum). Absent or unparseable
 * content is skipped silently; dependency failures (e.g. a tokenizer throw) may
 * escape this service and are contained by the command's own try/catch — that
 * command-level guard is what anchors the ADR-033 "Ingestion never fails on
 * classification" invariant, and it is proven end-to-end at the command level.
 *
 * Analytics only — these numbers never feed billing, quotas, or plan limits.
 */
export class OtlpSpanBlockClassificationService {
  private readonly deps: OtlpSpanBlockClassificationServiceDependencies;
  private readonly logger = createLogger(
    "langwatch:traces:block-classification",
  );

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
    tenantId,
  }: {
    span: OtlpSpan;
    instrumentationScope?: OtlpInstrumentationScope | null;
    /** Project id, for the per-project kill switch (parity with token estimation). */
    tenantId?: string;
  }): Promise<void> {
    // 1. Harness gate — classification only runs on coding-agent CLI traffic.
    const harness = detectCodingAgentHarness({
      instrumentationScopeName: instrumentationScope?.name ?? null,
      spanAttributes: this.spanAttributesRecord(span),
    });
    if (!harness) return;

    // Kill switch — global or per-project. Checked only after the harness gate
    // so the (cached) flag lookup never runs for non-coding-agent spans.
    if (await this.isDisabledByKillSwitch({ tenantId })) return;

    // Enforce the ADR-033 "ingestion never fails on classification" invariant
    // HERE, not just at the caller: any tokenizer / classifier / allocator throw
    // is contained, logged, and swallowed so the span still ingests unclassified.
    // The command-level try/catch remains as a second belt.
    try {
      await this.classifyInner({ span });
    } catch (error) {
      this.logger.warn(
        { error, spanId: span.spanId, traceId: span.traceId },
        "block classification failed; span ingested unclassified",
      );
    }
  }

  /** The classification work proper — see classifySpanBlocks for the guards. */
  private async classifyInner({ span }: { span: OtlpSpan }): Promise<void> {
    // 2. Content extraction — the same attribute surface token estimation reads.
    const inputMessages = this.parseMessages(span, [
      ATTR_KEYS.LANGWATCH_INPUT,
      ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
    ]);
    const outputMessages = this.parseMessages(span, [
      ATTR_KEYS.LANGWATCH_OUTPUT,
      ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
    ]);
    const tools = this.parseJsonAttribute(
      span,
      ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS,
    );
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
    //    Reconcile Σ to the authoritative displayed cost when the span carries a
    //    provider-billed total (Claude Code's cost_usd) that `computeSpanCost`
    //    trusts over the rate estimate — see resolveReconciliationCost.
    const { categoryTotals, blocks } = allocateCategoryCosts({
      inputBlocks,
      outputBlocks,
      lastCacheBreakpointIndex: lastInputCacheBreakpointIndex,
      pools,
      prices,
      reconcileToTotalCost: this.resolveReconciliationCost({ span }),
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
    // Per-block tokenization is independent, so fan out with Promise.all rather
    // than awaiting each block serially — a span with N blocks paid N sequential
    // tokenizer round-trips otherwise. Promise.all preserves order, so idx/axis
    // alignment with the classifier walk is unchanged. Block count is bounded by
    // MAX_CLASSIFIED_BLOCKS_PER_SPAN, so the fan-out width is bounded too.
    return Promise.all(
      blocks.map(async (block) => {
        // DoS guard: the 512-block cap bounds block COUNT but not the size of
        // any single block, and spool-reconstituted spans bypass the ingest
        // value cap entirely — one adversarial multi-MB block must not hold the
        // tokenizer hostage. Tokenize a capped slice and extrapolate linearly:
        // within-pool proportions shift only for pathological blocks, and pool
        // totals stay exact via scaling.
        const text =
          block.text.length > MAX_TOKENIZED_CHARS_PER_BLOCK
            ? block.text.slice(0, MAX_TOKENIZED_CHARS_PER_BLOCK)
            : block.text;
        let tokens = (await this.deps.tokenizer.countTokens(model, text)) ?? 0;
        if (text.length < block.text.length && text.length > 0) {
          tokens = Math.round((tokens * block.text.length) / text.length);
        }
        return { idx: block.idx, category: block.category, tokens };
      }),
    );
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
    // Rounded for storage: raw float artifacts (0.0000012340000001) inflate
    // the attribute payload without adding information — tokens are integral
    // by nature, USD keeps 10 decimals (sub-nano-dollar precision).
    for (const [category, total] of Object.entries(categoryTotals)) {
      if (!total || total.tokens <= 0) continue;
      pending.push({
        key: blockCategoryTokensAttr(category as Category),
        value: { stringValue: String(Math.round(total.tokens)) },
      });
      pending.push({
        key: blockCategoryCostAttr(category as Category),
        value: { stringValue: String(Number(total.costUsd.toFixed(10))) },
      });
    }

    // Idempotent write: drop any prior classification attributes first, so a
    // replay / retry / re-enrichment REPLACES them instead of appending
    // duplicates the fold would double-count (or first-win silently drop).
    const kept = span.attributes.filter(
      (a) =>
        a.key !== SPAN_ATTR_BLOCKS &&
        a.key !== SPAN_ATTR_CLASSIFIER_VERSION &&
        !a.key.startsWith(SPAN_ATTR_BLOCKCAT_PREFIX),
    );
    span.attributes.length = 0;
    span.attributes.push(...kept, ...pending);
  }

  /** Flattens span attributes into a primitive-valued map for harness detection. */
  private spanAttributesRecord(span: OtlpSpan): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const attr of span.attributes) {
      if (attr.key in record) continue; // first wins
      const v = attr.value;
      record[attr.key] =
        v.stringValue ??
        v.boolValue ??
        v.intValue ??
        v.doubleValue ??
        undefined;
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
   * first (`langwatch.model.*`), then the injected registry resolver. The custom
   * (Priority 1) cascade is the SHARED `resolveCustomTierRates` — the same helper
   * `computeSpanCost` uses — so the two cannot drift.
   */
  private resolveTierPrices({
    span,
    model,
  }: {
    span: OtlpSpan;
    model: string;
  }): TierPrices {
    const customRates = resolveCustomTierRates((key) =>
      coerceToNumber(this.getNumericAttribute(span, key)),
    );
    if (customRates) return customRates;

    if (model && this.deps.resolveModelPrices) {
      return this.deps.resolveModelPrices(model) ?? {};
    }

    return {};
  }

  /**
   * Global + per-project kill switch, identical in shape to
   * OtlpSpanTokenEstimationService. Runs on the per-span hot path, so both
   * lookups widen the cache window past the 5s frontend-flag default (a cache
   * miss = one billable flags request). No featureFlagService (unit tests) → on.
   */
  private async isDisabledByKillSwitch({
    tenantId,
  }: {
    tenantId?: string;
  }): Promise<boolean> {
    if (!this.deps.featureFlagService) return false;

    const globalDisabled = await this.deps.featureFlagService.isEnabled(
      GLOBAL_KILL_SWITCH_KEY,
      {
        distinctId: "global",
        defaultValue: false,
        cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
      },
    );
    if (globalDisabled) return true;

    if (tenantId) {
      const projectDisabled = await this.deps.featureFlagService.isEnabled(
        PROJECT_KILL_SWITCH_KEY,
        {
          distinctId: tenantId,
          defaultValue: false,
          projectId: tenantId,
          cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
        },
      );
      if (projectDisabled) return true;
    }

    return false;
  }

  /**
   * The authoritative span cost the display trusts OVER the rate estimate, or
   * `null` when the rate-derived Σ already matches what the display shows.
   *
   * Mirrors `computeSpanCost`'s cascade precedence so per-category costs
   * reconcile to the SAME number the span renders:
   *   - Custom per-token rates present (Priority 1) → the display costs with
   *     those rates and so does our allocation → already conserved, no reconcile.
   *   - Else an explicit provider-billed total (Priority 2 — `langwatch.span.cost`,
   *     e.g. Claude Code's `cost_usd`) wins over the token×registry estimate our
   *     allocation used, so reconcile Σ to it.
   *   - Else the registry (Priority 3) prices both display and allocation
   *     identically → already conserved, no reconcile.
   */
  private resolveReconciliationCost({
    span,
  }: {
    span: OtlpSpan;
  }): number | null {
    const hasCustomRates =
      this.getNumericAttribute(
        span,
        ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN,
      ) !== null ||
      this.getNumericAttribute(
        span,
        ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN,
      ) !== null;
    if (hasCustomRates) return null;

    const explicit = coerceToNumber(
      this.getNumericAttribute(span, ATTR_KEYS.LANGWATCH_SPAN_COST),
    );
    return explicit !== null && explicit > 0 ? explicit : null;
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
