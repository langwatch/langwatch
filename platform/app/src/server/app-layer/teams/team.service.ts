import { HandledError } from "@langwatch/handled-error";
import type { Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import type {
  PaginatedResult,
  TeamRepository,
} from "./repositories/team.repository";

export class TeamNotFoundError extends Error {
  name = "TeamNotFoundError" as const;
}

export class TeamSlugConflictError extends Error {
  name = "TeamSlugConflictError" as const;
}

/** Raised when something would archive a personal team. */
export class PersonalTeamProtectedError extends Error {
  name = "PersonalTeamProtectedError" as const;
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
    if (!team) throw new TeamNotFoundError("Team not found");
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
    if (!team) throw new TeamNotFoundError("Team not found");
    return team;
  }
}
