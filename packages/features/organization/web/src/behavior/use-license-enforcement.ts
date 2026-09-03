/**
 * Whether one more of something is within licence, click-then-modal (never
 * a disabled button, since that explains nothing). Optimistic while loading
 * — the server re-enforces on write, so worst case is a refusal one round
 * trip later.
 */

import type { LimitType } from "@langwatch/enterprise-licensing-contract";
// The upgrade modal is a shared zustand singleton: opening it here and
// mounting it elsewhere is one modal, not a copy.
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { useCallback } from "react";
import { api } from "./organization-api";
import { useOrganizationTeamProject } from "./use-organization-team-project";

/** Click-then-modal license enforcement: `checkAndProceed` runs the action or shows the upgrade modal. */
export function useLicenseEnforcement(limitType: LimitType) {
  const { organization } = useOrganizationTeamProject();
  const openUpgradeModal = useUpgradeModalStore((state) => state.open);

  const checkResult = api.licenseEnforcement.checkLimit.useQuery(
    { organizationId: organization?.id ?? "", limitType },
    { enabled: !!organization?.id },
  );

  const reportBlocked = api.licenseEnforcement.reportLimitBlocked.useMutation();

  /** Runs `onAllowed` if allowed, else fires a blocked-notification and returns undefined. */
  const checkAndProceed = useCallback(
    <T>(onAllowed: () => T): T | undefined => {
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
