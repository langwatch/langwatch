/**
 * GitHub Copilot CLI Extractor (sourceType `copilot_cli`, ADR-039)
 *
 * Handles: the Copilot-SPECIFIC attributes on Copilot CLI's native OTel
 * spans. Copilot (>= 1.0.41) emits standard GenAI semantic-convention
 * spans — model, token usage (incl. cache/reasoning splits),
 * gen_ai.input/output.messages content (with
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true),
 * gen_ai.conversation.id — ALL of which the GenAIExtractor earlier in
 * the chain already canonicalises with zero copilot-specific code. This
 * extractor deliberately does NOT touch any gen_ai.* key; it lifts only
 * the extras (attribute names verified against the copilot 1.0.69
 * native runtime string table):
 *
 * - `enduser.pseudo.id` → langwatch.user.id (a salted per-user hash —
 *   stable for grouping, carries no PII)
 * - `github.copilot.total_premium_requests` → metadata.copilot_premium_requests
 *   (premium-request consumption — the unit Copilot seat quotas bill in)
 * - `github.copilot.cost` → metadata.copilot_cost (Copilot's own cost
 *   figure in premium-request units, NOT dollars — deliberately kept
 *   out of langwatch cost fields so the pricing-lookup pipeline stays
 *   the single source of dollar cost)
 * - `github.copilot.git.repository` / `github.copilot.github.org` →
 *   metadata.copilot_repository / metadata.copilot_organization
 * - span type inferred from gen_ai.operation.name (invoke_agent →
 *   agent, execute_tool → tool, chat → llm) when nothing upstream set
 *   one — copilot names spans by operation, not by type.
 *
 * Registered AFTER GenAIExtractor: it reads only keys GenAI never
 * consumes, so ordering matters for the span-type inference (respects
 * an upstream decision) but nothing else.
 */

import { ATTR_KEYS } from "./_constants";
import { inferSpanTypeIfAbsent } from "./_extraction";
import { isNonEmptyString } from "./_guards";
import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
} from "./_types";

const COPILOT_ATTR_PREFIX = "github.copilot.";

/** Copilot CLI's instrumentation scope name (verified, copilot 1.0.69). */
export const COPILOT_SCOPE = "@github/copilot";

/** Copilot's gen_ai.operation.name values → langwatch span types. */
const OPERATION_TO_SPAN_TYPE: Record<string, string> = {
  invoke_agent: "agent",
  execute_tool: "tool",
  chat: "llm",
};

export class CopilotExtractor implements CanonicalAttributesExtractor {
  readonly id = "copilot";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // Span-type inference from the operation name GenAI left in place
    // (GenAI derives operation FROM span type, never the reverse).
    const operation =
      ctx.out[ATTR_KEYS.GEN_AI_OPERATION_NAME] ??
      attrs.get(ATTR_KEYS.GEN_AI_OPERATION_NAME);
    // Gate everything on copilot provenance so a non-copilot GenAI span
    // (e.g. a user's own SDK emitting invoke_agent) is left untouched.
    // `enduser.pseudo.id` is deliberately NOT a trigger — it's standard
    // OTel semconv any tenant SDK may emit; consuming it here would
    // rename a foreign tenant's attribute. Provenance = copilot's
    // instrumentation scope (`@github/copilot`, verified on the 1.0.69
    // wire) or a github.copilot.* attribute.
    const scopeName = ctx.span.instrumentationScope?.name ?? "";
    const hasCopilotProvenance =
      scopeName === COPILOT_SCOPE || attrs.hasByPrefix(COPILOT_ATTR_PREFIX);
    if (!hasCopilotProvenance) return;

    if (typeof operation === "string" && OPERATION_TO_SPAN_TYPE[operation]) {
      inferSpanTypeIfAbsent(
        ctx,
        OPERATION_TO_SPAN_TYPE[operation]!,
        `${this.id}:span_type.from_operation`,
      );
    }

    const pseudoId = attrs.take("enduser.pseudo.id");
    if (isNonEmptyString(pseudoId)) {
      ctx.setAttrIfAbsent(ATTR_KEYS.LANGWATCH_USER_ID, pseudoId);
      ctx.recordRule(`${this.id}:user.pseudo_id`);
    }

    const premiumRequests = attrs.take(
      `${COPILOT_ATTR_PREFIX}total_premium_requests`,
    );
    if (premiumRequests !== undefined && premiumRequests !== null) {
      ctx.setAttr("metadata.copilot_premium_requests", String(premiumRequests));
      ctx.recordRule(`${this.id}:premium_requests`);
    }

    const copilotCost = attrs.take(`${COPILOT_ATTR_PREFIX}cost`);
    if (copilotCost !== undefined && copilotCost !== null) {
      ctx.setAttr("metadata.copilot_cost", String(copilotCost));
      ctx.recordRule(`${this.id}:cost_units`);
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
}
