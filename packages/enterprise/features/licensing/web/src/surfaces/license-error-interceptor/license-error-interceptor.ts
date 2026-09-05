/**
 * The one place a licence refusal becomes something the reader sees. Installed
 * once over every failed mutation; a screen's own `onError` asks
 * `isHandledBy*` and stays quiet. specs/licensing/license-failure-modal.feature.
 */

import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import {
  extractLimitExceededInfo,
  extractLiteMemberRestrictionInfo,
  markAsHandledByLicenseHandler,
  markAsHandledByLiteMemberHandler,
} from "../../model/license-error";

/**
 * Reports one failed call as a licence refusal. Answers whether it reported it,
 * which is the caller's signal that nothing else needs to.
 */
export function reportLicenseFailure(error: unknown): boolean {
  let reported = false;

  // The organization is at a seat or resource limit. The modal names the limit
  // and carries the upgrade action, which a toast has nowhere to put.
  const limit = extractLimitExceededInfo(error);
  if (limit) {
    if (error instanceof Error) markAsHandledByLicenseHandler(error);
    useUpgradeModalStore.getState().open(limit.limitType, limit.current, limit.max);
    reported = true;
  }

  // The reader is on a Lite Member seat, which the plan does not extend to this
  // resource. Same modal, its restriction variant.
  const restriction = extractLiteMemberRestrictionInfo(error);
  if (restriction) {
    if (error instanceof Error) markAsHandledByLiteMemberHandler(error);
    useUpgradeModalStore.getState().openLiteMemberRestriction({ resource: restriction.resource });
    reported = true;
  }

  return reported;
}
