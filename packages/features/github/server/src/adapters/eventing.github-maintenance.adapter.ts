import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type Event,
  type ProcessStore,
} from "@langwatch/eventing";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  type GithubBranchRecheckState,
  githubBranchRecheckSchema,
  githubBranchRecheckWake,
} from "../processes/github-branch-recheck.process";
import {
  runGithubBranchRecheck,
  runGithubRetentionPrune,
} from "../intents/github-branch-recheck.intent";
import type { GithubBranchMaintenancePort } from "../ports/github-branch-maintenance.port";

export interface GithubMaintenancePipelineDeps {
  /**
   * The sweep, named by the two operations the schedule calls.
   *
   * It used to be the whole `GithubService`, which is what made this pipeline
   * unmountable by any graph that had not composed the App: the facade carries
   * an organization service and a project service the sweep never reaches. The
   * published service still satisfies this, so the registration in platform's
   * legacy registry is unchanged.
   */
  github: GithubBranchMaintenancePort;
  processStore: ProcessStore;
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
export class EventingGithubMaintenanceAdapter {
  private constructor(private readonly deps: GithubMaintenancePipelineDeps) {}

  static create(deps: GithubMaintenancePipelineDeps): EventingGithubMaintenanceAdapter {
    return new EventingGithubMaintenanceAdapter(deps);
  }

  build() {
    const deps = this.deps;

    return definePipeline<Event>({
      name: "github_maintenance",
      aggregate: defineAggregate({
        // `global`, like the other maintenance pipelines: this appends no events,
        // and the sweep spans every tenant by design.
        type: "global",
        events: defineEvents([]),
      }),
    })
      .withProcessManager(GITHUB_BRANCH_RECHECK_PROCESS_NAME, (pm) =>
        pm
          .state<GithubBranchRecheckState>(GITHUB_BRANCH_RECHECK_INITIAL_STATE)
          // Both intents are declared before `onWake` because the wake emits
          // both: the builder only lets one be declared after it.
          .intent("recheck", githubBranchRecheckSchema, runGithubBranchRecheck(deps))
          .intent("prune", githubBranchRecheckSchema, runGithubRetentionPrune(deps))
          .schedule({ everyMs: GITHUB_BRANCH_RECHECK_INTERVAL_MS })
          .onWake(githubBranchRecheckWake)
          // A pass is bounded at 50 branches and each one is a sequential GitHub
          // call, so the lease has to cover fifty round trips plus their retries.
          // The prune shares it: one DELETE, a single statement.
          .outbox({ leaseDurationMs: 10 * 60 * 1000, maxAttempts: 3 }),
      )
      .build();
  }
}
