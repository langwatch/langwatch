import type { Named } from "@langwatch/module";
/**
 * What trace answers a staff investigation (ADR-202 ops functions): ids, counts and times only,
 * never trace content, attributes, names or I/O. Times are epoch milliseconds.
 */
import { z } from "zod";

/** One project's ingestion over a range: traces stored, the latest, and plan-limit refusals. */
const traceIngestionCountSchemaDefinition = z.object({
  projectId: z.string(),
  traces: z.number().int().nonnegative(),
  lastTraceAt: z.number().int().nullable(),
  planLimitRefusals: z.number().int().nonnegative(),
});
export interface TraceIngestionCountSchema extends Named<
  typeof traceIngestionCountSchemaDefinition
> {}
export const traceIngestionCountSchema: TraceIngestionCountSchema =
  traceIngestionCountSchemaDefinition;
export type TraceIngestionCount = z.infer<typeof traceIngestionCountSchema>;

/** Where one trace id is stored in a project: when its spans arrived and how many there are. */
const tracePresenceSchemaDefinition = z.object({
  traceId: z.string(),
  projectId: z.string(),
  firstSeenAt: z.number().int(),
  lastSeenAt: z.number().int(),
  spanCount: z.number().int().nonnegative(),
});
export interface TracePresenceSchema extends Named<typeof tracePresenceSchemaDefinition> {}
export const tracePresenceSchema: TracePresenceSchema = tracePresenceSchemaDefinition;
export type TracePresence = z.infer<typeof tracePresenceSchema>;
