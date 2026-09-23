/**
 * What an `eval` chip wears: "(pending)" until a run is registered for it,
 * "(partial…)" once its run ended short of its total, and a sweep while it runs.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import {
  type ExplorerInstantEvalProgress,
  isExplorerInstantEvalRunActive,
} from "@langwatch/trace-contract";

type ChipRun = Pick<ExplorerInstantEvalProgress, "status" | "progress" | "total">;

/** Whether an `eval` chip's run is being estimated, started or judged. */
export function isInstantEvalBusy({
  isEstimating,
  isStarting,
  chips,
  runs,
}: {
  isEstimating: boolean;
  isStarting: boolean;
  chips: readonly { runId: string | null }[];
  runs: Readonly<Record<string, Pick<ExplorerInstantEvalProgress, "status">>>;
}): boolean {
  if (isEstimating || isStarting) return true;
  return chips.some((chip) => {
    const run = chip.runId === null ? undefined : runs[chip.runId];
    return run !== undefined && isExplorerInstantEvalRunActive(run.status);
  });
}

/** A marked chip reads like an unmarked one: the question in its quotes. */
export function instantEvalChipLabel({
  question,
  mark,
}: {
  question: string;
  mark: string;
}): string {
  return `"${question}" ${mark}`;
}

/** The chip's mark, or null while it judges, before its counters settle, or once finished whole. */
export function instantEvalChipMark({
  run,
  hasRun,
  isSettled = true,
}: {
  run: ChipRun | undefined;
  hasRun: boolean;
  /** False while an ended run's counters may still move. */
  isSettled?: boolean;
}): string | null {
  if (!hasRun) return "(pending)";
  if (!run) return null;
  if (isExplorerInstantEvalRunActive(run.status) || !isSettled) return null;
  const ended = run.status === "cancelled" || run.status === "failed";
  if (ended && (run.total === null || run.progress < run.total)) {
    const judged = run.progress.toLocaleString();
    const total = run.total === null ? "?" : run.total.toLocaleString();
    return `(partial: ${judged} of ${total} judged)`;
  }
  return null;
}

/** The overlay labels of the marked `eval` chips: field, then question. */
export function instantEvalChipMarks({
  chips,
  runs,
  settled,
}: {
  chips: readonly { field: string; question: string; runId: string | null }[];
  runs: Readonly<Record<string, ChipRun>>;
  settled: Readonly<Record<string, true>>;
}): Record<string, Record<string, string>> {
  const marks: Record<string, Record<string, string>> = {};
  for (const chip of chips) {
    const mark = instantEvalChipMark({
      run: chip.runId === null ? undefined : runs[chip.runId],
      hasRun: chip.runId !== null,
      isSettled: chip.runId !== null && settled[chip.runId] === true,
    });
    if (!mark) continue;
    marks[chip.field] = {
      ...marks[chip.field],
      [chip.question]: instantEvalChipLabel({ question: chip.question, mark }),
    };
  }
  return marks;
}
