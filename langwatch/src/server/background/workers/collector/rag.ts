import type { RAGChunk, RAGSpan, Span } from "../../../tracer/types";
import {
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
  organizeSpansIntoTree,
  type SpanWithChildren,
} from "./common";
import crypto from "crypto";

export const addInputAndOutputForRAGs = (spans: Span[]): Span[] => {
  const inputOutputMap: Record<
    string,
    { input: RAGSpan["input"]; output: RAGSpan["output"] }
  > = {};

  const fillInputOutputMap = (spans: Span[]): Span[] => {
    return spans.map((span) => {
      const inputOutput = inputOutputMap[span.span_id];
      if (!inputOutput) {
        return span;
      }

      const { input, output } = inputOutput;
      return { ...span, input, output };
    });
  };

  const recursiveExtractInputAndOutput = (spans: SpanWithChildren[]): void => {
    spans.forEach((span) => {
      recursiveExtractInputAndOutput(span.children);

      if (span.type !== "rag" || (span.input && span.output)) {
        return;
      }

      const flatChildren = fillInputOutputMap(
        flattenSpanTree(span.children, "inside-out")
      );
      const input = getFirstInputAsText(flatChildren);
      const output = getLastOutputAsText(flatChildren);

      inputOutputMap[span.span_id] = {
        input: span.input ? span.input : { type: "text", value: input },
        output: span.output ? span.output : { type: "text", value: output },
      };
    });
  };

  const spansTree = organizeSpansIntoTree(spans);
  recursiveExtractInputAndOutput(spansTree);

  return fillInputOutputMap(spans);
};

export const extractRAGTextualContext = (contexts?: RAGChunk[]) => {
  return (contexts ?? [])
    .map((context) => {
      return extractChunkTextualContent(context.content);
    })
    .filter((x) => x);
};

export const extractChunkTextualContent = (object: any): string => {
  let content = object;
  if (typeof content === "string") {
    try {
      content = JSON.parse(content);
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

export const maybeAddIdsToContextList = (
  contexts: (RAGChunk["content"] | null)[]
): RAGChunk[] => {
  const everyWithoutId =
    Array.isArray(contexts) &&
    contexts.every(
      (context) =>
        !context || typeof context !== "object" || !("document_id" in context)
    );
  if (!everyWithoutId) return contexts as RAGChunk[];

  return contexts.filter(Boolean).map((content) => ({
    document_id:
      content &&
      typeof content === "object" &&
      "document_id" in content &&
      content.document_id
        ? content.document_id
        : crypto
            .createHash("md5")
            .update(extractChunkTextualContent(content))
            .digest("hex"),
    content:
      content && typeof content === "object" && "content" in content
        ? content.content
        : content,
  }));
};
