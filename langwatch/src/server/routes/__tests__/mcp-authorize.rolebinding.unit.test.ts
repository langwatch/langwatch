/**
 * @vitest-environment node
 *
 * Regression guard for the MCP OAuth authorize endpoint
 * (POST /api/mcp/authorize). A user added to a team after migration
 * 20260407120000_migrate_team_users_to_role_bindings exists only as a
 * TEAM-scoped RoleBinding (no legacy TeamUser row). The endpoint gated
 * project access with `team: { members: { some: { user: { id } } } }` — the
 * TeamUser relation — and returned 403 "Project not found or you don't have
 * access" on Allow. The fix resolves access via RoleBindings
 * (hasProjectPermission), so RoleBinding-only members can authorize.
 */
import { describe, expect, it, vi } from "vitest";

import type * as ServerRedis from "~/server/redis";
import { app } from "../misc";

const PROJECT_ID = "project_1";
const TEAM_ID = "team_1";
const ORG_ID = "org_1";
const ERROR = "Project not found or you don't have access";

// Hoisted so the mock objects exist before the mocked modules are evaluated
// (the top-level `import { app } from "../misc"` triggers those factories).
// Prisma enums are string-valued at runtime, so string literals stand in for
// TeamUserRole.ADMIN / RoleBindingScopeType.TEAM here.
const { mockPrisma, mockRedis, SESSION } = vi.hoisted(() => {
  return {
    SESSION: { user: { id: "member_rolebinding_only" }, expires: "1" },
    mockRedis: { set: vi.fn().mockResolvedValue("OK") },
    mockPrisma: {
      // checkPermissionFromBindings: user belongs to no groups …
      groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      // … but has a TEAM-scoped ADMIN RoleBinding (project:view is granted).
      roleBinding: {
        findMany: vi.fn().mockResolvedValue([
          { role: "ADMIN", customRoleId: null, scopeType: "TEAM" },
        ]),
      },
      customRole: { findUnique: vi.fn().mockResolvedValue(null) },
      // Legacy fallback must find nothing — the whole point is the user has no
      // TeamUser row.
      teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
      project: {
        // Two callers hit project.findUnique: resolveProjectPermission selects
        // the team→org graph; ProjectService.getById fetches the project row.
        findUnique: vi.fn(({ select }: { select?: { team?: unknown } }) =>
          select?.team
            ? Promise.resolve({
                team: {
                  id: "team_1",
                  organizationId: "org_1",
                  organization: { members: [] }, // no OrganizationUser row either
                },
              })
            : Promise.resolve({
                id: "project_1",
                apiKey: "lw_test_key",
                archivedAt: null as Date | null,
              }),
        ),
      },
    },
  };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(SESSION),
}));
vi.mock("~/server/db", () => ({ prisma: mockPrisma }));
// Partial mock: importing ../misc drags in the worker/collector graph, which
// also reads `isBuildOrNoRedis` from this module — keep the real exports and
// override only the connection the handler writes the auth code to.
vi.mock("~/server/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerRedis>();
  return { ...actual, connection: mockRedis };
});
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) =>
    text.startsWith("encrypted:") ? text.slice(10) : text,
}));

const validBody = {
  projectId: PROJECT_ID,
  redirect_uri: "https://example.com/callback",
  code_challenge: "challenge123",
  code_challenge_method: "S256",
  client_id: "client_1",
  state: "xyz",
};

async function authorize() {
  return app.request("http://localhost/api/mcp/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validBody),
  });
}

describe("POST /mcp/authorize", () => {
  describe("when the user has project access via a TEAM-scoped RoleBinding but no legacy TeamUser row", () => {
    it("authorizes the connection instead of returning 403", async () => {
      const res = await authorize();
      const json = (await res.json()) as { redirect?: string; error?: string };

      expect(res.status).toBe(200);
      expect(json.error).toBeUndefined();
      expect(json.redirect).toContain("code=");
    });
  });

  describe("when the user has no binding granting access to the project", () => {
    it("returns 403 (proves the RoleBinding permission gate actually runs)", async () => {
      // No bindings at all → checkPermissionFromBindings falls back to TeamUser,
      // which is also absent → access denied.
      mockPrisma.roleBinding.findMany.mockResolvedValueOnce([]);

      const res = await authorize();
      const json = (await res.json()) as { error?: string };

      expect(res.status).toBe(403);
      expect(json.error).toBe(ERROR);
    });
  });

  describe("when the project is archived", () => {
    it("returns 403 (archived projects are not authorizable)", async () => {
      // getById fetches the project row first; a non-null archivedAt short-
      // circuits to the unified 403 before the permission check.
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        id: PROJECT_ID,
        apiKey: "lw_test_key",
        archivedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const res = await authorize();
      const json = (await res.json()) as { error?: string };

      expect(res.status).toBe(403);
      expect(json.error).toBe(ERROR);
    });
  });

  describe("when the target is the demo project", () => {
    it("returns 403 even though isDemoProject grants project:view to everyone", async () => {
      // Guards the apiKey-leak regression: the demo project must never be
      // MCP-authorizable, regardless of the caller's bindings.
      const previous = process.env.DEMO_PROJECT_ID;
      process.env.DEMO_PROJECT_ID = PROJECT_ID;
      try {
        const res = await authorize();
        const json = (await res.json()) as { error?: string };

        expect(res.status).toBe(403);
        expect(json.error).toBe(ERROR);
      } finally {
        if (previous === undefined) delete process.env.DEMO_PROJECT_ID;
        else process.env.DEMO_PROJECT_ID = previous;
      }
    });
  });
});
