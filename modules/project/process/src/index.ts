export type { PrismaCodingAgentActivityDatabase } from "./repositories/prisma/prisma.coding-agent-activity.repository.ts";
export type { ProjectInfrastructure } from "./app/project.app.ts";
export {
  projectProcessModule,
  createGovernanceInternalProjectService,
  createProjectCodingAgentActivityRepository,
  createProjectMetadataService,
} from "./project.module.ts";
export {
  type ProjectManagementApi,
  projectRest,
  projectRestCredential,
} from "./transport/project.rest.ts";
export {
  type ProjectBrowserApi,
  projectTrpcTransport,
  type ProjectFieldProtections,
  type ProjectPermissionScope,
} from "./transport/project.trpc.ts";
