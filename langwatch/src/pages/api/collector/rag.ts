import type { RAGSpan, Span } from "../../../server/tracer/types";
import {
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
  organizeSpansIntoTree,
  type SpanWithChildren,
} from "./common";

export const addInputAndOutputForRAGs = (spans: Span[]): Span[] => {
  const inputOutputMap: Record<
    string,
    { input: RAGSpan["input"]; outputs: RAGSpan["outputs"] }
  > = {};

  const fillInputOutputMap = (spans: Span[]): Span[] => {
    return spans.map((span) => {
      const inputOutput = inputOutputMap[span.id];
      if (!inputOutput) {
        return span;
      }

      const { input, outputs } = inputOutput;
      return { ...span, input, outputs };
    });
  };

  const recursiveExtractInputAndOutput = (spans: SpanWithChildren[]): void => {
    spans.forEach((span) => {
      recursiveExtractInputAndOutput(span.children);

      if (span.type !== "rag" || (span.input && span.outputs.length > 0)) {
        return;
      }

      const flatChildren = fillInputOutputMap(
        flattenSpanTree(span.children, "inside-out")
      );
      const input = getFirstInputAsText(flatChildren);
      const output = getLastOutputAsText(flatChildren);

      inputOutputMap[span.id] = {
        input: span.input ? span.input : { type: "text", value: input },
        outputs:
          span.outputs.length > 0
            ? span.outputs
            : [{ type: "text", value: output }],
      };
    });
  };

  const spansTree = organizeSpansIntoTree(spans);
  recursiveExtractInputAndOutput(spansTree);

  return fillInputOutputMap(spans);
};
