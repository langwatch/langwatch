import { describe, expect, it } from "vitest";
import { getNextPlan, getPlanAction } from "../planColumns";

describe("getNextPlan", () => {
  describe("given an organization on a tier the comparison shows", () => {
    it("points one step up from Free", () => {
      expect(getNextPlan("free")).toBe("growth");
    });

    it("points one step up from Growth", () => {
      expect(getNextPlan("growth")).toBe("enterprise");
    });

    it("points nowhere from the top tier", () => {
      expect(getNextPlan("enterprise")).toBeNull();
    });
  });

  describe("given a deployment on no recognised tier", () => {
    it("points at the tier the comparison's upgrade action already went to", () => {
      expect(getNextPlan(null)).toBe("growth");
    });
  });
});

describe("getPlanAction", () => {
  describe("given the organization is already on Growth", () => {
    it("asks it to fill the seats it pays for rather than buy them again", () => {
      expect(
        getPlanAction({ planId: "growth", currentPlan: "growth" }),
      ).toEqual({ label: "Add Members", href: "/settings/members" });
    });
  });

  describe("given the organization is already on Enterprise", () => {
    it("asks nothing of the top tier", () => {
      expect(
        getPlanAction({ planId: "enterprise", currentPlan: "enterprise" }),
      ).toBeNull();
    });
  });

  describe("given the Free column", () => {
    it("asks nothing, on any tier", () => {
      expect(getPlanAction({ planId: "free", currentPlan: null })).toBeNull();
      expect(getPlanAction({ planId: "free", currentPlan: "free" })).toBeNull();
    });
  });
});
