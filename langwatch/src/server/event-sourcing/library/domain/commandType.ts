import { z } from "zod";
import type {
  LwObsEntitySpanIngestion,
  LwObsEntityTraceAggregation,
} from "./taxonomy";

type SpanIngestionCommandPattern = `${LwObsEntitySpanIngestion}.${string}`;
type TraceAggregationCommandPattern =
  `${LwObsEntityTraceAggregation}.${string}`;

const spanIngestionCommand = <T extends SpanIngestionCommandPattern>(name: T) =>
  name;
const traceAggregationCommand = <T extends TraceAggregationCommandPattern>(
  name: T,
) => name;

export const COMMAND_TYPES = [
  spanIngestionCommand("lw.obs.span_ingestion.record"),
  traceAggregationCommand("lw.obs.trace_aggregation.trigger"),
] as const;

/**
 * Zod schema for command type identifiers.
 */
export const CommandTypeSchema = z.enum(COMMAND_TYPES);

/**
 * Strongly-typed command type identifiers.
 *
 * Command types represent the type of command being executed (e.g., "lw.obs.span.ingestion.record").
 * These are used for routing and processing commands in the event sourcing system.
 */
export type CommandType = z.infer<typeof CommandTypeSchema>;
