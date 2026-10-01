import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { OrganizationGroupScopeService } from "../organization-group-scope.service.ts";

function teamGrant({ id, teamId }: { id: string; teamId: string }) {
  return {
    id,
    role: "ADMIN" as const,
    customRoleId: null,
    customRoleName: null,
    scopeType: "TEAM" as const,
    scopeId: teamId,
  };
}

describe("OrganizationGroupScopeService.resolveBindingScopeNames", () => {
  describe("given a group grant on a team the team list omits", () => {
    describe("when the scope names are resolved", () => {
      it("answers, names the live team once and leaves the omitted team unnamed", async () => {
        const listTeams = vi.fn().mockResolvedValue({
          data: [{ id: "team-live", name: "Platform" }],
        });
        const getTeam = vi.fn().mockRejectedValue(new Error("team not found"));
        const service = OrganizationGroupScopeService.create({
          organizations: createApiFixture<OrganizationService>({ listTeams, getTeam }),
          projects: createApiFixture<ProjectApi>(),
        });

        const names = await service.resolveBindingScopeNames({
          organizationId: "org-1",
          bindings: [
            teamGrant({ id: "grant-1", teamId: "team-archived" }),
            teamGrant({ id: "grant-2", teamId: "team-live" }),
          ],
        });

        expect(names.get("team-live")).toBe("Platform");
        expect(names.has("team-archived")).toBe(false);
        expect(listTeams).toHaveBeenCalledTimes(1);
        expect(getTeam).not.toHaveBeenCalled();
      });
    });
  });
});
