/**
 * The named-project branch of `POST /api/auth/cli/governance/ingestion-key`.
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type {
  GovernanceCliCaller,
  GovernanceCliRestPorts,
} from "@langwatch/enterprise-governance-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const BEARER = "Bearer lw_at_valid";

const PROJECT_ID = "project-checkout-api";
const PROJECT_SLUG = "checkout-api";
const OTHER_ORG_PROJECT_ID = "project-other-co-api";

describe("given a caller who can write traces into the project", () => {
  describe("when the project is named by id", () => {
    /** @scenario "The CLI mints an ingestion key for a project named by id" */
    it("mints a key bound to that project and answers it once", async () => {
      const world = ingestionKeyWorld();
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "claude_code", project: PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        token: "ik-lw-minted-token",
        prefix: "ik-lw-minted",
        endpoint: "https://app.test/api/otel",
        project: { id: PROJECT_ID, slug: PROJECT_SLUG, name: "Checkout API" },
      });
      expect(world.mints).toEqual([{ projectId: PROJECT_ID, sourceType: "claude_code" }]);
    });
  });

  describe("when the project is named by slug", () => {
    /** @scenario "The CLI mints an ingestion key for a project named by slug" */
    it("resolves the slug inside the caller's organization", async () => {
      const world = ingestionKeyWorld();
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "claude_code", project: PROJECT_SLUG },
        BEARER,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        project: { id: PROJECT_ID, slug: PROJECT_SLUG },
      });
    });
  });
});

describe("given a caller without trace-write access to the project", () => {
  describe("when they name that project", () => {
    /** @scenario "Minting into a project the caller cannot write to is refused" */
    it("returns forbidden and mints nothing", async () => {
      const world = ingestionKeyWorld({ permittedOnProject: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "claude_code", project: PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
      expect(world.mints).toEqual([]);
    });
  });
});

describe("given a project that belongs to another organization", () => {
  describe("when the caller names it by id", () => {
    /** @scenario "A project in another organization is not found" */
    it("answers project_not_found without confirming it exists anywhere", async () => {
      const world = ingestionKeyWorld();
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "claude_code", project: OTHER_ORG_PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string; error_description: string };
      expect(body.error).toBe("project_not_found");
      // The lookup was org-scoped, so the route never learned the project is
      // real elsewhere and cannot leak that it is.
      expect(world.lookups.every((lookup) => lookup === ORGANIZATION_ID)).toBe(true);
      expect(world.mints).toEqual([]);
    });
  });
});

describe("given the organization turned direct OTLP off for a wrapped tool", () => {
  describe("when a CLI asks for a key declaring that same tool's source type", () => {
    /** @scenario "A tool whose organization forbids direct OTLP mints no ingestion key" */
    it("refuses the mint and leaves the project without a new key", async () => {
      const world = ingestionKeyWorld({ allowOtelDirect: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "claude_code", project: PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "direct_otel_not_allowed" });
      expect(world.mints).toEqual([]);
      expect(world.policySlugsProbed).toEqual(["claude"]);
    });
  });

  describe("when the caller declares a different tool the policy check reads by name", () => {
    /** @scenario "The mint policy reads the tool the request declares" */
    it("mints under the declared tool's own policy, not the disabled one", async () => {
      const world = ingestionKeyWorld({ allowOtelDirect: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "codex", project: PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(201);
      expect(world.mints).toEqual([{ projectId: PROJECT_ID, sourceType: "codex" }]);
      expect(world.policySlugsProbed).toEqual(["codex"]);
    });
  });

  describe("when the caller declares a source type no wrapped tool stamps", () => {
    /** @scenario "A source type outside the wrapped-tool set mints ungoverned" */
    it("mints, because templates and standalone apps share this route", async () => {
      const world = ingestionKeyWorld({ allowOtelDirect: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        { source_type: "copilot_app", project: PROJECT_ID },
        BEARER,
      );

      expect(response.status).toBe(201);
      expect(world.mints).toEqual([{ projectId: PROJECT_ID, sourceType: "copilot_app" }]);
      // Not a policed source type, so the policy is never consulted at all.
      expect(world.policySlugsProbed).toEqual([]);
    });
  });
});

// --------------------------------------------------------------------------

function ingestionKeyWorld(
  options: { permittedOnProject?: boolean; allowOtelDirect?: boolean } = {},
) {
  const world = {
    lookups: [] as string[],
    mints: [] as Array<{ projectId: string; sourceType: string }>,
    policySlugsProbed: [] as string[],
    ports: undefined as unknown as GovernanceCliRestPorts,
  };

  const caller: GovernanceCliCaller = {
    user_id: USER_ID,
    organization_id: ORGANIZATION_ID,
  };

  // Only the caller's own organization holds a project. The other tenant's
  // project is deliberately absent from what an org-scoped lookup can see.
  const database = {
    user: {
      findUnique: () => Promise.resolve({ deactivatedAt: null, name: "Jane", email: "j@e.test" }),
    },
    organizationUser: { findFirst: () => Promise.resolve({ userId: USER_ID }) },
    organization: { findUnique: () => Promise.resolve({ supportContact: null }) },
    project: {
      findFirst: (query: {
        where: { id?: string; slug?: string; team?: { organizationId?: string } };
      }) => {
        world.lookups.push(query.where.team?.organizationId ?? "");
        const matches =
          query.where.team?.organizationId === ORGANIZATION_ID &&
          (query.where.id === PROJECT_ID || query.where.slug === PROJECT_SLUG);
        return Promise.resolve(
          matches
            ? {
                id: PROJECT_ID,
                slug: PROJECT_SLUG,
                name: "Checkout API",
                isPersonal: false,
                ownerUserId: null,
              }
            : null,
        );
      },
    },
  };

  world.ports = {
    accessTokens: {
      resolve: (authHeader) => Promise.resolve(authHeader === BEARER ? caller : null),
      revoke: () => Promise.resolve(),
    },
    governance: () =>
      ({
        aiToolResolvePolicy: (input: { slug: string }) => {
          world.policySlugsProbed.push(input.slug);
          // Only the organization's "claude" tile is turned off; every other
          // tool's policy is untouched, exactly like the real per-tile config.
          const allowOtelDirect =
            input.slug === "claude" ? (options.allowOtelDirect ?? true) : true;
          return Promise.resolve({ allowVk: true, allowOtelDirect });
        },
        ingestionKeyIssueForProject: (input: { projectId: string; sourceType: string }) => {
          world.mints.push({ projectId: input.projectId, sourceType: input.sourceType });
          return Promise.resolve({ token: "ik-lw-minted-token", prefix: "ik-lw-minted" });
        },
      }) as never,
    database: () => database as never,
    ensurePersonalWorkspace: () => {
      throw new Error("unreachable: every scenario here names a project.");
    },
    tryFindPersonalWorkspace: () => Promise.resolve(null),
    plans: () => ({ getActivePlan: () => Promise.resolve({ type: "ENTERPRISE" }) }) as never,
    permittedOnOrganization: () => Promise.resolve(true),
    permittedOnProject: () => Promise.resolve(options.permittedOnProject !== false),
    publicBaseUrl: "https://app.test",
  };

  return world;
}

function mount(world: ReturnType<typeof ingestionKeyWorld>) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the governance CLI family resolves its own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      governanceCli: world.ports,
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = (path: string, init?: RequestInit) =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    post: (path: string, body: unknown, authorization?: string) =>
      fetchAt(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
