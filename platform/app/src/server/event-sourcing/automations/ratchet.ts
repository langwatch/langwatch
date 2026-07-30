import {
  checkTypeStringRatchet,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
  type AutomationsPipelineDeps,
  createAutomationsPipeline,
} from "./index";
import snapshot from "./ratchet.snapshot.json";

/** The committed type-string snapshot (ADR-105 decision 10). Additions are
 *  free; a string this file remembers but the pipeline no longer declares
 *  means a persisted event or intent type just lost its route back into
 *  state. */
export const AUTOMATIONS_TYPE_STRING_SNAPSHOT: TypeStringSnapshot = snapshot;

/**
 * What the vocabulary and every process manager's intents currently declare,
 * derived by building the pipeline itself rather than restated by hand — a
 * renamed intent key changes here automatically. The ports are never called:
 * an intent's `deliver` closure only reaches them once dispatched, and
 * deriving a type string never dispatches anything.
 */
export function currentAutomationsTypeStrings(): TypeStringSnapshot {
  const built = createAutomationsPipeline({} as AutomationsPipelineDeps);
  const snapshot: Record<string, readonly string[]> = {
    [built.name]: built.eventTypes,
  };
  for (const [name, processManager] of Object.entries(built.processManagers)) {
    snapshot[name] = processManager.intentTypes;
  }
  return snapshot;
}

/** Checks the committed snapshot against what the pipeline currently
 *  declares. */
export function checkAutomationsRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: AUTOMATIONS_TYPE_STRING_SNAPSHOT,
    current: currentAutomationsTypeStrings(),
  });
}
