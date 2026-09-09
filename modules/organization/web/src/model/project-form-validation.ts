/**
 * Validation for the create-project form.
 *
 * Recovered from `platform/app/src/components/projects/projectFormValidation.ts`,
 * deleted in `cc91631cd8` with the form it belonged to. Kept apart from the
 * form for the reason it was extracted in the first place: these are the two
 * rules a test can state without rendering anything.
 */

/**
 * The team value that means "make me a new one".
 *
 * A sentinel rather than a separate control, because the picker offers it in
 * the same list as the real teams — so the field holds one value either way,
 * and the name field below appears only when this is what is selected.
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
 * Whether the new team's name is usable, when one is being created.
 *
 * Takes the selected team as well, because the field is only required when
 * that selection is the sentinel: an existing team needs no name typed.
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
