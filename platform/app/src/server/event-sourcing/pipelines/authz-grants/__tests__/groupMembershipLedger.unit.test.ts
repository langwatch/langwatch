/** @vitest-environment node */

/**
 * Group membership on the authorization log (ADR-125's named prerequisite).
 *
 * Three things are pinned here and nowhere else: the fold in both directions,
 * the aggregate the commands stamp (which is what puts a re-add behind the
 * removal it follows), and the replay property — an event appended before any
 * of this existed has to fold to exactly what it folded to before.
 */
import {
  groupMembershipAggregateId,
  groupMembershipFactToRow,
  groupMembershipRowToFact,
} from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import {
  AddGroupMemberCommand,
  RemoveGroupMemberCommand,
} from "../commands/grantsLedgerCommands";
import {
  AuthzGrantsWriteProjection,
  type GrantProjectionWriteStore,
} from "../projections/authzGrantsWrite.projection";
import type {
  AddGroupMemberCommandData,
  RemoveGroupMemberCommandData,
} from "../schemas/commands";
import {
  addGroupMemberCommandDataSchema,
  removeGroupMemberCommandDataSchema,
} from "../schemas/commands";
import {
  AUTHZ_GRANT_AGGREGATE_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GROUP_MEMBER_ADDED_EVENT_TYPE,
  GROUP_MEMBER_REMOVED_EVENT_TYPE,
} from "../schemas/constants";
import { authzGrantsEventSchema } from "../schemas/events";

const ORG = "org_acme";
const GROUP = "group_sec_eng";
const USER = "user_dave";
const ACTOR = { type: "user", id: "user_admin" } as const;
const OCCURRED_AT = 1_755_000_000_000;

const store: GrantProjectionWriteStore = { append: async () => undefined };
const projection = new AuthzGrantsWriteProjection({ store });

function addedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: GROUP_MEMBER_ADDED_EVENT_TYPE,
    tenantId: ORG,
    aggregateId: groupMembershipAggregateId({ groupId: GROUP, userId: USER }),
    occurredAt: OCCURRED_AT,
    data: {
      membershipId: "groupmember_1",
      groupId: GROUP,
      userId: USER,
      source: "grants-service",
      actor: ACTOR,
      ...overrides,
    },
  } as never;
}

function removedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: GROUP_MEMBER_REMOVED_EVENT_TYPE,
    tenantId: ORG,
    aggregateId: groupMembershipAggregateId({ groupId: GROUP, userId: USER }),
    occurredAt: OCCURRED_AT,
    data: {
      membershipId: "groupmember_1",
      groupId: GROUP,
      userId: USER,
      reason: "removed from group",
      actor: ACTOR,
      ...overrides,
    },
  } as never;
}

function addCommandData(
  overrides: Partial<AddGroupMemberCommandData> = {},
): AddGroupMemberCommandData {
  return {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_1",
    membershipId: "groupmember_1",
    groupId: GROUP,
    userId: USER,
    source: "grants-service",
    actor: ACTOR,
    occurredAtMs: OCCURRED_AT,
    ...overrides,
  };
}

function removeCommandData(
  overrides: Partial<RemoveGroupMemberCommandData> = {},
): RemoveGroupMemberCommandData {
  return {
    tenantId: ORG,
    organizationId: ORG,
    commandId: "cmd_2",
    membershipId: "groupmember_1",
    groupId: GROUP,
    userId: USER,
    actor: ACTOR,
    occurredAtMs: OCCURRED_AT,
    ...overrides,
  };
}

describe("group membership on the authorization log", () => {
  describe("given a membership fact", () => {
    /** @scenario "Re-adding works and reads as a new membership" */
    it("round-trips through the projection row without losing anything", () => {
      const fact = {
        membershipId: "groupmember_1",
        groupId: GROUP,
        userId: USER,
        source: "grants-service" as const,
        occurredAtMs: OCCURRED_AT,
      };

      expect(
        groupMembershipRowToFact(
          groupMembershipFactToRow({
            membership: fact,
          }),
        ),
      ).toEqual(fact);
    });

    /** @scenario "Restating a membership cannot un-end it" */
    it("states no ending, so restating it cannot revive an ended membership", () => {
      const row = groupMembershipFactToRow({
        membership: {
          membershipId: "groupmember_1",
          groupId: GROUP,
          userId: USER,
          source: "grants-service",
          occurredAtMs: OCCURRED_AT,
        },
      });

      expect(row).not.toHaveProperty("removedAt");
      expect(row).not.toHaveProperty("removedReason");
    });
  });

  describe("when a membership is added", () => {
    it("maps to one upsert of one row, owned by nothing else", () => {
      expect(projection.mapAuthzGroupMemberAdded(addedEvent())).toEqual({
        kind: "groupMembership.upsert",
        row: {
          id: "groupmember_1",
          groupId: GROUP,
          userId: USER,
          occurredAt: new Date(OCCURRED_AT),
        },
      });
    });
  });

  describe("when a membership is removed", () => {
    /** @scenario "The record still shows they were in it and when they left" */
    it("marks the row rather than deleting it, and carries the reason", () => {
      expect(projection.mapAuthzGroupMemberRemoved(removedEvent())).toEqual({
        kind: "groupMembership.remove",
        membershipId: "groupmember_1",
        reason: "removed from group",
        occurredAt: new Date(OCCURRED_AT),
      });
    });

    it("carries a null reason rather than inventing one", () => {
      const write = projection.mapAuthzGroupMemberRemoved(
        removedEvent({ reason: undefined }),
      );
      expect(write).toMatchObject({ reason: null });
    });
  });

  // ═══ The aggregate ══════════════════════════════════════════════════
  // `serializeByAggregate` merges every command about one aggregate into one
  // FIFO lane by dropping the command name from the job path and keying on
  // `getAggregateId`. So the aggregate id IS the answer to "which changes may
  // not overtake each other", and getting it wrong fails OPEN for removals.

  describe("given the commands' aggregate", () => {
    /** @scenario "Joining and leaving one group are queued behind each other" */
    it("is the pair, so an add and a removal share one lane", () => {
      expect(AddGroupMemberCommand.getAggregateId(addCommandData())).toBe(
        RemoveGroupMemberCommand.getAggregateId(removeCommandData()),
      );
    });

    /**
     * The case the membership ROW id cannot express. A re-add is a different
     * row, so keying on the row id would put it in a lane of its own, where it
     * can drain before the removal it follows — and the projection's live-pair
     * guard would then silently drop it.
     */
    it("puts a re-add in the same lane as the removal it follows", () => {
      const reAdd = AddGroupMemberCommand.getAggregateId(
        addCommandData({ membershipId: "groupmember_2" }),
      );

      expect(reAdd).toBe(
        RemoveGroupMemberCommand.getAggregateId(removeCommandData()),
      );
    });

    it("gives a different pair a lane of its own", () => {
      expect(
        AddGroupMemberCommand.getAggregateId(
          addCommandData({ userId: "user_erin" }),
        ),
      ).not.toBe(AddGroupMemberCommand.getAggregateId(addCommandData()));
    });
  });

  describe("when the commands emit", () => {
    it("stamps the pipeline's own aggregate type and the organization as tenant", async () => {
      const [event] = await new AddGroupMemberCommand().handle({
        tenantId: ORG,
        data: addCommandData(),
      } as never);

      expect(event).toMatchObject({
        type: GROUP_MEMBER_ADDED_EVENT_TYPE,
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: groupMembershipAggregateId({
          groupId: GROUP,
          userId: USER,
        }),
        occurredAt: OCCURRED_AT,
      });
      expect(String(event?.tenantId)).toBe(ORG);
    });

    it("derives the removal's aggregate from the pair on the event too", async () => {
      const [event] = await new RemoveGroupMemberCommand().handle({
        tenantId: ORG,
        data: removeCommandData(),
      } as never);

      expect(event?.aggregateId).toBe(
        groupMembershipAggregateId({ groupId: GROUP, userId: USER }),
      );
    });

    it("omits an absent reason rather than sending it as undefined", async () => {
      const [event] = await new RemoveGroupMemberCommand().handle({
        tenantId: ORG,
        data: removeCommandData({ reason: undefined }),
      } as never);

      expect(event?.data).not.toHaveProperty("reason");
    });
  });

  // ═══ The wire boundary ══════════════════════════════════════════════

  describe("given a command that names two organizations", () => {
    it("refuses it, rather than appending under one and folding into another", () => {
      expect(
        addGroupMemberCommandDataSchema.safeParse(
          addCommandData({ tenantId: "org_other" }),
        ).success,
      ).toBe(false);
    });
  });

  describe("given a removal that names no pair", () => {
    /**
     * Without the pair the removal cannot derive its aggregate, so it would
     * ride a lane of its own and could overtake the add it follows. Refused at
     * the wire rather than left to route wrongly.
     */
    it("refuses it, because the pair is what routes it into the add's lane", () => {
      const { groupId: _g, ...withoutGroup } = removeCommandData();
      const { userId: _u, ...withoutUser } = removeCommandData();

      expect(
        removeGroupMemberCommandDataSchema.safeParse(withoutGroup).success,
      ).toBe(false);
      expect(
        removeGroupMemberCommandDataSchema.safeParse(withoutUser).success,
      ).toBe(false);
    });
  });

  // ═══ Replay ═════════════════════════════════════════════════════════

  describe("given an event appended before memberships were on the log", () => {
    /** @scenario "Every authorization change made before this existed replays unchanged" */
    it("still parses and folds to exactly the write it always folded to", () => {
      const attached = {
        id: "evt_old",
        type: GRANT_ATTACHED_EVENT_TYPE,
        tenantId: ORG,
        aggregateType: AUTHZ_GRANT_AGGREGATE_TYPE,
        aggregateId: "grant_1",
        version: "2026-08-20",
        occurredAt: OCCURRED_AT,
        createdAt: OCCURRED_AT,
        idempotencyKey: "cmd_old:0",
        metadata: {},
        data: {
          grantId: "grant_1",
          principal: { type: "user", id: USER },
          roleKey: "member",
          scope: { type: "TEAM", id: "team_1" },
          source: "grants-service",
          actor: ACTOR,
        },
      };

      // The union grew by two members; an old event must still discriminate
      // to the arm it always did.
      expect(authzGrantsEventSchema.safeParse(attached).success).toBe(true);

      expect(projection.mapAuthzGrantAttached(attached as never)).toMatchObject(
        {
          kind: "grant.upsert",
          row: {
            id: "grant_1",
            organizationId: ORG,
            roleKey: "member",
            expiresAt: null,
            occurredAt: new Date(OCCURRED_AT),
          },
        },
      );
    });
  });
});
