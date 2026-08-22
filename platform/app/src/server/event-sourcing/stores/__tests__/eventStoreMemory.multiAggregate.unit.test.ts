/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — appending through a
 * pipeline that owns a set of aggregate types (ADR-113). The store validates
 * each event against the aggregate that owns its event type, and writes the
 * event's own stamp to the row.
 */
import { describe, expect, it } from "vitest";
import { declaredAggregateScope } from "../../domain/aggregateScope";
import type { AggregateType } from "../../domain/aggregateType";
import type { EventType } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import {
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
} from "../../services/__tests__/testHelpers";
import { ValidationError } from "../../services/errorHandling";
import { EventStoreMemory } from "../eventStoreMemory";

const GRANT = "authz_grant" as const satisfies AggregateType;
const ROLE = "authz_role" as const satisfies AggregateType;
const GRANT_ATTACHED = "lw.authz.grant.attached" as EventType;
const ROLE_DEFINED = "lw.authz.role.defined" as EventType;
const SPAN_RECEIVED = "lw.obs.trace.span_received" as EventType;

const scope = declaredAggregateScope({
  [GRANT]: [GRANT_ATTACHED, "lw.authz.grant.revoked"],
  [ROLE]: [ROLE_DEFINED, "lw.authz.role.deleted"],
});

describe("EventStoreMemory.storeEvents on a multi-aggregate pipeline", () => {
  const tenantId = createTestTenantId("org_1");
  const context = createTestEventStoreReadContext<Event>(tenantId);

  async function storeOne(event: Event) {
    const store = new EventStoreMemory<Event>();
    await store.storeEvents([event], context, scope);
    return store;
  }

  describe("given an event of each aggregate", () => {
    /** @scenario "Appending an event of each aggregate to the shared pipeline" */
    it("stores both, each under the type it was stamped with", async () => {
      const store = new EventStoreMemory<Event>();
      const grant = createTestEvent("g1", GRANT, tenantId, GRANT_ATTACHED);
      const role = createTestEvent("r1", ROLE, tenantId, ROLE_DEFINED);

      await store.storeEvents([grant, role], context, scope);

      const grants = await store.getEvents("g1", context, GRANT);
      const roles = await store.getEvents("r1", context, ROLE);
      expect(grants.map((e) => e.aggregateType)).toEqual([GRANT]);
      expect(roles.map((e) => e.aggregateType)).toEqual([ROLE]);
      expect(await store.getEvents("r1", context, GRANT)).toHaveLength(0);
    });
  });

  describe("given an event whose stamp disagrees with its event type's owner", () => {
    /** @scenario "An event whose stamp disagrees with its event type's owner is rejected" */
    it("rejects the append naming the aggregateType field and stores nothing", async () => {
      const store = new EventStoreMemory<Event>();
      const misStamped = createTestEvent("r1", GRANT, tenantId, ROLE_DEFINED);

      const failure = await store
        .storeEvents([misStamped], context, scope)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ValidationError);
      expect((failure as ValidationError).field).toBe("aggregateType");
      expect((failure as ValidationError).message).toMatch(
        /owned by aggregate 'authz_role' but the event is stamped 'authz_grant'/,
      );
      expect(await store.getEvents("r1", context, GRANT)).toHaveLength(0);
    });
  });

  describe("given an event type none of the declared aggregates owns", () => {
    /** @scenario "An event type no declared aggregate owns is rejected" */
    it("rejects the append naming the aggregateType field", async () => {
      const stray = createTestEvent("t1", "trace", tenantId, SPAN_RECEIVED);

      const failure = await storeOne(stray).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ValidationError);
      expect((failure as ValidationError).field).toBe("aggregateType");
      expect((failure as ValidationError).message).toMatch(
        /owned by none of the pipeline's aggregates \(authz_grant, authz_role\)/,
      );
    });
  });

  describe("given a single-type pipeline", () => {
    /** @scenario "A single-aggregate pipeline is unchanged" */
    it("keeps the equality check and accepts any event type stamped with its type", async () => {
      const store = new EventStoreMemory<Event>();
      const event = createTestEvent("t1", "trace", tenantId, SPAN_RECEIVED);

      await store.storeEvents([event], context, "trace");
      const failure = await store
        .storeEvents(
          [createTestEvent("g1", GRANT, tenantId, GRANT_ATTACHED)],
          context,
          "trace",
        )
        .catch((error: unknown) => error);

      expect(await store.getEvents("t1", context, "trace")).toHaveLength(1);
      expect((failure as ValidationError).message).toMatch(
        /does not match pipeline aggregate type 'trace'/,
      );
    });
  });
});
