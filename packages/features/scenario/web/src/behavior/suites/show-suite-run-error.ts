import { explainHandledError, readHandledError, showErrorToast } from "../errors";
import { toaster } from "@langwatch/design-system/toaster";

/**
 * The codes that mean the run plan itself has nothing left to run.
 *
 * Both are curated rejections with the same single way out — open the plan and
 * put something runnable back in it — which is why they, and only they, get an
 * action button rather than the plain error toast.
 */
const NOTHING_RUNNABLE_CODES = new Set([
  "suite_all_scenarios_archived",
  "suite_all_targets_archived",
]);

/**
 * Reports a failed `suites.run` mutation.
 *
 * Both callers of that mutation — the sidebar's `useRunSuite` and the form
 * drawer's `useSuiteRunMutation` — had the same twenty-five lines: the same
 * code pair, the same `explainHandledError` call, the same toast, the same
 * "Edit Run Plan" label. Only the way the drawer opens differed, so that is the
 * only thing left as a parameter. Two copies of a rule about which failures are
 * actionable is two chances for them to disagree about it.
 *
 * The words stay in the registry, keyed by code — nothing here authors copy.
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

  if (handled && NOTHING_RUNNABLE_CODES.has(handled.code)) {
    const { title, description } = explainHandledError(handled);
    // STAYS ON THE DESIGN SYSTEM TOASTER, and it is the only failure in this
    // package that does. `ScenarioHostPort.failed` — and the `UiFailureNotice`
    // behind it — has no slot for an offered ACTION, and this toast is the
    // action: both codes mean the run plan has nothing runnable left in it, and
    // "Edit Run Plan" is the single way out. Routing it through the port would
    // buy the registry's words and lose the button that acts on them. The slot
    // is a change to the application's feedback capability rather than to this
    // package; see the plan doc's UI ledger.
    toaster.create({
      title,
      description: description || undefined,
      type: "error", // no-raw-error-toast-ok
      action: { label: "Edit Run Plan", onClick: onEditRunPlan },
    });
    return;
  }

  showErrorToast({ error, fallbackTitle });
}
