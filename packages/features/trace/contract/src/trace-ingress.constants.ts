/** Durable raw ingress fact. Its name, version, and payload are replay compatibility. */
export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;
export const SPAN_RECEIVED_EVENT_VERSION_LATEST = "2025-12-14" as const;

export const SPAN_RECEIVED_EVENT_VERSIONS = [SPAN_RECEIVED_EVENT_VERSION_LATEST] as const;

/** Legacy raw-span command accepted by the OTLP ingress boundary. */
export const RECORD_SPAN_COMMAND_TYPE = "lw.obs.trace.record_span" as const;

/** Maximum accepted span age, shared by every Trace ingestion transport. */
export const SPAN_MAX_PAST_MS = 31 * 24 * 60 * 60 * 1000;
