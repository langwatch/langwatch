export {
  PostgresGithubAdapter,
  PostgresGithubAdapter as GithubPrismaInstaller,
  type GithubDatabase,
} from "./adapters/postgres.github.adapter";
export {
  PostgresGithubBranchMaintenanceAdapter,
  type GithubBranchMaintenanceDatabase,
  type PostgresGithubBranchMaintenanceOptions,
} from "./adapters/postgres.github-branch-maintenance.adapter";
export {
  PostgresGithubBranchDemandAdapter,
  type GithubBranchDemandDatabase,
  type PostgresGithubBranchDemandOptions,
} from "./adapters/postgres.github-branch-demand.adapter";
export { EventingGithubMaintenanceAdapter } from "./adapters/eventing.github-maintenance.adapter";
export { GithubBranchMaintenancePort } from "./ports/github-branch-maintenance.port";
export { GithubBranchDemandPort } from "./ports/github-branch-demand.port";
export { GithubProjectActivityPort } from "./ports/github-project-activity.port";
export {
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
} from "./processes/github-branch-recheck.process";
export { GithubTrpcApi, type GithubTrpcContext } from "./transport/api-trpc/github.api";
export { GithubConnectionService } from "./services/github-connection.service";

// The GitHub App installation flow's REST family: the session-gated start, the
// protocol-mandated Setup URL and the HMAC-verified webhook, plus the two
// `github-langy` aliases held by App registrations we do not own.
export {
  createGithubRestApp,
  type GithubRestPorts,
  type GithubRestSessionPort,
} from "./transport/api-rest/github.api";
