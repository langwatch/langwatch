/**
 * The project's named refusals.
 *
 * Each one is a cause we can name AND the caller can act on, so each is a
 * `HandledError` with a stable code and the status that refusal has always
 * answered with. That is what lets a transport re-raise one untouched: the
 * REST boundary serialises it and the tRPC boundary derives its code from
 * `httpStatus`, so neither door has to hold its own translation table and the
 * two cannot drift apart.
 *
 * The messages here are server copy. What a customer reads is written against
 * the `code` in the app's presentation registry.
 */
import { HandledError } from "@langwatch/handled-error";

export class ProjectNotFoundError extends HandledError {
  declare readonly code: "project_not_found";

  constructor(message = "Project not found", options: { meta?: Record<string, unknown> } = {}) {
    super("project_not_found", message, {
      meta: options.meta,
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectSlugConflictError extends HandledError {
  declare readonly code: "project_slug_taken";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("project_slug_taken", message, {
      meta: options.meta,
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "ProjectSlugConflictError";
  }
}

export class TeamNotInOrganizationError extends HandledError {
  declare readonly code: "team_not_in_organization";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("team_not_in_organization", message, {
      meta: options.meta,
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "TeamNotInOrganizationError";
  }
}

export class DestinationTeamNotFoundError extends HandledError {
  declare readonly code: "project_destination_team_not_found";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("project_destination_team_not_found", message, {
      meta: options.meta,
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "DestinationTeamNotFoundError";
  }
}

export class PersonalWorkspaceBoundaryError extends HandledError {
  declare readonly code: "personal_workspace_boundary";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("personal_workspace_boundary", message, {
      meta: options.meta,
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "PersonalWorkspaceBoundaryError";
  }
}

export class PersonalProjectProtectedError extends HandledError {
  declare readonly code: "personal_project_protected";

  constructor(message: string, options: { meta?: Record<string, unknown> } = {}) {
    super("personal_project_protected", message, {
      meta: options.meta,
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "PersonalProjectProtectedError";
  }
}

/**
 * The caller archived the project they are currently in.
 *
 * Refused rather than performed: archiving the project the request is scoped
 * to leaves the caller inside something that no longer exists, and every
 * subsequent read in that session answers "not found".
 */
export class CannotArchiveCurrentProjectError extends HandledError {
  declare readonly code: "project_cannot_archive_current";

  constructor() {
    super("project_cannot_archive_current", "You cannot archive the current project", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "CannotArchiveCurrentProjectError";
  }
}

/**
 * No caller identity reached a surface that needs one.
 *
 * Kept as a named refusal rather than a narrowing `throw` because the
 * authenticated procedure that normally refuses first is the host's, not this
 * feature's: a host that mounts one of these surfaces on an open procedure
 * gets the 401 it should, not a 500.
 */
export class ProjectCallerUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "This request has no signed-in caller", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ProjectCallerUnauthenticatedError";
  }
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
  return isDestinationTeamPersonal ? PERSONAL_TEAM_PROJECT_CREATE_REFUSAL : null;
}
