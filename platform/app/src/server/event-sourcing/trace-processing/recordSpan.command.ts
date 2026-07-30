import type { EmittedEvent } from "@langwatch/event-sourcing";
import { traceEvents } from "./events";
import type { CanonicalSpan } from "./schema";

/**
 * The trust boundary (ADR-105 decision 7). OTLP normalization, PII redaction,
 * cost/token enrichment and attribute capping all run upstream, never here —
 * this command is a pure function of an already-canonical span.
 */
export async function recordSpan(
  input: CanonicalSpan,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "spanReceived", data: input }];
}
