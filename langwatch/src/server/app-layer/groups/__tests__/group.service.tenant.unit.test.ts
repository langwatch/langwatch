import { describe, expect, it, vi } from "vitest";
import type { GroupRepository } from "../repositories/group.repository";
import { GroupRestService, UserNotInOrganizationError } from "../group.service";

describe("GroupRestService.create", () => {
  describe("when a requested member is not in the organization", () => {
    it("rejects the whole group in a single membership query", async () => {
      const createAtomic = vi.fn();
      const areUsersInOrganization = vi.fn().mockResolvedValue(false);
      const repository = {
        areUsersInOrganization,
        createAtomic,
      } as unknown as GroupRepository;
      const service = new GroupRestService(repository);

      await expect(
        service.create({
          organizationId: "org_1",
          name: "Reviewers",
          memberIds: ["member_1", "foreign_user", "member_1"],
        }),
      ).rejects.toBeInstanceOf(UserNotInOrganizationError);

      expect(areUsersInOrganization).toHaveBeenCalledTimes(1);
      expect(areUsersInOrganization).toHaveBeenCalledWith({
        organizationId: "org_1",
        userIds: ["member_1", "foreign_user"],
      });
      expect(createAtomic).not.toHaveBeenCalled();
    });
  });
});
