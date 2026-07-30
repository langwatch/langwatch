import {
  checkTypeStringRatchet,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import { logRecord } from "./aggregate";
import snapshot from "./ratchet.snapshot.json";

/**
 * The committed type-string snapshot (ADR-105 §3). Additions are free; a
 * string this file remembers but the aggregate no longer declares is a
 * violation — it means a persisted event type just lost its route back into
 * state. Bump this file in the same commit as any change to `aggregate.ts`'s
 * `events` map.
 */
export const LOG_PROCESSING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot = snapshot;

/** What the aggregate currently declares, in the shape the ratchet compares against. */
export function currentLogProcessingTypeStrings(): TypeStringSnapshot {
  return { [logRecord.name]: logRecord.eventTypes };
}

/** Checks the committed snapshot against what `aggregate.ts` declares right now. */
export function checkLogProcessingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: LOG_PROCESSING_TYPE_STRING_SNAPSHOT,
    current: currentLogProcessingTypeStrings(),
  });
}
