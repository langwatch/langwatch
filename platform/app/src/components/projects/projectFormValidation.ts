/**
 * Validation functions for ProjectForm.
 * Extracted for testability and reuse.
 */

/**
 * Special value indicating a new team should be created.
 * Used in team selection dropdowns.
 */
export const NEW_TEAM_VALUE = "NEW" as const;

/**
 * Validates the project name field.
 * @returns Error message or true if valid
 */
export function validateProjectName(name: string | undefined): string | true {
  if (!name || name.trim() === "") {
    return "Project name is required";
  }
  return true;
}

/**
 * Validates the new team name field when creating a new team.
 * @param teamId - The selected team ID (check if "NEW")
 * @param newTeamName - The new team name to validate
 * @returns Error message or true if valid
 */
export function validateNewTeamName(
  teamId: string | undefined,
  newTeamName: string | undefined,
): string | true {
  if (teamId !== NEW_TEAM_VALUE) return true;
  if (!newTeamName || newTeamName.trim() === "") {
    return "Team name is required";
  }
  return true;
}
