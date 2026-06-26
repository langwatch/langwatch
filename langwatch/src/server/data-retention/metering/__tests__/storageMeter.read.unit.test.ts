import { beforeEach, describe, expect, it, vi } from "vitest";

const rbacMocks = vi.hoisted(() => ({ batchScopePermissions: vi.fn() }));
vi.mock("~/server/api/rbac", () => rbacMocks);

const appMocks = vi.hoisted(() => ({
  getTotalStorageBytes: vi.fn(),
  getTotalStorageBytesForTenants: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    dataRetention: {
      metering: {
        getTotalStorageBytes: appMocks.getTotalStorageBytes,
        getTotalStorageBytesForTenants: appMocks.getTotalStorageBytesForTenants,
      },
    },
  }),
}));

import { resolveScopeStorageUsage } from "../storageMeter.read";

/**
 * The storage card must reflect the scope selector. `resolveScopeStorageUsage`
 * enumerates the in-scope projects FROM the caller's org, RBAC-filters them to
 * `traces:view`, then sums each tenant's storage. The security property under
 * test: a wider scope can only ever surface storage for projects the caller is
 * already allowed to read.
 */
describe("resolveScopeStorageUsage", () => {
  const session = { user: { id: "user_alice" } } as any;
  const prisma = {
    project: { findFirst: vi.fn(), findMany: vi.fn() },
  } as any;
  const ctx = { prisma, session };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.project.findFirst.mockResolvedValue({
      team: { organizationId: "org_1" },
    });
    appMocks.getTotalStorageBytesForTenants.mockImplementation(
      async (ids: string[]) => ids.length * 100,
    );
  });

  describe("given an organization scope", () => {
    it("sums every org project the caller can read", async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: "proj_a", teamId: "team_a" },
        { id: "proj_b", teamId: "team_b" },
        { id: "proj_c", teamId: "team_b" },
      ]);
      // Caller can read a and c, but not b.
      rbacMocks.batchScopePermissions.mockResolvedValue({
        teams: new Map(),
        projects: new Map([
          ["proj_a", true],
          ["proj_b", false],
          ["proj_c", true],
        ]),
      });

      const result = await resolveScopeStorageUsage(ctx, {
        projectId: "proj_a",
        scope: { scopeType: "ORGANIZATION", scopeId: "org_1" },
      });

      expect(appMocks.getTotalStorageBytesForTenants).toHaveBeenCalledWith([
        "proj_a",
        "proj_c",
      ]);
      expect(result).toEqual({ totalBytes: 200, projectCount: 2 });
    });
  });

  describe("given a team scope", () => {
    it("enumerates only that team's projects, constrained to the org", async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: "proj_b", teamId: "team_b" },
        { id: "proj_c", teamId: "team_b" },
      ]);
      rbacMocks.batchScopePermissions.mockResolvedValue({
        teams: new Map(),
        projects: new Map([
          ["proj_b", true],
          ["proj_c", true],
        ]),
      });

      const result = await resolveScopeStorageUsage(ctx, {
        projectId: "proj_b",
        scope: { scopeType: "TEAM", scopeId: "team_b" },
      });

      const where = prisma.project.findMany.mock.calls[0]![0].where;
      expect(where).toEqual({
        teamId: "team_b",
        team: { organizationId: "org_1" },
      });
      expect(result).toEqual({ totalBytes: 200, projectCount: 2 });
    });
  });

  describe("given a foreign scope id the caller cannot reach", () => {
    it("resolves to no projects and zero bytes", async () => {
      // org-constrained query returns nothing for a scopeId in another org
      prisma.project.findMany.mockResolvedValue([]);

      const result = await resolveScopeStorageUsage(ctx, {
        projectId: "proj_a",
        scope: { scopeType: "PROJECT", scopeId: "proj_in_other_org" },
      });

      expect(result).toEqual({ totalBytes: 0, projectCount: 0 });
      expect(rbacMocks.batchScopePermissions).not.toHaveBeenCalled();
      expect(appMocks.getTotalStorageBytesForTenants).not.toHaveBeenCalled();
    });
  });

  describe("given a personal-account project with no organization", () => {
    it("returns just that project's storage", async () => {
      prisma.project.findFirst.mockResolvedValue({ team: null });
      appMocks.getTotalStorageBytes.mockResolvedValue(512);

      const result = await resolveScopeStorageUsage(ctx, {
        projectId: "proj_personal",
        scope: { scopeType: "PROJECT", scopeId: "proj_personal" },
      });

      expect(appMocks.getTotalStorageBytes).toHaveBeenCalledWith({
        tenantId: "proj_personal",
      });
      expect(result).toEqual({ totalBytes: 512, projectCount: 1 });
    });
  });
});
