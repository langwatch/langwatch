// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { runSpendSpikeEvaluation } from "./spend-spike-evaluation.intent.ts";
import {
  SPEND_SPIKE_EVALUATION_INITIAL_STATE,
  SPEND_SPIKE_EVALUATION_INTERVAL_MS,
  SPEND_SPIKE_EVALUATION_PROCESS_NAME,
  spendSpikeEvaluationPassSchema,
  spendSpikeEvaluationStateSchema,
  spendSpikeEvaluationWake,
} from "./spend-spike-evaluation.process.ts";

export const GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME = "governance_activity_monitor";

/** `global`: one pass evaluates every organization's active spend_spike rules. */
function buildGovernanceActivityMonitor({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<GovernanceApp, "evaluateSpendSpikes">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SPEND_SPIKE_EVALUATION_PROCESS_NAME, (pm) =>
      pm
        .state(spendSpikeEvaluationStateSchema, SPEND_SPIKE_EVALUATION_INITIAL_STATE)
        .schedule({ everyMs: SPEND_SPIKE_EVALUATION_INTERVAL_MS })
        .onWake(spendSpikeEvaluationWake)
        .intent(
          "pass",
          spendSpikeEvaluationPassSchema,
          runSpendSpikeEvaluation({
            evaluate: () => app.evaluateSpendSpikes(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // One pass at a time; an open alert per rule keeps a repeated pass from firing twice.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
    )
    .build();
}

export const governanceActivityMonitorEventing = defineEventingModule({
  pipeline: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    buildGovernanceActivityMonitor(setup),
});
