export {
  PrismaCodingAgentActivityRepository,
  type PrismaCodingAgentActivityDatabase,
} from "./repositories/prisma/prisma.coding-agent-activity.repository.ts";
export {
  PrismaProjectRepository,
  type PrismaProjectDatabase,
} from "./repositories/prisma/prisma.project.repository.ts";
export { PrismaRecentItemsRepository } from "./repositories/prisma/prisma.recent-items.repository.ts";
export { RecentItemsService } from "./services/recent-items.service.ts";
export type { GetRecentItemsParams, RecentItemType } from "./rules/recent-items.rules.ts";
export { ProjectMetadataService } from "./services/project-metadata.service.ts";
export { ProjectService } from "./services/project.service.ts";
export {
  ProjectCredentials,
  ProjectCredentialsService,
  // `apps/api/src/features/evaluator/__tests__/evaluator-create-model-resolution.integration.test.ts`
  // still imports the old name and sits under `apps/api/src/features/`, which
  // this lane does not touch (owned elsewhere, on its way out). Drop this
  // alias when that tree goes.
  ProjectCredentialsService as ProjectCredentialsAdapter,
} from "./services/project-credentials.service.ts";
export { ProjectApp, type ProjectInfrastructure } from "./app/project.app.ts";
export { ProjectOperationsService } from "./services/project-operations.service.ts";
export { projectServer } from "./project.server.ts";
export {
  ProjectDiagnostics,
  ProjectKeyMap,
  ProjectStoredObjects,
} from "./services/project.service.ts";
export {
  ProjectManagementApi,
  projectRest,
  projectRestCredential,
  type ProjectManagementDirectory,
} from "./transport/project.rest.ts";
export {
  ProjectBrowserApi,
  projectTrpcTransport,
  type ProjectFieldProtections,
  type ProjectPermissionScope,
} from "./transport/project.trpc.ts";
export { ProjectHomeApi, homeTrpcTransport } from "./transport/home.trpc.ts";
export {
  IntegrationsChecksApi,
  integrationsChecksTrpcTransport,
} from "./transport/integrations-checks.trpc.ts";
export {
  GovernanceInternalProject,
  GovernanceInternalProjectService,
  ProjectOldestTeam,
} from "./services/governance-internal-project.service.ts";
export { PrismaGovernanceInternalProjectRepository } from "./repositories/prisma/prisma.governance-internal-project.repository.ts";
