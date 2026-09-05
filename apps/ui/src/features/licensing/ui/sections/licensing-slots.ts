/**
 * What licensing puts in the slots the organization screens leave open: the
 * limit row beside the seat counts, and the words for a seat type.
 */

import {
  LITE_MEMBER_EXPLANATION,
  LITE_MEMBER_NEEDS_TEAM_WARNING,
  LITE_MEMBER_SHORT_DESCRIPTION,
  SEAT_TYPES_DOC_PATH,
} from "@langwatch/enterprise-licensing-web/surfaces/seat-types";
import { ResourceLimitRow } from "@langwatch/enterprise-licensing-web/surfaces/resource-limits";
import type { UiSeatTypeCopy, UiSlotComponents } from "@langwatch/ui-host/slots";

export const licensingUiSlots: UiSlotComponents = { resourceLimits: ResourceLimitRow };

export const licensingSeatTypeCopy: UiSeatTypeCopy = {
  liteMemberShortDescription: LITE_MEMBER_SHORT_DESCRIPTION,
  liteMemberExplanation: LITE_MEMBER_EXPLANATION,
  liteMemberNeedsTeamWarning: LITE_MEMBER_NEEDS_TEAM_WARNING,
  seatTypesDocPath: SEAT_TYPES_DOC_PATH,
};
