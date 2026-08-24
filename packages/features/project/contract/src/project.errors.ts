export class ProjectNotFoundError extends Error {
  name = "ProjectNotFoundError" as const;
}

export class ProjectSlugConflictError extends Error {
  name = "ProjectSlugConflictError" as const;
}

export class TeamNotInOrganizationError extends Error {
  name = "TeamNotInOrganizationError" as const;
}

export class DestinationTeamNotFoundError extends Error {
  name = "DestinationTeamNotFoundError" as const;
}

export class PersonalWorkspaceBoundaryError extends Error {
  name = "PersonalWorkspaceBoundaryError" as const;
}

export class PersonalProjectProtectedError extends Error {
  name = "PersonalProjectProtectedError" as const;
}

export const PERSONAL_PROJECT_MOVE_OUT_REFUSAL =
  "Personal workspace projects cannot be moved to another team. Create a project in the destination team instead.";

export const PERSONAL_PROJECT_MOVE_IN_REFUSAL =
  "Projects cannot be moved into a personal workspace. Personal workspaces hold only their owner's personal project.";

export const PERSONAL_TEAM_PROJECT_CREATE_REFUSAL =
  "Projects cannot be created in a personal workspace. A personal workspace holds only the personal project provisioned with it.";

export const PERSONAL_PROJECT_ARCHIVE_REFUSAL =
  "Personal workspace projects cannot be archived. A personal workspace is its project, and archiving it leaves the owner without one in this organization.";

export function personalWorkspaceMoveViolation({
  isProjectPersonal,
  isDestinationTeamPersonal,
}: {
  isProjectPersonal: boolean;
  isDestinationTeamPersonal: boolean;
}): string | null {
  if (isProjectPersonal) return PERSONAL_PROJECT_MOVE_OUT_REFUSAL;
  if (isDestinationTeamPersonal) return PERSONAL_PROJECT_MOVE_IN_REFUSAL;
  return null;
}

export function personalWorkspaceArchiveViolation(
  isProjectPersonal: boolean,
): string | null {
  return isProjectPersonal ? PERSONAL_PROJECT_ARCHIVE_REFUSAL : null;
}

export function personalWorkspaceCreateViolation(
  isDestinationTeamPersonal: boolean,
): string | null {
  return isDestinationTeamPersonal
    ? PERSONAL_TEAM_PROJECT_CREATE_REFUSAL
    : null;
}
