import { createHash } from "crypto";

import { ATTR_KEYS } from "@langwatch/span-normalisation";

import type { NormalizedAttributes } from "../trace.spans.ts";

/**
 * The ingest pipeline's own chunk flattening, close to but NOT the same as
 * `extractChunkTextualContent`: that one answers `""` for a parsed
 * primitive, this one answers the original string.
 */
function chunkText(object: unknown): string {
  let content = object;
  if (typeof content === "string") {
    try {
      content = JSON.parse(content);
    } catch {
      return (object as string).trim();
    }
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => chunkText(item))
      .filter((text) => text)
      .join("\n")
      .trim();
  }

  if (typeof content === "object" && content !== null) {
    return JSON.stringify(content);
  }

  return String(object).trim();
}

/** A RAG chunk's id when it arrived without one: a hash of its own text. */
export function ragDocumentIdFor(content: unknown): string {
  return createHash("md5").update(chunkText(content)).digest("hex");
}

/**
 * The span's RAG contexts with a `document_id` on every entry, for the caller
 * to write under the canonical key; `undefined` when the span carries none.
 */
export function deriveRagContextsWithIds(attributes: NormalizedAttributes): unknown[] | undefined {
  const raw =
    attributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] ??
    attributes[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS_LEGACY];
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.map((context: unknown) => {
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      return context;
    }

    const entry = context as Record<string, unknown>;
    if ("document_id" in entry && entry.document_id) {
      return entry;
    }

    return {
      ...entry,
      document_id: ragDocumentIdFor(entry.content !== undefined ? entry.content : context),
    };
  });
}
