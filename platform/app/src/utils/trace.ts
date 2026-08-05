import type { LLMSpan, Span } from "../server/tracer/types";

export const getSpanNameOrModel = (span: Span) => {
  return (
    span.name ?? (span.type === "llm" ? (span as LLMSpan).model : undefined)
  );
};

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;

/**
 * Lowercase-hex random id matching the OpenTelemetry id format
 * (32 hex chars for trace ids, 16 for span ids). Generated with the global
 * Web Crypto API, which is available in both modern Node and the browser,
 * so it works the same on the server and in the bundled client.
 */
const generateRandomHexId = (byteCount: number): string => {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

export const generateOtelTraceId = (): string =>
  generateRandomHexId(TRACE_ID_BYTES);

export const generateOtelSpanId = (): string =>
  generateRandomHexId(SPAN_ID_BYTES);
