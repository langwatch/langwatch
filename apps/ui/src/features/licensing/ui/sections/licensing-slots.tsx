/**
 * What licensing puts in the slots core screens leave open: the limit row
 * beside seat counts, the words for a seat type, and the store-driven
 * upgrade/limit dialog mounted once at the app root.
 */

import {
  LITE_MEMBER_EXPLANATION,
  LITE_MEMBER_NEEDS_TEAM_WARNING,
  LITE_MEMBER_SHORT_DESCRIPTION,
  SEAT_TYPES_DOC_PATH,
} from "@langwatch/enterprise-licensing-web/surfaces/seat-types";
import { ResourceLimitRow } from "@langwatch/enterprise-licensing-web/surfaces/resource-limits";
import { GlobalUpgradeModal } from "@langwatch/enterprise-licensing-web/surfaces/global-upgrade-modal";
import type { UiSeatTypeCopy, UiSlotComponents } from "@langwatch/ui-host/slots";
import { readPublicAppConfig } from "../../../../behavior/public-config";

/**
 * Reads `isSaaS` synchronously rather than through a hook: this mounts
 * outside any per-screen host (it is the app-root gate, not a screen), so
 * there is no host provider above it to read from.
 */
function AppGlobalUpgradeModal() {
  let isSaaS = false;
  try {
    isSaaS = readPublicAppConfig().deployment === "saas";
  } catch {
    // Config not yet resolved — the boot boundary, not a crash.
  }
  return <GlobalUpgradeModal isSaaS={isSaaS} />;
}

export const licensingUiSlots: UiSlotComponents = {
  resourceLimits: ResourceLimitRow,
  globalUpgradeModal: AppGlobalUpgradeModal,
};

export const licensingSeatTypeCopy: UiSeatTypeCopy = {
  liteMemberShortDescription: LITE_MEMBER_SHORT_DESCRIPTION,
  liteMemberExplanation: LITE_MEMBER_EXPLANATION,
  liteMemberNeedsTeamWarning: LITE_MEMBER_NEEDS_TEAM_WARNING,
  seatTypesDocPath: SEAT_TYPES_DOC_PATH,
};
