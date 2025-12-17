import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { safeJsonParse, extractInputMessages, extractOutputMessages, inferSpanTypeIfAbsent } from "./_helpers";
import { ATTR_KEYS } from "./_constants";
import type { NormalizedEvent } from "../../schemas/spans";

const ROLE_EVENT_NAMES = [
  "gen_ai.system.message",
  "gen_ai.user.message",
  "gen_ai.assistant.message",
  "gen_ai.tool.message",
] as const;

/**
 * Extracts canonical attributes from Strands spans.
 *
 * Handles:
 * - Role-based message events (`gen_ai.system.message`, `gen_ai.user.message`, etc.) → `gen_ai.input.messages`
 * - `gen_ai.choice` events → `gen_ai.output.messages`
 * - Infers `langwatch.span.type` as "llm" for Strands spans
 *
 * Only processes spans that match Strands instrumentation scope or have Strands-specific attributes.
 *
 * @example
 * ```typescript
 * const extractor = new StrandsExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class StrandsExtractor implements CanonicalAttributesExtractor {
  readonly id = "strands";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const scopeName = ctx.span.instrumentationScope?.name;
    const isStrands =
      scopeName === "strands.telemetry.tracer" ||
      scopeName === "opentelemetry.instrumentation.strands" ||
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SYSTEM_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.SERVICE_NAME) === "strands-agents" ||
      attrs.get(ATTR_KEYS.GEN_AI_AGENT_NAME) === "Strands Agents";

    if (!isStrands) return;

    // type default
    inferSpanTypeIfAbsent(ctx, "llm", `${this.id}:type=llm`);

    // input messages from role message events (manual extraction for multiple event types)
    if (!ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES)) {
      const input: unknown[] = [];
      for (const n of ROLE_EVENT_NAMES) {
        const evs = ctx.bag.events.takeAll(n);
        for (const ev of evs) {
          const role = n.split(".")[1]; // system/user/assistant/tool
          const a = (ev.attributes ?? {}) as Record<string, unknown>;
          const content = a.content ?? a.message ?? a.text;
          if (content !== undefined) {
            input.push({ role, content: safeJsonParse(content) });
          }
        }
      }
      if (input.length > 0) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, input);
        ctx.recordRule(`${this.id}:events->gen_ai.input.messages`);
      }
    }

    // output from choices
    extractOutputMessages(
      ctx,
      [
        {
          type: "event",
          name: "gen_ai.choice",
          extractor: (ev: NormalizedEvent) => {
            const a = (ev.attributes ?? {}) as Record<string, unknown>;
            const message = a.message ?? a.content ?? a.text;
            const role = (a.role as string | undefined) ?? "assistant";
            if (message !== undefined) {
              return {
                role,
                content: safeJsonParse(message),
                finish_reason: a.finish_reason,
              };
            }
            return undefined;
          },
        },
      ],
      `${this.id}:gen_ai.choice->gen_ai.output.messages`
    );

    // model sometimes appears as attributes on strands spans; do not fight other extractors
    const model =
      attrs.get(ATTR_KEYS.GEN_AI_REQUEST_MODEL) ?? attrs.get(ATTR_KEYS.GEN_AI_RESPONSE_MODEL);
    if (typeof model === "string" && model.length > 0) {
      // no-op; just a signal that this extractor matched
      ctx.recordRule(`${this.id}:matched`);
    }
  }
}
