/**
 * @see specs/security/api-endpoint-authorization.feature
 */
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  anyAuthenticated,
  apiKeyPermission,
  describeAccessPolicy,
  handlerManagedAuth,
  internalSecret,
  publicEndpoint,
  requires,
  requiresOnProject,
} from "../../../access-policy.js";
import { allRegisteredRoutes, getRoutePolicy } from "../route-registry.js";
import {
  type ApiErrorEnvelope,
  createRestApiService,
  familyFromBasePath,
  type RestApiServicePorts,
} from "../rest-api-service.js";

/** What the stub ports saw, in the order the builder asked for it. */
interface PortCalls {
  chain: string[];
  errorHandler: ApiErrorEnvelope | null;
}

const noopSecret: MiddlewareHandler = async (_c, next) => next();

/**
 * A service whose every port records the call that produced it.
 *
 * The package decides WHICH check a policy gets and in WHICH order; the checks
 * themselves belong to the process. So what is worth asserting here is exactly
 * the selection — that `requires(...)` reaches the RBAC port and
 * `apiKeyPermission(...)` reaches the ceiling, each after authentication and
 * each carrying the family's published envelope.
 */
function recordingSpine() {
  const calls: PortCalls = { chain: [], errorHandler: null };
  const record = (label: string): MiddlewareHandler => {
    return async (_c, next) => {
      calls.chain.push(label);
      await next();
    };
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      calls.errorHandler = "legacy";
      return c.json({ error: error.message }, 500);
    },
    canonicalErrorHandler: (error, c) => {
      calls.errorHandler = "canonical";
      return c.json({ error: { message: error.message } }, 500);
    },
    authenticateProject: (envelope) => record(`authenticateProject:${envelope}`),
    authorizeProjectPermission: ({ permission, envelope }) =>
      record(`authorizeProjectPermission:${permission}:${envelope}`),
    authorizeApiKeyCeiling: ({ permission, envelope }) =>
      record(`authorizeApiKeyCeiling:${permission}:${envelope}`),
    authenticateOrganization: (envelope) => record(`authenticateOrganization:${envelope}`),
    authorizeOrganizationPermission: ({ permission, envelope }) =>
      record(`authorizeOrganizationPermission:${permission}:${envelope}`),
    authorizeRouteProjectPermission: ({ permission, param, envelope }) =>
      record(`authorizeRouteProjectPermission:${permission}:${param}:${envelope}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrganizationPermissionThrowing:${permission}`),
  };

  return { calls, spine: createRestApiService<object, object>(ports) };
}

describe("familyFromBasePath", () => {
  describe("given a mount path", () => {
    it("derives the label the registry and the tracer share", () => {
      expect(familyFromBasePath("/api/agents")).toBe("agents");
      expect(familyFromBasePath("/api/gateway/v1")).toBe("gateway-v1");
      expect(familyFromBasePath("/api/")).toBe("api");
      expect(familyFromBasePath("/api")).toBe("api");
    });
  });
});

describe("SecuredApp", () => {
  describe("when a route is registered through access()", () => {
    it("records the route's policy in the registry under its full merged path", () => {
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_secured",
        verifySecret: noopSecret,
      });

      app.access(internalSecret("unit test route")).get("/ping", (c) => c.text("ok"));

      const recorded = getRoutePolicy("GET", "/api/__pkg_secured/ping");
      expect(recorded).toBeDefined();
      expect(recorded?.policy).toEqual({
        kind: "internal",
        reason: "unit test route",
      });
      // family is derived from basePath, never hand-passed.
      expect(recorded?.family).toBe("__pkg_secured");
    });
  });

  describe("when a route enforces a policy", () => {
    it("runs the strategy chain before the handler for non-public policies", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_chain",
        verifySecret: secret,
      });
      app.access(internalSecret("chain test")).get("/x", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const res = await app.hono.request("/api/__pkg_chain/x");
      expect(res.status).toBe(200);
      expect(calls).toEqual(["secret", "handler"]);
    });

    it("skips the auth chain for public policies", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_public",
        verifySecret: secret,
      });
      app.access(publicEndpoint("open probe")).get("/health", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const res = await app.hono.request("/api/__pkg_public/health");
      expect(res.status).toBe(200);
      expect(calls).toEqual(["handler"]); // secret middleware NOT run
    });

    it("skips the auth chain for handler-managed policies", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_handler_managed" });
      app
        .access(
          handlerManagedAuth({
            reason: "the handler resolves the caller itself",
            permissions: [],
            credential: "apiKey",
          }),
        )
        .get("/x", (c) => c.text("ok"));

      const res = await app.hono.request("/api/__pkg_handler_managed/x");
      expect(res.status).toBe(200);
      expect(calls.chain).toEqual([]);
    });
  });

  describe("when a project route declares a policy", () => {
    it("authenticates, then authorizes through the RBAC port", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_project_rbac" });
      app.access(requires("traces:view")).get("/x", (c) => c.text("ok"));

      await app.hono.request("/api/__pkg_project_rbac/x");
      expect(calls.chain).toEqual([
        "authenticateProject:legacy",
        "authorizeProjectPermission:traces:view:legacy",
      ]);
    });

    /** @scenario "An API-key-ceiling route records its real required permission" */
    it("routes an apiKeyPermission policy through the ceiling, not the RBAC check", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_apikey" });
      app.access(apiKeyPermission("virtualKeys:view")).get("/keys", (c) => c.text("ok"));

      const recorded = getRoutePolicy("GET", "/api/__pkg_apikey/keys");
      expect(recorded?.policy).toEqual({
        kind: "apiKeyPermission",
        permission: "virtualKeys:view",
      });
      expect(describeAccessPolicy(recorded!.policy)).toContain("virtualKeys:view");

      await app.hono.request("/api/__pkg_apikey/keys");
      expect(calls.chain).toEqual([
        "authenticateProject:legacy",
        "authorizeApiKeyCeiling:virtualKeys:view:legacy",
      ]);
    });

    it("authenticates and nothing more for anyAuthenticated", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_any" });
      app.access(anyAuthenticated()).get("/whoami", (c) => c.text("ok"));

      await app.hono.request("/api/__pkg_any/whoami");
      expect(calls.chain).toEqual(["authenticateProject:legacy"]);
    });

    it("refuses a policy its scope cannot enforce", () => {
      const { spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_project_bad" });
      expect(() => app.access(requiresOnProject("traces:view"))).toThrow(
        /not supported by project-scoped secured apps/,
      );
    });
  });

  describe("when an organization route declares a policy", () => {
    it("resolves a projectPermission at the project the route names", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createOrgApp({ basePath: "/api/__pkg_org" });
      app
        .access(requiresOnProject("traces:view", { param: "projectId" }))
        .get("/projects/:projectId", (c) => c.text("ok"));

      await app.hono.request("/api/__pkg_org/projects/project_1");
      expect(calls.chain).toEqual([
        "authenticateOrganization:legacy",
        "authorizeRouteProjectPermission:traces:view:projectId:legacy",
      ]);
    });

    it("authorizes a plain permission at organization scope", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createOrgApp({ basePath: "/api/__pkg_org_rbac" });
      app.access(requires("gatewaySpend:view")).get("/spend", (c) => c.text("ok"));

      await app.hono.request("/api/__pkg_org_rbac/spend");
      expect(calls.chain).toEqual([
        "authenticateOrganization:legacy",
        "authorizeOrganizationPermission:gatewaySpend:view:legacy",
      ]);
    });

    it("refuses a policy its scope cannot enforce", () => {
      const { spine } = recordingSpine();
      const app = spine.createOrgApp({ basePath: "/api/__pkg_org_bad" });
      expect(() => app.access(apiKeyPermission("virtualKeys:view"))).toThrow(
        /not supported by organization-scoped secured apps/,
      );
    });
  });

  describe("when a service route declares a policy", () => {
    it("refuses an RBAC policy, which nothing on a service app enforces", () => {
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({ basePath: "/api/__pkg_service_bad" });
      expect(() => app.access(requires("traces:view"))).toThrow(
        /not supported by service-scoped secured apps/,
      );
    });

    it("applies no chain when the handler validates the secret itself", async () => {
      const calls: string[] = [];
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({ basePath: "/api/__pkg_service_inline" });
      app.access(internalSecret("the handler verifies the signature")).post("/hook", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const res = await app.hono.request("/api/__pkg_service_inline/hook", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(calls).toEqual(["handler"]);
    });
  });

  describe("when an any-method route is registered with .all()", () => {
    /** @scenario "An any-method route enforces its policy on every method" */
    it("records method ALL and runs the strategy chain before the handler", async () => {
      const calls: string[] = [];
      const secret: MiddlewareHandler = async (_c, next) => {
        calls.push("secret");
        await next();
      };
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_all",
        verifySecret: secret,
      });
      app.access(internalSecret("any-method shim")).all("/everything", (c) => {
        calls.push("handler");
        return c.text("ok");
      });

      const recorded = getRoutePolicy("ALL", "/api/__pkg_all/everything");
      expect(recorded?.policy).toEqual({
        kind: "internal",
        reason: "any-method shim",
      });

      for (const method of ["GET", "POST", "DELETE"] as const) {
        calls.length = 0;
        const res = await app.hono.request("/api/__pkg_all/everything", { method });
        expect(res.status).toBe(200);
        expect(calls).toEqual(["secret", "handler"]);
      }
    });
  });

  describe("when a HEAD route is registered", () => {
    it("records the method and answers the request", async () => {
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({ basePath: "/api/__pkg_head" });
      app.access(publicEndpoint("liveness probe")).head("/up", (c) => c.body(null, 200));

      expect(getRoutePolicy("HEAD", "/api/__pkg_head/up")).toBeDefined();
      const res = await app.hono.request("/api/__pkg_head/up", { method: "HEAD" });
      expect(res.status).toBe(200);
    });
  });

  describe("the error envelope a family publishes", () => {
    /** @scenario A canonical family refuses unauthenticated calls canonically */
    it("installs the canonical handler when the family declares canonical", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({
        basePath: "/api/__pkg_canonical",
        errorEnvelope: "canonical",
      });
      app.access(apiKeyPermission("virtualKeys:view")).get("/x", () => {
        throw new Error("boom");
      });

      const res = await app.hono.request("/api/__pkg_canonical/x");
      expect(res.status).toBe(500);
      expect(calls.errorHandler).toBe("canonical");
      // The chain is told the family's shape too, so a refusal it answers
      // itself matches the shape the handlers answer with.
      expect(calls.chain).toEqual([
        "authenticateProject:canonical",
        "authorizeApiKeyCeiling:virtualKeys:view:canonical",
      ]);
    });

    /** @scenario A legacy family keeps the flat error body its consumers parse */
    it("installs the legacy handler by default", async () => {
      const { calls, spine } = recordingSpine();
      const app = spine.createProjectApp({ basePath: "/api/__pkg_legacy" });
      app.access(apiKeyPermission("virtualKeys:view")).get("/x", () => {
        throw new Error("boom");
      });

      const res = await app.hono.request("/api/__pkg_legacy/x");
      expect(res.status).toBe(500);
      expect(calls.errorHandler).toBe("legacy");
    });
  });

  describe("the credential class a family publishes", () => {
    it("takes the app's own family unless the app overrides it", () => {
      const { spine } = recordingSpine();
      const project = spine.createProjectApp({ basePath: "/api/__pkg_class_project" });
      project.access(requires("traces:view")).get("/x", (c) => c.text("ok"));
      expect(getRoutePolicy("GET", "/api/__pkg_class_project/x")?.credentialClass).toBe(
        "project_api_key",
      );

      const admin = spine.createServiceApp({
        basePath: "/api/__pkg_class_admin",
        credentialClass: "instance_admin_api_key",
      });
      admin.access(internalSecret("the operator's instance key")).post("/x", (c) => c.text("ok"));
      expect(getRoutePolicy("POST", "/api/__pkg_class_admin/x")?.credentialClass).toBe(
        "instance_admin_api_key",
      );
    });

    it("keeps a public route on an overriding app at none", () => {
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_class_discovery",
        credentialClass: "scim_token",
      });
      app
        .access(publicEndpoint("the provider reads this before it holds a token"))
        .get("/ServiceProviderConfig", (c) => c.text("ok"));

      expect(
        getRoutePolicy("GET", "/api/__pkg_class_discovery/ServiceProviderConfig")?.credentialClass,
      ).toBe("none");
    });
  });

  describe("when one secured app is mounted under another", () => {
    it("keeps the policies the mounted routes declared", async () => {
      const { spine } = recordingSpine();
      const versioned = spine.createServiceApp({ basePath: "/api/__pkg_mounted/v1" });
      versioned.access(publicEndpoint("mounted probe")).get("/ping", (c) => c.text("ok"));

      const root = spine.createServiceApp({ basePath: "/" });
      root.route("/", versioned);

      expect(getRoutePolicy("GET", "/api/__pkg_mounted/v1/ping")?.policy).toEqual({
        kind: "public",
        reason: "mounted probe",
      });
      const res = await root.hono.request("/api/__pkg_mounted/v1/ping");
      expect(res.status).toBe(200);
    });
  });

  describe("the compile-time guarantee", () => {
    /** @scenario "Registering a route without an access policy is a type error" */
    it("does not expose verb methods on the bare app — only via access()", () => {
      const { spine } = recordingSpine();
      const app = spine.createServiceApp({
        basePath: "/api/__pkg_guard",
        verifySecret: noopSecret,
      });

      // @ts-expect-error — verb methods are not on the bare app; you must go
      // through access(policy) first. If this ever compiles, the guarantee is
      // broken and tsgo flags the unused @ts-expect-error.
      const leaked = app.get;
      void leaked;

      // Runtime: the bare app genuinely has no `.get`.
      expect((app as unknown as { get?: unknown }).get).toBeUndefined();
    });
  });
});

describe("createVersionedApp", () => {
  const VERSION = "2026-08-07";

  describe("when every route declares its policy", () => {
    it("records the declared permission for every mount the framework creates", () => {
      const { spine } = recordingSpine();
      const { service, policy } = spine.createVersionedApp({
        name: "pkg-versioned",
        basePath: "/api/__pkg_versioned",
      });

      service
        .registerRoute(
          "get",
          "/",
          VERSION,
          async () => ({ ok: true }),
          (b) => policy("organization:manage")(b).withOutput(z.object({ ok: z.boolean() })),
        )
        .build();

      const mounts = allRegisteredRoutes().filter((route) => route.family === "__pkg_versioned");
      expect(mounts.length).toBeGreaterThan(0);
      for (const mount of mounts) {
        // The namespace guard is the one public mount: it answers 404 for
        // unknown version segments and takes no credential.
        if (mount.policy.kind === "public") {
          expect(mount.credentialClass).toBe("none");
          continue;
        }
        expect(mount.policy).toEqual({ kind: "permission", permission: "organization:manage" });
        expect(mount.credentialClass).toBe("organization_api_key");
      }
    });

    it("runs the route middleware after authentication and the permission check", async () => {
      const { calls, spine } = recordingSpine();
      const gate: MiddlewareHandler = async (_c, next) => {
        calls.chain.push("routeMiddleware");
        await next();
      };
      const { service, policy } = spine.createVersionedApp({
        name: "pkg-versioned-order",
        basePath: "/api/__pkg_versioned_order",
        routeMiddleware: [gate],
      });

      const app = service
        .registerRoute(
          "get",
          "/",
          VERSION,
          async () => ({ ok: true }),
          (b) => policy("organization:manage")(b).withOutput(z.object({ ok: z.boolean() })),
        )
        .build();

      const mounted = allRegisteredRoutes().find(
        (route) => route.family === "__pkg_versioned_order" && route.policy.kind === "permission",
      );
      expect(mounted).toBeDefined();

      await app.request(mounted!.path);

      expect(calls.chain).toEqual([
        "authenticateOrganizationThrowing",
        "authorizeOrganizationPermissionThrowing:organization:manage",
        "routeMiddleware",
      ]);
    });
  });

  describe("when a route declares no policy", () => {
    /** @scenario "A versioned endpoint without an access policy fails the build" */
    it("refuses to build the family", () => {
      const { spine } = recordingSpine();
      const { service } = spine.createVersionedApp({
        name: "pkg-versioned-unclassified",
        basePath: "/api/__pkg_versioned_unclassified",
      });

      // `withoutPermission` is the framework's own explicit opt-out; it gets
      // past the "declare exactly one of" check and leaves the endpoint with
      // no policy meta, which is exactly the route this refusal exists for.
      service.registerRoute(
        "get",
        "/",
        VERSION,
        async () => ({ ok: true }),
        (b) => b.withoutPermission("policyless probe").withOutput(z.object({ ok: z.boolean() })),
      );

      expect(() => service.build()).toThrow(/declares no access policy/);
    });
  });
});

describe("the process error handlers", () => {
  describe("when a family installs its own onError", () => {
    it("exposes the boundary handler it has to delegate back to", () => {
      const { spine } = recordingSpine();
      // A family-level onError REPLACES the app's, so a family that names its
      // own domain errors reaches for these to render everything else.
      expect(typeof spine.legacyErrorHandler).toBe("function");
      expect(typeof spine.canonicalErrorHandler).toBe("function");
    });
  });
});
