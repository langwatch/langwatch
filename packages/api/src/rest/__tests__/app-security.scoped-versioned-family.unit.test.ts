/**
 * The versioned family at the two scopes it did not used to have, and the
 * access declarations the chain did not used to carry. Specs:
 * fluent-registration.feature, endpoint-capabilities.feature.
 */

// The declaration half is the one that matters: a family whose routes are
// scoped to the project or team named IN THE PATH used to have nowhere to say
// so, and converting it onto the one org-scoped factory would have widened
// the check to the organization — one grant reaching every project in it.

import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  anyAuthenticated,
  apiKeyPermission,
  handlerManagedAuth,
  internalSecret,
  publicEndpoint,
  requiresOnProject,
  requiresOnTeam,
} from "@langwatch/api";
import {
  createAppRestSecurity,
  createFamilyErrorHandler,
  getRoutePolicy,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";

const order: string[] = [];

const recording =
  (label: string): MiddlewareHandler =>
  async (_c, next) => {
    order.push(label);
    await next();
  };

const passthrough: MiddlewareHandler = async (_c, next) => {
  await next();
};

function securityUnder() {
  return createAppRestSecurity({
    appContext: passthrough,
    requestLogger: () => passthrough,
    requestTracer: () => passthrough,
    legacyErrorHandler: (error, c) => c.json({ error: error.message }, 500),
    canonicalErrorHandler: (error, c) => c.json({ code: "unknown", message: error.message }, 500),

    authenticateProject: (envelope) => recording(`project-auth:${envelope}`),
    authorizeProjectPermission: ({ permission }) => recording(`project-permission:${permission}`),
    authorizeApiKeyCeiling: ({ permission }) => recording(`api-key-ceiling:${permission}`),
    authorizeRouteProjectPermission: ({ permission, param }) =>
      recording(`route-project:${permission}@${param}`),
    authorizeRouteTeamPermission: ({ permission, param }) =>
      recording(`route-team:${permission}@${param}`),
    authenticateOrganization: () => passthrough,
    authorizeOrganizationPermission: () => passthrough,
    authenticateOrganizationThrowing: recording("org-auth"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      recording(`org-permission:${permission}`),
  });
}

const okOutput = z.object({ ok: z.boolean() });

/** A refusal the boundary knows how to render, as a family would raise one. */
class ToyRefusedError extends HandledError {
  constructor() {
    super("toy_refused", "boom", { httpStatus: 422 });
  }
}

describe("createProjectVersionedApp", () => {
  describe("given a project-scoped family", () => {
    /** @scenario "A versioned family authenticates at its own scope" */
    it("runs the project door and the project permission check, and records a project credential", async () => {
      const { service, policy } = securityUnder().createProjectVersionedApp({
        name: "toy-agent-cache",
        basePath: "/api/toy-agent-cache",
      });
      const app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) => policy("agentCache:manage")(b).withOutput(okOutput),
        )
        .build();

      order.length = 0;
      const response = await app.request(`/api/toy-agent-cache/${MANAGEMENT_API_VERSION}/things`);

      expect(response.status).toBe(200);
      expect(order).toEqual(["project-auth:canonical", "project-permission:agentCache:manage"]);
      expect(
        getRoutePolicy("GET", `/api/toy-agent-cache/${MANAGEMENT_API_VERSION}/things`)
          ?.credentialClass,
      ).toBe("project_api_key");
    });

    /** @scenario "A route declares the API-key ceiling rather than a role check" */
    it("routes apiKeyPermission to the ceiling, and records the declaration as it was written", async () => {
      const { service, policy } = securityUnder().createProjectVersionedApp({
        name: "toy-gateway",
        basePath: "/api/toy-gateway",
      });
      const app = service
        .registerRoute(
          "get",
          "/keys",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) => policy(apiKeyPermission("virtualKeys:view"))(b).withOutput(okOutput),
        )
        .build();

      order.length = 0;
      await app.request(`/api/toy-gateway/${MANAGEMENT_API_VERSION}/keys`);

      expect(order).toEqual(["project-auth:canonical", "api-key-ceiling:virtualKeys:view"]);
      expect(
        getRoutePolicy("GET", `/api/toy-gateway/${MANAGEMENT_API_VERSION}/keys`)?.policy,
      ).toEqual({ kind: "apiKeyPermission", permission: "virtualKeys:view" });
    });
  });
});

describe("createVersionedApp", () => {
  describe("given a route scoped to the team or project named in its path", () => {
    /** @scenario "A route is checked at the scope its path names, not the family's" */
    it("checks that scope instead of the organization, and says so in the registry", async () => {
      const { service, policy } = securityUnder().createVersionedApp({
        name: "toy-teams",
        basePath: "/api/toy-teams",
      });
      const app = service
        .registerRoute(
          "get",
          "/teams/:id",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy(requiresOnTeam("team:view"))(b)
              .withParams(z.object({ id: z.string() }))
              .withOutput(okOutput),
        )
        .registerRoute(
          "get",
          "/projects/:projectId",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy(requiresOnProject("project:view", { param: "projectId" }))(b)
              .withParams(z.object({ projectId: z.string() }))
              .withOutput(okOutput),
        )
        .build();

      order.length = 0;
      await app.request(`/api/toy-teams/${MANAGEMENT_API_VERSION}/teams/team-1`);
      await app.request(`/api/toy-teams/${MANAGEMENT_API_VERSION}/projects/project-1`);

      expect(order).toEqual([
        "org-auth",
        "route-team:team:view@id",
        "org-auth",
        "route-project:project:view@projectId",
      ]);
      // The organization-wide check never ran: that is the widening this
      // declaration exists to prevent.
      expect(order.some((entry) => entry.startsWith("org-permission:"))).toBe(false);
      expect(
        getRoutePolicy("GET", `/api/toy-teams/${MANAGEMENT_API_VERSION}/teams/:id`)?.policy,
      ).toEqual({ kind: "teamPermission", permission: "team:view", param: "id" });
    });
  });

  describe("given the family publishes the legacy error envelope", () => {
    /** @scenario "A converted family keeps the error body its integrators parse" */
    it("answers a failure in the envelope it declared, not the framework default", async () => {
      for (const [envelope, key] of [
        ["legacy", "error"],
        ["canonical", "code"],
      ] as const) {
        const { service, policy } = securityUnder().createVersionedApp({
          name: `toy-envelope-${envelope}`,
          basePath: `/api/toy-envelope-${envelope}`,
          errorEnvelope: envelope,
        });
        const app = service
          .registerRoute(
            "get",
            "/things",
            MANAGEMENT_API_VERSION,
            async () => {
              throw new Error("boom");
            },
            (b) => policy("organization:manage")(b).withOutput(okOutput),
          )
          .build();

        const response = await app.request(
          `/api/toy-envelope-${envelope}/${MANAGEMENT_API_VERSION}/things`,
        );

        expect(response.status).toBe(500);
        expect(Object.keys((await response.json()) as object)).toContain(key);
      }
    });
  });

  describe("given the family installs its own error handler", () => {
    /** @scenario "A family layers its own error handler over the envelope" */
    it("hands it the envelope's boundary to delegate to", async () => {
      const seen: string[] = [];
      const { service, policy } = securityUnder().createVersionedApp({
        name: "toy-family-errors",
        basePath: "/api/toy-family-errors",
        errorEnvelope: "legacy",
        errorHandler: (boundary) => {
          expect(typeof boundary).toBe("function");
          return createFamilyErrorHandler({
            loggerName: "langwatch:api:toy:errors",
            label: "Toy Error",
            boundary: (error, c) => {
              seen.push(error.message);
              return boundary(error, c);
            },
          });
        },
      });
      const app = service
        .registerRoute(
          "get",
          "/things",
          MANAGEMENT_API_VERSION,
          async () => {
            // A refusal the boundary knows how to render: the family handler
            // logs it and passes it on rather than collapsing it to a 500.
            throw new ToyRefusedError();
          },
          (b) => policy("organization:manage")(b).withOutput(okOutput),
        )
        .build();

      const response = await app.request(`/api/toy-family-errors/${MANAGEMENT_API_VERSION}/things`);

      expect(response.status).toBe(500);
      expect(seen).toEqual(["boom"]);
    });
  });
});

describe("createServiceVersionedApp", () => {
  describe("given a shared-secret family", () => {
    /** @scenario "A service family stands behind its own secret, not a role check" */
    it("runs the secret check and records the declaration it was given", async () => {
      const { service, policy } = securityUnder().createServiceVersionedApp({
        name: "toy-internal",
        basePath: "/api/internal/toy",
        verifySecret: recording("verify-secret"),
      });
      const app = service
        .registerRoute(
          "post",
          "/notify",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy(internalSecret("the scheduler calls this with the process secret"))(b)
              .withInput(z.object({}))
              .withOutput(okOutput),
        )
        .registerRoute(
          "get",
          "/health",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy(publicEndpoint("a liveness probe reads nothing and takes no credential"))(
              b,
            ).withOutput(okOutput),
        )
        .build();

      order.length = 0;
      await app.request(`/api/internal/toy/${MANAGEMENT_API_VERSION}/notify`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      await app.request(`/api/internal/toy/${MANAGEMENT_API_VERSION}/health`);

      // The secret guards the internal route; the public probe declared its
      // way past the door, and nothing else ran.
      expect(order).toEqual(["verify-secret"]);
      expect(
        getRoutePolicy("GET", `/api/internal/toy/${MANAGEMENT_API_VERSION}/health`)
          ?.credentialClass,
      ).toBe("none");
    });

    /** @scenario "A service family cannot declare a check its door cannot run" */
    it("refuses a role check no shared secret can enforce", () => {
      const { policy } = securityUnder().createServiceVersionedApp({
        name: "toy-refuses",
        basePath: "/api/internal/toy-refuses",
      });

      expect(() => policy("organization:manage")).toThrow(
        /declares permission, which no shared-secret door can enforce/,
      );
    });

    /** @scenario "A service family stands behind its own secret, not a role check" */
    it("lets a handler-managed route authenticate for itself", async () => {
      const { service, policy } = securityUnder().createServiceVersionedApp({
        name: "toy-handler-managed",
        basePath: "/api/internal/toy-handler-managed",
        verifySecret: recording("verify-secret"),
      });
      const app = service
        .registerRoute(
          "get",
          "/session",
          MANAGEMENT_API_VERSION,
          async () => ({ ok: true }),
          (b) =>
            policy(
              handlerManagedAuth({
                reason: "the CLI door resolves the session from the raw request",
                credential: "session",
                permissions: [],
              }),
            )(b).withOutput(okOutput),
        )
        .build();

      order.length = 0;
      await app.request(`/api/internal/toy-handler-managed/${MANAGEMENT_API_VERSION}/session`);

      expect(order).toEqual([]);
    });
  });
});

describe("anyAuthenticated on a versioned family", () => {
  /** @scenario "A route accepts any credential its family's door admits" */
  it("keeps the door and skips the permission check", async () => {
    const { service, policy } = securityUnder().createProjectVersionedApp({
      name: "toy-whoami",
      basePath: "/api/toy-whoami",
    });
    const app = service
      .registerRoute(
        "get",
        "/me",
        MANAGEMENT_API_VERSION,
        async () => ({ ok: true }),
        (b) => policy(anyAuthenticated())(b).withOutput(okOutput),
      )
      .build();

    order.length = 0;
    await app.request(`/api/toy-whoami/${MANAGEMENT_API_VERSION}/me`);

    expect(order).toEqual(["project-auth:canonical"]);
    expect(getRoutePolicy("GET", `/api/toy-whoami/${MANAGEMENT_API_VERSION}/me`)?.policy.kind).toBe(
      "anyAuthenticated",
    );
  });
});

describe("a family whose contract is a generation rather than a date", () => {
  /** @scenario "A family serves one static generation instead of dated namespaces" */
  it("answers at its generation path only, with no dated or latest namespace beside it", async () => {
    const { service, policy } = securityUnder().createProjectVersionedApp({
      name: "toy-gateway-v1",
      basePath: "/api/toy-gateway/v1",
      staticGeneration: "v1",
    });
    const app = service
      .registerRoute(
        "get",
        "/keys",
        MANAGEMENT_API_VERSION,
        async () => ({ ok: true }),
        (b) => policy(apiKeyPermission("virtualKeys:view"))(b).withOutput(okOutput),
      )
      .build();

    const served = await app.request("/api/toy-gateway/v1/keys");
    const dated = await app.request(`/api/toy-gateway/v1/${MANAGEMENT_API_VERSION}/keys`);

    expect(served.status).toBe(200);
    expect(served.headers.get("X-API-Version")).toBe("v1");
    expect(dated.status).toBe(404);
    expect(getRoutePolicy("GET", "/api/toy-gateway/v1/keys")?.policy).toEqual({
      kind: "apiKeyPermission",
      permission: "virtualKeys:view",
    });
  });
});

describe("a stream on a family that is not organization-scoped", () => {
  /** @scenario "A stream is declared on a family at any scope" */
  it("wears the family's door and its access declaration, like any other route", async () => {
    const { service, policy } = securityUnder().createProjectVersionedApp({
      name: "toy-runs",
      basePath: "/api/toy-runs",
    });
    const app = service
      .registerSse(
        "runs.watch",
        MANAGEMENT_API_VERSION,
        async (_c, stream) => {
          await stream.emit("tick", { at: 1 });
          stream.close();
        },
        (b) => policy("agentCache:manage")(b).withEvents({ tick: z.object({ at: z.number() }) }),
      )
      .build();

    order.length = 0;
    const response = await app.request(`/api/toy-runs/${MANAGEMENT_API_VERSION}/runs.watch`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(order).toEqual(["project-auth:canonical", "project-permission:agentCache:manage"]);
    expect(
      getRoutePolicy("GET", `/api/toy-runs/${MANAGEMENT_API_VERSION}/runs.watch`)?.policy,
    ).toEqual({ kind: "permission", permission: "agentCache:manage" });
  });
});
