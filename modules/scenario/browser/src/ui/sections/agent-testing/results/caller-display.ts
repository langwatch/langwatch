/**
 * Reading the caller of a run for the results table and header (AC24). A
 * voice run records `callerKind`: "simulated" for a pool run, "human" for a
 * panel run someone spoke on themselves. A text run records none, hiding the column.
 */

import type { ScenarioRunData } from "@langwatch/scenario-contract";

export type CallerKind = "simulated" | "human";

/**
 * The slice of run/scenario-state metadata this module actually reads. The
 * real metadata is a loose object carrying many other reserved keys, so this
 * keeps its own index signature rather than naming just the one it reads.
 */
type CallerMetadata =
  | { langwatch?: { [key: string]: unknown; callerKind?: unknown } | null }
  | null
  | undefined;

function isCallerKind(value: unknown): value is CallerKind {
  return value === "simulated" || value === "human";
}

function callerKindOf(metadata: CallerMetadata): CallerKind | null {
  const value = metadata?.langwatch?.callerKind;
  return isCallerKind(value) ? value : null;
}

export function runCallerKind(run: ScenarioRunData): CallerKind | null {
  return callerKindOf(run.metadata);
}

/**
 * True when a run's caller is a real person (a voice "Call it myself"
 * call), rendering their turns "You" not "User Simulator" (#8020). Takes
 * just the metadata slice so a run row or a live drawer stream can call it.
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
