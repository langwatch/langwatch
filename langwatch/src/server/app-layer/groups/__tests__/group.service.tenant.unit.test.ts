import { describe, expect, it, vi } from "vitest";
import type { GroupRepository } from "../repositories/group.repository";
import { GroupRestService, UserNotInOrganizationError } from "../group.service";

describe("GroupRestService.create", () => {
  it("rejects members from another organization", async () => {
    const createAtomic = vi.fn();
    const repository = {
      isUserInOrganization: vi.fn().mockResolvedValue(false),
      createAtomic,
    } as unknown as GroupRepository;
    const service = new GroupRestService(repository);

    await expect(
      service.create({
        organizationId: "org_1",
        name: "Reviewers",
        memberIds: ["foreign_user"],
      }),
    ).rejects.toBeInstanceOf(UserNotInOrganizationError);

    expect(createAtomic).not.toHaveBeenCalled();
  });
});
