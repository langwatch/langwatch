/**
 * @vitest-environment node
 * Retention lengthened at a paid activation reaches the rows already stored: the extension fact,
 * then one raise per project and category, each recorded as applied.
 * @see specs/billing/seat-subscription-retention-policy.feature
 */
import {
  GROWTH_INCLUDED_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";
import {
  BILLING_LIFECYCLE_EVENT_VERSION,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  type SubscriptionStartedEventData,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createDataRetentionTestApp,
  createDataRetentionTestProjectScopes,
  MemoryRetentionDirectory,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_EXTENDED_EVENT_TYPE,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
} from "../retention-extension.events.ts";

const organizationId = retentionTestGraph.organizationId ?? "";
const projectIds = [retentionTestGraph.projectId, "project-2"];

function billingStandIn() {
  return definePipeline({
    name: "billing_stand_in",
    aggregate: defineAggregate({ type: "billing_lifecycle" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(SUBSCRIPTION_STARTED_EVENT_TYPE),
        data: subscriptionStartedEventDataSchema,
      }),
    ])
    .build();
}

async function harness({ refuseRaises = 0 }: { refuseRaises?: number } = {}) {
  // A Free organization holds no retention rule of its own.
  const policies = MemoryDataRetentionRepository.create();
  const retroactive = MemoryRetroactiveRetentionRepository.create();
  retroactive.refuseNextRaises = refuseRaises;
  const app = createDataRetentionTestApp({
    repositories: {
      ...MemoryDataRetentionRepositories.create(),
      policies,
      retroactive,
      directory: MemoryRetentionDirectory.create(),
      projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, ["project-2"]),
    },
  });
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const billing = eventing.register(billingStandIn());
  eventing.register(app.seatPolicyPipeline());
  const extension = eventing.register(
    app.retentionExtensionPipeline({ applyRetryDelayMs: () => 10 }),
  );
  app.connectRetentionExtensionCommands(extension.commands);

  const fact: SubscriptionStartedEventData = {
    tenantId: organizationId,
    occurredAt: 1_790_000_000_000,
    organizationId,
    subscriptionId: "sub-1",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    memberUserIds: ["user-1"],
    retentionDays: GROWTH_INCLUDED_RETENTION_DAYS,
  };
  const started = (id: string) =>
    billing.service.storeEvents(
      [
        {
          id,
          aggregateId: organizationId,
          aggregateType: "billing_lifecycle",
          tenantId: createTenantId(organizationId),
          type: SUBSCRIPTION_STARTED_EVENT_TYPE,
          version: BILLING_LIFECYCLE_EVENT_VERSION,
          createdAt: fact.occurredAt,
          occurredAt: fact.occurredAt,
          idempotencyKey: `${organizationId}:${fact.subscriptionId}:started`,
          data: fact,
        },
      ],
      { tenantId: createTenantId(organizationId) },
    );
  const eventsOf = async ({ aggregateId, type }: { aggregateId: string; type: string }) =>
    (
      await eventStore.getEvents({
        aggregateId,
        context: { tenantId: createTenantId(aggregateId) },
        aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
      })
    ).filter((event) => event.type === type);
  const applied = async () =>
    (
      await Promise.all(
        projectIds.map((projectId) =>
          eventsOf({ aggregateId: projectId, type: RETENTION_APPLIED_EVENT_TYPE }),
        ),
      )
    ).flat();
  const extended = () =>
    eventsOf({ aggregateId: organizationId, type: RETENTION_EXTENDED_EVENT_TYPE });
  return { app, eventing, started, retroactive, applied, extended };
}

const everyProjectAndCategory = projectIds.length * retentionCategories.length;

describe("given a Free organization with two projects and no retention rule", () => {
  describe("when a Growth Seat subscription keeping 90 days is activated", () => {
    /** @scenario "Upgrading extends retention of stored traces" */
    it("records the extension and raises every project's stored data to its resolved retention", async () => {
      const { app, eventing, started, retroactive, applied, extended } = await harness();

      try {
        await started("event-1");
        await vi.waitFor(
          async () => expect(await applied()).toHaveLength(everyProjectAndCategory),
          {
            timeout: 10_000,
          },
        );

        const [extension] = await extended();
        expect(extension?.data).toMatchObject({
          organizationId,
          retention: expect.arrayContaining([
            { category: "traces", retentionDays: GROWTH_INCLUDED_RETENTION_DAYS },
          ]),
        });
        const traceRaises = retroactive.raises.filter((raise) => raise.category === "traces");
        expect(traceRaises.map((raise) => raise.projectId).toSorted()).toEqual(
          [...projectIds].toSorted(),
        );
        expect(
          traceRaises.every((raise) => raise.retentionDays === GROWTH_INCLUDED_RETENTION_DAYS),
        ).toBe(true);
        await expect(
          app.getRetentionDays({ projectId: retentionTestGraph.projectId, category: "traces" }),
        ).resolves.toBe(GROWTH_INCLUDED_RETENTION_DAYS);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when re-stamping a project's stored data is refused the first time", () => {
    /** @scenario "A failed re-stamp of stored data is retried and never fails the upgrade" */
    it("still provisions the policies and retries until each raise is applied once", async () => {
      const { app, eventing, started, retroactive, applied } = await harness({ refuseRaises: 1 });

      try {
        await expect(started("event-1")).resolves.not.toThrow();
        await vi.waitFor(
          async () => expect(await applied()).toHaveLength(everyProjectAndCategory),
          {
            timeout: 20_000,
          },
        );

        expect(retroactive.refuseNextRaises).toBe(0);
        expect(retroactive.raises).toHaveLength(everyProjectAndCategory);
        await expect(
          app.getRetentionDays({ projectId: "project-2", category: "traces" }),
        ).resolves.toBe(GROWTH_INCLUDED_RETENTION_DAYS);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when the same activation fact is delivered again", () => {
    /** @scenario "A redelivered activation records the extension once" */
    it("records one extension and raises each project and category once", async () => {
      const { eventing, started, retroactive, applied, extended } = await harness();

      try {
        await started("event-1");
        await vi.waitFor(
          async () => expect(await applied()).toHaveLength(everyProjectAndCategory),
          {
            timeout: 10_000,
          },
        );
        await started("event-1-redelivered");
        await vi.waitFor(async () => expect(await extended()).toHaveLength(1));
        // Give the redelivery time to run through every lane before counting.
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(await extended()).toHaveLength(1);
        expect(retroactive.raises).toHaveLength(everyProjectAndCategory);
      } finally {
        await eventing.close();
      }
    });
  });
});
