/** Maps Haystack retrieval documents to canonical RAG contexts. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import { inferSpanTypeIfAbsent } from "../services/canonical-extraction.service";
import { isRecord } from "../services/canonical-guard.service";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";

export class HaystackCanonicalisationAdapter implements CanonicalAttributesPort {
  readonly id = "haystack";

  apply(ctx: ExtractorContext): void {
    if (ctx.span.instrumentationScope.name !== "openinference.instrumentation.haystack") {
      return;
    }

    const documents = ctx.bag.attrs.get(ATTR_KEYS.RETRIEVAL_DOCUMENTS);
    if (documents === void 0) {
      return;
    }

    if (!Array.isArray(documents) || documents.length === 0) {
      return;
    }

    const contexts = documents
      .map((doc: unknown) => {
        if (!isRecord(doc)) {
          return null;
        }

        const document = doc.document;
        if (!isRecord(document)) {
          return null;
        }

        const content = document.content;
        if (typeof content !== "string" || content.length === 0) {
          return null;
        }

        const id = document.id;
        return {
          ...(typeof id === "string" && id.length > 0 ? { document_id: id } : {}),
          content,
        };
      })
      .filter((x): x is { content: string; document_id?: string } => x !== null);

    if (contexts.length === 0) {
      return;
    }

    ctx.setAttr(ATTR_KEYS.LANGWATCH_RAG_CONTEXTS, contexts);
    inferSpanTypeIfAbsent(ctx, "rag", `${this.id}:type=rag`);
    ctx.recordRule(`${this.id}:retrieval.documents->langwatch.rag.contexts`);
  }
}
