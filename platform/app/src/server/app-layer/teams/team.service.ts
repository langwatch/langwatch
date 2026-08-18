import { DuplicateBindingError } from "@langwatch/authz-server";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import type { Team, TeamUserRole } from "~/generated/prisma/client";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";
import { UserNotInOrganizationError } from "~/server/role-bindings/errors";
import { slugify } from "~/utils/slugify";
import type {
  PaginatedResult,
  TeamRepository,
} from "./repositories/team.repository";

export class TeamNotFoundError extends NotFoundError {
  declare readonly code: "team_not_found";

  constructor(teamId?: string) {
    super("team_not_found", "Team", teamId ?? "", {
      ...(teamId ? { meta: { teamId } } : {}),
    });
    this.name = "TeamNotFoundError";
  }
}

export class TeamSlugConflictError extends HandledError {
  declare readonly code: "team_name_taken";

  constructor(message: string) {
    super("team_name_taken", message, { httpStatus: 409 });
    this.name = "TeamSlugConflictError";
  }
}

/** Raised when something would archive a personal team. */
export class PersonalTeamProtectedError extends HandledError {
  declare readonly code: "personal_workspace_not_managed_here";

  constructor(message: string) {
    super("personal_workspace_not_managed_here", message, { httpStatus: 403 });
    this.name = "PersonalTeamProtectedError";
  }
}

/** The user id is on the organization but holds no role on this team. */
export class TeamMembershipNotFoundError extends NotFoundError {
  declare readonly code: "team_membership_not_found";

  constructor(userId: string) {
    super("team_membership_not_found", "Team membership", userId, {
      meta: { userId },
    });
    this.name = "TeamMembershipNotFoundError";
  }
}

/** The user already holds that role on the team, so granting it changes nothing. */
export class TeamMemberAlreadyAddedError extends HandledError {
  declare readonly code: "team_member_already_added";

  constructor(userId: string) {
    super(
      "team_member_already_added",
      "That member already holds that role on this team",
      { httpStatus: 409, meta: { userId } },
    );
    this.name = "TeamMemberAlreadyAddedError";
  }
}

/** The refusal a personal team gives to anything that would archive it. */
export const PERSONAL_TEAM_ARCHIVE_REFUSAL =
  "Personal workspace teams cannot be archived. They are provisioned per member and disappear with the member's access to the organization.";

/** The refusal a personal team gives to anything that would change who is on it. */
export const PERSONAL_TEAM_MEMBERSHIP_REFUSAL =
  "Personal workspace teams have exactly one member: their owner. Create a shared team to collaborate with others.";

/**
 * Something tried to change who reaches a personal workspace.
 *
 * Handled rather than a plain `Error` because the cause is known exactly and
 * the caller has somewhere to go: the workspace belongs to one member, their
 * organization role already decides what they can do inside it, and a shared
 * team is where collaboration goes. An administrator reaching this was usually
 * managing a seat, and the old raw refusal read as an internal invariant with
 * no bearing on the seat they were trying to change.
 *
 * `ownerName` is in `meta` because a client renders it: "this is Robin's own
 * workspace" is an answer, whereas "a personal workspace" leaves the admin
 * looking for which one. It is the team name the owner sees, which the
 * organization's admins can already read on the member list.
 *
 * Consolidates three shapes this same refusal used to take, one per entry
 * point: a bare `TRPCError`, a `PersonalTeamProtectedError`, and a
 * `ValidationError` whose `validation_error` code and 422 both misreported it.
 * The REST team API keeps its own 403 with the sentence in the body, because
 * there the message *is* the documented contract
 * (`specs/teams/teams-rest-api.feature`).
 */
export class PersonalWorkspaceNotManagedHereError extends HandledError {
  declare readonly code: "personal_workspace_not_managed_here";

  constructor(ownerName?: string | null) {
    super(
      "personal_workspace_not_managed_here",
      PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
      {
        meta: ownerName ? { ownerName } : {},
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "PersonalWorkspaceNotManagedHereError";
  }
}

/**
 * A change would leave a team with nobody who can administer it from the team
 * itself.
 *
 * Handled, and it names the team: these refusals are raised while editing one
 * member who may belong to several teams, and "this team" sends the reader
 * looking for which one. The remedy is theirs and it is one step, promote
 * another admin there, so the copy can say it.
 *
 * Raised for a team-local decision only. An organization-level seat change is
 * allowed to leave a shared team without a team-scoped admin, because an
 * ORGANIZATION-scoped ADMIN binding administers every shared team and the state
 * this guard exists to prevent is not the state that produces. See
 * `specs/members/member-role-team-restrictions.feature`.
 */
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

/**
 * The caller is the team's only admin and is trying to demote or remove
 * themselves.
 *
 * Its own code because the remedy is not the same one
 * {@link TeamLastAdminRequiredError} offers: nobody else can promote a
 * replacement on their behalf, so the copy has to tell them to do it first
 * rather than suggest asking an admin.
 */
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

/**
 * A team role other than Viewer was asked for somebody on a Lite Member seat.
 *
 * The seat decides the ceiling, so this is not a field the caller can fix by
 * picking a different team role: they either leave it at Viewer or move the
 * member to a full seat.
 */
export class LiteMemberViewerOnlyError extends HandledError {
  declare readonly code: "lite_member_viewer_only";

  constructor(teamName?: string | null) {
    super(
      "lite_member_viewer_only",
      "A Lite Member seat allows the Viewer team role only.",
      {
        meta: teamName ? { teamName } : {},
        httpStatus: 409,
        fault: "customer",
      },
    );
    this.name = "LiteMemberViewerOnlyError";
  }
}

export class TeamRestService {
  constructor(readonly repo: TeamRepository) {}

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Team | null> {
    const team = await this.repo.findById(id);
    if (!team || team.organizationId !== organizationId || team.archivedAt) {
      return null;
    }
    return team;
  }

  async listByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Team>> {
    return this.repo.findAllByOrganization(params);
  }

  async create({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<Team> {
    const teamNanoId = nanoid();
    const id = `team_${teamNanoId}`;
    const slug =
      slugify(name, { lower: true, strict: true }) + "-" + id.substring(0, 11);

    const existing = await this.repo.findBySlugInOrganization({
      slug,
      organizationId,
    });
    if (existing) {
      throw new TeamSlugConflictError(
        "A team with this name already exists in the organization.",
      );
    }

    return this.repo.create({ id, name, slug, organizationId });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: { name?: string };
  }): Promise<Team> {
    const team = await this.repo.update({ id, organizationId, data });
    if (!team) throw new TeamNotFoundError(id);
    return team;
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Team> {
    // Archiving a personal team is unrecoverable. The partial unique index
    // `Team_organizationId_ownerUserId_personal_key` covers archived rows,
    // while PersonalWorkspaceService looks its workspace up with
    // `archivedAt: null`. The archived team keeps holding the index slot, so
    // the next ensure() can neither find the workspace nor create a
    // replacement, and the owner has none in this organization ever again.
    const existing = await this.repo.findById(id);
    if (
      existing &&
      existing.organizationId === organizationId &&
      existing.isPersonal
    ) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_ARCHIVE_REFUSAL);
    }

    const team = await this.repo.archive({ id, organizationId });
    if (!team) throw new TeamNotFoundError(id);
    return team;
  }

  /**
   * Put one member on a team. The membership IS the grant, so this is a
   * ledger write, and the route that used to make it itself is now the thin
   * thing it should have been.
   */
  async addMember({
    id,
    organizationId,
    userId,
    role,
    actor,
  }: {
    id: string;
    organizationId: string;
    userId: string;
    role: TeamUserRole;
    actor: LedgerActor;
  }): Promise<void> {
    const team = await this.getById({ id, organizationId });
    if (!team) throw new TeamNotFoundError(id);
    // A personal team holds exactly its owner, which is why plan limits exempt
    // it. A second member would contradict that, so the request is refused
    // rather than the team quietly becoming something else.
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }

    const isInOrganization = await this.repo.isUserInOrganization({
      userId,
      organizationId,
    });
    if (!isInOrganization) throw new UserNotInOrganizationError(userId);

    try {
      await this.repo.grantMembership({
        teamId: id,
        organizationId,
        userId,
        role,
        actor,
      });
    } catch (error) {
      if (error instanceof DuplicateBindingError) {
        throw new TeamMemberAlreadyAddedError(userId);
      }
      throw error;
    }
  }

  async removeMember({
    id,
    organizationId,
    userId,
    actor,
  }: {
    id: string;
    organizationId: string;
    userId: string;
    actor: LedgerActor;
  }): Promise<void> {
    const team = await this.getById({ id, organizationId });
    if (!team) throw new TeamNotFoundError(id);
    // The one member of a personal team is its owner, and nothing puts that
    // binding back, so removal is refused rather than leaving the owner locked
    // out of their own workspace.
    if (team.isPersonal) {
      throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    }

    const removed = await this.repo.revokeMembership({
      teamId: id,
      organizationId,
      userId,
      actor,
    });
    if (removed === 0) throw new TeamMembershipNotFoundError(userId);
  }
}
