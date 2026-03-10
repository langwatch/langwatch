import type { PrismaClient } from "@prisma/client";
import { traced } from "../tracing";
import { PrismaOrganizationRepository } from "./repositories/organization.prisma.repository";
import {
  NullOrganizationRepository,
  type OrganizationRepository,
} from "./repositories/organization.repository";

/**
 * Organization-level queries: project lookups, org-from-team resolution.
 */
export class OrganizationService {
  private constructor(private readonly repo: OrganizationRepository) {}

  static create(prisma: PrismaClient | null): OrganizationService {
    const repo = prisma
      ? new PrismaOrganizationRepository(prisma)
      : new NullOrganizationRepository();
    return traced(new OrganizationService(repo), "OrganizationService");
  }

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    return this.repo.getOrganizationIdByTeamId(teamId);
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    return this.repo.getProjectIds(organizationId);
  }
}
