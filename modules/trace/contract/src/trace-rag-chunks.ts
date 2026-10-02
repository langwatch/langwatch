import type { RAGChunk } from "./trace-format.schemas.ts";

export const extractRAGTextualContext = (contexts?: RAGChunk[]): string[] => {
  return (contexts ?? [])
    .map((context) => {
      return extractChunkTextualContent(context.content);
    })
    .filter((x) => x);
};

export const extractChunkTextualContent = (object: unknown): string => {
  let content: unknown = object;
  if (typeof object === "string") {
    try {
      content = JSON.parse(object);
    } catch {
      return object.trim();
    }
  }
  if (Array.isArray(content)) {
    return content
      .map(extractChunkTextualContent)
      .filter((x) => x)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    return JSON.stringify(content);
  }

  return "";
};
