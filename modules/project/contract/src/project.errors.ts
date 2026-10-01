/**
 * Project-specific HandledErrors: REST/tRPC boundaries re-raise by code and
 * httpStatus; customer-facing copy lives in the presentation registry.
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
 * The caller archived the project they are currently in. Refused rather than
 * performed: it would leave the caller inside something that no longer exists.
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
 * A create named neither an existing team nor a new one, so it names no scope
 * the caller could be judged at. Refused before any standing is resolved.
 */
export class ProjectCreateTargetMissingError extends HandledError {
  declare readonly code: "validation_error";

  constructor() {
    super("validation_error", "Either an existing team or a new team name must be given", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ProjectCreateTargetMissingError";
  }
}

/** The caller may not create a project at the tier they named. */
export class ProjectCreateDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to create a project here", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ProjectCreateDeniedError";
  }
}

/** The caller may update the project but not change who outside it can read. */
export class TraceSharingDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super("permission_denied", "You do not have permission to change trace sharing settings", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "TraceSharingDeniedError";
  }
}

/**
 * No caller identity reached a surface that needs one — a named refusal (not
 * a throw) so a host mounting this on an open procedure gets a 401, not a 500.
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

export function assertPersonalWorkspaceMove({
  isProjectPersonal,
  isDestinationTeamPersonal,
}: {
  isProjectPersonal: boolean;
  isDestinationTeamPersonal: boolean;
}): void {
  if (isProjectPersonal)
    throw new PersonalWorkspaceBoundaryError(PERSONAL_PROJECT_MOVE_OUT_REFUSAL);
  if (isDestinationTeamPersonal) {
    throw new PersonalWorkspaceBoundaryError(PERSONAL_PROJECT_MOVE_IN_REFUSAL);
  }
}

export function assertPersonalProjectArchivable(isProjectPersonal: boolean): void {
  if (isProjectPersonal) throw new PersonalProjectProtectedError(PERSONAL_PROJECT_ARCHIVE_REFUSAL);
}

export function assertPersonalWorkspaceCreate(isDestinationTeamPersonal: boolean): void {
  if (isDestinationTeamPersonal) {
    throw new PersonalWorkspaceBoundaryError(PERSONAL_TEAM_PROJECT_CREATE_REFUSAL);
  }
}
