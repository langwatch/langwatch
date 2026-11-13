// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent registry's eventing: agent's lifecycle facts reconcile the agent's organisation,
 * registry events fan out to webhook endpoints through the delivery outbox, and a scheduled pass
 * re-reads traffic. Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
import {
  AGENT_ARCHIVED_EVENT_TYPE,
  AGENT_CHANGED_EVENT_TYPE,
  agentArchivedEventDataSchema,
  agentChangedEventDataSchema,
} from "@langwatch/agent-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { GovernanceModule } from "../../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../../repositories/governance.repositories.ts";
import { pruneAgentRegistryDeliveries } from "./agent-registry-delivery.intent.ts";
import {
  AGENT_REGISTRY_DELIVERY_INITIAL_STATE,
  AGENT_REGISTRY_DELIVERY_MAX_ATTEMPTS,
  AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
  AGENT_REGISTRY_DELIVERY_PRUNE_INTENT,
  AGENT_REGISTRY_DELIVERY_PRUNE_INTERVAL_MS,
  AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
  agentRegistryDeliveryIntentSchema,
  agentRegistryDeliveryPruneSchema,
  agentRegistryDeliveryPruneWake,
  agentRegistryDeliveryStateSchema,
} from "./agent-registry-delivery.process.ts";
import {
  AGENT_REGISTRY_TRAFFIC_INITIAL_STATE,
  AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
  AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  agentRegistryTrafficPassSchema,
  agentRegistryTrafficStateSchema,
  agentRegistryTrafficWake,
  runAgentRegistryTraffic,
} from "./agent-registry-traffic.process.ts";

const AGENT_REGISTRY_PIPELINE_NAME = "governance_agent_registry";

/** A burst of writes to one project's agents settles into one reconcile. */
const AGENT_REGISTRY_SETTLE_MS = 5_000;
/** Outlives the settle, so a fact arriving as the window closes still joins it. */
const AGENT_REGISTRY_DEDUP_TTL_MS = 10_000;

const projectKeyOf = z.object({ projectId: z.string().min(1) });

function settlePerProject(lane: string) {
  return {
    delay: AGENT_REGISTRY_SETTLE_MS,
    deduplication: {
      makeId: (event: { data: unknown }) =>
        `agent-registry:${lane}:${projectKeyOf.parse(event.data).projectId}`,
      ttlMs: AGENT_REGISTRY_DEDUP_TTL_MS,
    },
  };
}

type AgentRegistryApp = Pick<
  GovernanceModule,
  | "connectAgentRegistryOutbox"
  | "requestAgentRegistryDelivery"
  | "reconcileAgentRegistryForProject"
  | "reconcileAgentRegistryTraffic"
>;

function buildAgentRegistryPipeline({
  app,
  processStore,
}: EventingSetup<unknown, AgentRegistryApp>): StaticPipelineDefinition<never> {
  app.connectAgentRegistryOutbox({ processStore });
  const reconcileProject = ({ projectId }: { projectId: string }) =>
    app.reconcileAgentRegistryForProject({ projectId });
  return definePipeline({
    name: AGENT_REGISTRY_PIPELINE_NAME,
    // `global`: governance appends no events here; it reacts to agent's and runs its outboxes.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("reconcileAgentRegistryOnAgentChanged", {
      eventType: AGENT_CHANGED_EVENT_TYPE,
      data: agentChangedEventDataSchema,
      options: settlePerProject("changed"),
      handle: reconcileProject,
    })
    .withPeerSubscriber("reconcileAgentRegistryOnAgentArchived", {
      eventType: AGENT_ARCHIVED_EVENT_TYPE,
      data: agentArchivedEventDataSchema,
      options: settlePerProject("archived"),
      handle: reconcileProject,
    })
    .withProcessManager(AGENT_REGISTRY_DELIVERY_PROCESS_NAME, (pm) =>
      pm
        .state(agentRegistryDeliveryStateSchema, AGENT_REGISTRY_DELIVERY_INITIAL_STATE)
        .intent(
          AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
          agentRegistryDeliveryIntentSchema,
          (intent, context) => app.requestAgentRegistryDelivery(intent, context),
        )
        .intent(
          AGENT_REGISTRY_DELIVERY_PRUNE_INTENT,
          agentRegistryDeliveryPruneSchema,
          pruneAgentRegistryDeliveries(processStore),
        )
        .schedule({ everyMs: AGENT_REGISTRY_DELIVERY_PRUNE_INTERVAL_MS })
        .onWake(agentRegistryDeliveryPruneWake)
        .outbox({ maxAttempts: AGENT_REGISTRY_DELIVERY_MAX_ATTEMPTS }),
    )
    .withProcessManager(AGENT_REGISTRY_TRAFFIC_PROCESS_NAME, (pm) =>
      pm
        .state(agentRegistryTrafficStateSchema, AGENT_REGISTRY_TRAFFIC_INITIAL_STATE)
        .schedule({ everyMs: AGENT_REGISTRY_TRAFFIC_INTERVAL_MS })
        .onWake(agentRegistryTrafficWake)
        .intent(
          "pass",
          agentRegistryTrafficPassSchema,
          runAgentRegistryTraffic({
            reconcile: () => app.reconcileAgentRegistryTraffic(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // One pass at a time; each organisation's reconcile is idempotent.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

export const agentRegistryEventing = defineEventingModule({
  pipeline: AGENT_REGISTRY_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    buildAgentRegistryPipeline(setup),
});
