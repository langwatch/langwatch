import {
  checkTypeStringRatchet,
  definePipeline,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
  TRACE_PIPELINE_NAME,
  TRACE_PIPELINE_PREFIX,
  traceEvents,
} from "./events";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 decision 10). Additions are
 * free; a string this file remembers but the pipeline no longer declares
 * means a persisted event type just lost its route back into state.
 */
export const TRACE_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  snapshot;

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentTraceProcessingTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(TRACE_PIPELINE_NAME)
    .prefix(TRACE_PIPELINE_PREFIX)
    .events(traceEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkTraceProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: TRACE_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentTraceProcessingTypeStrings(),
  });
}
