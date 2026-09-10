/**
 * `getScopeUsage` enumerates the in-scope projects FROM the caller's
 * organization, narrows them to `traces:view`, then sums each tenant's storage.
 * A wider scope can only ever surface storage the caller may already read.
 */
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import {
  type DataRetentionDirectoryReader,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "../../app/data-retention.app.ts";
import { RetentionPermissionsService } from "../retention-permissions.service.ts";
import { StorageMeterScopeService } from "../storage-meter-scope.service.ts";

const ACTOR = { userId: "user_alice", email: "alice@example.com" };

class StubDirectory implements DataRetentionDirectoryReader {
  constructor(
    private readonly lineage: RetentionProjectLineage | null,
    private readonly scopeProjects: ReadonlyArray<{ id: string; teamId: string }>,
  ) {}
  async findProjectLineage(): Promise<RetentionProjectLineage | null> {
    return this.lineage;
  }
  async listOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
    return { teams: [], projects: [] };
  }
  async findScopeOrganizationId(): Promise<string | null> {
    return this.lineage?.organizationId ?? null;
  }
  async listScopeProjects(): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    return this.scopeProjects;
  }
}

/** `traces:view` on exactly `viewable`; every other tier answers no. */
function permissionsFor(viewable: readonly string[]): RetentionPermissionsService {
  const authz = createApiFixture<AuthzApi>({
    hasPermission: vi.fn(async () => false),
    canBatchByIds: vi.fn(async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map<string, boolean>(),
      projects: new Map(
        input.projects.map((project) => [
          project.projectId,
          input.permission === "traces:view" && viewable.includes(project.projectId),
        ]),
      ),
      organizationRole: null,
    })),
  });

  return RetentionPermissionsService.create({ authz });
}

const ORGANIZATION_SCOPE: ScopeAssignment = {
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
        meter: {
          getTotalStorageBytes: vi.fn(),
          getTotalStorageBytesForTenants,
        },
        directory: new StubDirectory(inOrganization, [
          { id: "proj_a", teamId: "team_1" },
          { id: "proj_b", teamId: "team_2" },
        ]),
        permissions: permissionsFor(["proj_a"]),
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
        meter: {
          getTotalStorageBytes: vi.fn(),
          getTotalStorageBytesForTenants: vi.fn(),
        },
        directory: new StubDirectory(inOrganization, []),
        permissions: permissionsFor([]),
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
        meter: {
          getTotalStorageBytes,
          getTotalStorageBytesForTenants: vi.fn(),
        },
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
        permissions: permissionsFor([]),
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
