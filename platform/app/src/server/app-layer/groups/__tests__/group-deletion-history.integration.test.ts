/**
 * @vitest-environment node
 *
 * Deleting a group, against real Postgres.
 *
 * Three of the promises here are properties of the DATABASE and cannot be
 * asserted anywhere else: that two live groups still collide on a slug, that a
 * deleted group frees that slug for the next one, and that the marked
 * membership rows survive the deletion of the group they belong to. The last
 * of those is the whole point of the change — it used to be a cascade, and a
 * cascade is exactly the kind of thing a mocked store cannot fail on.
 *
 * The queue leg is severed the way the membership suite severs it: the command
 * senders record and no fold ever runs, so anything true at the end of a
 * deletion here is true because the calling path made it true.
 *
 * @see specs/rbac/group-deletion-keeps-its-history.feature
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
import {
  liveGroupMemberships,
  liveGroups,
} from "~/server/app-layer/authz/repositories/live-rows";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { GroupRestService } from "../group.service";
import { PrismaGroupRepository } from "../repositories/group.prisma.repository";

const ns = `group-deletion-${nanoid(8)}`;
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

describe("given a group with a member", () => {
  let organization: Organization;
  let userId: string;
  let groupId: string;

  const SLUG = `sec-eng-${ns}`;

  const writer = () =>
    new GrantsLedgerWriter(prisma, {
      onLedgerWrites: async () => true,
      poll: { intervalMs: 0, timeoutMs: 0 },
      commands: async () => ({
        commands: Object.fromEntries(
          COMMAND_VERBS.map((verb) => [verb, { send: async () => undefined }]),
        ) as unknown as AuthzGrantsCommandSenders,
      }),
    });

  const repository = () => new PrismaGroupRepository(prisma, writer());

  const service = () =>
    new GroupRestService({
      repo: repository(),
      roleService: {
        validateRolesAssignable: async () => undefined,
        assertNoOrgExclusivePermissionsBelowOrgScope: async () => undefined,
      } as never,
    });

  /** Every membership row for this group, marked or not — the history. */
  const allMemberships = () =>
    prisma.groupMembership.findMany({
      where: { groupId },
      select: { id: true, userId: true, removedAt: true, removedReason: true },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Deletion Org", slug: `--test-org-${ns}` },
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
        slug: SLUG,
      },
    });
    groupId = group.id;
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

  describe("when two live groups claim one slug", () => {
    /** @scenario "Two live groups still cannot share a name" */
    it("the database refuses the second, so the partial unique is really unique", async () => {
      // A live-rows partial index is still an index. If the WHERE clause had
      // been widened — or dropped by a `migrate dev` that saw an `@@unique` in
      // schema.prisma — this insert would succeed and two live groups would
      // share a slug.
      await expect(
        prisma.group.create({
          data: {
            id: `group_dup_${ns}`,
            organizationId: organization.id,
            name: "Security Engineering (again)",
            slug: SLUG,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("when the group is deleted", () => {
    /** @scenario "Deleting a group takes its access away immediately" */
    /** @scenario "The record still shows who was in the group and when it ended" */
    it("marks the group and leaves its ended memberships standing", async () => {
      await service().delete({
        id: groupId,
        organizationId: organization.id,
        actor: ACTOR,
      });

      // The group row is MARKED, not gone.
      const marked = await prisma.group.findUnique({ where: { id: groupId } });
      expect(marked?.deletedAt).toBeInstanceOf(Date);
      expect(marked?.deletedReason).toBe("group deleted");

      // And it reads as absent through the fence, which is what every
      // access-deciding query goes through.
      expect(
        await liveGroups(prisma).findFirst({ where: { id: groupId } }),
      ).toBeNull();

      // The memberships ended, and the rows are STILL THERE. This is the
      // assertion the cascade used to fail: it took them with the group.
      const rows = await allMemberships();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(userId);
      expect(rows[0]?.removedAt).toBeInstanceOf(Date);
      expect(rows[0]?.removedReason).toBe("group deleted");
      expect(
        await liveGroupMemberships(prisma).findMany({ where: { groupId } }),
      ).toEqual([]);
    });

    /** @scenario "The first deletion is the one that counts" */
    it("refuses a second deletion without moving when the first happened", async () => {
      const before = await prisma.group.findUnique({ where: { id: groupId } });

      await expect(
        service().delete({
          id: groupId,
          organizationId: organization.id,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "group_already_deleted" });

      const after = await prisma.group.findUnique({ where: { id: groupId } });
      expect(after?.deletedAt?.toISOString()).toBe(
        before?.deletedAt?.toISOString(),
      );
    });
  });

  describe("when the freed name is used again", () => {
    /** @scenario "A group name can be used again after the group is deleted" */
    /** @scenario "A name freed by a deletion is offered without a suffix" */
    it("accepts the slug the deleted group still holds, as a new group", async () => {
      // The slug is not free because the old row went — it is free because the
      // unique index only covers live rows.
      const offered = await repository().findUniqueSlug({
        organizationId: organization.id,
        baseSlug: SLUG,
      });
      expect(offered).toBe(SLUG);

      const recreated = await prisma.group.create({
        data: {
          id: `group_again_${ns}`,
          organizationId: organization.id,
          name: "Security Engineering",
          slug: SLUG,
        },
      });

      // A NEW group, never a revival: the deleted one keeps its own id, its
      // own members and its own end.
      expect(recreated.id).not.toBe(groupId);
      expect(recreated.deletedAt).toBeNull();
      expect(
        await liveGroupMemberships(prisma).findMany({
          where: { groupId: recreated.id },
        }),
      ).toEqual([]);
      const oldRows = await allMemberships();
      expect(oldRows).toHaveLength(1);
      expect(oldRows[0]?.removedAt).toBeInstanceOf(Date);
    });
  });

  describe("when a directory group is deleted and pushed back", () => {
    /** @scenario "A directory group that disappears and returns does not collide" */
    it("accepts the same directory id again, because the index covers live rows", async () => {
      const externalId = `idp-${ns}`;
      const first = await prisma.group.create({
        data: {
          id: `group_scim_${ns}`,
          organizationId: organization.id,
          name: "Directory Group",
          slug: `dir-${ns}`,
          scimSource: "scim",
          externalId,
        },
      });

      // A second LIVE group cannot hold it.
      await expect(
        prisma.group.create({
          data: {
            id: `group_scim_dup_${ns}`,
            organizationId: organization.id,
            name: "Directory Group (again)",
            slug: `dir-2-${ns}`,
            scimSource: "scim",
            externalId,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.group.update({
        where: { id: first.id },
        data: {
          deletedAt: new Date(),
          deletedReason: "group deleted by the identity provider",
        },
      });

      const returned = await prisma.group.create({
        data: {
          id: `group_scim_back_${ns}`,
          organizationId: organization.id,
          name: "Directory Group",
          slug: `dir-2-${ns}`,
          scimSource: "scim",
          externalId,
        },
      });

      expect(returned.id).not.toBe(first.id);
      expect(
        await liveGroups(prisma).findFirst({
          where: { organizationId: organization.id, externalId },
        }),
      ).toMatchObject({ id: returned.id });
    });
  });
});
