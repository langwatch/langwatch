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

export class PersonalTeamProtectedError extends Error {
  name = "PersonalTeamProtectedError" as const;
}

/** The refusal a personal team gives to anything that would archive it. */
export const PERSONAL_TEAM_ARCHIVE_REFUSAL =
  "Personal workspace teams cannot be archived. They are provisioned per member and disappear with the member's access to the organization.";

/** The refusal a personal team gives to anything that would change who is on it. */
export const PERSONAL_TEAM_MEMBERSHIP_REFUSAL =
  "Personal workspace teams have exactly one member: their owner. Create a shared team to collaborate with others.";

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
