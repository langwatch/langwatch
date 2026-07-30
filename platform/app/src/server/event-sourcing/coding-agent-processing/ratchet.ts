import {
  checkTypeStringRatchet,
  definePipeline,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
  CODING_AGENT_SESSION_PIPELINE_NAME,
  CODING_AGENT_SESSION_PIPELINE_PREFIX,
  codingAgentSessionEvents,
} from "./events";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 decision 10). A string this
 * file remembers but the pipeline no longer declares means a persisted event
 * type just lost its route back into state.
 */
export const CODING_AGENT_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  snapshot;

/**
 * What the vocabulary currently declares, in the shape the ratchet compares
 * against. Building only through `.events()` — no mount, no client — is
 * enough to derive the persisted strings.
 */
export function currentCodingAgentProcessingTypeStrings(): TypeStringSnapshot {
  const built = definePipeline(CODING_AGENT_SESSION_PIPELINE_NAME)
    .prefix(CODING_AGENT_SESSION_PIPELINE_PREFIX)
    .events(codingAgentSessionEvents)
    .build();
  return { [built.name]: built.eventTypes };
}

/** Checks the committed snapshot against what `events.ts` declares right now. */
export function checkCodingAgentProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: CODING_AGENT_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentCodingAgentProcessingTypeStrings(),
  });
}
