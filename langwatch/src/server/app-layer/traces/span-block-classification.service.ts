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
  type Axis,
  axisOf,
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
  parseClaudeCodeRequestBody,
  parseClaudeCodeResponseBody,
} from "./block-classification/claudeCodeBody";
import {
  allocateCategoryCosts,
  type CategoryTotals,
  inferCachedPrefixEstTokens,
  type TierPrices,
  type TokenBlock,
  type UsagePools,
} from "./block-classification/costAllocation.service";
import { textContainsPromptLineAligned } from "./block-classification/freshTurnPresence";
import {
  type CodingAgentHarness,
  detectCodingAgentHarness,
} from "./block-classification/harnessDetection";
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
      await this.classifyInner({ span, harness });
    } catch (error) {
      this.logger.warn(
        { error, spanId: span.spanId, traceId: span.traceId },
        "block classification failed; span ingested unclassified",
      );
    }
  }

  /** The classification work proper — see classifySpanBlocks for the guards. */
  private async classifyInner({
    span,
    harness,
  }: {
    span: OtlpSpan;
    harness: CodingAgentHarness;
  }): Promise<void> {
    // 2. Content extraction. PREFER the raw Claude Code request/response bodies
    //    (full fidelity: content-block structure + cache_control intact), so the
    //    cache breakpoint is REAL (not pool-inferred), tool_results keep their
    //    type, and output thinking/tool_use blocks classify correctly. Fall back
    //    to the lifted/flattened fields for non-Claude-Code paths (codex, gateway)
    //    or when the raw body is absent.
    const structuredInput = parseClaudeCodeRequestBody(
      getStringAttribute(span, ATTR_KEYS.CLAUDE_CODE_REQUEST_BODY),
    );
    const flattenedMessages = parseMessages(span, [
      ATTR_KEYS.LANGWATCH_INPUT,
      ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
    ]);
    const inputMessages = structuredInput
      ? // The raw body is preferred for its intact block structure, but inline
        // truncation drops the NEWEST turn (the tail). When it did, reinstate the
        // current user turn from the clean flattened side-channel (which the
        // log-to-span converter fills from the co-located user_prompt), so the
        // fresh user input is classified instead of lost to other_input.
        appendFreshTurnIfTruncated({
          structured: structuredInput.messages,
          newestTurnComplete: structuredInput.newestTurnComplete,
          flattened: flattenedMessages,
        })
      : flattenedMessages;
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
    const pools = extractUsagePools(span, harness);
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

    // 6. Cached-prefix boundary. When the content carried a real cache_control
    //    marker, `lastInputCacheBreakpointIndex` is a whole-block index. When it
    //    did not (the Claude Code log path flattens content to plain text,
    //    stripping cache_control) but the provider still reports cached tokens,
    //    infer the boundary as a FRACTIONAL estimate-space position from the pools
    //    so those tokens attribute to the real prefix categories instead of the
    //    axis catch-all (other_input), and the straddling block is split between
    //    the cached prefix and the fresh tail.
    const inferredCachedPrefixEstTokens =
      lastInputCacheBreakpointIndex === null
        ? inferCachedPrefixEstTokens({ inputBlocks, pools })
        : null;

    // 7. Allocate cache-tier aware and push the classification attributes.
    //    Reconcile Σ to the authoritative displayed cost when the span carries a
    //    provider-billed total (Claude Code's cost_usd) that `computeSpanCost`
    //    trusts over the rate estimate — see resolveReconciliationCost.
    const { categoryTotals, blocks } = allocateCategoryCosts({
      inputBlocks,
      outputBlocks,
      lastCacheBreakpointIndex: lastInputCacheBreakpointIndex,
      inferredCachedPrefixEstTokens,
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
    //
    // Tokens are rounded with the largest-remainder method PER AXIS, not
    // independently: the exact per-category floats sum to the provider's per-axis
    // pool total, and rounding each on its own drifts that sum by up to one token
    // per category. Largest-remainder distributes the rounding residual to the
    // categories with the biggest fractional parts, so the STORED integers still
    // sum to the provider total (the same conservation the allocator guarantees
    // in float space). Costs are floats, so they need no such reconciliation.
    const roundedTokens = roundCategoryTokensPerAxis(categoryTotals);
    for (const [category, total] of Object.entries(categoryTotals)) {
      if (!total) continue;
      const tokens = roundedTokens.get(category as Category) ?? 0;
      if (tokens <= 0) continue;
      pending.push({
        key: blockCategoryTokensAttr(category as Category),
        value: { stringValue: String(tokens) },
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
    // A one-sided custom override fills its unset tiers from the registry rate
    // for this model — the SAME fallback computeSpanCost passes, so the span's
    // displayed cost and the per-category allocation price every tier identically
    // (conservation holds without reconciliation).
    const registryFallback =
      model && this.deps.resolveModelPrices
        ? () => this.deps.resolveModelPrices?.(model) ?? null
        : undefined;
    const customRates = resolveCustomTierRates(
      (key) => coerceToNumber(getNumericAttribute(span, key)),
      registryFallback,
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

/**
 * Reinstate the newest user turn when the raw Claude Code body was truncated.
 *
 * Inline truncation always drops the TAIL, so the structured recovery is the
 * leading prefix (system + complete early turns) MINUS the current turn. The
 * clean flattened side-channel (`gen_ai.input.messages` / `langwatch.input`,
 * which the log-to-span converter fills from the co-located `user_prompt`) still
 * carries the current turn as its last user message — append it so the fresh
 * input classifies as `user_input` instead of vanishing into `other_input`.
 *
 * Guarded against re-adding a turn that already survived: on a mid-turn model
 * call the human prompt sits early in the conversation (as prior context) and
 * only the trailing tool_results were truncated, so the recovery already holds
 * the prompt. Re-appending it there would both duplicate the block AND mislabel
 * it as the fresh `user_input` turn. We therefore append only when the prompt
 * text is not already present in the recovered messages — the first model call
 * of a turn (whose dropped tail IS the human prompt) is the case that needs it.
 *
 * No-op when the body parsed whole (`newestTurnComplete`) or no user turn is
 * recoverable from the side-channel.
 */
function appendFreshTurnIfTruncated({
  structured,
  newestTurnComplete,
  flattened,
}: {
  structured: Array<{ role: string; content: unknown }>;
  newestTurnComplete: boolean;
  flattened: unknown[] | null;
}): Array<{ role: string; content: unknown }> {
  if (newestTurnComplete) return structured;
  const freshTurn = lastUserMessage(flattened);
  if (!freshTurn) return structured;
  const freshText = contentText(freshTurn.content);
  if (freshText && messagesContainUserText(structured, freshText)) {
    return structured;
  }
  return [...structured, freshTurn];
}

/** The last `role: "user"` message in a flattened message array, or null. */
function lastUserMessage(
  messages: unknown[] | null,
): { role: string; content: unknown } | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== "user") continue;
    if (msg.content === undefined || msg.content === null) return null;
    return { role: "user", content: msg.content };
  }
  return null;
}

/**
 * True when any user message's flattened text contains `text` LINE-ALIGNED.
 * A bare substring check suppressed short prompts ("ok", "continue") that
 * appear inside recovered reminder prose or file dumps, silently dropping the
 * fresh turn and mislabelling a stale prior user message as fresh.
 */
function messagesContainUserText(
  messages: Array<{ role: string; content: unknown }>,
  text: string,
): boolean {
  return messages.some(
    (m) =>
      m.role === "user" &&
      textContainsPromptLineAligned(contentText(m.content), text),
  );
}

/** Flatten a message `content` (string or block array) to plain text. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.length > 0) parts.push(text);
  }
  return parts.join("\n");
}

/**
 * Round each category's fractional token count to an integer for storage while
 * preserving the per-axis sum (largest-remainder / Hamilton). The exact floats
 * already sum to the provider's per-axis pool total; rounding each in isolation
 * drifts that sum, so this reconciles WITHIN each axis. Returns a category →
 * integer-tokens map (categories with no positive allocation are omitted).
 */
function roundCategoryTokensPerAxis(
  categoryTotals: CategoryTotals,
): Map<Category, number> {
  const byAxis: Record<Axis, Array<{ category: Category; tokens: number }>> = {
    input: [],
    output: [],
  };
  for (const [category, total] of Object.entries(categoryTotals)) {
    if (!total || total.tokens <= 0) continue;
    byAxis[axisOf(category as Category)].push({
      category: category as Category,
      tokens: total.tokens,
    });
  }

  const rounded = new Map<Category, number>();
  for (const axis of ["input", "output"] as const) {
    const entries = byAxis[axis];
    const target = Math.round(entries.reduce((sum, e) => sum + e.tokens, 0));
    const counts = largestRemainderRound(
      entries.map((e) => e.tokens),
      target,
    );
    entries.forEach((e, i) => rounded.set(e.category, counts[i] ?? 0));
  }
  return rounded;
}

/**
 * Round `values` to non-negative integers summing EXACTLY to `target`
 * (largest-remainder): floor everything, then hand the leftover +1s to the
 * entries with the largest fractional parts. `target` is `round(Σ values)`, so
 * the leftover count is in `[0, values.length]`.
 */
function largestRemainderRound(values: number[], target: number): number[] {
  const result = values.map((v) => Math.floor(v));
  let remainder = target - result.reduce((sum, f) => sum + f, 0);
  const byFracDesc = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFracDesc.length && remainder > 0; k++) {
    result[byFracDesc[k]!.i]! += 1;
    remainder -= 1;
  }
  return result;
}
