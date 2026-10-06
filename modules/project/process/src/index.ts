export type { PrismaCodingAgentActivityDatabase } from "./repositories/prisma/prisma.coding-agent-activity.repository.ts";
export { projectProcessModule } from "./project.module.ts";
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
