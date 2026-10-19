/**
 * Billing's pipeline as its contract names the fact the judge folds, and an append that records
 * one, for tests that drive the judge's subscriber.
 */
import {
  USAGE_BILLING_CHANGED_EVENT_TYPE,
  usageBillingChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  type EventSourcing,
} from "@langwatch/eventing";
import { z } from "zod";

function ownerStandIn() {
  return definePipeline({
    name: "judge_fact_owner_stand_in",
    aggregate: defineAggregate({ type: "organization" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(USAGE_BILLING_CHANGED_EVENT_TYPE),
        data: usageBillingChangedEventDataSchema,
      }),
    ])
    .build();
}

export type JudgeFact = {
  type: typeof USAGE_BILLING_CHANGED_EVENT_TYPE;
  data: z.infer<typeof usageBillingChangedEventDataSchema>;
};

/** Registers billing's stand-in on `eventing`; the returned append records one fact. */
export function judgeFactOwner(eventing: EventSourcing) {
  const owner = eventing.register(ownerStandIn());
  return (fact: JudgeFact, id: string) =>
    owner.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.data.organizationId,
          aggregateType: "organization",
          tenantId: createTenantId(fact.data.tenantId),
          version: "2026-10-07",
          createdAt: fact.data.occurredAt,
          occurredAt: fact.data.occurredAt,
          ...fact,
        },
      ],
      { tenantId: createTenantId(fact.data.tenantId) },
    );
}
