import {
    checkTypeStringRatchet,
    definePipeline,
    type RatchetViolation,
    type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
    SIMULATION_RUN_PIPELINE_NAME,
    SIMULATION_RUN_PIPELINE_PREFIX,
    simulationRunEvents,
} from "./events";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 decision 10). Additions are
 * free; a string this file remembers but the pipeline no longer declares
 * means a persisted event type just lost its route back into state.
 */
export const SIMULATION_RUN_TYPE_STRING_SNAPSHOT: TypeStringSnapshot = snapshot;

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentSimulationRunTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(SIMULATION_RUN_PIPELINE_NAME)
    .prefix(SIMULATION_RUN_PIPELINE_PREFIX)
    .events(simulationRunEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkSimulationRunRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: SIMULATION_RUN_TYPE_STRING_SNAPSHOT,
    current: currentSimulationRunTypeStrings(),
  });
}
