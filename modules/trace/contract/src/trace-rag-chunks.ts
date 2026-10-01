import {
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
  organizeSpansIntoTree,
  type SpanWithChildren,
} from "./trace-collector-common.ts";
import type { RAGChunk, RAGSpan, Span } from "./trace-format.schemas.ts";

export const addInputAndOutputForRAGs = (spans: Span[]): Span[] => {
  const inputOutputMap: Record<string, { input: RAGSpan["input"]; output: RAGSpan["output"] }> = {};

  const fillInputOutputMap = (flatSpans: Span[]): Span[] => {
    return flatSpans.map((span) => {
      const inputOutput = inputOutputMap[span.span_id];
      if (!inputOutput) {
        return span;
      }

      const { input, output } = inputOutput;
      return { ...span, input, output };
    });
  };

  const recursiveExtractInputAndOutput = (treeSpans: SpanWithChildren[]): void => {
    treeSpans.forEach((span) => {
      recursiveExtractInputAndOutput(span.children);

      if (span.type !== "rag" || (span.input && span.output)) {
        return;
      }

      const flatChildren = fillInputOutputMap(flattenSpanTree(span.children, "inside-out"));
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
