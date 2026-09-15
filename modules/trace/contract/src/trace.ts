import { z } from "zod";

/** Exact output shape of the existing `tracesV2.spanTreePaginated` route. */
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
