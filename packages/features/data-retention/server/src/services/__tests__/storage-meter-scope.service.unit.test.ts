/**
 * The storage card must reflect the scope selector. `getScopeUsage` enumerates
 * the in-scope projects FROM the caller's organization, narrows them to
 * `traces:view`, then sums each tenant's storage. The security property under
 * test: a wider scope can only ever surface storage for projects the caller is
 * already allowed to read.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DataRetentionDirectoryPort,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
  type RetentionScopeTarget,
} from "../../ports/data-retention-directory.port";
import { DataRetentionPermissionsPort } from "../../ports/data-retention-permissions.port";
import { StorageMeterScopeService } from "../storage-meter-scope.service";

const ACTOR = { userId: "user_alice", email: "alice@example.com" };

class StubDirectory extends DataRetentionDirectoryPort {
  constructor(
    private readonly lineage: RetentionProjectLineage | null,
    private readonly scopeProjects: ReadonlyArray<{ id: string; teamId: string }>,
  ) {
    super();
  }
  async tryGetProjectLineage(): Promise<RetentionProjectLineage | null> {
    return this.lineage;
  }
  async listOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
    return { teams: [], projects: [] };
  }
  async tryResolveScopeOrganizationId(): Promise<string | null> {
    return this.lineage?.organizationId ?? null;
  }
  async listScopeProjects(): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    return this.scopeProjects;
  }
}

class StubPermissions extends DataRetentionPermissionsPort {
  constructor(private readonly viewable: readonly string[]) {
    super();
  }
  async canManageOrganization(): Promise<boolean> {
    return false;
  }
  async canManageTeams(): Promise<ReadonlyMap<string, boolean>> {
    return new Map();
  }
  async canUpdateProjects(input: {
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return new Map(input.projectIds.map((id) => [id, true] as const));
  }
  async canViewTraces(input: {
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return new Map(input.projectIds.map((id) => [id, this.viewable.includes(id)] as const));
  }
}

const ORGANIZATION_SCOPE: RetentionScopeTarget = {
  scopeType: "ORGANIZATION",
  scopeId: "org_1",
};

const inOrganization: RetentionProjectLineage = {
  projectId: "proj_a",
  name: "A",
  teamId: "team_1",
  organizationId: "org_1",
  organizationName: "Acme",
};

describe("given an organization-scoped storage reading", () => {
  describe("when the caller can view only some of the organization's projects", () => {
    it("sums only the projects the caller may read", async () => {
      const getTotalStorageBytesForTenants = vi.fn().mockResolvedValue(512);
      const service = StorageMeterScopeService.create({
        retention: {
          getTotalStorageBytes: vi.fn(),
          getTotalStorageBytesForTenants,
        } as never,
        directory: new StubDirectory(inOrganization, [
          { id: "proj_a", teamId: "team_1" },
          { id: "proj_b", teamId: "team_2" },
        ]),
        permissions: new StubPermissions(["proj_a"]),
      });

      const usage = await service.getScopeUsage({
        projectId: "proj_a",
        scope: ORGANIZATION_SCOPE,
        actor: ACTOR,
      });

      expect(getTotalStorageBytesForTenants).toHaveBeenCalledWith({ tenantIds: ["proj_a"] });
      expect(usage).toEqual({ totalBytes: 512, projectCount: 1 });
    });
  });

  describe("when the scope resolves to no project in the caller's organization", () => {
    it("reports nothing rather than falling back to a wider set", async () => {
      const service = StorageMeterScopeService.create({
        retention: {
          getTotalStorageBytes: vi.fn(),
          getTotalStorageBytesForTenants: vi.fn(),
        } as never,
        directory: new StubDirectory(inOrganization, []),
        permissions: new StubPermissions([]),
      });

      const usage = await service.getScopeUsage({
        projectId: "proj_a",
        scope: { scopeType: "TEAM", scopeId: "team_from_another_org" },
        actor: ACTOR,
      });

      expect(usage).toEqual({ totalBytes: 0, projectCount: 0 });
    });
  });
});

describe("given a personal-account project with no organization", () => {
  describe("when its storage is read", () => {
    it("reports the project's own bytes, already authorized by the route guard", async () => {
      const getTotalStorageBytes = vi.fn().mockResolvedValue(64);
      const service = StorageMeterScopeService.create({
        retention: {
          getTotalStorageBytes,
          getTotalStorageBytesForTenants: vi.fn(),
        } as never,
        directory: new StubDirectory(
          {
            projectId: "proj_personal",
            name: "Personal",
            teamId: null,
            organizationId: null,
            organizationName: null,
          },
          [],
        ),
        permissions: new StubPermissions([]),
      });

      const usage = await service.getScopeUsage({
        projectId: "proj_personal",
        scope: { scopeType: "PROJECT", scopeId: "proj_personal" },
        actor: ACTOR,
      });

      expect(getTotalStorageBytes).toHaveBeenCalledWith({ tenantId: "proj_personal" });
      expect(usage).toEqual({ totalBytes: 64, projectCount: 1 });
    });
  });
});
