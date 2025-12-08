import { RandomIdGenerator } from "@opentelemetry/sdk-trace-web";
import type { LLMSpan, Span } from "../server/tracer/types";

export const getSpanNameOrModel = (span: Span) => {
  return (
    span.name ?? (span.type === "llm" ? (span as LLMSpan).model : undefined)
  );
};

export const generateOtelTraceId = (): string => {
  return new RandomIdGenerator().generateTraceId();
};

export const generateOtelSpanId = (): string => {
  return new RandomIdGenerator().generateSpanId();
};
