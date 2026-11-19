/**
 * A schedule's runs in the order its process started them. A slot is no such order: an operator's
 * run is for the moment it was asked, and a late wake keeps its earlier slot.
 * @see modules/insight/adrs/004-daily-run.md
 */

/** Where a run stands; `since`, when it started, is absent on a run an older worker carried. */
export type RunOrder = Readonly<{ runId: string; slot: number; since?: number | null }>;

/**
 * Below zero when `run` started before `other`, zero for the same run, above zero after. A run is
 * ordered by its start, or by its slot when it carries none: a slot is never after its start. A
 * tie is broken by run id, so every worker orders two runs the same way.
 */
export function compareRunOrder(run: RunOrder, other: RunOrder): number {
  if (run.runId === other.runId) return 0;
  const byStart = (run.since ?? run.slot) - (other.since ?? other.slot);
  if (byStart !== 0) return byStart;
  return run.runId < other.runId ? -1 : 1;
}

/** Whether `run` started before the newest run a row took; a row that took none has no newest. */
export function isOlderRun({ run, newest }: { run: RunOrder; newest: RunOrder | null }): boolean {
  return newest !== null && compareRunOrder(run, newest) < 0;
}
