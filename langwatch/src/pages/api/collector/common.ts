import type {
  BaseSpan,
  LLMSpan,
  RAGSpan,
  Span,
  SpanInputOutput,
  TypedValueJson,
} from "../../../server/tracer/types";

export const getFirstInputAsText = (spans: Span[]): string => {
  const topmostInputs = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "outside-in"
  ).filter(
    (span) =>
      span.input &&
      span.input.value &&
      (span.input.type !== "json" || !isEmptyJson(span.input.value))
  );

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

export const isEmptyJson = (value: TypedValueJson["value"]): boolean => {
  return (
    !value ||
    value === "null" ||
    value === "{}" ||
    (typeof value === "object" && Object.keys(value).length === 0)
  );
};

export const getLastOutputAsText = (spans: Span[]): string => {
  const bottommostOutputs = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "inside-out"
  )
    .reverse()
    .filter(
      (span) =>
        span.output &&
        span.type !== "guardrail" &&
        span.output.value &&
        (span.output.type !== "json" || !isEmptyJson(span.output.value))
    );

  const outputs = bottommostOutputs[0]?.output;
  if (!outputs) {
    return "";
  }
  const firstOutput = outputs;
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
  const stringified = (value_: any) => {
    if (typeof value_ === "string") {
      return value_;
    }
    try {
      return JSON.stringify(value_);
    } catch (e) {
      return value_.toString();
    }
  };

  if (typed.type == "text") {
    return typed.value;
  } else if (typed.type == "chat_messages") {
    if (last) {
      const lastMessage = typed.value[typed.value.length - 1];
      return lastMessage
        ? typeof lastMessage.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage.content)
          ? lastMessage.content
              .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
              .join("")
          : JSON.stringify(lastMessage)
        : "";
    } else {
      return typed.value
        .map((message) => message.content ?? JSON.stringify(message))
        .join("");
    }
  } else if (typed.type == "json") {
    const stringIfSpecialKeys = (json: any) => {
      // TODO: test those
      if (json.text !== undefined) {
        return stringified(json.text);
      }
      if (json.input !== undefined) {
        return stringified(json.input);
      }
      if (json.question !== undefined) {
        return stringified(json.question);
      }
      if (json.user_query !== undefined) {
        return stringified(json.user_query);
      }
      // Langflow
      if (json.input_value !== undefined) {
        return stringified(json.input_value);
      }
      // TODO: test this happens for finding outputs
      if (json.output !== undefined) {
        return stringified(json.output);
      }
      // Chainlit
      if (json.content !== undefined) {
        return stringified(json.content);
      }

      return undefined;
    };

    try {
      const json = typed.value as any;

      const value = stringIfSpecialKeys(json);
      if (value) {
        return value;
      }

      if (
        typeof json === "object" &&
        !Array.isArray(json) &&
        Object.keys(json).length === 1
      ) {
        const firstItem = json[Object.keys(json)[0]!];
        if (typeof firstItem === "object" && stringIfSpecialKeys(firstItem)) {
          return stringIfSpecialKeys(firstItem);
        }
        return stringified(firstItem);
      }

      return stringified(typed.value);
    } catch (_e) {
      return typed.value?.toString() ?? "";
    }
  } else if (typed.type == "raw") {
    return stringified(typed.value);
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
