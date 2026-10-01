import type { ApiKeyBinding } from "@langwatch/api-key-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository } from "../../repositories/api-key.repository.ts";
import type { ApiKeyCatalogService } from "../api-key-catalog.service.ts";
import { ApiKeyEnrichmentService } from "../api-key-enrichment.service.ts";
import type { ApiKeyDependencies } from "../api-key.service.ts";

function teamGrant({ id, teamId }: { id: string; teamId: string }): ApiKeyBinding {
  return { id, role: "ADMIN", customRoleId: null, scopeType: "TEAM", scopeId: teamId };
}

function serviceWith({ liveTeams }: { liveTeams: { id: string; name: string }[] }) {
  const getOrgTeams = vi.fn().mockResolvedValue(liveTeams);
  const getTeam = vi.fn().mockRejectedValue(new Error("team not found"));
  const service = ApiKeyEnrichmentService.create(
    createApiFixture<ApiKeyDependencies & { repository: ApiKeyRepository }>({
      organizations: createApiFixture<OrganizationApi>({ getTeam }),
    }),
    createApiFixture<ApiKeyCatalogService>({
      getOrgTeams,
      customRoles: vi.fn().mockResolvedValue([]),
    }),
  );

  return { service, getOrgTeams, getTeam };
}

describe("ApiKeyEnrichmentService.enrichBindingsWithNames", () => {
  describe("given a TEAM grant on a team the organization's team list omits", () => {
    describe("when the bindings are named", () => {
      /** @scenario "A key minted by someone holding a grant on an archived team keeps the minter's role" */
      it("answers, leaves that team unnamed and names the live team", async () => {
        const { service, getTeam } = serviceWith({
          liveTeams: [{ id: "team-live", name: "Platform" }],
        });

        const names = await service.enrichBindingsWithNames({
          organizationId: "org-1",
          bindings: [
            teamGrant({ id: "grant-1", teamId: "team-archived" }),
            teamGrant({ id: "grant-2", teamId: "team-live" }),
          ],
        });

        expect(names.teamName.get("team-archived")).toBeUndefined();
        expect(names.teamName.get("team-live")).toBe("Platform");
        expect(getTeam).not.toHaveBeenCalled();
      });
    });
  });

  describe("given several TEAM grants", () => {
    describe("when the bindings are named", () => {
      /** @scenario "A key minted by someone holding a grant on an archived team keeps the minter's role" */
      it("reads the organization's teams once", async () => {
        const { service, getOrgTeams } = serviceWith({ liveTeams: [] });

        await service.enrichBindingsWithNames({
          organizationId: "org-1",
          bindings: [
            teamGrant({ id: "grant-1", teamId: "team-a" }),
            teamGrant({ id: "grant-2", teamId: "team-b" }),
          ],
        });

        expect(getOrgTeams).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given no TEAM grant", () => {
    describe("when the bindings are named", () => {
      it("does not read the teams", async () => {
        const { service, getOrgTeams } = serviceWith({ liveTeams: [] });

        await service.enrichBindingsWithNames({ organizationId: "org-1", bindings: [] });

        expect(getOrgTeams).not.toHaveBeenCalled();
      });
    });
  });
});
