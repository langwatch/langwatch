/**
 * Project's pipeline as its contract names the lifecycle facts data privacy folds, an append that
 * records one of them, and the worker-side eventing the installation cases host it on.
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
  projectArchivedEventDataSchema,
  projectCreatedEventDataSchema,
  projectDepartmentAssignedEventDataSchema,
  projectMovedEventDataSchema,
} from "@langwatch/project-contract";
import { z } from "zod";

function ownerStandIn() {
  return definePipeline({
    name: "project_owner_stand_in",
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
        type: z.literal(PROJECT_MOVED_EVENT_TYPE),
        data: projectMovedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE),
        data: projectDepartmentAssignedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(PROJECT_ARCHIVED_EVENT_TYPE),
        data: projectArchivedEventDataSchema,
      }),
    ])
    .build();
}

export type ProjectFact =
  | { type: typeof PROJECT_CREATED_EVENT_TYPE; data: z.infer<typeof projectCreatedEventDataSchema> }
  | { type: typeof PROJECT_MOVED_EVENT_TYPE; data: z.infer<typeof projectMovedEventDataSchema> }
  | {
      type: typeof PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE;
      data: z.infer<typeof projectDepartmentAssignedEventDataSchema>;
    }
  | {
      type: typeof PROJECT_ARCHIVED_EVENT_TYPE;
      data: z.infer<typeof projectArchivedEventDataSchema>;
    };

/** A worker's eventing over memory, with consumers on, for the subscribers under test. */
export function dataPrivacyTestEventing(): EventSourcing {
  return new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
}

/** Registers project's stand-in on `eventing`; the returned append records one fact. */
export function projectFactOwner(eventing: EventSourcing) {
  const owner = eventing.register(ownerStandIn());
  return (fact: ProjectFact, id: string) =>
    owner.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.data.projectId,
          aggregateType: "project",
          tenantId: createTenantId(fact.data.tenantId),
          version: "2026-10-06",
          createdAt: fact.data.occurredAt,
          occurredAt: fact.data.occurredAt,
          ...fact,
        },
      ],
      { tenantId: createTenantId(fact.data.tenantId) },
    );
}
