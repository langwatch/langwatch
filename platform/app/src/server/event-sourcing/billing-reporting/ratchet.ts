import {
  checkTypeStringRatchet,
  type RatchetViolation,
  type TypeStringSnapshot,
} from "@langwatch/event-sourcing";
import {
  type BillingReportingPipelineDeps,
  createBillingReportingPipeline,
} from "./index";
import snapshot from "./ratchet.snapshot.json";

/** The committed type-string snapshot (ADR-105 decision 10). Additions are
 *  free; a string this file remembers but the pipeline no longer declares
 *  means a persisted event or intent type just lost its route back into
 *  state. */
export const BILLING_REPORTING_TYPE_STRING_SNAPSHOT: TypeStringSnapshot =
  snapshot;

/**
 * What the vocabulary and the sweep's intents currently declare, derived by
 * building the pipeline itself. The deps are never called: deriving a type
 * string never writes to ClickHouse, resolves an organization, or dispatches
 * an intent.
 */
export function currentBillingReportingTypeStrings(): TypeStringSnapshot {
  const built = createBillingReportingPipeline(
    {} as BillingReportingPipelineDeps,
  );
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
export function checkBillingReportingRatchet(): readonly RatchetViolation[] {
  return checkTypeStringRatchet({
    snapshot: BILLING_REPORTING_TYPE_STRING_SNAPSHOT,
    current: currentBillingReportingTypeStrings(),
  });
}
