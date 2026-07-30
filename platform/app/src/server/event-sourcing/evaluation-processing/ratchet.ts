import {
    checkTypeStringRatchet,
    definePipeline,
    type RatchetViolation,
    type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
    EVALUATION_PIPELINE_NAME,
    EVALUATION_PIPELINE_PREFIX,
    evaluationEvents,
} from "./events";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 decision 10). Additions are
 * free; a string this file remembers but the pipeline no longer declares
 * means a persisted event type just lost its route back into state.
 */
export const EVALUATION_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  snapshot;

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentEvaluationProcessingTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(EVALUATION_PIPELINE_NAME)
    .prefix(EVALUATION_PIPELINE_PREFIX)
    .events(evaluationEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkEvaluationProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: EVALUATION_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentEvaluationProcessingTypeStrings(),
  });
}
