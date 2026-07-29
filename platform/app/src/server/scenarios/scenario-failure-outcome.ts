import { z } from "zod";

import { ScenarioRunStatus } from "./scenario-event.enums";

/**
 * How a run ended when it did not end itself.
 *
 * One modelled outcome rather than a set of mutually-exclusive booleans
 * (ADR-073 step 2). The predecessor was a lone `cancelled?: boolean` on
 * `FailureEventParams`; adding a second flag for "stalled" beside it would
 * have made two of the four combinations meaningless and left the caller to
 * remember which one wins.
 *
 * - `error`     — the run was attempted and failed. The default.
 * - `cancelled` — a user asked for it to stop.
 * - `stalled`   — nothing reported on it for longer than it was allowed to
 *   stay quiet, so whatever was executing it is gone. This is the status the
 *   read path used to *derive* per query; it is now written once and read as
 *   fact.
 */
export const SCENARIO_FAILURE_OUTCOMES = [
  "error",
  "cancelled",
  "stalled",
] as const;

export const scenarioFailureOutcomeSchema = z.enum(SCENARIO_FAILURE_OUTCOMES);

export type ScenarioFailureOutcome = z.infer<
  typeof scenarioFailureOutcomeSchema
>;

/** The terminal status each outcome is recorded as. */
export function statusForFailureOutcome(
  outcome: ScenarioFailureOutcome,
): ScenarioRunStatus {
  switch (outcome) {
    case "cancelled":
      return ScenarioRunStatus.CANCELLED;
    case "stalled":
      return ScenarioRunStatus.STALLED;
    case "error":
      return ScenarioRunStatus.ERROR;
  }
}
