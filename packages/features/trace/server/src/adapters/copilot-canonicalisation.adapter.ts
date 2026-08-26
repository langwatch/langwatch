/**
 * Lifts Copilot-specific metadata from native spans. Standard `gen_ai.*`
 * attributes are handled by the preceding GenAI adapter.
 */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import { inferSpanTypeIfAbsent } from "../services/canonical-extraction.service";
import { isNonEmptyString } from "../services/canonical-guard.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

const COPILOT_ATTR_PREFIX = "github.copilot.";

/**
 * Copilot's instrumentation scope name. Verified on the wire: build
 * 1.0.71 emits `github.copilot` (the documented `COPILOT_OTEL_SOURCE_NAME`
 * default); `@github/copilot` is kept as a legacy alias for older builds.
 * Matching by scope — not only by a `github.copilot.*` attribute — is what
 * lets an `execute_tool` span (which may carry no vendor attribute) still
 * be recognized as copilot and classified as a tool span.
 */
export const COPILOT_SCOPES = ["github.copilot", "@github/copilot"];

/** Copilot's gen_ai.operation.name values → langwatch span types. */
const OPERATION_TO_SPAN_TYPE: Record<string, string> = {
  invoke_agent: "agent",
  execute_tool: "tool",
  chat: "llm",
};

export class CopilotCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "copilot";

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat, linear sequence of independent `take attribute → if present, lift` guards — the score comes from the count of one-line lifts, not tangled control flow; the branches don't interact.
  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const operation =
      ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME] ??
      attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    const scopeName = ctx.span.instrumentationScope?.name ?? "";
    // Scope/vendor attributes prevent foreign SDKs using the same operation names
    // from being classified as Copilot spans.
    const hasCopilotProvenance =
      COPILOT_SCOPES.includes(scopeName) || attrs.hasByPrefix(COPILOT_ATTR_PREFIX);
    if (!hasCopilotProvenance) {
      return;
    }

    const spanType =
      typeof operation === "string" ? OPERATION_TO_SPAN_TYPE[operation] : void 0;
    if (spanType !== void 0) {
      inferSpanTypeIfAbsent(ctx, spanType, `${this.id}:span_type.from_operation`);
    }

    if (operation === "invoke_agent" && this.hasTokenUsage(ctx)) {
      // The root operation repeats usage already emitted by its chat children.
      ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
      ctx.recordRule(`${this.id}:skip-rollup-usage`);
    }

    const reasoningTokens = attrs.get("gen_ai.usage.reasoning.output_tokens");
    if (
      typeof reasoningTokens === "number" &&
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS] === void 0
    ) {
      attrs.take("gen_ai.usage.reasoning.output_tokens");
      ctx.setAttr(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS, reasoningTokens);
      ctx.recordRule(`${this.id}:usage.reasoning`);
    }

    const pseudoId = attrs.get("enduser.pseudo.id");
    if (isNonEmptyString(pseudoId) && ctx.out[ATTR_KEYS.LANGWATCH_USER_ID] === void 0) {
      attrs.take("enduser.pseudo.id");
      ctx.setAttr(ATTR_KEYS.LANGWATCH_USER_ID, pseudoId);
      ctx.recordRule(`${this.id}:user.pseudo_id`);
    }

    const premiumRequests = attrs.take(`${COPILOT_ATTR_PREFIX}total_premium_requests`);
    if (premiumRequests !== void 0 && premiumRequests !== null) {
      ctx.setAttr("metadata.copilot_premium_requests", String(premiumRequests));
      ctx.recordRule(`${this.id}:premium_requests`);
    }

    const copilotCost = attrs.take(`${COPILOT_ATTR_PREFIX}cost`);
    if (copilotCost !== void 0 && copilotCost !== null) {
      ctx.setAttr("metadata.copilot_cost", String(copilotCost));
      ctx.recordRule(`${this.id}:cost_units`);
    }

    const nanoAiu = attrs.take(`${COPILOT_ATTR_PREFIX}nano_aiu`);
    if (nanoAiu !== void 0 && nanoAiu !== null) {
      ctx.setAttr("metadata.copilot_nano_aiu", String(nanoAiu));
      ctx.recordRule(`${this.id}:nano_aiu`);
    }

    const repository = attrs.take(`${COPILOT_ATTR_PREFIX}git.repository`);
    if (isNonEmptyString(repository)) {
      ctx.setAttr("metadata.copilot_repository", repository);
      ctx.recordRule(`${this.id}:repository`);
    }

    const organization = attrs.take(`${COPILOT_ATTR_PREFIX}github.org`);
    if (isNonEmptyString(organization)) {
      ctx.setAttr("metadata.copilot_organization", organization);
      ctx.recordRule(`${this.id}:organization`);
    }
  }

  /**
   * GenAICanonicalisationAdapter runs before this one and lifts native gen_ai.usage.*
   * into `out`, so look there as well as the still-unconsumed bag.
   */
  private hasTokenUsage(ctx: ExtractorContext): boolean {
    return (
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] !== void 0 ||
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS] !== void 0 ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS) ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS)
    );
  }
}
