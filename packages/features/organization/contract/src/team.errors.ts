import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class TeamNotFoundError extends NotFoundError {
  declare readonly code: "team_not_found";

  constructor(teamId?: string) {
    super("team_not_found", "Team", teamId ?? "", teamId ? { meta: { teamId } } : {});
    this.name = "TeamNotFoundError";
  }
}

export class TeamSlugConflictError extends HandledError {
  declare readonly code: "team_name_taken";

  constructor() {
    super("team_name_taken", "A team with this name already exists in the organization.", {
      httpStatus: 409,
    });
    this.name = "TeamSlugConflictError";
  }
}

export const PERSONAL_TEAM_ARCHIVE_REFUSAL =
  "Personal workspace teams cannot be archived. They are provisioned per member and disappear with the member's access to the organization.";

export const PERSONAL_TEAM_MEMBERSHIP_REFUSAL =
  "Personal workspace teams have exactly one member: their owner. Create a shared team to collaborate with others.";

export class PersonalTeamProtectedError extends HandledError {
  declare readonly code: "personal_workspace_not_managed_here";

  constructor(message: string) {
    super("personal_workspace_not_managed_here", message, { httpStatus: 403 });
    this.name = "PersonalTeamProtectedError";
  }
}

export class TeamMembershipNotFoundError extends NotFoundError {
  declare readonly code: "team_membership_not_found";

  constructor(userId: string) {
    super("team_membership_not_found", "Team membership", userId, {
      meta: { userId },
    });
    this.name = "TeamMembershipNotFoundError";
  }
}

export class TeamMemberAlreadyAddedError extends HandledError {
  declare readonly code: "team_member_already_added";

  constructor(userId: string) {
    super("team_member_already_added", "That member already holds that role on this team", {
      httpStatus: 409,
      meta: { userId },
    });
    this.name = "TeamMemberAlreadyAddedError";
  }
}

export class UserNotInOrganizationError extends NotFoundError {
  declare readonly code: "user_not_in_organization";

  constructor(userId: string) {
    super("user_not_in_organization", "Organization member", userId, {
      meta: { userId },
    });
    this.name = "UserNotInOrganizationError";
  }
}

export class PersonalWorkspaceNotManagedHereError extends HandledError {
  declare readonly code: "personal_workspace_not_managed_here";

  constructor(ownerName?: string | null) {
    super("personal_workspace_not_managed_here", PERSONAL_TEAM_MEMBERSHIP_REFUSAL, {
      meta: ownerName ? { ownerName } : {},
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "PersonalWorkspaceNotManagedHereError";
  }
}

export class TeamLastAdminRequiredError extends HandledError {
  declare readonly code: "team_last_admin_required";

  constructor(teamName?: string | null) {
    super(
      "team_last_admin_required",
      "A team needs at least one admin, and this change would leave it with none.",
      {
        meta: teamName ? { teamName } : {},
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "TeamLastAdminRequiredError";
  }
}

export class CannotRemoveSelfAsLastAdminError extends HandledError {
  declare readonly code: "cannot_remove_self_as_last_admin";

  constructor(teamName?: string | null) {
    super(
      "cannot_remove_self_as_last_admin",
      "You are the only admin of this team, so you cannot give up the role yet.",
      {
        meta: teamName ? { teamName } : {},
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "CannotRemoveSelfAsLastAdminError";
  }
}

export class LiteMemberViewerOnlyError extends HandledError {
  declare readonly code: "lite_member_viewer_only";

  constructor(teamName?: string | null) {
    super("lite_member_viewer_only", "A Lite Member seat allows the Viewer team role only.", {
      meta: teamName ? { teamName } : {},
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "LiteMemberViewerOnlyError";
  }
}

export class TeamMembershipChangedError extends HandledError {
  declare readonly code: "team_membership_changed";

  constructor(teamId: string) {
    super(
      "team_membership_changed",
      "The team membership changed while this update was being applied. Retry the request.",
      {
        meta: { teamId },
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "TeamMembershipChangedError";
  }
}

export class TeamCustomRoleRequiredError extends HandledError {
  declare readonly code: "team_custom_role_required";

  constructor() {
    super(
      "team_custom_role_required",
      "A custom role identifier is required for a custom team role.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "TeamCustomRoleRequiredError";
  }
}

export class TeamCustomRoleNotAssignableError extends HandledError {
  declare readonly code: "team_custom_role_not_assignable";

  constructor(customRoleId: string) {
    super(
      "team_custom_role_not_assignable",
      "The custom role cannot be assigned in this organization.",
      {
        meta: { customRoleId },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "TeamCustomRoleNotAssignableError";
  }
}
