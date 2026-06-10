/**
 * Codex Extractor
 *
 * Handles: OpenAI Codex's native OpenTelemetry log records AND its
 * Rust-CLI native spans (scope `codex_cli_rs`).
 *
 * On the LOG side, Codex emits three event types this extractor claims:
 *
 * - `codex.sse_event`: the cost-bearing turn event with model + token
 *   counts + conversation.id + user.email. Codex does NOT emit a cost
 *   field on the wire; cost is filled downstream via the receiver-side
 *   model-pricing lookup once the unified pipeline is wired in.
 * - `codex.conversation_starts`: lets the trace summary show the
 *   conversation grouping (model + principal) even when the very
 *   first sse_event hasn't fired yet.
 * - `codex.user_prompt`: carries the user's prompt text, which the
 *   trace summary lifts onto langwatch.input.
 *
 * Log-side detection: attributes["event.name"] starts with "codex.".
 * Codex doesn't pin its log scope name in a stable way across releases,
 * so we gate on event.name (matches the bespoke
 * extractCodexSseEventMetrics + extractCodexConversationStartMetrics +
 * codex.user_prompt branch in extractIOFromLogRecord this class replaces).
 *
 * On the SPAN side, codex 0.137+ emits native spans under scope
 * `codex_cli_rs` to /v1/traces (Path B with `[otel.trace_exporter.otlp-http]`).
 * The `session_task.turn` span carries the full per-turn metadata as
 * codex-namespaced attributes:
 *   - model
 *   - codex.turn.token_usage.input_tokens / output_tokens
 *   - codex.turn.token_usage.cached_input_tokens (a.k.a. cache_read)
 *   - codex.turn.token_usage.reasoning_output_tokens (a.k.a. reasoning)
 *   - codex.turn.token_usage.total_tokens
 *   - codex.turn.reasoning_effort (the request setting, e.g. "high")
 *   - turn.id (a.k.a. thread / turn identifier)
 * This extractor lifts those to gen_ai.* canonical so the trace
 * summary fold mirrors them to the top-level columns and the
 * receiver-side pricing lookup computes cost (codex never emits cost
 * on the wire). The known per-response span that reports the same usage
 * natively (`handle_responses`) is flagged so the fold does not
 * double-count it.
 *
 * Canonical attributes produced (only when the corresponding wire
 * field is present):
 * - langwatch.model
 * - langwatch.input_tokens
 * - langwatch.output_tokens
 * - langwatch.cache_read_tokens
 * - langwatch.thread.id (from conversation.id OR turn.id)
 * - langwatch.principal.email (from user.email)
 * - langwatch.input (from codex.user_prompt prompt)
 */

import { ATTR_KEYS } from "./_constants";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const CODEX_EVENT_NAME_PREFIX = "codex.";
const CODEX_RUST_SCOPE_NAME = "codex_cli_rs";
const CODEX_TURN_SPAN_NAME = "session_task.turn";

// codex's per-response model-call span. Its gen_ai.usage.* is already summed
// into the `session_task.turn` rollup, so the fold must count the usage on
// exactly one of the two or the trace totals double. We keep the rollup and
// skip this known duplicate. Any OTHER usage-bearing span under the scope is
// deliberately NOT skipped: if a future codex release emits a model call whose
// usage is not folded into the turn rollup, counting it (a visible total) is
// safer than silently dropping its tokens, cost, and cache.
const CODEX_REDUNDANT_USAGE_SPAN_NAMES = new Set(["handle_responses"]);

const asNumber = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) ? n : null;
};

const asString = (raw: unknown): string | null =>
  typeof raw === "string" && raw.length > 0 ? raw : null;

export class CodexExtractor implements CanonicalAttributesExtractor {
  readonly id = "codex";

  apply(ctx: ExtractorContext): void {
    // Path A codex traffic flows through the gateway as gen_ai.*
    // spans; GenAIExtractor handles that side and emits canonical
    // attributes. This branch covers Path B native spans from the
    // Rust CLI (scope `codex_cli_rs`), where the per-turn
    // `session_task.turn` span carries codex-namespaced attributes
    // that won't match GenAIExtractor's gen_ai.* gates.
    //
    // Output target is the gen_ai.* OTel semconv (not langwatch.*),
    // because the trace-summary fold's SpanCostService.extractModelsFromSpan
    // + extractTokenMetrics read gen_ai.{request,response}.model and
    // gen_ai.usage.{input,output}_tokens. Writing langwatch.* would lift
    // attrs onto the span but leave Models=[] + TotalCost=NULL on the
    // trace summary — that's the log-record path's convention, not the
    // span path's. Mastra + Vercel + the rest of the extractors all
    // target gen_ai.* on the span side.
    if (ctx.span.instrumentationScope?.name !== CODEX_RUST_SCOPE_NAME) return;

    // codex emits ONE authoritative per-turn rollup span
    // (`session_task.turn`) carrying codex.turn.token_usage.*, AND a
    // lower-level response span (`handle_responses`) that natively reports
    // the SAME usage under gen_ai.usage.*. The rollup is the source of
    // truth; without intervention the fold sums both and the trace's token
    // totals double. Flag the known-redundant response span so the fold skips
    // its token math — its own per-span detail is left untouched.
    if (ctx.span.name !== CODEX_TURN_SPAN_NAME) {
      this.markRedundantUsageSpan(ctx);
      return;
    }

    // The turn rollup is the agentic step that contains the model call(s).
    // Without a type the drawer renders it as a generic span; "agent" gives
    // it the right icon + grouping so a codex trace reads as an agent turn
    // rather than two untyped orphan rows.
    ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "agent");

    const { attrs } = ctx.bag;
    const model = asString(attrs.take("model"));
    const inputTokens = asNumber(
      attrs.take("codex.turn.token_usage.input_tokens"),
    );
    const outputTokens = asNumber(
      attrs.take("codex.turn.token_usage.output_tokens"),
    );
    const cacheReadTokens = asNumber(
      attrs.take("codex.turn.token_usage.cached_input_tokens"),
    );
    const reasoningTokens = asNumber(
      attrs.take("codex.turn.token_usage.reasoning_output_tokens"),
    );
    const reasoningEffort = asString(attrs.take("codex.turn.reasoning_effort"));
    const turnId = asString(attrs.take("turn.id"));

    let fired = false;
    if (model !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_REQUEST_MODEL, model);
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, model);
      fired = true;
    }
    if (inputTokens !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
      fired = true;
    }
    if (outputTokens !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      fired = true;
    }
    if (cacheReadTokens !== null) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        cacheReadTokens,
      );
      fired = true;
    }
    if (reasoningTokens !== null) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        reasoningTokens,
      );
      fired = true;
    }
    if (reasoningEffort !== null) {
      ctx.setAttrIfAbsent(
        ATTR_KEYS.GEN_AI_REQUEST_REASONING_EFFORT,
        reasoningEffort,
      );
      fired = true;
    }
    if (turnId !== null) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, turnId);
      fired = true;
    }
    if (fired) ctx.recordRule("codex/session_task.turn");
  }

  /**
   * Handles a non-turn `codex_cli_rs` span that carries token usage.
   * GenAIExtractor runs before this one and lifts native gen_ai.usage.* into
   * `out`, so we look there as well as the still-unconsumed bag.
   *
   * Two distinct effects, deliberately decoupled:
   * - Typing: any usage-bearing span is a model call, so it gets `llm` so the
   *   drawer renders it under the agent turn with the model icon.
   * - Skip marker: only KNOWN duplicates of the turn rollup
   *   (`handle_responses`) get `skip_token_accumulation`. An unrecognised
   *   usage-bearing span keeps its tokens so a future codex span whose usage is
   *   NOT folded into the rollup is counted rather than silently dropped.
   * Nothing is removed from the span itself either way.
   */
  private markRedundantUsageSpan(ctx: ExtractorContext): void {
    const hasUsage =
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] !== undefined ||
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS] !== undefined ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS) ||
      ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS);
    if (!hasUsage) return;

    ctx.setAttrIfAbsent(ATTR_KEYS.SPAN_TYPE, "llm");

    if (!CODEX_REDUNDANT_USAGE_SPAN_NAMES.has(ctx.span.name)) return;
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION, "true");
    ctx.recordRule("codex/skip-redundant-usage");
  }

  applyLog(ctx: LogExtractorContext): void {
    const eventName = ctx.bag.attrs.get("event.name");
    if (typeof eventName !== "string") return;
    if (!eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) return;

    if (eventName === "codex.sse_event") {
      this.liftSseEvent(ctx);
      return;
    }
    if (eventName === "codex.conversation_starts") {
      this.liftConversationStarts(ctx);
      return;
    }
    if (eventName === "codex.user_prompt") {
      this.liftUserPrompt(ctx);
      return;
    }
  }

  private liftSseEvent(ctx: LogExtractorContext): void {
    const model = asString(ctx.bag.attrs.take("model"));
    const inputTokens = asNumber(ctx.bag.attrs.take("input_token_count"));
    const outputTokens = asNumber(ctx.bag.attrs.take("output_token_count"));
    const cacheReadTokens = asNumber(ctx.bag.attrs.take("cached_token_count"));
    const threadId = asString(ctx.bag.attrs.take("conversation.id"));
    const principalEmail = asString(ctx.bag.attrs.take("user.email"));

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (inputTokens !== null) {
      ctx.setAttr("langwatch.input_tokens", String(inputTokens));
      fired = true;
    }
    if (outputTokens !== null) {
      ctx.setAttr("langwatch.output_tokens", String(outputTokens));
      fired = true;
    }
    if (cacheReadTokens !== null) {
      ctx.setAttr("langwatch.cache_read_tokens", String(cacheReadTokens));
      fired = true;
    }
    if (threadId !== null) {
      ctx.setAttr("langwatch.thread.id", threadId);
      fired = true;
    }
    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }
    if (fired) ctx.recordRule("codex/sse_event");
  }

  private liftConversationStarts(ctx: LogExtractorContext): void {
    const model = asString(ctx.bag.attrs.take("model"));
    const principalEmail = asString(ctx.bag.attrs.take("user.email"));

    let fired = false;
    if (model !== null) {
      ctx.setAttr("langwatch.model", model);
      fired = true;
    }
    if (principalEmail !== null) {
      ctx.setAttr("langwatch.principal.email", principalEmail);
      fired = true;
    }
    if (fired) ctx.recordRule("codex/conversation_starts");
  }

  private liftUserPrompt(ctx: LogExtractorContext): void {
    const prompt = asString(ctx.bag.attrs.take("prompt"));
    if (prompt === null) return;
    ctx.setAttr("langwatch.input", prompt);
    ctx.recordRule("codex/user_prompt");
  }
}
