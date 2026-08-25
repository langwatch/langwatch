import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { DataPrivacyService as DataPrivacyServiceContract } from "@langwatch/data-privacy-contract";
import { PrismaDataPrivacyPolicyRepository } from "../repositories/prisma/prisma.data-privacy.repository";
import { DataPrivacyService } from "../services/data-privacy.service";

export class PrismaDataPrivacyAdapter {
  static create(options: {
    prisma: PrismaClient;
    projects: ProjectService;
    organizations: OrganizationService;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyServiceContract {
    return DataPrivacyService.create({
      repository: PrismaDataPrivacyPolicyRepository.create(options.prisma),
      projects: options.projects,
      organizations: options.organizations,
      ttlMs: options.ttlMs,
      now: options.now,
    });
  }
}
