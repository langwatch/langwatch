import { createHash } from "node:crypto";

import { extractChunkTextualContent, type RAGChunk } from "@langwatch/trace-contract";

export const maybeAddIdsToContextList = (contexts: (RAGChunk["content"] | null)[]): RAGChunk[] => {
  const everyWithoutId =
    Array.isArray(contexts) &&
    contexts.every(
      (context) => !context || typeof context !== "object" || !("document_id" in context),
    );
  if (!everyWithoutId) return contexts as RAGChunk[];

  return contexts.filter(Boolean).map((content) => {
    const isRecord = content && typeof content === "object";
    const hasDocumentId = isRecord && "document_id" in content && Boolean(content.document_id);
    const hasContent = isRecord && "content" in content;

    return {
      document_id: hasDocumentId
        ? content.document_id
        : createHash("md5").update(extractChunkTextualContent(content)).digest("hex"),
      content: hasContent ? content.content : content,
    };
  });
};
