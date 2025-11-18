import type { LwObsEntitySpan, LwObsEntityTrace } from "./taxonomy";

type SpanCommandPattern = `${LwObsEntitySpan}.${string}`;
type TraceCommandPattern = `${LwObsEntityTrace}.${string}`;

const spanCommand = <T extends SpanCommandPattern>(name: T) => name;
const traceCommand = <T extends TraceCommandPattern>(name: T) => name;

export const COMMAND_TYPES = [
  spanCommand("lw.obs.span.ingestion.record"),
  traceCommand("lw.obs.trace.projection.rebuild"),
  traceCommand("lw.obs.trace.projection.rebuild_force"),
  traceCommand("lw.obs.trace.projection.rebuild_bulk"),
] as const;

/**
 * Strongly-typed command type identifiers.
 *
 * Command types represent the type of command being executed (e.g., "lw.obs.trace.projection.rebuild").
 * These are used for routing and processing commands in the event sourcing system.
 */
export type CommandType = (typeof COMMAND_TYPES)[number];
