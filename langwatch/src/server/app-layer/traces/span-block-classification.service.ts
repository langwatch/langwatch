import { coerceToNumber } from "~/utils/coerceToNumber";
import { createLogger } from "~/utils/logger/server";
import type {
  OtlpInstrumentationScope,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { isDisabledByKillSwitch } from "../../featureFlag/killSwitch";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { TokenizerClient } from "../clients/tokenizer/tokenizer.client";
import {
  type ClassifiedBlock,
  classifyBlocks,
} from "./block-classification/blockClassifier.service";
import {
  parseClaudeCodeRequestBody,
  parseClaudeCodeResponseBody,
} from "./block-classification/claudeCodeBody";
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
  inferCacheBreakpointFromPools,
  type TierPrices,
  type TokenBlock,
  type UsagePools,
} from "./block-classification/costAllocation.service";
import { detectCodingAgentHarness } from "./block-classification/harnessDetection";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import { resolveCustomTierRates } from "./model-cost-matching";
import {
  extractUsagePools,
  getNumericAttribute,
  getStringAttribute,
  parseJsonAttribute,
  parseMessages,
  parseOutputMessages,
  spanAttributesRecord,
} from "./span-block-classification.readers";
import { extractModelName } from "./utils/spanModel";

/**
 * Attribute keys checked for model name (priority order). MUST match the order
 * OtlpSpanTokenEstimationService and computeSpanCost use — response.model FIRST —
 * so the tokenizer, the price registry, and this classifier all resolve the SAME
 * model on a span whose request/response models differ. Otherwise the classifier
 * would tokenize against a different model than the span was costed against,
 * skewing the exact-token category split.
 */
const MODEL_ATTRIBUTE_KEYS = [
  "gen_ai.response.model",
  "gen_ai.request.model",
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
      spanAttributes: spanAttributesRecord(span),
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
    // 2. Content extraction. PREFER the raw Claude Code request/response bodies
    //    (full fidelity: content-block structure + cache_control intact), so the
    //    cache breakpoint is REAL (not pool-inferred), tool_results keep their
    //    type, and output thinking/tool_use blocks classify correctly. Fall back
    //    to the lifted/flattened fields for non-Claude-Code paths (codex, gateway)
    //    or when the raw body is absent.
    const structuredInput = parseClaudeCodeRequestBody(
      getStringAttribute(span, ATTR_KEYS.CLAUDE_CODE_REQUEST_BODY),
    );
    const inputMessages =
      structuredInput?.messages ??
      parseMessages(span, [
        ATTR_KEYS.LANGWATCH_INPUT,
        ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
      ]);
    const outputMessages =
      parseClaudeCodeResponseBody(
        getStringAttribute(span, ATTR_KEYS.CLAUDE_CODE_RESPONSE_BODY),
      ) ?? parseOutputMessages(span);
    const tools =
      structuredInput?.tools ??
      parseJsonAttribute(span, ATTR_KEYS.GEN_AI_TOOL_DEFINITIONS);
    if (inputMessages === null && outputMessages === null) return;

    // 3. Classify content parts into cost categories (pure, deterministic).
    const { input, output, lastInputCacheBreakpointIndex } = classifyBlocks({
      inputMessages: inputMessages ?? [],
      outputMessages: outputMessages ?? [],
      tools: tools ?? undefined,
    });

    // 4. Provider-reported usage pools. Extracted BEFORE the empty-blocks guard:
    //    when content classified to zero blocks but the provider still reported
    //    usage (e.g. empty/unparseable parts), that usage must not be dropped —
    //    the zero-guard in allocateCategoryCosts routes it to the axis catch-all
    //    (ADR-033 "no usage is dropped"). Skip only when there is neither content
    //    nor usage to attribute.
    const pools = extractUsagePools(span);
    const hasUsage =
      pools.inputTokens > 0 ||
      pools.cacheReadTokens > 0 ||
      pools.cacheCreationTokens > 0 ||
      pools.outputTokens > 0;
    if (input.length === 0 && output.length === 0 && !hasUsage) return;

    // 5. Per-block token estimate — real tokenizer counts, not byte proxies
    //    (ADR-033 exact-tokens constraint). Pool totals below re-scale these to
    //    provider truth, so within-pool the split is tokenizer-grade.
    const model = extractModelName(span, MODEL_ATTRIBUTE_KEYS) ?? "";
    const inputBlocks = await this.toTokenBlocks({ blocks: input, model });
    const outputBlocks = await this.toTokenBlocks({ blocks: output, model });
    const prices = this.resolveTierPrices({ span, model });

    // 6. Cached-prefix boundary. The Claude Code log path flattens message
    //    content to plain text, stripping the cache_control markers the
    //    classifier reads — so `classifyBlocks` returns a null breakpoint even on
    //    a cached turn. When the provider still reports cached tokens, infer the
    //    boundary from the usage pools so those tokens attribute to the real
    //    prefix categories instead of the axis catch-all (other_input).
    const cacheBreakpoint =
      lastInputCacheBreakpointIndex ??
      inferCacheBreakpointFromPools({ inputBlocks, pools });

    // 7. Allocate cache-tier aware and push the classification attributes.
    //    Reconcile Σ to the authoritative displayed cost when the span carries a
    //    provider-billed total (Claude Code's cost_usd) that `computeSpanCost`
    //    trusts over the rate estimate — see resolveReconciliationCost.
    const { categoryTotals, blocks } = allocateCategoryCosts({
      inputBlocks,
      outputBlocks,
      lastCacheBreakpointIndex: cacheBreakpoint,
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

  private resolveTierPrices({
    span,
    model,
  }: {
    span: OtlpSpan;
    model: string;
  }): TierPrices {
    const customRates = resolveCustomTierRates((key) =>
      coerceToNumber(getNumericAttribute(span, key)),
    );
    if (customRates) return customRates;

    if (model && this.deps.resolveModelPrices) {
      return this.deps.resolveModelPrices(model) ?? {};
    }

    return {};
  }

  private isDisabledByKillSwitch({
    tenantId,
  }: {
    tenantId?: string;
  }): Promise<boolean> {
    return isDisabledByKillSwitch({
      featureFlagService: this.deps.featureFlagService,
      globalKey: GLOBAL_KILL_SWITCH_KEY,
      projectKey: PROJECT_KILL_SWITCH_KEY,
      tenantId,
    });
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
    // Use the SAME resolver as resolveTierPrices / computeSpanCost so the two
    // can't drift: a present-but-non-coercible rate (e.g. stringValue "auto")
    // must NOT count as a custom rate here, or reconciliation is skipped while
    // pricing quietly falls through to the registry — leaving Σ un-reconciled.
    const hasCustomRates =
      resolveCustomTierRates((key) =>
        coerceToNumber(getNumericAttribute(span, key)),
      ) !== null;
    if (hasCustomRates) return null;

    const explicit = coerceToNumber(
      getNumericAttribute(span, ATTR_KEYS.LANGWATCH_SPAN_COST),
    );
    return explicit !== null && explicit > 0 ? explicit : null;
  }
}
