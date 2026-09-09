/**
 * What to call each workbench action while the page carries it out.
 */
export const WORKBENCH_ACTION_NARRATION: Record<string, string> = {
  "workbench.duplicateTarget": "Duplicating the column",
  "workbench.setTargetPrompt": "Writing the new prompt",
  "workbench.updateTargetModel": "Switching the model",
  "workbench.setMapping": "Connecting the column to the data",
  "workbench.setEvaluatorMapping": "Connecting the evaluator",
  "workbench.addEvaluator": "Adding the evaluator",
  "workbench.addTarget": "Adding a column",
  "workbench.setCellValue": "Filling in a cell",
  "workbench.addColumn": "Adding a dataset column",
  "workbench.addRows": "Adding rows",
  "workbench.removeTarget": "Removing the column",
  "workbench.getState": "Reading the workbench",
  "workbench.run": "Starting the run",
};

/** The line for one action, or null when the kind has nothing to say. */
export function narrateWorkbenchAction(kind: string): string | null {
  return WORKBENCH_ACTION_NARRATION[kind] ?? null;
}

/**
 * The line for a run in flight. Named by column so a reader with six columns
 * knows which one is filling, and counted so a long run reads as progress
 * rather than as a stall.
 */
export function narrateWorkbenchRun({
  targetName,
  completed,
  total,
}: {
  targetName?: string | null;
  completed: number;
  total: number;
}): string {
  const what = targetName ? `Running ${targetName}` : "Running the evaluation";
  if (total <= 0) return what;
  return `${what} — ${completed} of ${total} cells`;
}
