import { z } from "zod";

/** Exact output shape of the existing `traces.spanTreePaginated` route. */
export const spanTreeNodeSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  type: z.string().nullable(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  durationMs: z.number(),
  status: z.enum(["ok", "error", "unset"]),
  model: z.string().nullable(),
  toolName: z.string().nullish(),
  cost: z.number().nullish(),
  inputTokens: z.number().nullish(),
  outputTokens: z.number().nullish(),
  cacheReadTokens: z.number().nullish(),
  cacheCreationTokens: z.number().nullish(),
  updatedAtMs: z.number().nullish(),
});

export type SpanTreeNode = z.infer<typeof spanTreeNodeSchema>;

export const spanTreeCursorSchema = z.object({
  startTimeMs: z.number().int().min(0),
  spanId: z.string().min(1).max(128),
});

export type SpanTreeCursor = z.infer<typeof spanTreeCursorSchema>;

export const spanTreePageSchema = z.object({
  nodes: z.array(spanTreeNodeSchema),
  nextCursor: spanTreeCursorSchema.nullable(),
});

export type SpanTreePage = z.infer<typeof spanTreePageSchema>;

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;

/**
 * Lowercase-hex random id matching the OpenTelemetry id format (32 hex chars
 * for trace ids, 16 for span ids), via the global Web Crypto API so it works
 * the same on the server and in the bundled client.
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

export const generateOtelTraceId = (): string => generateRandomHexId(TRACE_ID_BYTES);

export const generateOtelSpanId = (): string => generateRandomHexId(SPAN_ID_BYTES);
