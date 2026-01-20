/**
 * Haystack Extractor
 *
 * Handles: Haystack framework telemetry
 * Reference: https://haystack.deepset.ai/
 *
 * Haystack is a framework for building RAG pipelines. This extractor handles
 * retrieval.documents to extract RAG contexts.
 *
 * Detection: Presence of retrieval.documents attribute
 *
 * Canonical attributes produced:
 * - langwatch.span.type (rag)
 * - langwatch.rag.contexts (from retrieval.documents)
 */

import { ATTR_KEYS } from "./_constants";
import { inferSpanTypeIfAbsent, isRecord, safeJsonParse } from "./_helpers";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

export class HaystackExtractor implements CanonicalAttributesExtractor {
  readonly id = "haystack";

  apply(ctx: ExtractorContext): void {
    // ─────────────────────────────────────────────────────────────────────────
    // Detection Check
    // Only process spans from Haystack instrumentation
    // ─────────────────────────────────────────────────────────────────────────
    if (
      ctx.span.instrumentationScope.name !==
      "openinference.instrumentation.haystack"
    ) {
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Retrieval Documents → RAG Contexts
    // Haystack stores retrieved documents in retrieval.documents attribute
    // ─────────────────────────────────────────────────────────────────────────
    const documentsRaw = ctx.bag.attrs.get(ATTR_KEYS.RETRIEVAL_DOCUMENTS);
    if (documentsRaw === void 0) {
      return;
    }

    const parsed = safeJsonParse(documentsRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return;
    }

    // Transform Haystack document format to LangWatch RAG context format
    const contexts = parsed
      .map((doc) => {
        if (!isRecord(doc)) return null;

        const document = (doc as Record<string, unknown>).document;
        if (!isRecord(document)) return null;

        const content = (document as Record<string, unknown>).content;
        if (typeof content !== "string" || content.length === 0) return null;

        const id = (document as Record<string, unknown>).id;
        return {
          ...(typeof id === "string" && id.length > 0
            ? { document_id: id }
            : {}),
          content,
        };
      })
      .filter(
        (x): x is { content: string; document_id?: string } => x !== null,
      );

    if (contexts.length === 0) {
      return;
    }

    // Note: We do not consume retrieval.documents (it's not "owned" by this extractor)
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, contexts);
    inferSpanTypeIfAbsent(ctx, "rag", `${this.id}:type=rag`);
    ctx.recordRule(`${this.id}:retrieval.documents->langwatch.rag.contexts`);
  }
}
