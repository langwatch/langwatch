/**
 * Deleting a group, and the order it happens in.
 *
 * The access has to go before the group row is marked, and each part of it has
 * to go as its own fact — otherwise the record of who was in the group and
 * when they left is exactly what a deletion throws away, which is what the
 * membership change existed to stop.
 */
import { describe, expect, it, vi } from "vitest";
import type { Group } from "~/generated/prisma/client";
import type { RoleService } from "~/server/role";
import { GroupRestService } from "../group.service";
import type { GroupRepository } from "../repositories/group.repository";

const ACTOR = { type: "user", id: "actor_1" } as const;

function groupRow(overrides: Partial<Group> = {}): Group {
  return {
    id: "grp_1",
    organizationId: "org_1",
    name: "sec-eng",
    slug: "sec-eng",
    externalId: null,
    scimSource: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  } as Group;
}

function serviceWith(repo: Partial<GroupRepository>) {
  const calls: string[] = [];
  const record =
    <T>(name: string, result?: T) =>
    async () => {
      calls.push(name);
      return result as T;
    };
  const repository = {
    deleteAllBindings: vi.fn(record("bindings")),
    deleteAllMemberships: vi.fn(record("memberships")),
    delete: vi.fn(record("group")),
    ...repo,
  } as unknown as GroupRepository;
  const service = new GroupRestService({
    repo: repository,
    roleService: { validateRolesAssignable: vi.fn() } as unknown as RoleService,
  });
  return { service, repository, calls };
}

describe("GroupRestService.delete", () => {
  describe("when the group is live", () => {
    /** @scenario "Deleting a group takes its access away immediately" */
    it("takes the access away before it marks the group", async () => {
      const { service, repository, calls } = serviceWith({
        findIncludingDeleted: vi.fn().mockResolvedValue(groupRow()),
      });

      await service.delete({
        id: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });

      // Bindings, then memberships, then the row. Both of the first two
      // enforce their deny synchronously, so an interrupted delete
      // under-grants rather than leaving access on a group on its way out.
      expect(calls).toEqual(["bindings", "memberships", "group"]);
      expect(repository.deleteAllMemberships).toHaveBeenCalledWith({
        groupId: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });
    });

    /** @scenario "The record still shows who was in the group and when it ended" */
    it("ends the memberships through the ledger rather than erasing them", async () => {
      const { service, repository } = serviceWith({
        findIncludingDeleted: vi.fn().mockResolvedValue(groupRow()),
      });

      await service.delete({
        id: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });

      // The repository's `deleteAllMemberships` is a ledger write that MARKS
      // each row; the group's own `delete` marks the group. Neither is a row
      // deletion, which is what keeps the two records readable afterwards.
      expect(repository.deleteAllMemberships).toHaveBeenCalledTimes(1);
      expect(repository.delete).toHaveBeenCalledWith({
        id: "grp_1",
        organizationId: "org_1",
        reason: "group deleted",
      });
    });
  });

  describe("when the change history is read afterwards", () => {
    /** @scenario "Deleting a group records every access it took away, one by one" */
    it("takes each kind of access away as its own attributable change", async () => {
      const { service, repository } = serviceWith({
        findIncludingDeleted: vi.fn().mockResolvedValue(groupRow()),
      });

      await service.delete({
        id: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });

      // The grants and the memberships go through the ledger separately, each
      // carrying the actor — which is what makes every resulting entry say who
      // did it. A deletion recorded as one "group deleted" line could not.
      expect(repository.deleteAllBindings).toHaveBeenCalledWith({
        groupId: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });
      expect(repository.deleteAllMemberships).toHaveBeenCalledWith({
        groupId: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
      });
      // The fan-out itself — one fact per live membership — belongs to
      // `removeGroupMembersWhere`, which resolves the filter to ids and is
      // covered where it lives. What is pinned here is that the deletion
      // reaches it rather than marking the group and calling it done.
      expect(repository.delete).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "group deleted" }),
      );
    });
  });

  describe("when the group was already deleted", () => {
    /** @scenario "The first deletion is the one that counts" */
    it("refuses with a code that names the record, not a missing row", async () => {
      const { service, repository } = serviceWith({
        findIncludingDeleted: vi
          .fn()
          .mockResolvedValue(
            groupRow({ deletedAt: new Date("2026-02-03T00:00:00.000Z") }),
          ),
      });

      await expect(
        service.delete({
          id: "grp_1",
          organizationId: "org_1",
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "group_already_deleted" });

      // Nothing is re-ended: a second deletion must not move when the first
      // one happened, nor emit removals for memberships that already ended.
      expect(repository.deleteAllBindings).not.toHaveBeenCalled();
      expect(repository.deleteAllMemberships).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    /** @scenario "The first deletion is the one that counts" */
    it("does not tell the caller the group never existed", async () => {
      const { service } = serviceWith({
        findIncludingDeleted: vi
          .fn()
          .mockResolvedValue(groupRow({ deletedAt: new Date() })),
      });

      await expect(
        service.delete({
          id: "grp_1",
          organizationId: "org_1",
          actor: ACTOR,
        }),
      ).rejects.not.toMatchObject({ code: "group_not_found" });
    });
  });

  describe("when there is no such group at all", () => {
    /** @scenario "The first deletion is the one that counts" */
    it("answers not found, which is a different refusal", async () => {
      const { service } = serviceWith({
        findIncludingDeleted: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.delete({
          id: "grp_missing",
          organizationId: "org_1",
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "group_not_found" });
    });
  });

  describe("when the group is owned by an identity provider", () => {
    /** @scenario "A deleted directory group is gone as far as the directory is concerned" */
    it("refuses unless the caller has already asked the admin", async () => {
      const { service, repository } = serviceWith({
        findIncludingDeleted: vi
          .fn()
          .mockResolvedValue(groupRow({ scimSource: "scim" })),
      });

      await expect(
        service.delete({
          id: "grp_1",
          organizationId: "org_1",
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group" });
      expect(repository.delete).not.toHaveBeenCalled();

      await service.delete({
        id: "grp_1",
        organizationId: "org_1",
        actor: ACTOR,
        shouldBypassDirectoryManagement: true,
      });
      expect(repository.delete).toHaveBeenCalledTimes(1);
    });
  });
});
