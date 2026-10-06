/**
 * Project's and organization's pipelines as their contracts name the presence-setting facts, and
 * an append that records one of them, for tests that drive presence's settings subscribers.
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  type EventSourcing,
} from "@langwatch/eventing";
import {
  ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  organizationPresenceSettingChangedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  projectCreatedEventDataSchema,
  projectPresenceSettingChangedEventDataSchema,
} from "@langwatch/project-contract";
import { z } from "zod";

/** Project's and organization's pipelines, as their contracts name the facts. */
function ownerStandIn() {
  return definePipeline({
    name: "owner_stand_in",
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
        type: z.literal(PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE),
        data: projectPresenceSettingChangedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE),
        data: organizationPresenceSettingChangedEventDataSchema,
      }),
    ])
    .build();
}

export type SettingsFact =
  | { type: typeof PROJECT_CREATED_EVENT_TYPE; data: z.infer<typeof projectCreatedEventDataSchema> }
  | {
      type: typeof PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE;
      data: z.infer<typeof projectPresenceSettingChangedEventDataSchema>;
    }
  | {
      type: typeof ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE;
      data: z.infer<typeof organizationPresenceSettingChangedEventDataSchema>;
    };

/** Registers the owners' stand-in on `eventing`; the returned append records one fact. */
export function settingsFactOwner(eventing: EventSourcing) {
  const owner = eventing.register(ownerStandIn());
  return (fact: SettingsFact, id: string) =>
    owner.service.storeEvents(
      [
        {
          id,
          aggregateId: "projectId" in fact.data ? fact.data.projectId : fact.data.organizationId,
          aggregateType: "project",
          tenantId: createTenantId(fact.data.tenantId),
          version: "2026-10-05",
          createdAt: fact.data.occurredAt,
          occurredAt: fact.data.occurredAt,
          ...fact,
        },
      ],
      { tenantId: createTenantId(fact.data.tenantId) },
    );
}
