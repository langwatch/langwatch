/**
 * Validation for the create-project form, recovered from
 * `platform/app/src/components/projects/projectFormValidation.ts` (deleted
 * in `cc91631cd8`) — kept apart so a test can state these rules without rendering anything.
 */

/**
 * The team value that means "make me a new one" — a sentinel rather than a
 * separate control, since the picker offers it in the same list as real
 * teams; the name field below appears only when this is selected.
 */
export const NEW_TEAM_VALUE = "NEW" as const;

/** Whether a project name is usable, or the sentence saying why not. */
export function validateProjectName(name: string | undefined): string | true {
  if (!name || name.trim() === "") {
    return "Project name is required";
  }
  return true;
}

/**
 * Whether the new team's name is usable, when one is being created. Takes
 * the selected team too, since the name is only required when that
 * selection is the sentinel — an existing team needs none typed.
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
