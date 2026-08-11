import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  type GithubBranchRecheckDeps,
  type GithubBranchRecheckState,
  githubBranchRecheckSchema,
  githubBranchRecheckWake,
  runGithubBranchRecheck,
  runGithubRetentionPrune,
} from "./process-manager/githubBranchRecheck.process";

export interface GithubMaintenancePipelineDeps {
  branchRecheck: GithubBranchRecheckDeps;
}

/**
 * GitHub pull-request linkage maintenance, in its own pipeline for the same
 * reason blob_maintenance and langy_maintenance are in theirs: re-asking GitHub
 * about branches that mapped to nothing, and pruning the rows nobody reads any
 * more, are neither a session concern nor a queue concern.
 *
 * WHY IT MOVED HERE. The sweep was a `setTimeout` chain booted from
 * `startWorkers`, with no lock of any kind. Every replica ran the same
 * cross-tenant scan every ten minutes and asked GitHub about the same due
 * branches; the only nod to the fleet was a 30-second boot jitter, which
 * staggers a stampede rather than preventing one. Exactly-once per tick is
 * inherited here rather than implemented: the wake commits at the revision it
 * was scheduled at, so when several workers race one tick a single commit wins
 * and the losers stand down, and the GitHub calls run behind the outbox lease.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createGithubMaintenancePipeline(
  deps: GithubMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("github_maintenance")
      // `global`, like the other maintenance pipelines: this appends no events,
      // and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(GITHUB_BRANCH_RECHECK_PROCESS_NAME, (pm) =>
        pm
          .state<GithubBranchRecheckState>(GITHUB_BRANCH_RECHECK_INITIAL_STATE)
          // Both intents are declared before `onWake` because the wake emits
          // both: the builder only lets one be declared after it.
          .intent(
            "recheck",
            githubBranchRecheckSchema,
            runGithubBranchRecheck(deps.branchRecheck),
          )
          .intent(
            "prune",
            githubBranchRecheckSchema,
            runGithubRetentionPrune(deps.branchRecheck),
          )
          .schedule({ everyMs: GITHUB_BRANCH_RECHECK_INTERVAL_MS })
          .onWake(githubBranchRecheckWake)
          // A pass is bounded at 50 branches and each one is a sequential GitHub
          // call, so the lease has to cover fifty round trips plus their retries.
          // The prune shares it: two DELETEs, each a single statement.
          .outbox({ leaseDurationMs: 10 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
