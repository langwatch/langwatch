/**
 * The two rules the create-project form applies before anything is sent.
 *
 * PORTED WITH THE FORM from
 * `platform/app/src/components/projects/__tests__/ProjectForm.unit.test.ts`,
 * deleted in `cc91631cd8` along with its subject. Only the import path changed.
 *
 * @see specs/projects/create-project-drawer.feature
 */

import { describe, expect, it } from "vitest";

import {
  NEW_TEAM_VALUE,
  validateNewTeamName,
  validateProjectName,
} from "../project-form-validation";

describe("given the create-project form's validation", () => {
  describe("when validating the project name", () => {
    /** @scenario "Project name is required" */
    it("requires a project name", () => {
      expect(validateProjectName(undefined)).toBe("Project name is required");
    });

    /** @scenario "Project name is required" */
    it("rejects an empty string", () => {
      expect(validateProjectName("")).toBe("Project name is required");
    });

    /** @scenario "Project name with only whitespace is invalid" */
    it("rejects whitespace alone", () => {
      expect(validateProjectName("   ")).toBe("Project name is required");
    });

    it("accepts a real name", () => {
      expect(validateProjectName("My Project")).toBe(true);
    });
  });

  describe("when validating the new team's name", () => {
    it("asks for nothing while an existing team is selected", () => {
      expect(validateNewTeamName("team-123", undefined)).toBe(true);
    });

    /** @scenario "New team name is required when creating team" */
    it("requires a name once the new-team option is selected", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, undefined)).toBe("Team name is required");
    });

    /** @scenario "New team name is required when creating team" */
    it("rejects an empty new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "")).toBe("Team name is required");
    });

    /** @scenario "New team name is required when creating team" */
    it("rejects a whitespace-only new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "   ")).toBe("Team name is required");
    });

    it("accepts a real new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "Engineering")).toBe(true);
    });
  });
});
