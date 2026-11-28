import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";
import {
  GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  gatewayBudgetCrossingEventSchema,
  type GatewayGovernanceProcessingEvent,
  gatewayUnbudgetedSpendEventSchema,
  gatewayVkFirstRequestEventSchema,
  gatewayVkLifecycleEventSchema,
  RecordBudgetCrossingCommand,
  RecordUnbudgetedSpendCommand,
  RecordVkFirstRequestCommand,
  RecordVkLifecycleCommand,
} from "./gateway-governance-events.intent.ts";
import {
  UNBUDGETED_SPEND_SWEEP_INITIAL_STATE,
  UNBUDGETED_SPEND_SWEEP_INTERVAL_MS,
  UNBUDGETED_SPEND_SWEEP_PROCESS_NAME,
  unbudgetedSpendSweepSchema,
  unbudgetedSpendSweepStateSchema,
  unbudgetedSpendSweepWake,
} from "./gateway-unbudgeted-spend-sweep.process.ts";

export type GatewayGovernanceEventsDefinition = StaticPipelineDefinition<
  GatewayGovernanceProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** What the governance pipeline's scheduled work runs; read only when the worker wakes it. */
export type GatewayGovernanceEventsDeps = Readonly<{
  /** One unbudgeted-spend sweep over every organization, recording through this pipeline. */
  sweepUnbudgetedSpend: () => Promise<unknown>;
}>;

/**
 * Gateway's governance facts, ordered per governed subject. Gateway only records them;
 * webhook and nurturing subscribe to them from their own side (record §5, §9).
 */
export function buildGatewayGovernanceEventsPipeline(
  deps: GatewayGovernanceEventsDeps,
): GatewayGovernanceEventsDefinition {
  return definePipeline({
    name: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE }),
  })
    .withEvents([
      gatewayVkLifecycleEventSchema,
      gatewayBudgetCrossingEventSchema,
      gatewayVkFirstRequestEventSchema,
      gatewayUnbudgetedSpendEventSchema,
    ])
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand)
    .withCommand("recordVkFirstRequest", RecordVkFirstRequestCommand)
    .withCommand("recordUnbudgetedSpend", RecordUnbudgetedSpendCommand)
    .withProcessManager(UNBUDGETED_SPEND_SWEEP_PROCESS_NAME, (pm) =>
      pm
        .state(unbudgetedSpendSweepStateSchema, UNBUDGETED_SPEND_SWEEP_INITIAL_STATE)
        .schedule({ everyMs: UNBUDGETED_SPEND_SWEEP_INTERVAL_MS })
        .onWake(unbudgetedSpendSweepWake)
        .intent("sweep", unbudgetedSpendSweepSchema, async () => {
          await deps.sweepUnbudgetedSpend();
        })
        // One ledger read per organization with recent key use, then a budget read per key over
        // the threshold.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

/** Declared before gateway_spend, so the debit writer's crossing sender is bound first. */
export const gatewayGovernanceEventsEventing = defineEventingModule({
  pipeline: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.governanceEventsPipeline(),
  connect: ({ app, commands }) => app.connectGovernanceEvents(commands),
});
