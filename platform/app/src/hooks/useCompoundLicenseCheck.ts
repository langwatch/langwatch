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
