/**
 * Whether one more of something is within licence, click-then-modal (never a disabled button,
 * since that explains nothing). Optimistic while loading — the server re-enforces on write, so
 * worst case is a refusal one round trip later.
 */

// The upgrade modal is a shared zustand singleton: opening it here and
// mounting it elsewhere is one modal, not a copy.
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { useCallback } from "react";

import { api } from "./organization-api.ts";
import { useOrganizationTeamProject } from "./use-organization-team-project.ts";

/**
 * The seat levers a licence caps, written out here rather than imported from
 * `@langwatch/enterprise-licensing-contract`: this package is core and may not
 * depend on enterprise. `limitTypes` in that contract is the source of truth.
 */
type LimitType = "members" | "membersLite";

/** License enforcement: check and proceed with action or show upgrade modal. */
export function useLicenseEnforcement(limitType: LimitType) {
  const { organization } = useOrganizationTeamProject();
  const openUpgradeModal = useUpgradeModalStore((state) => state.open);
  const analytics = useUiAnalytics();

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
      }
      openUpgradeModal(limitType, checkResult.data.current, checkResult.data.max);
      analytics.track({
        boundary: "organization",
        action: "shown",
        name: "upgrade_modal",
        attributes: {
          mode: "limit",
          limitType,
          current: checkResult.data.current,
          max: checkResult.data.max,
        },
      });
      // Fire-and-forget: notify backend that a UI pre-check blocked the user
      if (organization?.id) {
        reportBlocked.mutate({
          organizationId: organization.id,
          limitType,
        });
      }
      return undefined;
    },
    [analytics, checkResult.data, openUpgradeModal, limitType, organization?.id, reportBlocked],
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
