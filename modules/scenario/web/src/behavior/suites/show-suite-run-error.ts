import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { showErrorToast } from "@langwatch/ui-host/errors";

/**
 * The codes that mean the run plan itself has nothing left to run.
 */
const NOTHING_RUNNABLE_CODES = new Set([
  "suite_all_scenarios_archived",
  "suite_all_targets_archived",
]);

/**
 * Reports a failed `suites.run` mutation.
 */
export function showSuiteRunError({
  error,
  fallbackTitle,
  onEditRunPlan,
}: {
  error: unknown;
  /** Headline for a failure the registry has no copy for. */
  fallbackTitle: string;
  /** Opens the run plan for editing — the fix for a plan with nothing to run. */
  onEditRunPlan: () => void;
}): void {
  const handled = readHandledError(error);
  const hasNothingRunnable = !!handled && NOTHING_RUNNABLE_CODES.has(handled.code);

  showErrorToast({
    error,
    fallbackTitle,
    ...(hasNothingRunnable ? { action: { label: "Edit Run Plan", run: onEditRunPlan } } : {}),
  });
}
