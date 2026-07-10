import type { useLicenseEnforcement } from "./useLicenseEnforcement";

type EnforcementResult = ReturnType<typeof useLicenseEnforcement>;

/**
 * Chain multiple license enforcement checks sequentially.
 * Each check must pass before the next one runs.
 * If any check fails (shows upgrade modal), execution stops.
 *
 * @example
 * ```tsx
 * const workflowEnforcement = useLicenseEnforcement("workflows");
 * const agentEnforcement = useLicenseEnforcement("agents");
 *
 * // Before (callback hell):
 * workflowEnforcement.checkAndProceed(() => {
 *   agentEnforcement.checkAndProceed(() => {
 *     createWorkflowAgent();
 *   });
 * });
 *
 * // After (cleaner):
 * checkCompoundLimits(
 *   [workflowEnforcement, agentEnforcement],
 *   () => createWorkflowAgent()
 * );
 * ```
 */
export function checkCompoundLimits(
  enforcements: EnforcementResult[],
  onAllPassed: () => void
): void {
  const [first, ...rest] = enforcements;
  if (!first) {
    onAllPassed();
    return;
  }
  first.checkAndProceed(() => {
    checkCompoundLimits(rest, onAllPassed);
  });
}

/**
 * Promise-returning variant of {@link checkCompoundLimits} for async/await
 * call sites. Resolves `true` once every enforcement passes, or `false` as
 * soon as one is blocked. A blocked check shows its upgrade modal and never
 * calls back, so the blocked case is detected synchronously via `isAllowed`.
 */
export function checkCompoundLimitsAsync(
  enforcements: EnforcementResult[]
): Promise<boolean> {
  return new Promise((resolve) => {
    checkCompoundLimits(enforcements, () => resolve(true));
    if (enforcements.some((enforcement) => !enforcement.isAllowed)) {
      resolve(false);
    }
  });
}
