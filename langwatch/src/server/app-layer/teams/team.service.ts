import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import type { Team } from "@prisma/client";
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
      slugify(name, { lower: true, strict: true }) +
      "-" +
      id.substring(0, 11);

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
    const team = await this.repo.archive({ id, organizationId });
    if (!team) throw new TeamNotFoundError("Team not found");
    return team;
  }
}
