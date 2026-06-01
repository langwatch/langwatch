import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks for rbac helpers used by getRetentionPolicySnapshot.
const rbacMocks = vi.hoisted(() => ({
  hasOrganizationPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
  batchScopePermissions: vi.fn(),
}));

vi.mock("~/server/api/rbac", () => rbacMocks);

const appMocks = vi.hoisted(() => ({
  getResolvedForProject: vi.fn(),
  listOrganizationRules: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    dataRetention: {
      policy: {
        getResolvedForProject: appMocks.getResolvedForProject,
        listOrganizationRules: appMocks.listOrganizationRules,
      },
    },
  }),
}));

import { getRetentionPolicySnapshot } from "../dataRetentionPolicy.read";

/**
 * Regression: a caller with project:view on a single project must NOT see
 * retention rule definitions (or human names) for other projects/teams in
 * the same organization. The earlier `canReadScope` used
 * `Map.has(scopeId)` against the full org member list — proving org
 * membership rather than per-scope permission.
 */
describe("getRetentionPolicySnapshot — scope visibility", () => {
  const session = { user: { id: "user_alice" } } as any;
  const prisma = {
    project: {
      findUnique: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    appMocks.getResolvedForProject.mockResolvedValue({
      traces: 49,
      scenarios: 49,
      experiments: 49,
    });

    prisma.project.findUnique.mockResolvedValue({
      teamId: "team_a",
      team: {
        organizationId: "org_1",
        organization: { id: "org_1", name: "ACME" },
      },
    });

    prisma.team.findMany.mockResolvedValue([
      { id: "team_a", name: "Team A" },
      { id: "team_b", name: "Team B" },
    ]);

    // Org has 3 projects; user only has project:update on project_a.
    prisma.project = {
      ...prisma.project,
      findMany: vi.fn().mockResolvedValue([
        { id: "project_a", name: "Project A", teamId: "team_a" },
        { id: "project_b", name: "Project B", teamId: "team_b" },
        { id: "project_c", name: "Project C", teamId: "team_b" },
      ]),
    };

    appMocks.listOrganizationRules.mockResolvedValue([
      // Rules the user CAN see:
      {
        scopeType: "ORGANIZATION",
        scopeId: "org_1",
        category: "traces",
        retentionDays: 91,
      },
      {
        scopeType: "PROJECT",
        scopeId: "project_a",
        category: "traces",
        retentionDays: 7,
      },
      // Rules the user MUST NOT see:
      {
        scopeType: "PROJECT",
        scopeId: "project_b",
        category: "traces",
        retentionDays: 14,
      },
      {
        scopeType: "PROJECT",
        scopeId: "project_c",
        category: "traces",
        retentionDays: 63,
      },
      {
        scopeType: "TEAM",
        scopeId: "team_b",
        category: "traces",
        retentionDays: 49,
      },
    ]);

    // Caller is a project-only user, no org/team management.
    rbacMocks.hasOrganizationPermission.mockResolvedValue(false);
    rbacMocks.hasProjectPermission.mockResolvedValue(true);
    rbacMocks.batchScopePermissions.mockImplementation(
      async (_ctx: any, args: any) => {
        const teams = new Map<string, boolean>();
        const projects = new Map<string, boolean>();
        for (const id of args.teamIds) teams.set(id, false);
        for (const id of args.projectIds) {
          projects.set(id, id === "project_a");
        }
        return { teams, projects };
      },
    );
  });

  describe("when caller has project:update on one project only", () => {
    it("omits team, other-project, AND org rules from the snapshot", async () => {
      const snapshot = await getRetentionPolicySnapshot(
        { prisma, session },
        { projectId: "project_a" },
      );

      const scopeKeys = snapshot.rules.map(
        (r) => `${r.scopeType}:${r.scopeId}`,
      );

      // Caller-readable: only their own project rule.
      expect(scopeKeys).toContain("PROJECT:project_a");

      // Leaked previously — must be absent now. ORG rule is gated on
      // organization:manage (which this caller lacks) so the org-default
      // retention number doesn't leak to project-only viewers.
      expect(scopeKeys).not.toContain("ORGANIZATION:org_1");
      expect(scopeKeys).not.toContain("PROJECT:project_b");
      expect(scopeKeys).not.toContain("PROJECT:project_c");
      expect(scopeKeys).not.toContain("TEAM:team_b");
    });

    it("exposes the org rule once caller also holds organization:manage", async () => {
      rbacMocks.hasOrganizationPermission.mockResolvedValue(true);

      const snapshot = await getRetentionPolicySnapshot(
        { prisma, session },
        { projectId: "project_a" },
      );

      const scopeKeys = snapshot.rules.map(
        (r) => `${r.scopeType}:${r.scopeId}`,
      );

      expect(scopeKeys).toContain("ORGANIZATION:org_1");
      expect(scopeKeys).toContain("PROJECT:project_a");
      // Project/team gates still apply
      expect(scopeKeys).not.toContain("PROJECT:project_b");
      expect(scopeKeys).not.toContain("TEAM:team_b");
    });

    it("only exposes the writable scopes in `available`", async () => {
      const snapshot = await getRetentionPolicySnapshot(
        { prisma, session },
        { projectId: "project_a" },
      );

      expect(snapshot.available.organization).toBeNull();
      expect(snapshot.available.teams).toEqual([]);
      expect(snapshot.available.projects.map((p) => p.id)).toEqual([
        "project_a",
      ]);
    });
  });
});
