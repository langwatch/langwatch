/**
 * Unit tests for ProjectForm validation logic.
 * Tests the extracted validation functions.
 */
import { describe, expect, it } from "vitest";
import {
  NEW_TEAM_VALUE,
  validateNewTeamName,
  validateProjectName,
} from "../projectFormValidation";

describe("ProjectForm validation logic", () => {
  describe("when validating project name", () => {
    it("requires a project name", () => {
      expect(validateProjectName(undefined)).toBe("Project name is required");
    });

    it("rejects empty string", () => {
      expect(validateProjectName("")).toBe("Project name is required");
    });

    it("rejects whitespace only", () => {
      expect(validateProjectName("   ")).toBe("Project name is required");
    });

    it("accepts valid project name", () => {
      expect(validateProjectName("My Project")).toBe(true);
    });
  });

  describe("when validating new team name", () => {
    it("does not require new team name when not creating new team", () => {
      expect(validateNewTeamName("team-123", undefined)).toBe(true);
    });

    it("requires new team name when creating new team", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, undefined)).toBe(
        "Team name is required",
      );
    });

    it("rejects empty new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "")).toBe(
        "Team name is required",
      );
    });

    it("rejects whitespace-only new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "   ")).toBe(
        "Team name is required",
      );
    });

    it("accepts valid new team name", () => {
      expect(validateNewTeamName(NEW_TEAM_VALUE, "Engineering")).toBe(true);
    });
  });

  // Project limit tests are in utils/__tests__/limits.unit.test.ts
});
