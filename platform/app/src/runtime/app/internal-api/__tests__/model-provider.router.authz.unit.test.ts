import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { AppAuditLogRuntime } from "~/runtime/app/features/audit-log";
import { createInnerTRPCContext } from "~/server/api/trpc";
import type { App } from "~/server/app-layer/app";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { modelProviderRouter } from "../model-provider.router";

// ---------------------------------------------------------------------------
// This suite runs the REAL rbac middleware (no rbac mock): tenancy denial
// must come from `checkProjectPermission("project:view")` itself, not from
// a mocked stand-in. Only the prisma query boundary is simulated, with an
// in-memory fixture filtered the same way the real where-clauses select.
// ---------------------------------------------------------------------------

/**
 * The composed service, stubbed at the one method this route calls. The
 * masking of stored credentials is the service's own job and is covered by
 * the sibling masking suite; what this suite proves is who reaches the
 * service at all.
 */
const { mockGetForProject } = vi.hoisted(() => ({ mockGetForProject: vi.fn() }));

// Keep the module-level prisma the mount pulls in transitively from
// instantiating a real client; this route resolves through ctx.prisma.
vi.mock("~/server/db", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

// ---------------------------------------------------------------------------
// Tenancy fixture: org_a owns project_a (team_a) and project_b (team_b);
// org_b is a completely separate organization.
// ---------------------------------------------------------------------------

const projects: Record<string, { teamId: string; organizationId: string }> = {
  project_a: { teamId: "team_a", organizationId: "org_a" },
  project_b: { teamId: "team_b", organizationId: "org_a" },
};

const organizationUsers = [
  {
    userId: "user_member_of_project_a",
    organizationId: "org_a",
    role: "MEMBER",
    disabledAt: null,
  },
  {
    userId: "user_other_project_admin",
    organizationId: "org_a",
    role: "MEMBER",
    disabledAt: null,
  },
  { userId: "user_other_org_admin", organizationId: "org_b", role: "ADMIN" },
];

const roleBindings = [
  {
    userId: "user_member_of_project_a",
    organizationId: "org_a",
    scopeType: "PROJECT",
    scopeId: "project_a",
    role: "ADMIN",
    customRoleId: null,
  },
  // Full admin of a SIBLING project in the same org — must not see project_a.
  {
    userId: "user_other_project_admin",
    organizationId: "org_a",
    scopeType: "PROJECT",
    scopeId: "project_b",
    role: "ADMIN",
    customRoleId: null,
  },
  // Full admin of a DIFFERENT org — must not see anything in org_a.
  {
    userId: "user_other_org_admin",
    organizationId: "org_b",
    scopeType: "ORGANIZATION",
    scopeId: "org_b",
    role: "ADMIN",
    customRoleId: null,
  },
];

function fixturePrisma(): PrismaClient {
  return {
    project: {
      // Serves both the rbac lookup (selects `team`) and, for the
      // authorized control, the service's full-row fetch (`createdAt`).
      findUnique: vi.fn(({ where }: any) => {
        const project = projects[where.id];
        if (!project) return Promise.resolve(null);
        return Promise.resolve({
          id: where.id,
          createdAt: new Date("2024-01-01"),
          team: { id: project.teamId, organizationId: project.organizationId },
        });
      }),
    },
    organizationUser: {
      findFirst: vi.fn(({ where }: any) =>
        Promise.resolve(
          organizationUsers.find(
            (m) => m.userId === where.userId && m.organizationId === where.organizationId,
          ) ?? null,
        ),
      ),
    },
    groupMembership: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
    roleBinding: {
      findMany: vi.fn(({ where }: any) =>
        Promise.resolve(
          roleBindings.filter(
            (b) =>
              typeof where.userId === "string" &&
              b.userId === where.userId &&
              b.organizationId === where.organizationId &&
              // Mirrors the direct-binding predicate: the bound user must
              // currently be a member of the queried organization.
              organizationUsers.some(
                (m) => m.userId === b.userId && m.organizationId === where.organizationId,
              ),
          ),
        ),
      ),
    },
    teamUser: {
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
  } as unknown as PrismaClient;
}

function callerForUser(userId: string) {
  const database = fixturePrisma();
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" },
    req: undefined,
    res: undefined,
    app: {
      agents: {} as never,
      permissions: appPermissionsService(database),
      authzGrants: {} as never,
      governance: {} as never,
      modelProviders: { getForProject: mockGetForProject } as never,
    } as unknown as App,
  });
  ctx.prisma = database;
  return modelProviderRouter.createCaller(ctx);
}

const auditRows: unknown[] = [];

describe("modelProviders.getAllForProject authz", () => {
  // A refused call is audited, and the audit sink is a process singleton the
  // composition root installs. Collect the rows rather than reach a database:
  // without a sink the refusal itself throws and every denial below reads as
  // an internal error instead of the FORBIDDEN it is.
  beforeAll(() => {
    AppAuditLogRuntime.install({
      prisma: { auditLog: { create: async (row: unknown) => auditRows.push(row) } },
    });
  });
  afterAll(() => {
    AppAuditLogRuntime.clear();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    auditRows.length = 0;

    mockGetForProject.mockResolvedValue({
      openai: {
        id: "mp_openai",
        provider: "openai",
        enabled: true,
        // Already masked: this is what the service hands back on a read.
        customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
        customModels: [],
        customEmbeddingsModels: [],
        models: null,
        embeddingsModels: null,
      },
    });
  });

  describe("when the user has no access to the project at all", () => {
    /** @scenario A user without project view permission cannot list a project's providers */
    it("rejects with FORBIDDEN", async () => {
      const caller = callerForUser("user_with_nothing");

      await expect(caller.getAllForProject({ projectId: "project_a" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("throws TRPCError (not a generic error) for denied access", async () => {
      const caller = callerForUser("user_with_nothing");

      await expect(caller.getAllForProject({ projectId: "project_a" })).rejects.toBeInstanceOf(
        TRPCError,
      );
    });
  });

  describe("when the user only has access to a sibling project in the same organization", () => {
    /** @scenario Access to a sibling project does not grant access to this project's providers */
    it("rejects with FORBIDDEN", async () => {
      const caller = callerForUser("user_other_project_admin");

      await expect(caller.getAllForProject({ projectId: "project_a" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("when the user is an admin of a different organization", () => {
    /** @scenario Admin rights in another organization grant nothing across the tenancy boundary */
    it("rejects with FORBIDDEN", async () => {
      const caller = callerForUser("user_other_org_admin");

      await expect(caller.getAllForProject({ projectId: "project_a" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("when the user has a binding on the project itself", () => {
    it("returns providers, proving the denials above are not vacuous", async () => {
      const caller = callerForUser("user_member_of_project_a");

      const result = await caller.getAllForProject({ projectId: "project_a" });

      expect(result.openai).toBeDefined();
      expect(mockGetForProject).toHaveBeenCalledWith({ projectId: "project_a" });
    });
  });
});
