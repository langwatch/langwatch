/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  needsSeatProration,
  calculateNewSeatTotal,
} from "../useInviteActions";

describe("needsSeatProration", () => {
  describe("given a SEAT_USAGE subscription with maxMembers 5", () => {
    const pricingModel = "SEAT_USAGE";
    const currentMaxMembers = 5;

    describe("when checking if 2 new core invites need proration with 5 current core members", () => {
      it("returns true (proration is needed)", () => {
        const result = needsSeatProration({
          pricingModel,
          currentMaxMembers,
          currentCoreMembers: 5,
          newCoreInviteCount: 2,
          hasNewFullMembers: true,
        });

        expect(result).toBe(true);
      });
    });

    describe("when checking if 1 new core invite needs proration with 3 current core members", () => {
      it("returns false (proration is not needed)", () => {
        const result = needsSeatProration({
          pricingModel,
          currentMaxMembers,
          currentCoreMembers: 3,
          newCoreInviteCount: 1,
          hasNewFullMembers: true,
        });

        expect(result).toBe(false);
      });
    });

    describe("when checking if 2 new lite member invites need proration", () => {
      it("returns false (lite members never trigger proration)", () => {
        const result = needsSeatProration({
          pricingModel,
          currentMaxMembers,
          currentCoreMembers: 5,
          newCoreInviteCount: 0,
          hasNewFullMembers: false,
        });

        expect(result).toBe(false);
      });
    });
  });

  describe("given a non-SEAT_USAGE organization", () => {
    describe("when inviting core members beyond maxMembers", () => {
      it("returns false (proration only applies to SEAT_USAGE)", () => {
        const result = needsSeatProration({
          pricingModel: "TIERED",
          currentMaxMembers: 5,
          currentCoreMembers: 5,
          newCoreInviteCount: 2,
          hasNewFullMembers: true,
        });

        expect(result).toBe(false);
      });
    });
  });

  describe("given undefined pricingModel or currentMaxMembers", () => {
    describe("when pricingModel is undefined", () => {
      it("returns false", () => {
        const result = needsSeatProration({
          pricingModel: undefined,
          currentMaxMembers: 5,
          currentCoreMembers: 5,
          newCoreInviteCount: 2,
          hasNewFullMembers: true,
        });

        expect(result).toBe(false);
      });
    });

    describe("when currentMaxMembers is undefined", () => {
      it("returns false", () => {
        const result = needsSeatProration({
          pricingModel: "SEAT_USAGE",
          currentMaxMembers: undefined,
          currentCoreMembers: 5,
          newCoreInviteCount: 2,
          hasNewFullMembers: true,
        });

        expect(result).toBe(false);
      });
    });
  });
});

describe("calculateNewSeatTotal", () => {
  describe("given a subscription with maxMembers 5 and 3 current core members", () => {
    describe("when calculating the new total for 2 additional core seats", () => {
      it("returns 7 (maxMembers 5 + 2 new seats)", () => {
        const result = calculateNewSeatTotal({
          currentMaxMembers: 5,
          newCoreInviteCount: 2,
        });

        expect(result).toBe(7);
      });
    });
  });

  describe("given a subscription with maxMembers 10", () => {
    describe("when calculating the new total for 3 additional core seats", () => {
      it("returns 13 (maxMembers 10 + 3 new seats)", () => {
        const result = calculateNewSeatTotal({
          currentMaxMembers: 10,
          newCoreInviteCount: 3,
        });

        expect(result).toBe(13);
      });
    });
  });
});
