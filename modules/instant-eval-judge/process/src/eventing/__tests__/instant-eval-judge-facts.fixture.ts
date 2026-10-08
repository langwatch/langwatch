/**
 * Project's and billing's pipelines as their contracts name the facts the judge folds, and an
 * append that records one of them, for tests that drive the judge's subscribers.
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
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { z } from "zod";

function ownerStandIn() {
  return definePipeline({
    name: "judge_fact_owner_stand_in",
    aggregate: defineAggregate({ type: "project" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_CREATED_EVENT_TYPE),
        data: projectCreatedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(USAGE_BILLING_CHANGED_EVENT_TYPE),
        data: usageBillingChangedEventDataSchema,
      }),
    ])
    .build();
}

export type JudgeFact =
  | { type: typeof PROJECT_CREATED_EVENT_TYPE; data: z.infer<typeof projectCreatedEventDataSchema> }
  | {
      type: typeof USAGE_BILLING_CHANGED_EVENT_TYPE;
      data: z.infer<typeof usageBillingChangedEventDataSchema>;
    };

/** Registers the owners' stand-in on `eventing`; the returned append records one fact. */
export function judgeFactOwner(eventing: EventSourcing) {
  const owner = eventing.register(ownerStandIn());
  return (fact: JudgeFact, id: string) =>
    owner.service.storeEvents(
      [
        {
          id,
          aggregateId: "projectId" in fact.data ? fact.data.projectId : fact.data.organizationId,
          aggregateType: "project",
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
