/**
 * GitHub's own maintenance sweep (ADR-144): branch-recheck and retention
 * prune, no events and no commands of its own. Ported from the deleted
 * `GithubWorkerFeatureInstaller`.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GithubModule } from "../app/github.app.ts";
import type { GithubRepositories } from "../repositories/github.repositories.ts";
import type { GithubBranchMaintenance } from "../services/github-branch-maintenance.service.ts";
import { runGithubBranchRecheck, runGithubRetentionPrune } from "./github-branch-recheck.intent.ts";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_INTERVAL_MS,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  githubBranchRecheckStateSchema,
  githubBranchRecheckSchema,
  githubBranchRecheckWake,
} from "./github-branch-recheck.process.ts";

export interface GithubMaintenancePipelineDeps {
  /** The two sweep operations the schedule calls, so the pipeline mounts without the full app. */
  github: GithubBranchMaintenance;
  processStore: ProcessStore;
}

/**
 * GitHub maintenance pipeline for branch sweep and retention prune. The wake
 * commit serializes workers so only one runs per tick.
 */
export function buildGithubMaintenancePipeline(
  deps: GithubMaintenancePipelineDeps,
): StaticPipelineDefinition<never, Record<string, Projection>, never> {
  return definePipeline({
    name: "github_maintenance",
    aggregate: defineAggregate({
      // `global`, like the other maintenance pipelines: this appends no events,
      // and the sweep spans every tenant by design.
      type: "global",
    }),
  })
    .withEvents([])
    .withProcessManager(GITHUB_BRANCH_RECHECK_PROCESS_NAME, (pm) =>
      pm
        .state(githubBranchRecheckStateSchema, GITHUB_BRANCH_RECHECK_INITIAL_STATE)
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

export const githubMaintenanceEventing = defineEventingModule({
  pipeline: "github_maintenance",
  build: ({ app, processStore }: EventingSetup<GithubRepositories, GithubModule>) =>
    buildGithubMaintenancePipeline({ github: app.branchMaintenance(), processStore }),
});
