import type { Named } from "@langwatch/module";
import { z } from "zod";

import { spanTreeCursorSchema } from "./trace.ts";

/** Exact transport input of `traces.spanTreePaginated`. */
const spanTreeTransportInputSchemaDefinition = z.object({
  projectId: z.string(),
  traceId: z.string(),
  limit: z.number().int().min(1).max(1000).default(200),
  cursor: spanTreeCursorSchema.optional(),
  occurredAtMs: z.number().int().optional(),
});
export interface SpanTreeTransportInputSchema extends Named<
  typeof spanTreeTransportInputSchemaDefinition
> {}
export const spanTreeTransportInputSchema: SpanTreeTransportInputSchema =
  spanTreeTransportInputSchemaDefinition;

/** Transport input plus the resolved authorization capability for the service. */
const spanTreeInputSchemaDefinition = z.object({
  ...spanTreeTransportInputSchema.shape,
  canSeeCosts: z.boolean(),
});
export interface SpanTreeInputSchema extends Named<typeof spanTreeInputSchemaDefinition> {}
export const spanTreeInputSchema: SpanTreeInputSchema = spanTreeInputSchemaDefinition;

export type SpanTreeInput = z.infer<typeof spanTreeInputSchema>;

/** Exact transport input of `traces.spanTreeDelta`. */
const spanTreeDeltaTransportInputSchemaDefinition = z.object({
  projectId: z.string(),
  traceId: z.string(),
  sinceUpdatedAtMs: z.number().int().min(0),
  occurredAtMs: z.number().int().optional(),
});
export interface SpanTreeDeltaTransportInputSchema extends Named<
  typeof spanTreeDeltaTransportInputSchemaDefinition
> {}
export const spanTreeDeltaTransportInputSchema: SpanTreeDeltaTransportInputSchema =
  spanTreeDeltaTransportInputSchemaDefinition;

/** Transport input plus the resolved authorization capability for the service. */
const spanTreeDeltaInputSchema = z.object({
  ...spanTreeDeltaTransportInputSchema.shape,
  canSeeCosts: z.boolean(),
});

export type SpanTreeDeltaInput = z.infer<typeof spanTreeDeltaInputSchema>;

const traceIngestWaitInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface TraceIngestWaitInputSchema extends Named<
  typeof traceIngestWaitInputSchemaDefinition
> {}
export const traceIngestWaitInputSchema: TraceIngestWaitInputSchema =
  traceIngestWaitInputSchemaDefinition;

export type TraceIngestWaitInput = z.infer<typeof traceIngestWaitInputSchema>;

/** Canonical Trace summary lookup for internal feature callers. */
const traceSummaryLookupInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();
export interface TraceSummaryLookupInputSchema extends Named<
  typeof traceSummaryLookupInputSchemaDefinition
> {}
export const traceSummaryLookupInputSchema: TraceSummaryLookupInputSchema =
  traceSummaryLookupInputSchemaDefinition;

export type TraceSummaryLookupInput = z.infer<typeof traceSummaryLookupInputSchema>;

const traceByIdInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    traceId: z.string().min(1),
  })
  .strict();
export interface TraceByIdInputSchema extends Named<typeof traceByIdInputSchemaDefinition> {}
export const traceByIdInputSchema: TraceByIdInputSchema = traceByIdInputSchemaDefinition;

export type TraceByIdInput = z.infer<typeof traceByIdInputSchema>;

const traceDerivedEventsInputSchemaDefinition = traceByIdInputSchema.safeExtend({
  occurredAtMs: z.number().int().nonnegative().optional(),
  foldVersion: z.number().int().nonnegative().optional(),
});
export interface TraceDerivedEventsInputSchema extends Named<
  typeof traceDerivedEventsInputSchemaDefinition
> {}
export const traceDerivedEventsInputSchema: TraceDerivedEventsInputSchema =
  traceDerivedEventsInputSchemaDefinition;

export type TraceDerivedEventsInput = z.infer<typeof traceDerivedEventsInputSchema>;
