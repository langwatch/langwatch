/**
 * Data-retention stamps a paid Growth Seat organization's policies from billing's activation fact
 * (round 37 D4; record §9) and records the extension `data_retention_extension` carries to the
 * stored rows. Spec: specs/billing/seat-subscription-retention-policy.feature
 */
import {
  isGrowthSeatEventPlan,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import type { RetentionExtensionService } from "../services/retention-extension.service.ts";

const DATA_RETENTION_SEAT_POLICY_PIPELINE_NAME = "data_retention_seat_policy" as const;

export type DataRetentionSeatPolicyPipeline = StaticPipelineDefinition<never>;

export function buildDataRetentionSeatPolicyPipeline({
  extensions,
}: {
  extensions: Pick<RetentionExtensionService, "extendFromActivation">;
}): DataRetentionSeatPolicyPipeline {
  return definePipeline({
    name: DATA_RETENTION_SEAT_POLICY_PIPELINE_NAME,
    // `global`: it appends no events of its own; it only reacts to billing's activation fact.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("dataRetentionSeatActivation", {
      eventType: SUBSCRIPTION_STARTED_EVENT_TYPE,
      data: subscriptionStartedEventDataSchema,
      options: { enqueue: { filter: (data) => isGrowthSeatEventPlan(data.plan) } },
      handle: async (fact, context) => {
        await extensions.extendFromActivation({
          organizationId: fact.organizationId,
          ...(fact.retentionDays === undefined ? {} : { retentionDays: fact.retentionDays }),
          extensionId: context.idempotencyKey ?? context.eventId,
          at: context.occurredAt,
        });
      },
    })
    .build();
}

export const dataRetentionSeatPolicyEventing = defineEventingModule({
  pipeline: DATA_RETENTION_SEAT_POLICY_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    app.seatPolicyPipeline(),
});
