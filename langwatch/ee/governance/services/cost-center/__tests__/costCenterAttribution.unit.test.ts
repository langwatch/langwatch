import { describe, expect, it } from "vitest";

import {
  resolveTraceCostCenterId,
  UNASSIGNED_COST_CENTER,
} from "../costCenterAttribution";

describe("resolveTraceCostCenterId", () => {
  describe("given a trace with a principal user", () => {
    /** @scenario A trace with a principal user attributes to the user's cost center */
    it("resolves to the user's cost center", () => {
      expect(
        resolveTraceCostCenterId({
          hasPrincipalUser: true,
          userCostCenterId: "Marketing",
          projectCostCenterId: "Engineering",
        }),
      ).toBe("Marketing");
    });

    describe("when the project also has a cost center", () => {
      /** @scenario Principal user cost center wins over the project's cost center */
      it("prefers the user cost center over the project cost center", () => {
        const resolved = resolveTraceCostCenterId({
          hasPrincipalUser: true,
          userCostCenterId: "Marketing",
          projectCostCenterId: "Engineering",
        });
        expect(resolved).toBe("Marketing");
        expect(resolved).not.toBe("Engineering");
      });
    });

    describe("when the user has no own cost center", () => {
      /** @scenario A member with no own cost center inherits their team's cost center */
      it("falls back to the user's team cost center", () => {
        expect(
          resolveTraceCostCenterId({
            hasPrincipalUser: true,
            userCostCenterId: null,
            userTeamCostCenterId: "Engineering",
            projectCostCenterId: null,
          }),
        ).toBe("Engineering");
      });
    });

    describe("when the user, team, and project all have no cost center", () => {
      /** @scenario A trace with no resolvable cost center falls back to Unassigned */
      it("falls back to Unassigned", () => {
        expect(
          resolveTraceCostCenterId({
            hasPrincipalUser: true,
            userCostCenterId: null,
            userTeamCostCenterId: null,
            projectCostCenterId: null,
          }),
        ).toBe(UNASSIGNED_COST_CENTER);
      });
    });
  });

  describe("given an agent trace with no principal user", () => {
    /** @scenario An agent trace with no principal user attributes to its project's cost center */
    it("resolves to the project's cost center", () => {
      expect(
        resolveTraceCostCenterId({
          hasPrincipalUser: false,
          userCostCenterId: "Marketing",
          projectCostCenterId: "Engineering",
        }),
      ).toBe("Engineering");
    });

    describe("when the project has no cost center", () => {
      it("falls back to Unassigned", () => {
        expect(
          resolveTraceCostCenterId({
            hasPrincipalUser: false,
            projectCostCenterId: null,
          }),
        ).toBe(UNASSIGNED_COST_CENTER);
      });
    });
  });
});
