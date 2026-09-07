/**
 * Reading the caller of a run for the results table and the run header (AC24).
 *
 * A voice run records `callerKind` on its LangWatch metadata: "simulated" for a
 * pool run's simulated caller, "human" for a panel run someone spoke on
 * themselves. A text run records none, so the column stays hidden.
 */

import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

export type CallerKind = "simulated" | "human";

export function runCallerKind(run: ScenarioRunData): CallerKind | null {
  return run.metadata?.langwatch?.callerKind ?? null;
}

/** The words a person reads for each caller kind. */
export function callerLabel(kind: CallerKind): string {
  return kind === "human" ? "You" : "Simulated";
}

/** True when at least one run in the table has a caller, so the column shows. */
export function anyRunHasCaller(runs: ScenarioRunData[]): boolean {
  return runs.some((run) => runCallerKind(run) !== null);
}
