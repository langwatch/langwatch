import { DuplicateBindingError } from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import type { RoleService } from "~/server/role";
import { GroupRestService } from "../group.service";
import type { GroupRepository } from "../repositories/group.repository";

describe("GroupRestService.addBinding", () => {
  describe("when an identical binding already exists", () => {
    it("answers the conflict code instead of a fabricated binding id", async () => {
      const repository = {
        findGroupOnly: vi.fn().mockResolvedValue({ id: "group_1" }),
        validateScopeInOrganization: vi.fn().mockResolvedValue(true),
        anyScopeIsPersonalTeam: vi.fn().mockResolvedValue(false),
        createBinding: vi
          .fn()
          .mockRejectedValue(new DuplicateBindingError("group_1")),
      } as unknown as GroupRepository;
      const service = new GroupRestService({
        repo: repository,
        roleService: {
          validateRolesAssignable: vi.fn(),
        } as unknown as RoleService,
      });

      await expect(
        service.addBinding({
          groupId: "group_1",
          organizationId: "org_1",
          role: "MEMBER" as never,
          scopeType: "TEAM" as never,
          scopeId: "team_1",
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });
  });
});
