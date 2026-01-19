/**
 * OpenInference Extractor
 *
 * Handles: OpenInference semantic conventions (openinference.* namespace)
 * Reference: https://github.com/Arize-ai/openinference
 *
 * OpenInference is a set of conventions used by Arize Phoenix and related tools.
 * This extractor primarily handles span kind mapping.
 *
 * Detection: Presence of openinference.span.kind attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (from openinference.span.kind)
 */

import { ATTR_KEYS } from "./_constants";
import { ALLOWED_SPAN_TYPES } from "./_helpers";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class OpenInferenceExtractor implements CanonicalAttributesExtractor {
  readonly id = "openinference";

  apply(ctx: ExtractorContext): void {
    // ─────────────────────────────────────────────────────────────────────────
    // Span Type (from openinference.span.kind)
    // Skip if explicit type is already set
    // ─────────────────────────────────────────────────────────────────────────
    const explicitType = ctx.bag.attrs.get(ATTR_KEYS.SPAN_TYPE);
    if (
      typeof explicitType === "string" &&
      ALLOWED_SPAN_TYPES.has(explicitType)
    ) {
      return;
    }

    const rawKind = ctx.bag.attrs.take(ATTR_KEYS.OPENINFERENCE_SPAN_KIND);
    const kind = typeof rawKind === "string" ? rawKind.toLowerCase() : null;

    if (!kind || !ALLOWED_SPAN_TYPES.has(kind)) {
      return;
    }

    ctx.setAttr(ATTR_KEYS.SPAN_TYPE, kind);
    ctx.recordRule(`${this.id}:openinference.span.kind->langwatch.span.type`);
  }
}
