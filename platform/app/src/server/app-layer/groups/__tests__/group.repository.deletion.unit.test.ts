/**
 * The group repository's half of a deletion: what it writes, and what it stops
 * reading afterwards.
 *
 * The two things that would undo the change are both invisible in a diff — a
 * `deleteMany` where a mark belongs, and a missing epoch bump that leaves the
 * decision cache answering from before the deletion for up to thirty seconds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const bumpAuthzEpoch = vi.fn(
  async (_args: { organizationId: string }) => undefined,
);

vi.mock("~/server/app-layer/authz/epoch", () => ({
  bumpAuthzEpoch: (args: { organizationId: string }) => bumpAuthzEpoch(args),
}));

const { PrismaGroupRepository } = await import(
  "../repositories/group.prisma.repository"
);

function prismaWith(group: Record<string, unknown>) {
  return {
    group: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
      ...group,
    },
  };
}

describe("PrismaGroupRepository", () => {
  beforeEach(() => {
    bumpAuthzEpoch.mockClear();
  });

  describe("when a group is deleted", () => {
    /** @scenario "The record still shows who was in the group and when it ended" */
    it("marks the row instead of deleting it, so its memberships survive", async () => {
      const prisma = prismaWith({});
      const repository = new PrismaGroupRepository(prisma as never);

      await repository.delete({ id: "grp_1", organizationId: "org_1" });

      expect(prisma.group.updateMany).toHaveBeenCalledTimes(1);
      const [args] = prisma.group.updateMany.mock.calls[0] as [
        { where: Record<string, unknown>; data: Record<string, unknown> },
      ];
      expect(args.where).toEqual({
        id: "grp_1",
        organizationId: "org_1",
        deletedAt: null,
      });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect("delete" in prisma.group).toBe(false);
      expect("deleteMany" in prisma.group).toBe(false);
    });

    /** @scenario "Deleting a group moves the organization's change counter" */
    it("moves the organization's epoch, or a deleted group keeps granting", async () => {
      const prisma = prismaWith({});
      const repository = new PrismaGroupRepository(prisma as never);

      await repository.delete({ id: "grp_1", organizationId: "org_1" });

      expect(bumpAuthzEpoch).toHaveBeenCalledWith({ organizationId: "org_1" });
    });

    /** @scenario "The first deletion is the one that counts" */
    it("only ever marks a live row, so a repeat cannot move the moment it ended", async () => {
      const prisma = prismaWith({});
      const repository = new PrismaGroupRepository(prisma as never);

      await repository.delete({ id: "grp_1", organizationId: "org_1" });

      const [args] = prisma.group.updateMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where.deletedAt).toBeNull();
    });

    /** @scenario "The record still shows who was in the group and when it ended" */
    it("records the caller's reason on the row", async () => {
      const prisma = prismaWith({});
      const repository = new PrismaGroupRepository(prisma as never);

      await repository.delete({
        id: "grp_1",
        organizationId: "org_1",
        reason: "group deleted",
      });

      const [args] = prisma.group.updateMany.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data.deletedReason).toBe("group deleted");
    });
  });

  describe("when a name is being chosen for a new group", () => {
    /** @scenario "A name freed by a deletion is offered without a suffix" */
    it("ignores a deleted group holding the same slug", async () => {
      // The fence is what makes the read miss the deleted row, so the first
      // candidate is free and no suffix is invented for a name nothing uses.
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = prismaWith({ findFirst });
      const repository = new PrismaGroupRepository(prisma as never);

      const slug = await repository.findUniqueSlug({
        organizationId: "org_1",
        baseSlug: "sec-eng",
      });

      expect(slug).toBe("sec-eng");
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            slug: "sec-eng",
            deletedAt: null,
          }),
        }),
      );
    });

    /** @scenario "Two live groups still cannot share a name" */
    it("still suffixes around a LIVE group holding the same slug", async () => {
      const findFirst = vi
        .fn()
        .mockResolvedValueOnce({ id: "grp_live" })
        .mockResolvedValueOnce(null);
      const prisma = prismaWith({ findFirst });
      const repository = new PrismaGroupRepository(prisma as never);

      const slug = await repository.findUniqueSlug({
        organizationId: "org_1",
        baseSlug: "sec-eng",
      });

      expect(slug).toBe("sec-eng-2");
    });
  });

  describe("when a group is looked up for a deletion", () => {
    /** @scenario "The first deletion is the one that counts" */
    it("reads past the fence, because a deleted group is still a record", async () => {
      const findFirst = vi
        .fn()
        .mockResolvedValue({ id: "grp_1", deletedAt: new Date() });
      const prisma = prismaWith({ findFirst });
      const repository = new PrismaGroupRepository(prisma as never);

      const group = await repository.findIncludingDeleted({
        id: "grp_1",
        organizationId: "org_1",
      });

      expect(group?.deletedAt).toBeInstanceOf(Date);
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "grp_1", organizationId: "org_1" },
      });
    });

    /** @scenario "A deleted group grants nothing anywhere it is read" */
    it("but every other lookup fences, so a deleted group reads as absent", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const prisma = prismaWith({ findFirst });
      const repository = new PrismaGroupRepository(prisma as never);

      const group = await repository.findGroupOnly({
        id: "grp_1",
        organizationId: "org_1",
      });

      expect(group).toBeNull();
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "grp_1", organizationId: "org_1", deletedAt: null },
      });
    });
  });
});
