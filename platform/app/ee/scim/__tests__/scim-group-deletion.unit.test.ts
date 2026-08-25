// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A directory deleting a group, and pushing the same group back later.
 *
 * A SCIM group is deleted and re-created routinely — an admin moves it, a sync
 * rule changes, an IdP re-provisions. That used to be a row deletion, which
 * cascaded away every marked membership row underneath it, so the answer to
 * "who was in this directory group before it went" survived the removal of the
 * members and then did not survive the removal of the group.
 *
 * Now the group is MARKED, its `externalId` is freed with it because the
 * uniqueness index is partial over live rows, and the group that comes back is
 * a new one with its own beginning.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { ScimGroupService } from "../scim-group.service";

const bumpAuthzEpoch = vi.hoisted(() =>
  vi.fn(async (_args: { organizationId: string }) => undefined),
);
vi.mock("~/server/app-layer/authz/epoch", () => ({
  bumpAuthzEpoch: (args: { organizationId: string }) => bumpAuthzEpoch(args),
}));

const reconcileScimGrants = vi.hoisted(() =>
  vi.fn(async (_args: unknown) => undefined),
);
vi.mock("../scim-grants.reconciler", () => ({
  reconcileScimGrants: (args: unknown) => reconcileScimGrants(args),
}));

const GROUP = {
  id: "group-1",
  name: "Engineering",
  slug: "engineering",
  organizationId: "org-1",
  externalId: "idp-42",
  scimSource: "scim",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  deletedAt: null,
  deletedReason: null,
};

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  const mock = {
    group: {
      findFirst: vi.fn().mockResolvedValue(GROUP),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue(GROUP),
      ...overrides,
    },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    organizationUser: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return mock as unknown as PrismaClient & typeof mock;
}

function serviceFor(prisma: PrismaClient) {
  return ScimGroupService.create({
    prisma,
    writer: {
      addGroupMembers: vi.fn().mockResolvedValue({ added: [], duplicates: [] }),
      removeGroupMembersWhere: vi.fn().mockResolvedValue([]),
    } as unknown as GrantsLedgerWriter,
  });
}

describe("SCIM group deletion", () => {
  beforeEach(() => {
    bumpAuthzEpoch.mockClear();
    reconcileScimGrants.mockClear();
  });

  describe("when the directory deletes a group", () => {
    /** @scenario "The record still shows who was in the group and when it ended" */
    it("marks the row rather than deleting it", async () => {
      const prisma = createMockPrisma();

      const error = await serviceFor(prisma).deleteGroup({
        externalScimId: "group-1",
        organizationId: "org-1",
      });

      expect(error).toBeNull();
      expect("delete" in prisma.group).toBe(false);
      const [args] = prisma.group.updateMany.mock.calls[0] as [
        { where: Record<string, unknown>; data: Record<string, unknown> },
      ];
      expect(args.where).toEqual({
        id: "group-1",
        organizationId: "org-1",
        deletedAt: null,
      });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect(args.data.deletedReason).toBe(
        "group deleted by the identity provider",
      );
    });

    /** @scenario "Deleting a group takes its access away immediately" */
    it("takes the grants away before the group row is marked", async () => {
      const prisma = createMockPrisma();

      await serviceFor(prisma).deleteGroup({
        externalScimId: "group-1",
        organizationId: "org-1",
      });

      // Reconciled to the empty set: an IdP that deletes a group has taken
      // that access away, and the enforcement is synchronous.
      expect(reconcileScimGrants).toHaveBeenCalledWith(
        expect.objectContaining({ desired: [], where: { groupId: "group-1" } }),
      );
      expect(reconcileScimGrants.mock.invocationCallOrder[0]!).toBeLessThan(
        prisma.group.updateMany.mock.invocationCallOrder[0]!,
      );
    });

    /** @scenario "Deleting a group moves the organization's change counter" */
    it("moves the organization's epoch, or the deleted group keeps being read", async () => {
      const prisma = createMockPrisma();

      await serviceFor(prisma).deleteGroup({
        externalScimId: "group-1",
        organizationId: "org-1",
      });

      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });

  describe("when the directory asks for a group it already deleted", () => {
    /** @scenario "A deleted directory group is gone as far as the directory is concerned" */
    it("answers 404, because the fence makes the lookup miss it", async () => {
      // The fence is the mechanism: `findGroup` goes through `liveGroups`, so
      // a marked row answers null and every SCIM verb starting there 404s.
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = createMockPrisma({ findFirst });

      const result = await serviceFor(prisma).getGroup({
        externalScimId: "group-1",
        organizationId: "org-1",
      });

      expect(result).toMatchObject({ status: "404" });
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: "group-1",
          organizationId: "org-1",
          deletedAt: null,
        },
      });
    });

    /** @scenario "A deleted directory group is gone as far as the directory is concerned" */
    it("refuses to delete it twice", async () => {
      const prisma = createMockPrisma({
        findFirst: vi.fn().mockResolvedValue(null),
      });

      const error = await serviceFor(prisma).deleteGroup({
        externalScimId: "group-1",
        organizationId: "org-1",
      });

      expect(error).toMatchObject({ status: "404" });
      expect(prisma.group.updateMany).not.toHaveBeenCalled();
      expect(bumpAuthzEpoch).not.toHaveBeenCalled();
    });
  });

  describe("when the directory pushes a group back after deleting it", () => {
    /** @scenario "A directory group that disappears and returns does not collide" */
    it("creates a new group rather than colliding with the deleted one", async () => {
      // Both the duplicate-name check and the slug search go through the
      // fence, so the deleted group is invisible to them — which is what lets
      // the second arrival take the same name and the same directory id.
      const findFirst = vi.fn().mockResolvedValue(null);
      const create = vi.fn().mockResolvedValue({ ...GROUP, id: "group-2" });
      const prisma = createMockPrisma({ findFirst, create });

      const result = await serviceFor(prisma).createGroup({
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          externalId: "idp-42",
        } as never,
        organizationId: "org-1",
      });

      expect(result).toMatchObject({ id: "group-2" });
      for (const call of findFirst.mock.calls) {
        expect((call[0] as { where: Record<string, unknown> }).where).toEqual(
          expect.objectContaining({ deletedAt: null }),
        );
      }
      // A NEW group: the id is minted here, never recovered from the row that
      // held the name before.
      const [args] = create.mock.calls[0] as [{ data: { id: string } }];
      expect(args.data.id).not.toBe(GROUP.id);
    });
  });
});
