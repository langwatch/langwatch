import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectCredentialsAdapter } from "./project-credentials.adapter";
import { PrismaProjectRepository } from "../repositories/prisma/prisma.project.repository";
import {
  GovernanceInternalProjectService,
  ProjectOldestTeamPort,
} from "../services/governance-internal-project.service";

/**
 * The two project reads Governance's ingestion pull makes, over Postgres.
 *
 * A composition seam rather than the whole `ProjectService`: the pull resolves
 * a source's trace project and mints (or finds) the organization's internal
 * governance project, and the capability around those two additionally wants
 * an organization service, an LWQL key map, a stored-object runtime and a
 * diagnostics sink. `ProjectService` still satisfies the port, so an
 * application composition passes what it always passed.
 *
 * The oldest-team read arrives as a port for the same reason: it is ONE
 * question of the organization capability, and `OrganizationService` answers
 * it structurally.
 */
export class PostgresGovernanceInternalProjectAdapter {
  static create(options: {
    database: PrismaClient;
    teams: ProjectOldestTeamPort;
  }): PostgresGovernanceInternalProjectAdapter {
    return new PostgresGovernanceInternalProjectAdapter(options);
  }

  private constructor(
    private readonly options: { database: PrismaClient; teams: ProjectOldestTeamPort },
  ) {}

  build(): GovernanceInternalProjectService {
    return GovernanceInternalProjectService.create({
      repository: PrismaProjectRepository.create(this.options.database),
      credentials: ProjectCredentialsAdapter.create(),
      teams: this.options.teams,
    });
  }
}
