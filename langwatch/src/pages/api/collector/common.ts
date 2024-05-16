import type {
  BaseSpan,
  LLMSpan,
  RAGSpan,
  Span,
  SpanInputOutput,
} from "../../../server/tracer/types";

export const getFirstInputAsText = (spans: Span[]): string => {
  const topmostInputs = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "outside-in"
  ).filter((span) => span.input);

  const input = topmostInputs[0]?.input;
  if (!input) {
    return "";
  }
  const text = typedValueToText(input, true);
  if (
    !text &&
    topmostInputs[0]?.name === "RunnableSequence" &&
    topmostInputs[1]?.input
  ) {
    return typedValueToText(topmostInputs[1].input, true);
  }
  return text;
};

export const getLastOutputAsText = (spans: Span[]): string => {
  const bottommostOutputs = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "inside-out"
  )
    .reverse()
    .filter((span) => span.outputs.length > 0);

  const outputs = bottommostOutputs[0]?.outputs;
  if (!outputs) {
    return "";
  }
  const firstOutput = outputs[0];
  if (!firstOutput) {
    return "";
  }

  return typedValueToText(firstOutput, true);
};

// TODO: test
export const typedValueToText = (
  typed: SpanInputOutput,
  last = false
): string => {
  if (typed.type == "text") {
    return typed.value;
  } else if (typed.type == "chat_messages") {
    if (last) {
      const lastMessage = typed.value[typed.value.length - 1];
      return lastMessage
        ? lastMessage.content ?? JSON.stringify(lastMessage)
        : "";
    } else {
      return typed.value
        .map((message) => message.content ?? JSON.stringify(message))
        .join("");
    }
  } else if (typed.type == "json") {
    try {
      const json = typed.value as any;
      // TODO: test those
      if (json.text !== undefined) {
        return json.text;
      }
      if (json.input !== undefined) {
        return json.input;
      }
      if (json.question !== undefined) {
        return json.question;
      }
      if (json.user_query !== undefined) {
        return json.user_query;
      }
      // TODO: test this happens for finding outputs
      if (json.output !== undefined) {
        return json.output;
      }
      return JSON.stringify(typed.value);
    } catch (_e) {
      return typed.value?.toString() ?? "";
    }
  } else if (typed.type == "raw") {
    return typed.value;
  }

  return "";
};

interface BaseSpanWithChildren extends BaseSpan {
  children: SpanWithChildren[];
}
interface LLMSpanWithChildren extends LLMSpan {
  children: SpanWithChildren[];
}
interface RAGSpanWithChildren extends RAGSpan {
  children: SpanWithChildren[];
}
export type SpanWithChildren =
  | BaseSpanWithChildren
  | LLMSpanWithChildren
  | RAGSpanWithChildren;

export const organizeSpansIntoTree = (spans: Span[]): SpanWithChildren[] => {
  const spanMap = new Map<string, SpanWithChildren>();

  // Sort based on started_at timestamp, so that all siblings are in started_at order
  const sortedSpans = [...spans].sort(
    (a, b) => a.timestamps.started_at - b.timestamps.started_at
  );

  // Initialize each span with an empty children array
  sortedSpans.forEach((span) => {
    spanMap.set(span.span_id, { ...span, children: [] });
  });

  // Assign children to their respective parents
  sortedSpans.forEach((span) => {
    if (span.parent_id && spanMap.has(span.parent_id)) {
      spanMap.get(span.parent_id)!.children.push(spanMap.get(span.span_id)!);
    }
  });

  // Extract top-level spans (those without a parent_id or with a non-existent parent_id)
  return Array.from(spanMap.values()).filter(
    (span) => !span.parent_id || !spanMap.has(span.parent_id)
  );
};

export const flattenSpanTree = (
  spans: SpanWithChildren[],
  mode: "inside-out" | "outside-in"
): Span[] => {
  const result: Span[] = [];

  const appendSpans = (spans: SpanWithChildren[]) => {
    spans.forEach((span) => {
      const spanWithoutChildren: Span = { ...span };
      //@ts-ignore
      delete spanWithoutChildren.children;
      result.push(spanWithoutChildren);
    });
  };

  const traverseAndCollect = (spans: SpanWithChildren[]) => {
    if (mode == "outside-in") {
      appendSpans(spans);
    }

    spans.forEach((span) => {
      if (span.children && span.children.length > 0) {
        traverseAndCollect(span.children);
      }
    });

    if (mode == "inside-out") {
      appendSpans(spans);
    }
  };

  traverseAndCollect(spans);

  return result;
};
