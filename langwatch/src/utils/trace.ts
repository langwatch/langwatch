import { type LLMSpan, type Span } from "../server/tracer/types";

export const getSpanNameOrModel = (span: Span) => {
  return (
    span.name ?? (span.type === "llm" ? (span as LLMSpan).model : undefined)
  );
};
