/**
 * @vitest-environment node
 * @unit
 * @see modules/user/specs/user.feature
 */
import {
  createTenantId,
  type Event,
  type EventSubscriberDefinition,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import {
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION,
  type OrganizationMemberDisabledEventData,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { buildUserLifecyclePipeline } from "../user-lifecycle.pipeline.ts";

const LANE = "user_lifecycle.revokeDisabledMemberSessions";

const DISABLED: OrganizationMemberDisabledEventData = {
  tenantId: "organization-1",
  organizationId: "organization-1",
  userId: "user-1",
  occurredAt: 1_500,
  disabledByUserId: "user-admin",
};

function disabledEvent({ id = "event-1" }: { id?: string } = {}): Event {
  return {
    id,
    aggregateId: DISABLED.organizationId,
    aggregateType: "organization",
    tenantId: createTenantId(DISABLED.tenantId),
    createdAt: DISABLED.occurredAt,
    occurredAt: DISABLED.occurredAt,
    type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
    version: ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION,
    data: DISABLED,
  };
}

/** The sessions user holds per account, ended the way user's own revoke ends them. */
function sessionStore() {
  const held = new Map<string, Set<string>>([
    ["user-1", new Set(["session-a", "session-b"])],
    ["user-2", new Set(["session-c"])],
  ]);
  const revocations: string[] = [];
  const sessions = createApiFixture<UserApi>(
    {
      revokeAllBrowserSessions: async ({ userId }) => {
        revocations.push(userId);
        held.get(userId)?.clear();
      },
    },
    "UserApi",
  );
  const counts = () => [...held.entries()].map(([userId, ids]) => [userId, ids.size]);
  return { sessions, revocations, counts };
}

function revocationLane(
  sessions: Pick<UserApi, "revokeAllBrowserSessions">,
): EventSubscriberDefinition {
  const pipeline = buildUserLifecyclePipeline({
    sessions,
    facts: { record: async () => undefined, retention: InMemoryProcessStore.createForTesting() },
  });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const definition = lanes.get(LANE);
  if (!definition) throw new Error("no member-disabled session lane mounted");
  return definition;
}

function deduplicationIdOf({
  definition,
  event,
}: {
  definition: EventSubscriberDefinition;
  event: Event;
}): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const CONTEXT = { tenantId: DISABLED.tenantId, aggregateId: DISABLED.organizationId };

describe("user's member-disabled session lane", () => {
  describe("when organization records a member as disabled", () => {
    /** @scenario "A member disabled in an organization loses their browser sessions" */
    it("ends that person's browser sessions and nobody else's", async () => {
      const store = sessionStore();
      const definition = revocationLane(store.sessions);

      await definition.handle(disabledEvent(), CONTEXT);

      expect(definition.eventTypes).toEqual([ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE]);
      expect(store.revocations).toEqual(["user-1"]);
      expect(store.counts()).toEqual([
        ["user-1", 0],
        ["user-2", 1],
      ]);
    });
  });

  describe("when the same fact is redelivered", () => {
    /** @scenario "A redelivered seat revocation is keyed alike and harmless" */
    it("keys both deliveries alike and leaves the account with no sessions", async () => {
      const store = sessionStore();
      const definition = revocationLane(store.sessions);

      await definition.handle(disabledEvent(), CONTEXT);
      await definition.handle(disabledEvent({ id: "redelivered" }), CONTEXT);

      expect(store.counts()).toEqual([
        ["user-1", 0],
        ["user-2", 1],
      ]);
      expect(deduplicationIdOf({ definition, event: disabledEvent() })).toBe(
        deduplicationIdOf({ definition, event: disabledEvent({ id: "redelivered" }) }),
      );
    });
  });
});
