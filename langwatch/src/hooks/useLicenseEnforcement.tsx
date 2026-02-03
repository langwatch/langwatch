import { useCallback } from "react";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";
import type { LimitType } from "../server/license-enforcement";

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

  /**
   * Check if the action is allowed, and either proceed or show upgrade modal.
   * @param onAllowed - Callback to execute if the action is allowed
   */
  const checkAndProceed = useCallback(
    (onAllowed: () => void) => {
      if (!checkResult.data) {
        // Data not yet loaded - allow action (optimistic)
        onAllowed();
        return;
      }

      if (checkResult.data.allowed) {
        onAllowed();
      } else {
        openUpgradeModal(limitType, checkResult.data.current, checkResult.data.max);
      }
    },
    [checkResult.data, openUpgradeModal, limitType],
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
