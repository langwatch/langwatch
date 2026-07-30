import {
  checkTypeStringRatchet,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import { codingAgentSession } from "./aggregate";
import snapshot from "./ratchet.snapshot.json";

/**
 * A string this snapshot remembers but the aggregate no longer declares means
 * a persisted event type just lost its route back into state. Bump it in the
 * same commit as any change to `aggregate.ts`'s `events` map.
 */
export const CODING_AGENT_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  snapshot;

/** What the aggregate currently declares, in the shape the ratchet compares against. */
export function currentCodingAgentProcessingTypeStrings(): TypeStringSnapshot {
  return { [codingAgentSession.name]: codingAgentSession.eventTypes };
}

/** Checks the committed snapshot against what `aggregate.ts` declares right now. */
export function checkCodingAgentProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: CODING_AGENT_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentCodingAgentProcessingTypeStrings(),
  });
}
