import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";
import { safeJsonParse, isRecord, inferSpanTypeIfAbsent } from "./_helpers";
import { ATTR_KEYS } from "./_constants";

/**
 * Extracts canonical attributes from Haystack spans.
 * 
 * Handles:
 * - `retrieval.documents` → `langwatch.rag.contexts`
 * - Infers `langwatch.span.type` as "rag" if contexts are found
 * 
 * Extracts document content and IDs from Haystack's retrieval.documents format.
 * 
 * @example
 * ```typescript
 * const extractor = new HaystackExtractor();
 * extractor.apply(ctx);
 * ```
 */
export class HaystackExtractor implements CanonicalAttributesExtractor {
  readonly id = "haystack";

  apply(ctx: ExtractorContext): void {
    const docsRaw = ctx.bag.attrs.get(ATTR_KEYS.RETRIEVAL_DOCUMENTS);
    if (docsRaw === undefined) return;

    const parsed = safeJsonParse(docsRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const contexts = parsed
      .map((d) => {
        if (!isRecord(d)) return null;
        const document = (d as Record<string, unknown>).document;
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
        (x): x is { content: string; document_id?: string } => x !== null
      );

    if (contexts.length === 0) return;

    // we do not consume retrieval.documents (it's not "owned" by us unless you want it gone)
    ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, contexts);
    inferSpanTypeIfAbsent(ctx, "rag", `${this.id}:type=rag`);
    ctx.recordRule(`${this.id}:retrieval.documents->langwatch.rag.contexts`);
  }
}
