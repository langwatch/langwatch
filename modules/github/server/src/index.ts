export { composeGithubApi } from "./app/github.app.ts";
export { PostgresGithubRepositories } from "./repositories/prisma/prisma.github.repositories.ts";
export type { GithubRepositories } from "./repositories/github.repositories.ts";
export {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "./repositories/prisma/prisma.github-installations.repository.ts";
export {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "./repositories/prisma/prisma.github-pull-requests.repository.ts";
export {
  composeGithubBranchMaintenance,
  type GithubBranchMaintenanceComposition,
  composeGithubBranchDemand,
  type GithubBranchDemandComposition,
} from "./app/github.app.ts";
export { EventingGithubMaintenanceAdapter } from "./services/github-maintenance.service.ts";
export type { GithubBranchMaintenance } from "./app/github.infrastructure.ts";
export type { GithubBranchDemand } from "./app/github.infrastructure.ts";
export type { GithubProjectActivity } from "./app/github.infrastructure.ts";
export { GithubHostApi } from "./ports/github-host.port.ts";
export {
  GithubBranchDemandService,
  type BranchMappingRequest,
} from "./services/github-branch-demand.service.ts";
export {
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
} from "./processes/github-branch-recheck.process.ts";
export { GithubConnectionService } from "./services/github-connection.service.ts";
export { GithubApp, type GithubInfrastructure } from "./app/github.app.ts";
export { githubServer } from "./github.server.ts";

// The GitHub App installation flow's REST family: the session-gated start, the
// protocol-mandated Setup URL and the HMAC-verified webhook, plus the two
// `github-langy` aliases held by App registrations we do not own.
export {
  githubInstallRest,
  GithubInstallApi,
  type GithubInstallSession,
} from "./transport/github-install.rest.ts";

// The `github.*` procedures: the connection, its repositories, the live
// pull-request read and the disconnect.
export { githubTrpcTransport, GithubConnectionApi } from "./transport/github.trpc.ts";
