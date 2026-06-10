import { describe, expect, it } from "vitest";

import {
  collapseRedundantScopes,
  type ScopeChipPickerEntry,
} from "../ScopeChipPicker";

const ORG: ScopeChipPickerEntry = { scopeType: "ORGANIZATION", scopeId: "org-1" };
const TEAM_A: ScopeChipPickerEntry = { scopeType: "TEAM", scopeId: "team-a" };
const TEAM_B: ScopeChipPickerEntry = { scopeType: "TEAM", scopeId: "team-b" };
const PROJ_A1: ScopeChipPickerEntry = { scopeType: "PROJECT", scopeId: "proj-a1" };
const PROJ_A2: ScopeChipPickerEntry = { scopeType: "PROJECT", scopeId: "proj-a2" };
const PROJ_B1: ScopeChipPickerEntry = { scopeType: "PROJECT", scopeId: "proj-b1" };
const DEPT_X: ScopeChipPickerEntry = { scopeType: "DEPARTMENT", scopeId: "dept-x" };
const DEPT_Y: ScopeChipPickerEntry = { scopeType: "DEPARTMENT", scopeId: "dept-y" };

const ctx = {
  organizationId: "org-1",
  availableProjects: [
    { id: "proj-a1", teamId: "team-a" },
    { id: "proj-a2", teamId: "team-a" },
    { id: "proj-b1", teamId: "team-b" },
  ],
};

describe("given the user is editing a multi-scope selection", () => {
  describe("when adding ORGANIZATION", () => {
    it("clears every team and project under it (already covered by the org)", () => {
      const prev = [TEAM_A, PROJ_B1];
      const next = [TEAM_A, PROJ_B1, ORG];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([ORG]);
    });

    it("does not touch other-org entries (defensive - picker today is single-org)", () => {
      const otherOrg: ScopeChipPickerEntry = {
        scopeType: "ORGANIZATION",
        scopeId: "org-other",
      };
      const prev = [otherOrg];
      const next = [otherOrg, ORG];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([otherOrg, ORG]);
    });
  });

  describe("when adding a TEAM", () => {
    it("drops the parent organization and projects under that team", () => {
      const prev = [ORG, PROJ_A1, PROJ_A2, PROJ_B1];
      const next = [...prev, TEAM_A];
      // Org gone (TEAM_A narrows it), projects under team-a gone,
      // proj-b1 (different team) survives.
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([
        PROJ_B1,
        TEAM_A,
      ]);
    });

    it("leaves sibling teams alone", () => {
      const prev = [TEAM_B];
      const next = [TEAM_B, TEAM_A];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([
        TEAM_B,
        TEAM_A,
      ]);
    });
  });

  describe("when adding a PROJECT", () => {
    it("drops the parent organization and the parent team (the trip-up rchaves flagged)", () => {
      const prev = [ORG];
      const next = [ORG, PROJ_A1];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([PROJ_A1]);
    });

    it("drops only the project's own parent team, not unrelated teams", () => {
      const prev = [TEAM_A, TEAM_B];
      const next = [TEAM_A, TEAM_B, PROJ_B1];
      // PROJ_B1's parent is TEAM_B → TEAM_B goes. TEAM_A survives.
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([
        TEAM_A,
        PROJ_B1,
      ]);
    });

    it("is a no-op when neither parent is selected", () => {
      const prev: ScopeChipPickerEntry[] = [];
      const next = [PROJ_A1];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([PROJ_A1]);
    });
  });

  describe("when adding a DEPARTMENT", () => {
    it("drops the organization (a department narrows from org-wide)", () => {
      const prev = [ORG];
      const next = [ORG, DEPT_X];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([DEPT_X]);
    });

    it("leaves sibling departments alone (a tile can target several)", () => {
      const prev = [DEPT_Y];
      const next = [DEPT_Y, DEPT_X];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([DEPT_Y, DEPT_X]);
    });
  });

  describe("when adding ORGANIZATION over departments", () => {
    it("clears the departments (org-wide supersedes them)", () => {
      const prev = [DEPT_X, DEPT_Y];
      const next = [DEPT_X, DEPT_Y, ORG];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([ORG]);
    });
  });

  describe("when no new scope is added (removal / no-op)", () => {
    it("returns next unchanged", () => {
      const prev = [ORG, TEAM_A];
      // User unchecked TEAM_A - nothing was added.
      const next = [ORG];
      expect(collapseRedundantScopes(next, prev, ctx)).toEqual([ORG]);
    });
  });
});
