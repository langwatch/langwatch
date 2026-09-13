/**
 * @vitest-environment node
 *
 * Project scoping through the health-probe family's shared `authenticateProject`
 * helper (issue #8085, AC5).
 *
 * The probes used to authenticate with a bespoke
 * `prisma.project.findUnique({ where: { apiKey } })`, so an organization key
 * that verifies but binds to no single project fell through to the generic
 * "Invalid auth token." — the same failure the query door had. Now the helper
 * routes through `TokenResolver.resolveProject`, so such a key is refused with
 * the self-describing `project_scope_required` body the query door and the
 * shared project-auth middleware answer with, while legacy project keys keep
 * working unchanged and an unknown key keeps the existing vague refusal.
 *
 * `/api/health/triggers` stands in for the family: it needs only the project
 * after auth, so a legacy key that authenticates reaches the route's own 404
 * (auth passed) rather than any auth refusal. Boundaries faked, not the code
 * under test: `ApiKeyService` (the DB-backed lookup `TokenResolver` delegates
 * to) and `~/server/db` are mocked; the real `TokenResolver` and the real route
 * run.
 *
 * NOTE: `GET /api/health/langy` itself authenticates through
 * `authorizeLangyApiKey` (still on the deprecated `resolve()`), not through this
 * helper, so it is not covered here — tracked in
 * https://github.com/langwatch/langwatch/issues/8114.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ../health-checks.ts
 * @see ~/server/api-key/auth-middleware.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType } from "~/generated/prisma/client";

const { verify, markUsed, projectFindUnique, triggerFindUnique } = vi.hoisted(
  () => ({
    verify: vi.fn(),
    markUsed: vi.fn(),
    projectFindUnique: vi.fn(),
    triggerFindUnique: vi.fn(),
  }),
);

vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: { create: () => ({ verify, markUsed }) },
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: projectFindUnique },
    trigger: { findUnique: triggerFindUnique },
  },
}));

/**
 * A syntactically valid new-format API key token (`sk-lw-{16 alnum}_{48
 * alnum}`) — `getTokenType` classifies anything else as a legacy project key.
 */
function apiKeyToken(seed: string): string {
  const alnum = seed.replace(/[^0-9A-Za-z]/g, "");
  const lookup = alnum.padEnd(16, "0").slice(0, 16);
  const secret = alnum.padEnd(48, "1").slice(0, 48);
  return `sk-lw-${lookup}_${secret}`;
}

const ORG_ONLY_TOKEN = apiKeyToken("org-only-health-key");
const LEGACY_PROJECT_KEY = "health-legacy-project-key";
const PROJECT = {
  id: "proj_1",
  apiKey: LEGACY_PROJECT_KEY,
  archivedAt: null,
  team: { id: "team_1", organizationId: "org_1" },
};

async function getApp() {
  const mod = await import("../health-checks");
  return mod.app;
}

describe("GET /api/health/triggers project scoping", () => {
  beforeEach(() => {
    verify.mockReset();
    markUsed.mockReset();
    projectFindUnique.mockReset();
    triggerFindUnique.mockReset();
    projectFindUnique.mockImplementation(
      async ({ where }: { where: { apiKey?: string } }) =>
        where.apiKey === LEGACY_PROJECT_KEY ? PROJECT : null,
    );
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given a legacy project key", () => {
    /** @scenario "Every project-scoped REST app emits project_scope_required for the same condition" */
    it("authenticates unchanged and reaches the route's own logic", async () => {
      triggerFindUnique.mockResolvedValue(null);
      const app = await getApp();

      const res = await app.request("/api/health/triggers?triggerId=t-1", {
        headers: { "x-auth-token": LEGACY_PROJECT_KEY },
      });

      // Auth passed: the route ran and answered its own 404, not an auth refusal.
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe("Trigger not found.");
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("given an organization key that binds to no single project", () => {
    /** @scenario "Every project-scoped REST app emits project_scope_required for the same condition" */
    it("refuses with 401 project_scope_required, matching the query door's body", async () => {
      verify.mockResolvedValue({
        id: "key_org_only",
        userId: "user_1",
        organizationId: "org_1",
        ingestSourceType: null,
        ingestionTemplateId: null,
        name: "org key",
        roleBindings: [
          { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: null },
        ],
      });
      const app = await getApp();

      const res = await app.request("/api/health/triggers?triggerId=t-1", {
        headers: { "x-auth-token": ORG_ONLY_TOKEN },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("project_scope_required");
      expect(body.message).toMatch(/X-Project-Id/);
      expect(body.meta?.required).toBe("project_scope");
      expect(body.meta?.accepted).toEqual(
        expect.arrayContaining(["X-Project-Id", "basic_auth_project_id"]),
      );
      expect(triggerFindUnique).not.toHaveBeenCalled();
    });
  });

  describe("given an unknown key", () => {
    it("keeps the route's existing vague refusal", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/triggers?triggerId=t-1", {
        headers: { "x-auth-token": "no-such-key" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBeUndefined();
      expect(body.message).toBe("Invalid auth token.");
    });
  });
});
