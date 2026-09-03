/**
 * Whether one more of something is within the licence, and what to do when it
 * is not.
 *
 * Moved with the invitation flow, which is its only remaining consumer of any
 * kind. THE PATTERN IS CLICK-THEN-MODAL on purpose: the button is never
 * disabled, because a disabled control tells a customer nothing about why, and
 * the refusal explains itself and offers the upgrade.
 *
 * Optimistic while the check is still loading, which is the right direction:
 * the server enforces the limit again on the write, so the worst case is a
 * refusal one round trip later rather than a member blocked from inviting
 * anybody while a query settles.
 */

import type { LimitType } from "@langwatch/enterprise-licensing-contract";
// THE UPGRADE MODAL IS ANOTHER PACKAGE'S, and this is its address rather than a
// copy: the store is a zustand singleton exported by `@langwatch/workflow-web`,
// so opening it here and mounting it there is one modal. Nothing mounts it
// above a screen served from `apps/ui` yet — the overlay gap every family since
// governance has recorded — so on that half a blocked invite reports through
// the notice and opens nothing.
import { useUpgradeModalStore } from "@langwatch/workflow-web/stores/upgradeModalStore";
import { useCallback } from "react";
import { api } from "./organization-api";
import { useOrganizationTeamProject } from "./use-organization-team-project";

/**
 * Hook for enforcing license limits in the UI.
 *
 * Uses the "click-then-modal" pattern: allows users to click buttons,
 * then shows an upgrade modal if they've hit their limit.
 *
 * @example
 * ```tsx
 * function CreateWorkflowButton() {
 *   const { checkAndProceed } = useLicenseEnforcement("workflows");
 *
 *   const handleClick = () => {
 *     checkAndProceed(() => {
 *       // User is allowed - proceed with creation
 *       createWorkflow();
 *     });
 *   };
 *
 *   return <Button onClick={handleClick}>Create Workflow</Button>;
 * }
 * ```
 */
export function useLicenseEnforcement(limitType: LimitType) {
  const { organization } = useOrganizationTeamProject();
  const openUpgradeModal = useUpgradeModalStore((state) => state.open);

  const checkResult = api.licenseEnforcement.checkLimit.useQuery(
    { organizationId: organization?.id ?? "", limitType },
    { enabled: !!organization?.id },
  );

  const reportBlocked = api.licenseEnforcement.reportLimitBlocked.useMutation();

  /**
   * Check if the action is allowed, and either proceed or show upgrade modal.
   * Returns the result of onAllowed if allowed, undefined if blocked.
   * When blocked, fires a fire-and-forget notification to the backend.
   * @param onAllowed - Callback to execute if the action is allowed
   */
  const checkAndProceed = useCallback(
    <T,>(onAllowed: () => T): T | undefined => {
      if (!checkResult.data) {
        // Data not yet loaded - allow action (optimistic)
        return onAllowed();
      }

      if (checkResult.data.allowed) {
        return onAllowed();
      } else {
        openUpgradeModal(limitType, checkResult.data.current, checkResult.data.max);
        // Fire-and-forget: notify backend that a UI pre-check blocked the user
        if (organization?.id) {
          reportBlocked.mutate({
            organizationId: organization.id,
            limitType,
          });
        }
        return undefined;
      }
    },
    [checkResult.data, openUpgradeModal, limitType, organization?.id, reportBlocked],
  );

  return {
    /** Check limit and proceed if allowed, otherwise show upgrade modal */
    checkAndProceed,
    /** Whether the limit check is still loading */
    isLoading: checkResult.isLoading,
    /** Whether creating another resource is currently allowed */
    isAllowed: checkResult.data?.allowed ?? true,
    /** Full limit information (current, max, allowed) */
    limitInfo: checkResult.data,
  };
}
