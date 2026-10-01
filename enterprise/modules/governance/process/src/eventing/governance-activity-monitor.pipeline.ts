// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationSignedUpEventDataSchema,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { runGovernanceTraceFacts } from "./governance-trace-facts.intent.ts";
import {
  GOVERNANCE_TRACE_FACTS_INITIAL_STATE,
  GOVERNANCE_TRACE_FACTS_INTERVAL_MS,
  GOVERNANCE_TRACE_FACTS_PROCESS_NAME,
  governanceTraceFactsPassSchema,
  governanceTraceFactsStateSchema,
  governanceTraceFactsWake,
} from "./governance-trace-facts.process.ts";
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

/**
 * `global`: one pass evaluates every spend_spike rule; one pulls every tenant's governance traces.
 * A signed-up organization gets the standard AI-tool catalogue from governance's own side (§9).
 */
function buildGovernanceActivityMonitor({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<
    GovernanceApp,
    "evaluateSpendSpikes" | "pullGovernanceTraceFacts" | "aiToolEnsureDefaultCatalog"
  >
>): StaticPipelineDefinition<never> {
  return (
    definePipeline({
      name: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // Seeds only an organization with no entries, so a redelivered sign-up seeds nothing twice.
      .withPeerSubscriber("seedDefaultAiToolCatalog", {
        eventType: ORGANIZATION_SIGNED_UP_EVENT_TYPE,
        data: organizationSignedUpEventDataSchema,
        handle: async ({ organizationId }) => {
          await app.aiToolEnsureDefaultCatalog({ organizationId });
        },
      })
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
      .withProcessManager(GOVERNANCE_TRACE_FACTS_PROCESS_NAME, (pm) =>
        pm
          .state(governanceTraceFactsStateSchema, GOVERNANCE_TRACE_FACTS_INITIAL_STATE)
          .schedule({ everyMs: GOVERNANCE_TRACE_FACTS_INTERVAL_MS })
          .onWake(governanceTraceFactsWake)
          .intent(
            "pass",
            governanceTraceFactsPassSchema,
            runGovernanceTraceFacts({
              pull: (window) => app.pullGovernanceTraceFacts(window),
              deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
              now: () => nowInstant().epochMilliseconds,
            }),
          )
          // A failed window is re-driven whole; its rows replace by key.
          .outbox({
            maxAttempts: 10,
            concurrency: 1,
            batchSize: 1,
            leaseDurationMs: 5 * 60 * 1000,
          }),
      )
      .build()
  );
}

export const governanceActivityMonitorEventing = defineEventingModule({
  pipeline: GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    buildGovernanceActivityMonitor(setup),
});
