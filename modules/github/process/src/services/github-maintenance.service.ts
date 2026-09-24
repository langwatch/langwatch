import {
  defineAggregate,
  definePipeline,
  type Event,
  type ProcessStore,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GithubBranchMaintenance } from "../app/github.members.ts";
import {
  runGithubBranchRecheck,
  runGithubRetentionPrune,
} from "../eventing/github-branch-recheck.intent.ts";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  type GithubBranchRecheckState,
  githubBranchRecheckSchema,
  githubBranchRecheckWake,
} from "../eventing/github-branch-recheck.process.ts";

export interface GithubMaintenancePipelineDeps {
  /**
   * The sweep, named by the two operations the schedule calls. Abbreviated from
   * the full GithubService to make the pipeline mountable without composing it.
   */
  github: GithubBranchMaintenance;
  processStore: ProcessStore;
}

/**
 * GitHub maintenance pipeline for branch sweep and retention prune. The wake
 * commit serializes workers so only one runs per tick.
 */
export class EventingGithubMaintenanceAdapter {
  private constructor(private readonly deps: GithubMaintenancePipelineDeps) {}

  static create(deps: GithubMaintenancePipelineDeps): EventingGithubMaintenanceAdapter {
    return new EventingGithubMaintenanceAdapter(deps);
  }

  build(): StaticPipelineDefinition<Event, Record<string, Projection>, never> {
    const deps = this.deps;

    return definePipeline<Event>({
      name: "github_maintenance",
      aggregate: defineAggregate({
        // `global`, like the other maintenance pipelines: this appends no events,
        // and the sweep spans every tenant by design.
        type: "global",
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
