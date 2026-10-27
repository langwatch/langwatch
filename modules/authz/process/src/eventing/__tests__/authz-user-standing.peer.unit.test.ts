/**
 * @vitest-environment node
 *
 * Authz keeps who is deactivated or erased from user's and identity's facts,
 * from its own side (§9).
 * @see modules/authz/specs/user-standing.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { USER_ERASED_EVENT_TYPE, userErasedPayloadSchema } from "@langwatch/identity-contract";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AuthzAuditTrailRepository } from "../../repositories/authz-audit-trail.repository.ts";
import { AuthzGrantProjectionRepository } from "../../repositories/authz-grant-projection.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzUserStandingRepository } from "../../repositories/memory/memory.authz-user-standing.repository.ts";
import { AuthzUserStandingService } from "../../services/authz-user-standing.service.ts";
import { EventingAuthzAdapter } from "../authz-grant.pipeline.ts";

const USER_ID = "user_alice";

class NullAuthzGrantProjectionRepository extends AuthzGrantProjectionRepository {
  async append(): Promise<void> {}
}

class NullAuthzAuditTrailRepository extends AuthzAuditTrailRepository {
  async insert(): Promise<void> {}
}

/** User's and identity's pipelines as their contracts name the events; authz reads type, data. */
function ownerStandIn() {
  const lifecycleData = userLifecycleEventDataSchema;
  return definePipeline({
    name: "owner_stand_in",
    aggregate: defineAggregate({ type: "user_account" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_DEACTIVATED_EVENT_TYPE),
        data: lifecycleData,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_REACTIVATED_EVENT_TYPE),
        data: lifecycleData,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_ERASED_EVENT_TYPE),
        data: userErasedPayloadSchema,
      }),
    ])
    .build();
}

type StandingFact =
  | {
      type: typeof USER_DEACTIVATED_EVENT_TYPE | typeof USER_REACTIVATED_EVENT_TYPE;
      data: z.infer<typeof userLifecycleEventDataSchema>;
    }
  | { type: typeof USER_ERASED_EVENT_TYPE; data: z.infer<typeof userErasedPayloadSchema> };

function harness() {
  const memory = AuthzMemoryStore.create();
  const standings = MemoryAuthzUserStandingRepository.create({ memory });
  const revokeErased = vi.fn(async (_input: { userId: string }) => void 0);
  const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const owner = eventing.register(ownerStandIn());
  eventing.register(
    EventingAuthzAdapter.build({
      authzGrantsWriteStore: new NullAuthzGrantProjectionRepository(),
      authzAuditTrailStore: new NullAuthzAuditTrailRepository(),
      userStandings: AuthzUserStandingService.create({
        standings,
        platformOperators: { revokeErased },
      }),
    }),
  );
  let sequence = 0;
  const store = (occurredAt: number, fact: StandingFact) => {
    sequence += 1;
    return owner.service.storeEvents(
      [
        {
          id: `event-${sequence}`,
          aggregateId: USER_ID,
          aggregateType: "user_account",
          tenantId: createTenantId(USER_ID),
          version: "2026-10-01",
          createdAt: occurredAt,
          occurredAt,
          ...fact,
        },
      ],
      { tenantId: createTenantId(USER_ID) },
    );
  };
  const lifecycle = (occurredAt: number) => ({ tenantId: USER_ID, userId: USER_ID, occurredAt });
  const inactive = () => standings.findInactiveUserIds({ userIds: [USER_ID] });

  return { eventing, store, lifecycle, inactive, revokeErased, memory };
}

describe("authz's user standing, kept from its peers' facts", () => {
  describe("when user records a deactivation and then a reactivation", () => {
    /** @scenario A deactivated user is inactive to authz until reactivated */
    it("holds the user inactive, then active again", async () => {
      const { eventing, store, lifecycle, inactive } = harness();

      await store(10, { type: USER_DEACTIVATED_EVENT_TYPE, data: lifecycle(10) });
      await vi.waitFor(async () => expect(await inactive()).toEqual([USER_ID]));

      await store(20, { type: USER_REACTIVATED_EVENT_TYPE, data: lifecycle(20) });
      await vi.waitFor(async () => expect(await inactive()).toEqual([]));
      await eventing.close();
    });
  });

  describe("when a deactivation is delivered again after the reactivation", () => {
    /** @scenario A redelivered user fact changes nothing */
    it("leaves the user active", async () => {
      const { eventing, store, lifecycle, inactive, memory } = harness();

      await store(10, { type: USER_DEACTIVATED_EVENT_TYPE, data: lifecycle(10) });
      await store(20, { type: USER_REACTIVATED_EVENT_TYPE, data: lifecycle(20) });
      await vi.waitFor(() => expect(memory.userStandings.get(USER_ID)?.changedAtMs).toBe(20));
      await store(10, { type: USER_DEACTIVATED_EVENT_TYPE, data: lifecycle(10) });

      await vi.waitFor(async () => expect(await inactive()).toEqual([]));
      await eventing.close();
    });
  });

  describe("when identity records the user erased", () => {
    /** @scenario Erasure revokes the erased person's platform grant */
    it("marks the user gone, then revokes their platform grant", async () => {
      const { eventing, store, inactive, revokeErased } = harness();

      await store(30, {
        type: USER_ERASED_EVENT_TYPE,
        data: {
          userId: USER_ID,
          erasedIdentifierIds: [],
          actor: { type: "system", id: null },
        },
      });

      await vi.waitFor(() => expect(revokeErased).toHaveBeenCalledWith({ userId: USER_ID }));
      expect(await inactive()).toEqual([USER_ID]);
      await eventing.close();
    });
  });
});
