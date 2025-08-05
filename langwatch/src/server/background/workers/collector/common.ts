import type {
  BaseSpan,
  LLMSpan,
  RAGSpan,
  Span,
  SpanInputOutput,
  TypedValueJson,
} from "../../../tracer/types";

export const getFirstInputAsText = (spans: Span[]): string => {
  const topmostSpans = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "outside-in"
  );

  const topmostInputs = topmostSpans.filter(
    (span) =>
      span.input &&
      span.input.value &&
      span.type !== "evaluation" &&
      span.type !== "guardrail" &&
      (span.input.type !== "json" || !isEmptyJson(span.input.value)) &&
      // Agent inputs captured by openinference from agno are not really human redable, skip it
      !(
        span.params?.scope?.name == "openinference.instrumentation.agno" &&
        span.type == "agent"
      )
  );

  let input = topmostInputs[0]?.input;
  // Haystack
  if (
    topmostSpans[0]?.type === "chain" &&
    topmostSpans[0]?.params?.scope?.name?.includes("haystack") &&
    typeof (topmostSpans[0]?.input?.value as any)?.data === "object"
  ) {
    input = {
      type: "json",
      value: Object.values(
        (topmostSpans[0]?.input?.value as any)?.data
      )[0] as any,
    };
  }
  if (!input) {
    const topmostSpan = topmostSpans.filter((span) => !span.parent_id)[0];
    if (
      topmostSpan?.params?.http?.method &&
      topmostSpan?.params?.http?.target
    ) {
      return `${topmostSpan?.params?.http?.method} ${topmostSpan?.params?.http?.target}`;
    }
    return topmostSpan?.name ?? "";
  }
  const text = typedValueToText(input, true);
  if (
    !text &&
    topmostInputs[0]?.name?.startsWith("RunnableSequence") &&
    topmostInputs[1]?.input
  ) {
    return typedValueToText(topmostInputs[1].input, true);
  }
  return text;
};

export const isEmptyJson = (value: TypedValueJson["value"]): boolean => {
  let isEmpty =
    !value ||
    value === "null" ||
    value === "{}" ||
    (typeof value === "object" && Object.keys(value).length === 0);

  if (
    !isEmpty &&
    typeof value === "object" &&
    value &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1
  ) {
    const value_ = value[Object.keys(value)[0]!];
    isEmpty = isEmptyJson(value_);
  }

  return isEmpty;
};

export const getLastOutputAsText = (spans: Span[]): string => {
  const nonEmptySpan = (span: Span) =>
    span.output &&
    span.output.value &&
    span.type !== "evaluation" &&
    span.type !== "guardrail" &&
    (span.output.type !== "json" || !isEmptyJson(span.output.value));

  // First we try to see if the topLevel node has a valid output, if so, we go with that, so users
  // can take control of which output to use by controlling the top level one by hand, even if it
  // doesn't finish last because of some background process span being captured
  const topLevelNodes = flattenSpanTree(
    organizeSpansIntoTree(spans),
    "inside-out"
  )
    .filter(nonEmptySpan)
    .reverse();
  const singleTopLevelNode =
    topLevelNodes.length === 1 ? topLevelNodes[0] : undefined;

  if (singleTopLevelNode?.output) {
    return typedValueToText(singleTopLevelNode.output, true);
  }

  // If the top-level node has no output, then for getting the best text that represents the output,
  // we try to find the last span to finish, this is likely the one that came up with the final answer
  const spansInFinishOrderDesc = spans
    .sort((a, b) => b.timestamps.finished_at - a.timestamps.finished_at)
    .filter(nonEmptySpan);

  const outputs = spansInFinishOrderDesc[0]?.output;
  if (!outputs) {
    const topmostSpan = flattenSpanTree(
      organizeSpansIntoTree(spans),
      "outside-in"
    ).filter((span) => !span.parent_id)[0];
    if (topmostSpan?.params?.http?.status_code) {
      return topmostSpan.params.http.status_code.toString();
    }
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
              .map((c) => ("text" in c ? c.text : JSON.stringify(c)))
              .join("")
          : JSON.stringify(lastMessage)
        : "";
    } else {
      return typed.value
        .map((message) => message.content ?? JSON.stringify(message))
        .join("");
    }
  } else if (typed.type == "json") {
    const specialKeysMapping = (json: any): string | undefined => {
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
      if (json.query !== undefined) {
        return json.user_query;
      }
      if (json.message !== undefined && typeof json.message === "string") {
        return json.message;
      }
      // Langflow
      if (json.input_value !== undefined) {
        return json.input_value;
      }
      // TODO: test this happens for finding outputs
      if (json.output !== undefined) {
        return json.output;
      }

      if (json.answer !== undefined) {
        return json.answer;
      }

      // Chainlit
      if (json.content !== undefined) {
        return json.content;
      }

      // Haystack
      if (json.prompt !== undefined) {
        return json.prompt;
      }

      // Langgraph on Flowise
      if (
        json.messages?.length > 0 &&
        json.messages?.[json.messages?.length - 1]?.content !== undefined
      ) {
        return json.messages[json.messages?.length - 1].content;
      }
      if (json.return_values?.output !== undefined) {
        return json.return_values.output;
      }

      // LangChain
      if (typeof json.inputs === "object" && json.inputs.input !== undefined) {
        return json.inputs.input;
      }
      if (typeof json.inputs === "object" && json.inputs.text !== undefined) {
        return json.inputs.text;
      }
      if (typeof json.inputs === "object" && json.inputs.query !== undefined) {
        return json.inputs.query;
      }
      if (
        typeof json.inputs === "object" &&
        json.inputs.question !== undefined
      ) {
        return json.inputs.question;
      }
      if (
        typeof json.outputs === "object" &&
        json.outputs.output !== undefined
      ) {
        return json.outputs.output;
      }
      if (typeof json.outputs === "string") {
        return json.outputs;
      }
      if (typeof json.outputs === "object" && json.outputs.text !== undefined) {
        return json.outputs.text;
      }
      if (Array.isArray(json.llm?.replies)) {
        return json.llm.replies[0];
      }

      // Langgraph.js

      if (
        Array.isArray(json.messages) &&
        Array.isArray(json.messages.at(-1)?.id) &&
        json.messages.at(-1)?.id.includes("AIMessage") &&
        json.messages.at(-1)?.kwargs?.content
      ) {
        return json.messages.at(-1)?.kwargs?.content;
      }

      // Optimization Studio
      if (json.end !== undefined) {
        return specialKeysMapping(json.end) ?? json.end;
      }

      return undefined;
    };

    const firstAndOnlyKey = (json: any) => {
      if (
        typeof json === "object" &&
        !Array.isArray(json) &&
        Object.keys(json).length === 1
      ) {
        const firstItem = json[Object.keys(json)[0]!];
        const mapped =
          typeof firstItem === "object"
            ? specialKeysMapping(firstItem)
            : undefined;
        if (mapped !== undefined) {
          return stringified(mapped);
        }
        return stringified(firstItem);
      }

      return undefined;
    };

    try {
      const json = typed.value as any;

      const value =
        Array.isArray(json) && json.length == 1
          ? typeof json[0] === "string"
            ? json[0]
            : specialKeysMapping(json[0])
          : specialKeysMapping(json);
      if (value !== undefined) {
        return firstAndOnlyKey(value) ?? stringified(value);
      }

      return firstAndOnlyKey(json) ?? stringified(json);
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
