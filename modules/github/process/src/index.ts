export { PostgresGithubRepositories } from "./repositories/prisma/prisma.github.repositories.ts";
export type { GithubRepositories } from "./repositories/github.repositories.ts";
export type { PrismaGithubInstallationsDatabase } from "./repositories/prisma/prisma.github-installations.repository.ts";
export type { PrismaGithubPullRequestsDatabase } from "./repositories/prisma/prisma.github-pull-requests.repository.ts";
export type {
  GithubBranchMaintenanceComposition,
  GithubBranchDemandComposition,
} from "./app/github.app.ts";
export { EventingGithubMaintenanceAdapter } from "./services/github-maintenance.service.ts";
export type { GithubBranchMaintenance } from "./app/github.members.ts";
export type { GithubBranchDemand } from "./app/github.members.ts";
export type { GithubProjectActivity } from "./app/github.members.ts";
export type { BranchMappingRequest } from "./services/github-branch-demand.service.ts";
export {
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
} from "./eventing/github-branch-recheck.process.ts";
export { GithubApp, type GithubInfrastructure } from "./app/github.app.ts";
export {
  githubServer,
  composeGithubApi,
  composeGithubBranchMaintenance,
  composeGithubBranchDemand,
  createGithubMaintenancePipeline,
} from "./github.server.ts";

// The GitHub App installation flow's REST family: the session-gated start, the
// protocol-mandated Setup URL and the HMAC-verified webhook, plus the two
// `github-langy` aliases held by App registrations we do not own.
export { githubInstallRest, type GithubInstallApi } from "./transport/github-install.rest.ts";

// The `github.*` procedures: the connection, its repositories, the live
// pull-request read and the disconnect.
export { githubTrpcTransport, type GithubConnectionApi } from "./transport/github.trpc.ts";
