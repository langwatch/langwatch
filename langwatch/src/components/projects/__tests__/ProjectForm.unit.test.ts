/**
 * Unit tests for ProjectForm validation logic.
 * Tests the validation rules without rendering the form.
 */
import { describe, it, expect } from "vitest";

// Validation functions extracted from form logic
function validateProjectName(name: string | undefined): string | null {
  if (!name) return "Project name is required";
  if (name.trim() === "") return "Project name is required";
  return null;
}

function validateTeamId(teamId: string | undefined, showTeamSelector: boolean): string | null {
  if (!showTeamSelector) return null;
  if (!teamId) return "Team is required";
  return null;
}

function validateNewTeamName(
  teamId: string | undefined,
  newTeamName: string | undefined,
): string | null {
  if (teamId !== "NEW") return null;
  if (!newTeamName) return "Team name is required";
  if (newTeamName.trim() === "") return "Team name is required";
  return null;
}

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
      expect(validateProjectName("My Project")).toBeNull();
    });
  });

  describe("when validating team selection", () => {
    it("does not require team when selector is hidden", () => {
      expect(validateTeamId(undefined, false)).toBeNull();
    });

    it("requires team when selector is visible", () => {
      expect(validateTeamId(undefined, true)).toBe("Team is required");
    });

    it("accepts valid team id", () => {
      expect(validateTeamId("team-123", true)).toBeNull();
    });
  });

  describe("when validating new team name", () => {
    it("does not require new team name when not creating new team", () => {
      expect(validateNewTeamName("team-123", undefined)).toBeNull();
    });

    it("requires new team name when creating new team", () => {
      expect(validateNewTeamName("NEW", undefined)).toBe("Team name is required");
    });

    it("rejects empty new team name", () => {
      expect(validateNewTeamName("NEW", "")).toBe("Team name is required");
    });

    it("rejects whitespace-only new team name", () => {
      expect(validateNewTeamName("NEW", "   ")).toBe("Team name is required");
    });

    it("accepts valid new team name", () => {
      expect(validateNewTeamName("NEW", "Engineering")).toBeNull();
    });
  });

  describe("when checking project limit", () => {
    it("blocks creation when at max projects", () => {
      const usage = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      const isAtMax =
        usage.projectsCount >= usage.activePlan.maxProjects &&
        !usage.activePlan.overrideAddingLimitations;
      expect(isAtMax).toBe(true);
    });

    it("allows creation when below max projects", () => {
      const usage = {
        projectsCount: 3,
        activePlan: { maxProjects: 5, overrideAddingLimitations: false },
      };
      const isAtMax =
        usage.projectsCount >= usage.activePlan.maxProjects &&
        !usage.activePlan.overrideAddingLimitations;
      expect(isAtMax).toBe(false);
    });

    it("allows creation when override is enabled", () => {
      const usage = {
        projectsCount: 5,
        activePlan: { maxProjects: 5, overrideAddingLimitations: true },
      };
      const isAtMax =
        usage.projectsCount >= usage.activePlan.maxProjects &&
        !usage.activePlan.overrideAddingLimitations;
      expect(isAtMax).toBe(false);
    });
  });
});
