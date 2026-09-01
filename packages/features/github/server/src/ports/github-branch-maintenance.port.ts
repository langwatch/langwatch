/**
 * The fleet-wide sweep, as the maintenance pipeline consumes it.
 *
 * The pipeline used to take the whole `GithubService` facade — 30 methods,
 * every one of them composed from an organization service, a project service
 * and the transports' collaborators — to call these two. A worker that mounts
 * the sweep needs neither, and naming the pair here is what lets it compose
 * the sweep from its own database without also composing the App.
 *
 * `GithubBranchMaintenanceService` satisfies it, and so does the published
 * `GithubService`: both carry these two methods with these signatures, which
 * is what keeps the frozen registration in `platform/app` compiling.
 */
export abstract class GithubBranchMaintenancePort {
  /** Re-asks GitHub about branches whose mapping is due; answers how many. */
  abstract recheckDueBranches(): Promise<number>;

  /** Drops branch bookkeeping past the activity horizon. */
  abstract pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
}
