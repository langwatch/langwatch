import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { DataRetentionService as DataRetentionServiceContract } from "@langwatch/data-retention-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { PrismaDataRetentionRepository } from "../repositories/prisma/prisma.data-retention.repository";
import { DataRetentionService } from "../services/data-retention.service";

export class PrismaDataRetentionAdapter {
  static create(options: {
    prisma: PrismaClient;
    projects: ProjectService;
    organizations: OrganizationService;
    defaultRetentionDays: number;
  }): DataRetentionServiceContract {
    return DataRetentionService.create({
      repository: PrismaDataRetentionRepository.create(options),
      projects: options.projects,
      organizations: options.organizations,
      defaultRetentionDays: options.defaultRetentionDays,
    });
  }
}
