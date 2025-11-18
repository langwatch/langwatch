import type { LwObsEntitySpan, LwObsEntityTrace } from "./taxonomy";

type SpanEventPattern = `${LwObsEntitySpan}.${string}`;
type TraceEventPattern = `${LwObsEntityTrace}.${string}`;

const spanEvent = <T extends SpanEventPattern>(name: T) => name;
const traceEvent = <T extends TraceEventPattern>(name: T) => name;

export const EVENT_TYPES = [
  spanEvent("lw.obs.span.ingestion.recorded"),
  traceEvent("lw.obs.trace.projection.reset"),
  traceEvent("lw.obs.trace.projection.recomputed"),
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
