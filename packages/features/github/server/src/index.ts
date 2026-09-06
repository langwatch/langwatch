export {
  PostgresGithubAdapter,
  PostgresGithubAdapter as GithubPrismaInstaller,
  type GithubDatabase,
} from "./adapters/postgres.github.adapter.ts";
export {
  PostgresGithubBranchMaintenanceAdapter,
  type GithubBranchMaintenanceDatabase,
  type PostgresGithubBranchMaintenanceOptions,
} from "./adapters/postgres.github-branch-maintenance.adapter.ts";
export {
  PostgresGithubBranchDemandAdapter,
  type GithubBranchDemandDatabase,
  type PostgresGithubBranchDemandOptions,
} from "./adapters/postgres.github-branch-demand.adapter.ts";
export { EventingGithubMaintenanceAdapter } from "./adapters/eventing.github-maintenance.adapter.ts";
export { GithubBranchMaintenancePort } from "./ports/github-branch-maintenance.port.ts";
export { GithubBranchDemandPort } from "./ports/github-branch-demand.port.ts";
export { GithubProjectActivityPort } from "./ports/github-project-activity.port.ts";
export { GithubHostPort } from "./ports/github-host.port.ts";
export {
  GithubBranchDemandService,
  type BranchMappingRequest,
} from "./services/github-branch-demand.service.ts";
export {
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
} from "./processes/github-branch-recheck.process.ts";
export { GithubTrpcApi, type GithubTrpcContext } from "./transport/api-trpc/github.api.ts";
export { GithubConnectionService } from "./services/github-connection.service.ts";

// The GitHub App installation flow's REST family: the session-gated start, the
// protocol-mandated Setup URL and the HMAC-verified webhook, plus the two
// `github-langy` aliases held by App registrations we do not own.
export {
  createGithubRestApp,
  type GithubRestPorts,
  type GithubRestSessionPort,
} from "./transport/api-rest/github.api.ts";
