/**
 * @vitest-environment node
 *
 * Project scoping through `createUnifiedAuthMiddleware`.
 *
 * Issue #8085: an API key that verifies but binds to no single project must
 * be refused with a self-describing `project_scope_required` error rather
 * than the generic `invalid_credentials` it gets today (the resolver just
 * returns null when it cannot pick one project). The three cases that
 * already work — an org key with `X-Project-Id`, an org key with Basic auth
 * naming the project, and a key bound to exactly one project self-scoping —
 * must keep working unchanged, as must a legacy `pkey_`-style project key
 * ignoring any `X-Project-Id` header sent alongside it.
 *
 * Boundary faked, not the module under test: `ApiKeyService` is the actual
 * DB-backed lookup `TokenResolver` delegates to, so it is mocked (same
 * pattern as `auth-middleware.org-refusals.unit.test.ts`, one level up) and
 * the real `TokenResolver` + `createUnifiedAuthMiddleware` run unmocked.
 * `~/server/db` is a bare object because `prisma.project.findUnique` is the
 * only call this path makes; it is faked per test.
 *
 * AC5 ("every project-scoped REST app emits the same code") is proved by
 * mounting the middleware on a SECOND, independent app below — the query
 * door is not the only consumer of `createUnifiedAuthMiddleware`, and this
 * is what stands in for another one (e.g. the Langy health-check door in
 * `~/server/routes/misc.ts`, which installs the identical middleware).
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ../auth-middleware.ts
 * @see ../token-resolver.ts
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType } from "~/generated/prisma/client";

vi.mock("~/server/db", () => ({ prisma: {} }));

const verify = vi.fn();
const markUsed = vi.fn();

vi.mock("../api-key.service", () => ({
  ApiKeyService: {
    create: () => ({ verify, markUsed }),
  },
}));

import { createUnifiedAuthMiddleware } from "../auth-middleware";

type TestEnv = {
  Variables: {
    project: { id: string };
  };
};

const ORG_ID = "org_1";

/**
 * A syntactically valid new-format API key token (`sk-lw-{16 alnum}_{48
 * alnum}`) — `getTokenType` classifies anything else as a legacy project
 * key, since the new-format body is alphanumeric-only.
 */
function apiKeyToken(seed: string): string {
  const alnum = seed.replace(/[^0-9A-Za-z]/g, "");
  const lookup = alnum.padEnd(16, "0").slice(0, 16);
  const secret = alnum.padEnd(48, "1").slice(0, 48);
  return `sk-lw-${lookup}_${secret}`;
}

const ORG_ONLY_TOKEN = apiKeyToken("org-only-key");
const SINGLE_PROJECT_TOKEN = apiKeyToken("single-proj-key");
const LEGACY_PROJECT_KEY = "sk-lw-legacy-project-key-body";

function orgOnlyApiKey() {
  return {
    id: "key_org_only",
    userId: "user_1",
    organizationId: ORG_ID,
    ingestSourceType: null,
    ingestionTemplateId: null,
    name: "org key",
    roleBindings: [
      { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: null },
    ],
  };
}

function singleProjectApiKey(projectId: string) {
  return {
    id: "key_single_project",
    userId: "user_2",
    organizationId: ORG_ID,
    ingestSourceType: "otel",
    ingestionTemplateId: null,
    name: "single project key",
    roleBindings: [
      { scopeType: RoleBindingScopeType.PROJECT, scopeId: projectId },
    ],
  };
}

function projectFixture({
  id,
  organizationId = ORG_ID,
}: {
  id: string;
  organizationId?: string;
}) {
  return {
    id,
    archivedAt: null,
    team: { id: "team_1", organizationId },
  };
}

/** A prisma stub whose `project.findUnique` answers from a fixed lookup table. */
function buildPrisma(
  projects: Record<string, ReturnType<typeof projectFixture>>,
): PrismaClient {
  return {
    project: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(projects[where.id] ?? null),
      ),
    },
  } as unknown as PrismaClient;
}

/**
 * Mounts the middleware on a bare probe app, the same shape
 * `auth-middleware.org-refusals.unit.test.ts` uses for the org-level
 * middleware — so a refusal and a success both travel their real path.
 */
function buildApp(prisma: PrismaClient) {
  const app = new Hono<TestEnv>();
  app.use(createUnifiedAuthMiddleware({ prisma, errorEnvelope: "canonical" }));
  app.get("/probe", (c) => c.json({ projectId: c.get("project").id }));
  return app;
}

function basicAuthHeader(projectId: string, token: string): string {
  return `Basic ${Buffer.from(`${projectId}:${token}`).toString("base64")}`;
}

beforeEach(() => {
  verify.mockReset();
  markUsed.mockReset();
});

describe("createUnifiedAuthMiddleware", () => {
  describe("given an API key that verifies but binds to no single project", () => {
    beforeEach(() => {
      verify.mockResolvedValue(orgOnlyApiKey());
    });

    /** @scenario "An organization-scoped key with no project hint is refused with a self-describing error" */
    /** @scenario "Every project-scoped REST app emits project_scope_required for the same condition" */
    it("refuses with 401 project_scope_required when no X-Project-Id or Basic auth is sent", async () => {
      const app = buildApp(buildPrisma({}));

      const res = await app.request("/probe", {
        headers: { Authorization: `Bearer ${ORG_ONLY_TOKEN}` },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("project_scope_required");
    });

    it("tells the caller to send X-Project-Id or Basic auth with the project id", async () => {
      const app = buildApp(buildPrisma({}));

      const res = await app.request("/probe", {
        headers: { Authorization: `Bearer ${ORG_ONLY_TOKEN}` },
      });

      const body = await res.json();
      expect(body.error.message).toMatch(/X-Project-Id/);
      expect(body.error.message).toMatch(/basic auth/i);
    });

    it("carries meta.required and meta.accepted naming both scoping mechanisms", async () => {
      const app = buildApp(buildPrisma({}));

      const res = await app.request("/probe", {
        headers: { Authorization: `Bearer ${ORG_ONLY_TOKEN}` },
      });

      const body = await res.json();
      expect(body.error.meta?.required).toBe("project_scope");
      expect(body.error.meta?.accepted).toEqual(
        expect.arrayContaining(["X-Project-Id", "basic_auth_project_id"]),
      );
    });
  });

  describe("given an organization-scoped API key with a project hint", () => {
    beforeEach(() => {
      verify.mockResolvedValue(orgOnlyApiKey());
    });

    /** @scenario "An organization key with X-Project-Id answers for that project unchanged" */
    it("answers 200 scoped to the project named by X-Project-Id", async () => {
      const projectId = "proj_from_header";
      const app = buildApp(
        buildPrisma({ [projectId]: projectFixture({ id: projectId }) }),
      );

      const res = await app.request("/probe", {
        headers: {
          Authorization: `Bearer ${ORG_ONLY_TOKEN}`,
          "X-Project-Id": projectId,
        },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).projectId).toBe(projectId);
    });

    /** @scenario "An organization key with Basic auth project id answers for that project unchanged" */
    it("answers 200 scoped to the project named by Basic auth", async () => {
      const projectId = "proj_from_basic";
      const app = buildApp(
        buildPrisma({ [projectId]: projectFixture({ id: projectId }) }),
      );

      const res = await app.request("/probe", {
        headers: {
          Authorization: basicAuthHeader(projectId, ORG_ONLY_TOKEN),
        },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).projectId).toBe(projectId);
    });
  });

  describe("given an API key bound to exactly one project", () => {
    /** @scenario "A key bound to exactly one project self-scopes with no header" */
    it("answers 200 scoped to that one project with no X-Project-Id or Basic auth", async () => {
      const projectId = "proj_only_one";
      verify.mockResolvedValue(singleProjectApiKey(projectId));
      const app = buildApp(
        buildPrisma({ [projectId]: projectFixture({ id: projectId }) }),
      );

      const res = await app.request("/probe", {
        headers: { Authorization: `Bearer ${SINGLE_PROJECT_TOKEN}` },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).projectId).toBe(projectId);
    });
  });

  describe("given a legacy project key", () => {
    /** @scenario "A legacy project key ignores an X-Project-Id header naming another project" */
    it("answers 200 scoped to its own project, ignoring a header naming another one", async () => {
      const ownProjectId = "proj_legacy_own";
      const otherProjectId = "proj_someone_else";
      // A legacy key resolves by an exact match on `Project.apiKey`, not
      // through `ApiKeyService.verify` at all — `verify` staying unset here
      // is itself part of the proof that this path never reaches it.
      const prisma = {
        project: {
          findUnique: vi.fn(({ where }: { where: { apiKey?: string } }) =>
            Promise.resolve(
              where.apiKey === LEGACY_PROJECT_KEY
                ? projectFixture({ id: ownProjectId })
                : null,
            ),
          ),
        },
      } as unknown as PrismaClient;
      const app = buildApp(prisma);

      const res = await app.request("/probe", {
        headers: {
          Authorization: `Bearer ${LEGACY_PROJECT_KEY}`,
          "X-Project-Id": otherProjectId,
        },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).projectId).toBe(ownProjectId);
      expect(verify).not.toHaveBeenCalled();
    });
  });
});
