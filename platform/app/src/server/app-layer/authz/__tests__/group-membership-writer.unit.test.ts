/**
 * The writer's membership verbs (ADR-125's named prerequisite).
 *
 * What is pinned here: a removal MARKS rather than deletes on both sides of
 * the per-organization fork, the deny is enforced before the queue is asked,
 * the organization's authz epoch moves on every membership change, and the
 * liveness pre-check reads a re-add as new rather than as a duplicate.
 *
 * @see specs/rbac/group-membership-is-event-truth.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import { bumpAuthzEpoch } from "../epoch";
import {
  ACTOR,
  GROUP_ID,
  harness,
  liveMembershipRow,
  MEMBER_USER_ID,
  membership,
  ORG_ID,
} from "./ledger-write-fork.harness";

beforeEach(() => {
  vi.mocked(bumpAuthzEpoch).mockClear();
});

const removal = {
  membershipId: "groupmember_1",
  groupId: GROUP_ID,
  userId: MEMBER_USER_ID,
};

describe("given an organization on the authorization ledger", () => {
  describe("when somebody is added to a group", () => {
    it("sends one command per membership and never writes the table itself", async () => {
      const { writer, db, sent } = harness({ onLedger: true });
      db.groupMembership.count.mockResolvedValue(1);

      await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [membership],
        actor: ACTOR,
        onDuplicate: "reject",
      });

      expect(sent).toEqual([
        {
          verb: "addGroupMember",
          data: expect.objectContaining({
            tenantId: ORG_ID,
            organizationId: ORG_ID,
            membershipId: "groupmember_1",
            groupId: GROUP_ID,
            userId: MEMBER_USER_ID,
            source: "grants-service",
          }),
        },
      ]);
      expect(db.groupMembership.create).not.toHaveBeenCalled();
      expect(db.groupMembership.createMany).not.toHaveBeenCalled();
    });

    /** @scenario "The removal moves the organization's change counter" */
    it("moves the organization's change counter", async () => {
      const { writer, db } = harness({ onLedger: true });
      db.groupMembership.count.mockResolvedValue(1);

      await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [membership],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });
  });

  describe("when somebody is already in the group", () => {
    /** @scenario "Somebody already in a group cannot be added to it twice" */
    it("refuses, and appends nothing", async () => {
      const { writer, sent, db } = harness({ onLedger: true });
      db.groupMembership.findMany.mockResolvedValue([
        liveMembershipRow({ id: "groupmember_existing" }),
      ]);

      await expect(
        writer.addGroupMembers({
          organizationId: ORG_ID,
          memberships: [membership],
          actor: ACTOR,
          onDuplicate: "reject",
        }),
      ).rejects.toMatchObject({ code: "group_member_already_added" });

      expect(sent).toEqual([]);
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
    });

    it("answers with the existing membership when asked to skip", async () => {
      const { writer, sent, db } = harness({ onLedger: true });
      db.groupMembership.findMany.mockResolvedValue([
        liveMembershipRow({ id: "groupmember_existing" }),
      ]);

      const outcome = await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [membership],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(outcome).toEqual({
        added: [],
        duplicates: ["groupmember_existing"],
      });
      expect(sent).toEqual([]);
    });

    /**
     * The whole point of fencing the pre-check. A membership that ENDED is a
     * row, and reading it as "already a member" would make a re-add a silent
     * no-op — the person stays out of the group they were just put back into.
     */
    it("reads a pair whose membership ended as new, not as a duplicate", async () => {
      const { writer, sent, db } = harness({ onLedger: true });
      // `liveGroupMemberships` puts `removedAt: null` in the WHERE, so the
      // ended row is not returned at all — this is what the fence buys.
      db.groupMembership.findMany.mockResolvedValue([]);
      db.groupMembership.count.mockResolvedValue(1);

      const outcome = await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [{ ...membership, membershipId: "groupmember_2" }],
        actor: ACTOR,
        onDuplicate: "reject",
      });

      expect(db.groupMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ removedAt: null }),
        }),
      );
      expect(outcome.added).toEqual(["groupmember_2"]);
      expect(sent).toHaveLength(1);
    });
  });

  describe("when somebody is removed from a group", () => {
    /** @scenario "Removing someone from a group takes their access away immediately" */
    it("marks the row before the queue is asked, so the answer changes at once", async () => {
      const { writer, db, sent } = harness({ onLedger: true });
      // How many commands had been sent by the time the mark was applied. The
      // ordering IS the property: an admin told somebody is out of the group
      // must not find them still holding what it grants because the fold is
      // behind.
      let sentWhenMarked = -1;
      db.groupMembership.updateMany.mockImplementation(async () => {
        sentWhenMarked = sent.length;
        return { count: 1 };
      });

      await writer.removeGroupMembers({
        organizationId: ORG_ID,
        memberships: [removal],
        actor: ACTOR,
        reason: "removed from group",
      });

      expect(db.groupMembership.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["groupmember_1"] },
          removedAt: null,
          group: { organizationId: ORG_ID },
        },
        data: {
          removedAt: new Date(1_700_000_000_000),
          removedReason: "removed from group",
        },
      });
      expect(sentWhenMarked).toBe(0);
      expect(sent).toHaveLength(1);
    });

    /** @scenario "The record still shows they were in it and when they left" */
    it("never deletes the row", async () => {
      const { writer, db } = harness({ onLedger: true });

      await writer.removeGroupMembers({
        organizationId: ORG_ID,
        memberships: [removal],
        actor: ACTOR,
      });

      expect(db.groupMembership.delete).not.toHaveBeenCalled();
      expect(db.groupMembership.deleteMany).not.toHaveBeenCalled();
    });

    it("sends the pair on the command, so it rides the add's lane", async () => {
      const { writer, sent } = harness({ onLedger: true });

      await writer.removeGroupMembers({
        organizationId: ORG_ID,
        memberships: [removal],
        actor: ACTOR,
      });

      expect(sent[0]).toMatchObject({
        verb: "removeGroupMember",
        data: { groupId: GROUP_ID, userId: MEMBER_USER_ID },
      });
    });

    /** @scenario "The removal moves the organization's change counter" */
    it("moves the organization's change counter", async () => {
      const { writer } = harness({ onLedger: true });

      await writer.removeGroupMembers({
        organizationId: ORG_ID,
        memberships: [removal],
        actor: ACTOR,
      });

      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });
  });

  describe("when a filter names neither a group nor a user", () => {
    it("refuses rather than ending every membership in the organization", async () => {
      const { writer } = harness({ onLedger: true });

      await expect(
        writer.removeGroupMembersWhere({
          organizationId: ORG_ID,
          where: {},
          actor: ACTOR,
        }),
      ).rejects.toThrow(/neither a group nor a user/);
    });
  });

  describe("when a filter carries a blank id", () => {
    it("refuses a blank user rather than emptying the whole group", async () => {
      const { writer, db } = harness({ onLedger: true });

      await expect(
        writer.removeGroupMembersWhere({
          organizationId: ORG_ID,
          where: { groupId: GROUP_ID, userId: "" },
          actor: ACTOR,
        }),
      ).rejects.toThrow(/blank id/);
      // The point of the refusal: a dropped predicate would have read every
      // live membership of the group and ended all of them.
      expect(db.groupMembership.findMany).not.toHaveBeenCalled();
    });

    it("refuses a blank inside a list of users", async () => {
      const { writer, db } = harness({ onLedger: true });

      await expect(
        writer.removeGroupMembersWhere({
          organizationId: ORG_ID,
          where: { groupId: GROUP_ID, userId: ["user_erin", ""] },
          actor: ACTOR,
        }),
      ).rejects.toThrow(/blank id/);
      expect(db.groupMembership.findMany).not.toHaveBeenCalled();
    });

    it("refuses a blank group", async () => {
      const { writer, db } = harness({ onLedger: true });

      await expect(
        writer.removeGroupMembersWhere({
          organizationId: ORG_ID,
          where: { groupId: "" },
          actor: ACTOR,
        }),
      ).rejects.toThrow(/blank id/);
      expect(db.groupMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when several users are removed at once", () => {
    it("resolves them in one read rather than one per user", async () => {
      const { writer, db } = harness({ onLedger: true });
      db.groupMembership.findMany.mockResolvedValue([
        liveMembershipRow({ id: "groupmember_1" }),
        { id: "groupmember_2", groupId: GROUP_ID, userId: "user_erin" },
      ]);

      const ended = await writer.removeGroupMembersWhere({
        organizationId: ORG_ID,
        where: { groupId: GROUP_ID, userId: ["user_dana", "user_erin"] },
        actor: ACTOR,
      });

      expect(ended).toEqual(["groupmember_1", "groupmember_2"]);
      expect(db.groupMembership.findMany).toHaveBeenCalledTimes(1);
      expect(db.groupMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: GROUP_ID,
            userId: { in: ["user_dana", "user_erin"] },
          }),
        }),
      );
    });
  });

  describe("when a group's memberships are ended by filter", () => {
    /** @scenario "Deleting a group ends its memberships without erasing that they existed" */
    it("resolves the live rows and marks exactly those", async () => {
      const { writer, db, sent } = harness({ onLedger: true });
      db.groupMembership.findMany.mockResolvedValue([
        liveMembershipRow({ id: "groupmember_1" }),
        { id: "groupmember_2", groupId: GROUP_ID, userId: "user_erin" },
      ]);

      const ended = await writer.removeGroupMembersWhere({
        organizationId: ORG_ID,
        where: { groupId: GROUP_ID },
        actor: ACTOR,
        reason: "group deleted",
      });

      expect(ended).toEqual(["groupmember_1", "groupmember_2"]);
      expect(db.groupMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            groupId: GROUP_ID,
            group: { organizationId: ORG_ID },
            removedAt: null,
          },
        }),
      );
      expect(sent).toHaveLength(2);
      expect(db.groupMembership.deleteMany).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization the genesis import has not reached", () => {
  describe("when somebody is added to a group", () => {
    it("writes the same row imperatively and appends nothing", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [membership],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(db.groupMembership.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: "groupmember_1",
            userId: MEMBER_USER_ID,
            groupId: GROUP_ID,
            occurredAt: new Date(1_700_000_000_000),
          },
        ],
        skipDuplicates: true,
      });
      expect(sent).toEqual([]);
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });

    it("writes the audit row itself, since it has no event to subscribe to", async () => {
      const { writer, db } = harness({ onLedger: false });

      await writer.addGroupMembers({
        organizationId: ORG_ID,
        memberships: [membership],
        actor: ACTOR,
        onDuplicate: "skip",
      });

      expect(db.auditLog.createMany.mock.calls[0]![0].data).toEqual([
        {
          createdAt: new Date(1_700_000_000_000),
          userId: "user_admin",
          organizationId: ORG_ID,
          action: "authz.grants.group_member_added",
          metadata: {
            membershipId: "groupmember_1",
            groupId: GROUP_ID,
            userId: MEMBER_USER_ID,
            source: "grants-service",
          },
        },
      ]);
    });
  });

  describe("when somebody is removed from a group", () => {
    /**
     * The row's survival is a SCHEMA fact, not a ledger one, so both sides of
     * the fork keep the record of when the membership ended. An imperative
     * delete here would erase on the legacy side exactly what the ledger side
     * preserves — and a rollback would then lose the history.
     */
    it("marks the row rather than deleting it, on this side too", async () => {
      const { writer, db, sent } = harness({ onLedger: false });

      await writer.removeGroupMembers({
        organizationId: ORG_ID,
        memberships: [removal],
        actor: ACTOR,
        reason: "removed from group",
      });

      expect(db.groupMembership.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["groupmember_1"] },
          removedAt: null,
          group: { organizationId: ORG_ID },
        },
        data: {
          removedAt: new Date(1_700_000_000_000),
          removedReason: "removed from group",
        },
      });
      expect(db.groupMembership.delete).not.toHaveBeenCalled();
      expect(db.groupMembership.deleteMany).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });
  });
});
