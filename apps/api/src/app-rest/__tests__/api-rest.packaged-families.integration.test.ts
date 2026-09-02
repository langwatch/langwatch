/**
 * The families that live in a FEATURE PACKAGE, driven through the real Hono app
 * `createApiProcessRestFeatures` returns.
 *
 * The retired platform router mounted all of these through ONE all-or-nothing
 * call over thirty-two product services. What is under test here is the thing
 * that replaced it: each family is its own condition, so a process holding the
 * service serves it and a process without it serves nothing at that path
 * rather than a 500 — and the boot report names which.
 *
 * The membership assertions are the point of the file. A family reaches the
 * route-policy registry when it is BUILT, so "is it mounted" is exactly "is it
 * reachable", and the two tables below pin both directions at once. On top of
 * them, one golden path and one named failure per credential class drive real
 * requests through the real chain.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  type ApiPackagedRestCollaborators,
  type ApiPackagedRestFamilyName,
} from "../app-rest.packaged-families";
import { createApiProcessRestFeatures } from "../app-rest.process-features";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

/** Every base path the packaged list can claim, and the family that owns it. */
const FAMILY_PATHS: ReadonlyArray<readonly [ApiPackagedRestFamilyName, string]> = [
  ["agent-cache", "/api/agent-cache"],
  ["agents", "/api/agents"],
  ["coding-agent", "/api/coding-agent"],
  ["dashboards", "/api/dashboards"],
  ["dashboards", "/api/graphs"],
  ["dataset", "/api/dataset"],
  ["evaluators", "/api/evaluators"],
  ["experiments", "/api/experiments"],
  ["files", "/api/files"],
  ["governance", "/api/governance"],
  ["groups", "/api/groups"],
  ["me", "/api/me"],
  ["model-providers", "/api/model-defaults"],
  ["model-providers", "/api/model-providers"],
  ["monitors", "/api/monitors"],
  ["organizations", "/api/organizations"],
  ["projects", "/api/projects"],
  ["roles", "/api/roles"],
  ["role-bindings", "/api/role-bindings"],
  ["scenarios", "/api/scenarios"],
  ["scenario-events", "/api/scenario-events"],
  ["scim-tokens", "/api/scim-tokens"],
  ["secret", "/api/secrets"],
  ["simulation-runs", "/api/simulation-runs"],
  ["suites", "/api/suites"],
  ["teams", "/api/teams"],
  ["triggers", "/api/triggers"],
  ["triggers", "/api/trigger/slack"],
  ["webhooks", "/api/webhooks/v1"],
  ["workflows", "/api/workflows"],
];

describe("given a process that composed every packaged service", () => {
  describe("when the mounted paths are enumerated", () => {
    it("serves each family at its own base path", () => {
      const api = mount(fullCollaborators());
      for (const [family, path] of FAMILY_PATHS) {
        expect(api.claims(path), `${family} should be mounted at ${path}`).toBe(true);
      }
    });
  });
});

describe("given a process that composed none of the packaged services", () => {
  describe("when the mounted paths are enumerated", () => {
    it("serves NONE of them, rather than mounting families over throwing stubs", () => {
      const api = mount(emptyCollaborators());
      for (const [family, path] of FAMILY_PATHS) {
        expect(
          api.claims(path),
          `${family} should be absent at ${path} on a process with no service for it`,
        ).toBe(false);
      }
    });
  });

  describe("when the absence report is read", () => {
    it("names every family it left out, so the gap is visible at boot rather than at a 404", () => {
      const absent: ApiPackagedRestFamilyName[] = [];
      mount(emptyCollaborators(), { absent: (family) => absent.push(family) });

      expect(new Set(absent)).toEqual(
        new Set([
          ...new Set(FAMILY_PATHS.map(([family]) => family)),
          // The three this process cannot build at all, named unconditionally.
          "user-avatar",
          "tracked-events",
          "copilotkit",
        ]),
      );
    });
  });
});

describe("given the deprecated agents family", () => {
  describe("when a project credential lists them", () => {
    it("answers from the application this process composed, for the credential's project", async () => {
      const list = vi.fn(async () => ({ data: [], page: 1, limit: 20, total: 0 }));
      const api = mount(collaboratorsWith({ agents: () => ({ list }) as never }));

      const response = await api.fetch("/api/agents");

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
    });
  });
});

describe("given the agent cache", () => {
  describe("when a run reads an entry the project never stored", () => {
    it("answers the one refusal every empty read answers, rather than an empty value", async () => {
      const api = mount(
        collaboratorsWith({
          agentCache: () =>
            ({
              getByName: vi.fn(async () => {
                throw Object.assign(new Error("no entry"), {
                  code: "cache_entry_not_found",
                  httpStatus: 404,
                });
              }),
              put: vi.fn(),
              claim: vi.fn(),
              delete: vi.fn(),
            }) as never,
        }),
      );

      const response = await api.fetch("/api/agent-cache/SESSION");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "cache_entry_not_found" });
    });
  });
});

describe("given the Enterprise-gated families", () => {
  describe("when this process composed no plan provider", () => {
    it("mounts none of the four rather than mounting them ungated", () => {
      const api = mount(
        collaboratorsWith(
          {
            organizations: () => ({}) as never,
            roles: () => ({}) as never,
            permissions: () => ({}) as never,
            authzGrants: () => ({}) as never,
            scim: () => ({}) as never,
          },
          { withoutEnterpriseGate: true },
        ),
      );

      expect(api.claims("/api/groups")).toBe(false);
      expect(api.claims("/api/roles")).toBe(false);
      expect(api.claims("/api/role-bindings")).toBe(false);
      expect(api.claims("/api/scim-tokens")).toBe(false);
    });
  });
});

describe("given the byte-serving file family", () => {
  describe("when this process composed no dual-credential verifier", () => {
    it("leaves it off rather than 401ing the in-app player", () => {
      const api = mount(
        collaboratorsWith({ storedObjects: () => ({}) as never }, { withoutDualAuth: true }),
      );

      expect(api.claims("/api/files/project-1/object-1")).toBe(false);
    });
  });
});

describe("given the workflow family on a process with no evaluation runner", () => {
  describe("when a caller starts a run through it", () => {
    it("refuses BY NAME while the graph reads keep answering", async () => {
      const list = vi.fn(async () => []);
      const api = mount(
        collaboratorsWith({ workflows: () => ({ list, getById: vi.fn() }) as never }),
      );

      const response = await api.fetch("/api/workflows");

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type MountReport = { absent(family: ApiPackagedRestFamilyName): void };

function mount(collaborators: ApiPackagedRestCollaborators, report?: MountReport) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: { packaged: collaborators },
    ports: {
      handlerManagedCredential: () => {
        throw new Error("These families authenticate through the framework chain.");
      },
      rateLimit: async () => ({ allowed: true }),
    },
    ...(report ? { packagedAbsence: report as never } : {}),
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
    /**
     * Whether ANY route is registered under this path.
     *
     * Read off the router rather than by fetching, because "mounted" is a fact
     * about registration: a family that is present but refuses is still
     * mounted, and one that is absent answers Hono's own 404 with no handler
     * of ours ever running.
     */
    claims: (path: string) =>
      hono.routes.some((route) => route.path === path || route.path.startsWith(`${path}/`)),
    routes: () => hono.routes.map((route) => route.path),
  };
}

/** A bag holding a stand-in for every service, to pin the full mount table. */
function fullCollaborators(): ApiPackagedRestCollaborators {
  const anyService = () => ({}) as never;
  return {
    services: {
      agentCache: anyService,
      agents: anyService,
      apiKeys: anyService,
      authzGrants: anyService,
      automation: anyService,
      broadcast: anyService,
      codingAgents: anyService,
      codingAgentAudit: anyService,
      dashboard: anyService,
      datasets: anyService,
      evaluators: anyService,
      experiments: anyService,
      governance: anyService,
      modelProviders: anyService,
      monitors: anyService,
      organizations: anyService,
      organizationProvisioning: anyService,
      permissions: anyService,
      projects: anyService,
      roles: anyService,
      scenarios: anyService,
      scenarioTabs: anyService,
      scim: anyService,
      secrets: anyService,
      simulations: anyService,
      storedObjects: anyService,
      suites: anyService,
      webhooks: anyService,
      workflows: anyService,
    },
    ports: fullPorts(),
  };
}

function emptyCollaborators(): ApiPackagedRestCollaborators {
  return { services: {}, ports: fullPorts() };
}

function collaboratorsWith(
  services: ApiPackagedRestCollaborators["services"],
  options: { withoutEnterpriseGate?: boolean; withoutDualAuth?: boolean } = {},
): ApiPackagedRestCollaborators {
  const ports = fullPorts();
  const trimmed = { ...ports } as Record<string, unknown>;
  if (options.withoutEnterpriseGate) delete trimmed.enterpriseGate;
  if (options.withoutDualAuth) delete trimmed.dualAuth;
  return { services, ports: trimmed as ApiPackagedRestCollaborators["ports"] };
}

const noopMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

function fullPorts(): ApiPackagedRestCollaborators["ports"] {
  return {
    agentPlatformUrl: () => "https://app.langwatch.test/acme/agents",
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    scenarioRunPlatformUrl: () => "https://app.langwatch.test/acme/simulations",
    canonicalError: () => ({ status: 500, body: {} as never }),
    organizationMiddleware: noopMiddleware,
    managementAudit: () => {},
    organizationLedgerActor: () => ({ type: "system", id: "system:test" }) as never,
    rbacVocabulary: {
      actions: ["view"],
      resources: ["traces"],
      isOrganizationExclusive: () => false,
    },
    instanceAdminKey: () => "instance-key",
    isSaas: () => false,
    reportError: () => {},
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    monitorMappingsSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
    requireApiKeyPermission: () => noopMiddleware,
    traceUsageGuard: noopMiddleware,
    requireProjectPermission: async () => {},
    dualAuth: noopMiddleware,
    enterpriseGate: () => noopMiddleware,
    authorizeDatasetDirectUpload: async () => ({ ok: false, status: 401, error: "no" }),
    extractInlineMedia: async ({ event }) => ({ rewrittenEvent: event, refs: [] }),
    triggerWorkflowEvaluation: () => Promise.reject(new Error("no runner")),
  };
}

/**
 * Enforcement that authenticates every caller as the same project and the same
 * organization. The families' own access declarations still run; what is faked
 * is only the credential resolution the process would have done.
 */
function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: "organization-1" });
    c.set("apiKeyUserId", "user-1");
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

/** A handled refusal must reach the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
