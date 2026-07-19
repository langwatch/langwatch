import { describe, expect, it } from "vitest";

import {
  resolveTraceDepartmentId,
  UNASSIGNED_DEPARTMENT,
} from "../departmentAttribution";

describe("resolveTraceDepartmentId", () => {
  describe("given a trace with a principal user", () => {
    /** @scenario A trace with a principal user attributes to the user's department */
    it("resolves to the user's department", () => {
      expect(
        resolveTraceDepartmentId({
          hasPrincipalUser: true,
          userDepartmentId: "Marketing",
          projectDepartmentId: "Engineering",
        }),
      ).toBe("Marketing");
    });

    describe("when the project also has a department", () => {
      /** @scenario Principal user department wins over the project's department */
      it("prefers the user department over the project department", () => {
        const resolved = resolveTraceDepartmentId({
          hasPrincipalUser: true,
          userDepartmentId: "Marketing",
          projectDepartmentId: "Engineering",
        });
        expect(resolved).toBe("Marketing");
        expect(resolved).not.toBe("Engineering");
      });
    });

    describe("when the user has no own department", () => {
      /** @scenario A member with no own department inherits their team's department */
      it("falls back to the user's team department", () => {
        expect(
          resolveTraceDepartmentId({
            hasPrincipalUser: true,
            userDepartmentId: null,
            userTeamDepartmentId: "Engineering",
            projectDepartmentId: null,
          }),
        ).toBe("Engineering");
      });
    });

    describe("when the user, team, and project all have no department", () => {
      /** @scenario A trace with no resolvable department falls back to Unassigned */
      it("falls back to Unassigned", () => {
        expect(
          resolveTraceDepartmentId({
            hasPrincipalUser: true,
            userDepartmentId: null,
            userTeamDepartmentId: null,
            projectDepartmentId: null,
          }),
        ).toBe(UNASSIGNED_DEPARTMENT);
      });
    });
  });

  describe("given an agent trace with no principal user", () => {
    /** @scenario An agent trace with no principal user attributes to its project's department */
    it("resolves to the project's department", () => {
      expect(
        resolveTraceDepartmentId({
          hasPrincipalUser: false,
          userDepartmentId: "Marketing",
          projectDepartmentId: "Engineering",
        }),
      ).toBe("Engineering");
    });

    describe("when the project has no department", () => {
      it("falls back to Unassigned", () => {
        expect(
          resolveTraceDepartmentId({
            hasPrincipalUser: false,
            projectDepartmentId: null,
          }),
        ).toBe(UNASSIGNED_DEPARTMENT);
      });
    });
  });
});
