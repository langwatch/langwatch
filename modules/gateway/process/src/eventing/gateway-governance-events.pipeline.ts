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
import {
  GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  gatewayBudgetCrossingEventSchema,
  type GatewayGovernanceProcessingEvent,
  gatewayVkLifecycleEventSchema,
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "./gateway-governance-events.intent.ts";

export type GatewayGovernanceEventsDefinition = StaticPipelineDefinition<
  GatewayGovernanceProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * Gateway's governance facts, ordered per governed subject. Gateway only records them;
 * webhook subscribes to them from its own side (record §5, §9).
 */
export function buildGatewayGovernanceEventsPipeline(): GatewayGovernanceEventsDefinition {
  return definePipeline({
    name: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE }),
  })
    .withEvents([gatewayVkLifecycleEventSchema, gatewayBudgetCrossingEventSchema])
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand)
    .build();
}

/** Declared before gateway_spend, so the debit writer's crossing sender is bound first. */
export const gatewayGovernanceEventsEventing = defineEventingModule({
  pipeline: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<undefined, GatewayModule>) => app.governanceEventsPipeline(),
  connect: ({ app, commands }) => app.connectGovernanceEvents(commands),
});
