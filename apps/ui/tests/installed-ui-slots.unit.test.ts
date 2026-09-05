/**
 * What this application puts in the slots its core screens leave open.
 * Spec: specs/ui/ui-slots.feature
 */

import {
  LITE_MEMBER_EXPLANATION,
  LITE_MEMBER_NEEDS_TEAM_WARNING,
  LITE_MEMBER_SHORT_DESCRIPTION,
  SEAT_TYPES_DOC_PATH,
} from "@langwatch/enterprise-licensing-web/surfaces/seat-types";
import { CORE_SEAT_TYPE_COPY } from "@langwatch/ui-host/slots";
import { describe, expect, it } from "vitest";

import { installedUiFeatures } from "../src/features/installed-ui-features";

const installedUiSlots = installedUiFeatures.capabilities.slots!;

describe("the slots this application fills", () => {
  describe("when the installed slots are read", () => {
    /** @scenario The application fills the slot with the enterprise component */
    it("fills every slot a core screen asks for", () => {
      expect(installedUiSlots.filled("contactSales")).toBeTypeOf("function");
      expect(installedUiSlots.filled("resourceLimits")).toBeTypeOf("function");
      expect(installedUiSlots.filled("managedModelProviderAlert")).toBeTypeOf("function");
    });

    /** @scenario The application fills the slot with the enterprise component */
    it("answers the seat-type words from the licensing surface", () => {
      expect(installedUiSlots.seatTypeCopy()).toEqual({
        liteMemberShortDescription: LITE_MEMBER_SHORT_DESCRIPTION,
        liteMemberExplanation: LITE_MEMBER_EXPLANATION,
        liteMemberNeedsTeamWarning: LITE_MEMBER_NEEDS_TEAM_WARNING,
        seatTypesDocPath: SEAT_TYPES_DOC_PATH,
      });
    });

    /**
     * A core deployment reads the same sentence, so the screens say the same
     * thing with the enterprise half absent.
     * @scenario The application fills the slot with the enterprise component
     */
    it("says what core's own default says", () => {
      expect(installedUiSlots.seatTypeCopy().liteMemberExplanation).toBe(
        CORE_SEAT_TYPE_COPY.liteMemberExplanation,
      );
    });
  });

  describe("when the shell publishes its capabilities", () => {
    /** @scenario The application fills the slot with the enterprise component */
    it("publishes them as a capability, so every routed screen reads them", () => {
      expect(installedUiFeatures.capabilities.slots).toBeDefined();
    });
  });
});
