/**
 * Traceloop Extractor
 *
 * Handles: Traceloop SDK telemetry (traceloop.* namespace)
 * Reference: https://github.com/traceloop/openllmetry
 *
 * Traceloop (OpenLLMetry) uses its own attribute conventions that need to be
 * mapped to canonical gen_ai.* attributes.
 *
 * Detection: Presence of traceloop.span.kind or traceloop.entity.* attributes
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from traceloop.span.kind)
 * - gen_ai.input.messages (from traceloop.entity.input)
 * - gen_ai.output.messages (from traceloop.entity.output)
 */

import { ATTR_KEYS } from "./_constants";
import {
  ALLOWED_SPAN_TYPES,
  extractInputMessages,
  extractOutputMessages,
} from "./_helpers";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class TraceloopExtractor implements CanonicalAttributesExtractor {
  readonly id = "traceloop";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    // ─────────────────────────────────────────────────────────────────────────
    // Span Type (from traceloop.span.kind)
    // Maps Traceloop's span kind to canonical type
    // ─────────────────────────────────────────────────────────────────────────
    if (!attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      const rawKind = attrs.take(ATTR_KEYS.TRACELOOP_SPAN_KIND);
      const kind = typeof rawKind === "string" ? rawKind.toLowerCase() : null;

      if (kind && ALLOWED_SPAN_TYPES.has(kind)) {
        ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
        ctx.recordRule(`${this.id}:span.kind`);
      }
    } else {
      // Consume attribute even if not used, to reduce leftovers
      attrs.take(ATTR_KEYS.TRACELOOP_SPAN_KIND);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages (from traceloop.entity.input)
    // ─────────────────────────────────────────────────────────────────────────
    extractInputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.TRACELOOP_ENTITY_INPUT] }],
      `${this.id}:entity.input->gen_ai.input.messages`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages (from traceloop.entity.output)
    // ─────────────────────────────────────────────────────────────────────────
    extractOutputMessages(
      ctx,
      [{ type: "attr", keys: [ATTR_KEYS.TRACELOOP_ENTITY_OUTPUT] }],
      `${this.id}:entity.output->gen_ai.output.messages`,
    );
  }
}
