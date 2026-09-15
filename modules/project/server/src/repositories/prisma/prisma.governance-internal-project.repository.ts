import { ProjectCredentialsService } from "../../services/project-credentials.service.ts";
import { PrismaProjectRepository, type PrismaProjectDatabase } from "./prisma.project.repository.ts";
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
    database: PrismaProjectDatabase;
    teams: ProjectOldestTeam;
  }): PrismaGovernanceInternalProjectRepository {
    return new PrismaGovernanceInternalProjectRepository(options);
  }

  private constructor(
    private readonly options: { database: PrismaProjectDatabase; teams: ProjectOldestTeam },
  ) {}

  build(): GovernanceInternalProjectService {
    return GovernanceInternalProjectService.create({
      repository: PrismaProjectRepository.create({ prisma: this.options.database }),
      credentials: ProjectCredentialsService.create(),
      teams: this.options.teams,
    });
  }
}
