import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectCredentialsService } from "../../services/project-credentials.service.ts";
import { PrismaProjectRepository } from "./prisma.project.repository.ts";
import {
  GovernanceInternalProjectService,
  ProjectOldestTeam,
} from "../../services/governance-internal-project.service.ts";

/**
 * Two project reads for Governance ingestion: trace project + internal governance
 * project (via ProjectService port; oldest-team via OrganizationService).
 */
export class PrismaGovernanceInternalProjectRepository {
  static create(options: {
    database: PrismaClient;
    teams: ProjectOldestTeam;
  }): PrismaGovernanceInternalProjectRepository {
    return new PrismaGovernanceInternalProjectRepository(options);
  }

  private constructor(
    private readonly options: { database: PrismaClient; teams: ProjectOldestTeam },
  ) {}

  build(): GovernanceInternalProjectService {
    return GovernanceInternalProjectService.create({
      repository: PrismaProjectRepository.create({ prisma: this.options.database }),
      credentials: ProjectCredentialsService.create(),
      teams: this.options.teams,
    });
  }
}
