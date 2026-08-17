import { describe, expect, it } from "vitest";
import { cohortIncludes } from "../cohort";

describe("cohortIncludes", () => {
  describe("when the installation is self-hosted", () => {
    /** @scenario "A self-hosted installation migrates every organization automatically" */
    it("includes every organization with no configuration", () => {
      expect(
        cohortIncludes({ isSaaS: false, cohort: undefined, tenantId: "any" }),
      ).toBe(true);
      expect(
        cohortIncludes({ isSaaS: false, cohort: "none", tenantId: "any" }),
      ).toBe(true);
    });
  });

  describe("when the installation is cloud", () => {
    it("includes nothing by default", () => {
      expect(
        cohortIncludes({ isSaaS: true, cohort: undefined, tenantId: "org1" }),
      ).toBe(false);
      expect(
        cohortIncludes({ isSaaS: true, cohort: "", tenantId: "org1" }),
      ).toBe(false);
      expect(
        cohortIncludes({ isSaaS: true, cohort: "none", tenantId: "org1" }),
      ).toBe(false);
    });

    it('includes everything on "all"', () => {
      expect(
        cohortIncludes({ isSaaS: true, cohort: "all", tenantId: "org1" }),
      ).toBe(true);
    });

    it("includes exactly the listed organizations", () => {
      const cohort = "org1, org2";
      expect(cohortIncludes({ isSaaS: true, cohort, tenantId: "org1" })).toBe(
        true,
      );
      expect(cohortIncludes({ isSaaS: true, cohort, tenantId: "org2" })).toBe(
        true,
      );
      expect(cohortIncludes({ isSaaS: true, cohort, tenantId: "org3" })).toBe(
        false,
      );
    });
  });
});
