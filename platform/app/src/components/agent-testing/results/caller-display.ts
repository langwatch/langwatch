/**
 * Reading the caller of a run for the results table and the run header (AC24).
 *
 * A voice run records `callerKind` on its LangWatch metadata: "simulated" for a
 * pool run's simulated caller, "human" for a panel run someone spoke on
 * themselves. A text run records none, so the column stays hidden.
 */

import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

export type CallerKind = "simulated" | "human";

/** The slice of run/scenario-state metadata this module actually reads. */
type CallerMetadata =
  | { langwatch?: { callerKind?: CallerKind | null } | null }
  | null
  | undefined;

function callerKindOf(metadata: CallerMetadata): CallerKind | null {
  return metadata?.langwatch?.callerKind ?? null;
}

export function runCallerKind(run: ScenarioRunData): CallerKind | null {
  return callerKindOf(run.metadata);
}

/**
 * True when a run's caller is a real person (a voice "Call it myself" call),
 * so their turns render as "You" rather than the LLM "User Simulator"
 * (#8020). Takes just the metadata slice so both a run row and a live
 * drawer's scenario-state stream can call it directly.
 */
export function isHumanCallerRun(metadata: CallerMetadata): boolean {
  return callerKindOf(metadata) === "human";
}

/**
 * "You" rather than the vendor-neutral "human", because a panel run's caller
 * is literally the person reading the table, not a labelled test persona.
 */
export function callerLabel(kind: CallerKind): string {
  return kind === "human" ? "You" : "Simulated";
}

/** True when at least one run in the table has a caller, so the column shows. */
export function anyRunHasCaller(runs: ScenarioRunData[]): boolean {
  return runs.some((run) => runCallerKind(run) !== null);
}
