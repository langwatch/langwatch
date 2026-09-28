import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";

import { ProjectApp } from "./app/project.app.ts";
import type { CodingAgentActivityRepository } from "./repositories/coding-agent-activity.repository.ts";
import {
  PrismaCodingAgentActivityRepository,
  type PrismaCodingAgentActivityDatabase,
} from "./repositories/prisma/prisma.coding-agent-activity.repository.ts";
import {
  PrismaProjectRepository,
  type PrismaProjectDatabase,
} from "./repositories/prisma/prisma.project.repository.ts";
import { projectRepositories } from "./repositories/project-repositories.registry.ts";
import {
  GovernanceInternalProjectService,
  type ProjectOldestTeam,
} from "./services/governance-internal-project.service.ts";
import {
  type ProjectCredentials,
  ProjectCredentialsService,
} from "./services/project-credentials.service.ts";
import { ProjectMetadataService } from "./services/project-metadata.service.ts";
import {
  ProjectService,
  type ProjectDiagnostics,
  type ProjectKeyMap,
  type ProjectStoredObjects,
} from "./services/project.service.ts";
import { integrationsChecksTrpcTransport } from "./transport/integrations-checks.trpc.ts";
import { projectRest, projectRestCredential } from "./transport/project.rest.ts";
import { projectTrpcTransport } from "./transport/project.trpc.ts";

export const projectServer = defineServerModule("project")
  .withRepositories(projectRepositories)
  .withApp(ProjectApp)
  .withTransports(projectRest, projectTrpcTransport, integrationsChecksTrpcTransport)
  .withTransportFacts(() => [
    bindRestMiddleware(projectRestCredential, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { apiKeyId: credential.apiKeyId, userId: credential.userId };
    }),
  ]);

/**
 * Composition seams for a process wiring this feature: thin factories over
 * this feature's private classes, so a composition root never names one
 * directly (private-runtime-export drive).
 */
export function createProjectCodingAgentActivityRepository(
  options: Readonly<{ prisma: PrismaCodingAgentActivityDatabase }>,
): CodingAgentActivityRepository {
  return PrismaCodingAgentActivityRepository.create(options);
}

/** The full read/write project directory, over the process's own Prisma client. */
export function createProjectService(options: {
  database: PrismaProjectDatabase;
  credentials: ProjectCredentials;
  organizations: OrganizationApi;
  keyMap?: ProjectKeyMap;
  storedObjects?: ProjectStoredObjects;
  diagnostics?: ProjectDiagnostics;
}): ProjectService {
  return ProjectService.create({
    repository: PrismaProjectRepository.create({ prisma: options.database }),
    credentials: options.credentials,
    organizations: options.organizations,
    keyMap: options.keyMap,
    storedObjects: options.storedObjects,
    diagnostics: options.diagnostics,
  });
}

/** The read-mostly project metadata surface, for a caller with no credentials or org service. */
export function createProjectMetadataService(options: {
  database: PrismaProjectDatabase;
  diagnostics?: ProjectDiagnostics;
}): ProjectMetadataService {
  return ProjectMetadataService.create({
    repository: PrismaProjectRepository.create({ prisma: options.database }),
    diagnostics: options.diagnostics,
  });
}

/**
 * Governance's internal-project mint, over the process's own Prisma client and
 * its own oldest-team port (the one organization read this seam does not own).
 */
export function createGovernanceInternalProjectService(options: {
  database: PrismaProjectDatabase;
  teams: ProjectOldestTeam;
}): GovernanceInternalProjectService {
  return GovernanceInternalProjectService.create({
    repository: PrismaProjectRepository.create({ prisma: options.database }),
    credentials: ProjectCredentialsService.create(),
    teams: options.teams,
  });
}

/**
 * Legacy worker composition shape. The implementation now lives at this
 * composition seam rather than in a repository that constructed services.
 */
export const PrismaGovernanceInternalProjectRepository = {
  create(options: { database: PrismaProjectDatabase; teams: ProjectOldestTeam }): {
    build: () => GovernanceInternalProjectService;
  } {
    return {
      build: (): GovernanceInternalProjectService =>
        createGovernanceInternalProjectService(options),
    };
  },
};
