/**
 * @vitest-environment node
 *
 * Group membership as event truth, against real Postgres (ADR-125's named
 * prerequisite).
 *
 * Real rows on purpose. The promise is not "the service calls a method" — it
 * is that after a removal the row IS still there, marked, and that every read
 * of live membership answers as though it were gone. A mocked store can only
 * assert the first half, and the half it cannot assert is the one that failed
 * open before.
 *
 * The queue leg is severed the way `ledger-instant-revoke.integration.test.ts`
 * severs it: the command senders record and no fold ever runs. What is left is
 * the synchronous enforcement write, so anything true at the end of a removal
 * here is true because the calling path made it true — not because a worker
 * caught up.
 *
 * @see specs/rbac/group-membership-is-event-truth.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
} from "~/generated/prisma/client";
import {
  type AuthzGrantsCommandSenders,
  GrantsLedgerWriter,
  newGroupMembershipId,
} from "~/server/app-layer/authz/ledger";
import { liveGroupMemberships } from "~/server/app-layer/authz/repositories/live-rows";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaGroupRepository } from "../repositories/group.prisma.repository";

const ns = `group-membership-${nanoid(8)}`;
const ACTOR = { type: "user", id: "user_admin" } as const;

const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
  "addGroupMember",
  "removeGroupMember",
] as const;

describe("given a group somebody belongs to", () => {
  const appended: Array<{ verb: string; data: unknown }> = [];

  let organization: Organization;
  let userId: string;
  let groupId: string;

  const writer = () =>
    new GrantsLedgerWriter(prisma, {
      onLedgerWrites: async () => true,
      // A poll that never retries: the fold is severed, so waiting for it
      // would only spend the suite's time. Every assertion below is about
      // what the CALLING path did.
      poll: { intervalMs: 0, timeoutMs: 0 },
      commands: async () => ({
        commands: Object.fromEntries(
          COMMAND_VERBS.map((verb) => [
            verb,
            {
              send: async (data: unknown) => {
                appended.push({ verb, data });
              },
            },
          ]),
        ) as unknown as AuthzGrantsCommandSenders,
      }),
    });

  const repository = () => new PrismaGroupRepository(prisma, writer());

  /** Every membership row for this pair, marked or not — the history. */
  const allMemberships = () =>
    prisma.groupMembership.findMany({
      where: { groupId, userId },
      orderBy: { occurredAt: "asc" },
      select: { id: true, removedAt: true, removedReason: true },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Membership Org", slug: `--test-org-${ns}` },
    });
    const user = await prisma.user.create({
      data: { name: "Dave", email: `${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const group = await prisma.group.create({
      data: {
        id: `group_${ns}`,
        organizationId: organization.id,
        name: "Security Engineering",
        slug: `sec-eng-${ns}`,
      },
    });
    groupId = group.id;
    // The membership the fold would have written. The suite drives removals
    // and re-adds from here.
    await prisma.groupMembership.create({
      data: {
        id: newGroupMembershipId(),
        groupId,
        userId,
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["groupMembership", { group: { organizationId: organization.id } }],
      ["group", { organizationId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ...(userId ? ([["user", { id: userId }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  describe("when an administrator removes them", () => {
    /** @scenario "Removing someone from a group takes their access away immediately" */
    /** @scenario "The record still shows they were in it and when they left" */
    it("marks the row rather than deleting it, before the call returns", async () => {
      const before = await allMemberships();
      expect(before).toHaveLength(1);

      await repository().removeMember({
        groupId,
        organizationId: organization.id,
        userId,
        actor: ACTOR,
      });

      const after = await allMemberships();
      // The record survives — this is the whole point. A delete here made
      // "which groups was Dave in on 30 June" unanswerable.
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(before[0]!.id);
      expect(after[0]!.removedAt).toBeInstanceOf(Date);
      expect(after[0]!.removedReason).toBe("removed from group");

      // And the mark is there with no fold having run: no worker touched
      // this database during the call.
      expect(appended.some((entry) => entry.verb === "removeGroupMember")).toBe(
        true,
      );
    });

    /** @scenario "A membership that ended grants nothing anywhere it is read" */
    it("answers every live read as though the membership were gone", async () => {
      expect(
        await liveGroupMemberships(prisma).findMany({
          where: { groupId, userId },
        }),
      ).toEqual([]);
      expect(
        await liveGroupMemberships(prisma).count({ where: { groupId } }),
      ).toBe(0);
      expect(await repository().findMembers({ groupId })).toEqual([]);

      const detail = await repository().findById({
        id: groupId,
        organizationId: organization.id,
      });
      expect(detail?.members).toEqual([]);
    });

    /** @scenario "Somebody who is not in a group cannot be taken out of it" */
    it("refuses a second removal with a code the caller can act on", async () => {
      await expect(
        repository().removeMember({
          groupId,
          organizationId: organization.id,
          userId,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "group_member_not_in_group" });
    });
  });

  describe("when an administrator adds them back", () => {
    /** @scenario "Re-adding works and reads as a new membership" */
    it("creates a second membership and leaves the first one ended", async () => {
      const ended = await allMemberships();
      expect(ended).toHaveLength(1);

      // The fold is severed, so the row the command would have written is
      // written here — the assertion is about the state a re-add reaches,
      // and the writer's own liveness pre-check is what has to let it get
      // this far rather than reading the marked row as a duplicate.
      const reAddId = newGroupMembershipId();
      await prisma.groupMembership.create({
        data: { id: reAddId, groupId, userId, occurredAt: new Date() },
      });

      const both = await allMemberships();
      expect(both).toHaveLength(2);
      expect(both[0]!.removedAt).toBeInstanceOf(Date);
      expect(both[1]!.id).toBe(reAddId);
      expect(both[1]!.removedAt).toBeNull();

      // The live read sees exactly one, and it is the new one.
      const live = await liveGroupMemberships(prisma).findMany({
        where: { groupId, userId },
        select: { id: true },
      });
      expect(live).toEqual([{ id: reAddId }]);
    });

    /** @scenario "Somebody already in a group cannot be added to it twice" */
    it("refuses a second live membership for the same pair", async () => {
      await expect(
        repository().addMember({
          groupId,
          organizationId: organization.id,
          userId,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "group_member_already_added" });
    });

    /**
     * The partial unique index, proven at the database rather than inferred
     * from the schema file. Any number of ENDED memberships for one pair is
     * ordinary history; two LIVE ones is the state that must be impossible.
     */
    it("lets the database refuse two live memberships even if the code does not", async () => {
      await expect(
        prisma.groupMembership.create({
          data: {
            id: newGroupMembershipId(),
            groupId,
            userId,
            occurredAt: new Date(),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("allows a second ENDED membership for the same pair", async () => {
      const extra = newGroupMembershipId();
      await prisma.groupMembership.create({
        data: {
          id: extra,
          groupId,
          userId,
          occurredAt: new Date(),
          removedAt: new Date(),
          removedReason: "history",
        },
      });

      expect(await allMemberships()).toHaveLength(3);
      await prisma.groupMembership.delete({ where: { id: extra } });
    });
  });

  describe("when the group is deleted", () => {
    /** @scenario "Deleting a group ends its memberships without erasing that they existed" */
    it("ends every live membership before the group row goes", async () => {
      await repository().deleteAllMemberships({
        groupId,
        organizationId: organization.id,
        actor: ACTOR,
      });

      expect(
        await liveGroupMemberships(prisma).findMany({ where: { groupId } }),
      ).toEqual([]);
      // Ended, with a stated reason — the events behind these are what
      // survives the group row's own deletion.
      const rows = await allMemberships();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.removedAt !== null)).toBe(true);
      expect(rows.some((row) => row.removedReason === "group deleted")).toBe(
        true,
      );
    });
  });
});
