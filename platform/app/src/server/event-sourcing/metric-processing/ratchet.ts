import {
  checkTypeStringRatchet,
  definePipeline,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import { METRIC_PIPELINE_NAME, METRIC_PIPELINE_PREFIX, metricProcessingEvents } from "./events";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 decision 10). Additions are
 * free; a string this file remembers but the pipeline no longer declares
 * means a persisted event type just lost its route back into state.
 */
export const METRIC_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot = snapshot;

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentMetricProcessingTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(METRIC_PIPELINE_NAME)
    .prefix(METRIC_PIPELINE_PREFIX)
    .events(metricProcessingEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkMetricProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: METRIC_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentMetricProcessingTypeStrings(),
  });
}
