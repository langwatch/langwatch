import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Permission } from "~/server/api/rbac";
import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  requireApiKeyPermission,
} from "../auth-middleware";
import { ApiKeyPermissionDeniedError } from "../errors";
import type { ResolvedToken } from "../token-resolver";

/**
 * Enforcement side of the API-key ceiling — the middleware and the guard it
 * wraps. The resolver itself is covered by
 * `role-binding-resolver.ceiling.unit.test.ts`; here it is stubbed so each
 * branch of the enforcement path can be steered directly.
 *
 * @see specs/api-keys/scope-based-permissions.feature
 */

vi.mock("~/server/rbac/role-binding-resolver", () => ({
  resolveApiKeyPermission: vi.fn(),
}));

// The ceiling resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appCredentialPermissionsMock } = await import(
    "~/test-utils/appCredentialPermissionsMock"
  );
  return appCredentialPermissionsMock();
});

const resolveMock = vi.mocked(resolveApiKeyPermission);

const project = {
  id: "proj1",
  team: { id: "team1", organizationId: "org1" },
} as unknown as ResolvedToken["project"];

const apiKeyToken: ResolvedToken = {
  type: "apiKey",
  apiKeyId: "apikey1",
  userId: "user1",
  organizationId: "org1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project,
};

const langySessionKeyToken: ResolvedToken = {
  type: "apiKey",
  apiKeyId: "langykey1",
  userId: "user1",
  organizationId: "org1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  isLangySessionKey: true,
  project,
};

const legacyProjectKeyToken: ResolvedToken = {
  type: "legacyProjectKey",
  project,
};

/**
 * Mounts the middleware behind a stub that seeds `resolvedToken`, so the test
 * drives it through a real Hono request rather than a hand-built context.
 */
function appWith(
  resolved: ResolvedToken | undefined,
  permission: Permission = "project:update",
) {
  const handler = vi.fn((c: { text: (body: string) => Response }) =>
    c.text("reached"),
  );
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (resolved) c.set("resolvedToken" as never, resolved as never);
    await next();
  });
  app.use("*", requireApiKeyPermission({ permission }));
  app.get("/", handler as never);
  return { app, handler };
}

beforeEach(() => {
  resolveMock.mockReset();
});

describe("enforceApiKeyCeiling()", () => {
  describe("given a scoped API key", () => {
    describe("when the ceiling grants the permission", () => {
      it("returns without throwing", async () => {
        resolveMock.mockResolvedValue(true);

        await expect(
          enforceApiKeyCeiling({
            resolved: apiKeyToken,
            permission: "project:update",
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when the ceiling denies the permission", () => {
      it("throws a permission-denied error naming the permission", async () => {
        resolveMock.mockResolvedValue(false);

        await expect(
          enforceApiKeyCeiling({
            resolved: apiKeyToken,
            permission: "project:update",
          }),
        ).rejects.toMatchObject({ code: "api_key_permission_denied" });
      });
    });

    describe("when resolving the permission", () => {
      it("scopes the check to the token's own project and team", async () => {
        resolveMock.mockResolvedValue(true);

        await enforceApiKeyCeiling({
          resolved: apiKeyToken,
          permission: "project:update",
        });

        expect(resolveMock).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKeyId: "apikey1",
            userId: "user1",
            organizationId: "org1",
            permission: "project:update",
            scope: { type: "project", id: "proj1", teamId: "team1" },
          }),
        );
      });
    });
  });

  /**
   * A refused Langy session key has two causes that look identical at the
   * ceiling, and only one of them has an action behind it. The customer can
   * be granted a permission they lack; nobody can be granted one Langy is
   * never delegated, so telling them to widen the key sends them to a door
   * that does not open. Langy did exactly that with `triggers:create`, and
   * offered to retry once the user "granted the permission".
   */
  describe("given the ephemeral key a Langy chat mints", () => {
    describe("when the permission is one Langy is never delegated", () => {
      /** @scenario "A permission Langy is never delegated says so" */
      it("says it is not delegable rather than not granted", async () => {
        resolveMock.mockResolvedValue(false);

        await expect(
          enforceApiKeyCeiling({
            resolved: langySessionKeyToken,
            permission: "triggers:create",
          }),
        ).rejects.toMatchObject({
          code: "api_key_permission_not_delegable",
        });
      });
    });

    describe("when the permission is one Langy may hold", () => {
      /**
       * The session key mirrors its owner, so a delegable permission can still
       * be refused because the human does not hold it — and there, widening
       * the key or asking an admin is exactly the right advice.
       */
      it("keeps the ordinary refusal", async () => {
        resolveMock.mockResolvedValue(false);

        await expect(
          enforceApiKeyCeiling({
            resolved: langySessionKeyToken,
            permission: "prompts:create",
          }),
        ).rejects.toMatchObject({ code: "api_key_permission_denied" });
      });
    });
  });

  describe("given an ordinary API key", () => {
    describe("when the permission is one Langy is never delegated", () => {
      it("keeps the ordinary refusal, since the Langy policy is not its rule", async () => {
        resolveMock.mockResolvedValue(false);

        await expect(
          enforceApiKeyCeiling({
            resolved: apiKeyToken,
            permission: "triggers:create",
          }),
        ).rejects.toMatchObject({ code: "api_key_permission_denied" });
      });
    });
  });

  describe("given a legacy project key", () => {
    /**
     * Characterization, not endorsement: legacy project keys are exempt from
     * the ceiling and reach every permission on their project. Pinned so that
     * narrowing this later is a deliberate, visible change rather than a
     * silent one.
     */
    it("skips the ceiling entirely", async () => {
      await expect(
        enforceApiKeyCeiling({
          resolved: legacyProjectKeyToken,
          permission: "project:update",
        }),
      ).resolves.toBeUndefined();

      expect(resolveMock).not.toHaveBeenCalled();
    });
  });
});

describe("requireApiKeyPermission()", () => {
  describe("given a scoped API key", () => {
    describe("when the ceiling grants the permission", () => {
      it("runs the route handler", async () => {
        resolveMock.mockResolvedValue(true);
        const { app, handler } = appWith(apiKeyToken);

        const res = await app.request("/");

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalled();
      });
    });

    describe("when the ceiling denies the permission", () => {
      it("answers 403 and never reaches the handler", async () => {
        resolveMock.mockResolvedValue(false);
        const { app, handler } = appWith(apiKeyToken);

        const res = await app.request("/");

        expect(res.status).toBe(403);
        // The `error` field is the CODE, not the status text: the middleware
        // answers with the same body `onError` would have built (ADR-045), so
        // a caller keeps the code, the permission in `meta`, and the tips.
        await expect(res.json()).resolves.toMatchObject({
          error: "api_key_permission_denied",
        });
        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe("when a Langy session key asks for a permission it is never delegated", () => {
      it("answers 403 with the not-delegable code and a tip that does not send the user to an admin", async () => {
        resolveMock.mockResolvedValue(false);
        const { app, handler } = appWith(
          langySessionKeyToken,
          "triggers:create",
        );

        const res = await app.request("/");
        const body = (await res.json()) as {
          error: string;
          tips?: string[];
        };

        expect(res.status).toBe(403);
        expect(body.error).toBe("api_key_permission_not_delegable");
        expect(body.tips?.join(" ")).toContain("LangWatch");
        expect(handler).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a legacy project key", () => {
    it("runs the route handler without consulting the ceiling", async () => {
      const { app, handler } = appWith(legacyProjectKeyToken);

      const res = await app.request("/");

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
      expect(resolveMock).not.toHaveBeenCalled();
    });
  });

  describe("given no token was resolved onto the context", () => {
    /**
     * A permission gate running with nobody authenticated is a mis-wired
     * route — the unified auth middleware was not mounted before it. The
     * gate refuses rather than waving the request through: the old
     * pass-through meant a route that forgot its auth middleware silently
     * lost its permission check too. The plain Error degrades to the
     * generic unknown response at the boundary (ADR-045).
     */
    /** @scenario "The permission gate refuses a request nobody authenticated" */
    it("refuses the request instead of passing it through", async () => {
      const { app, handler } = appWith(undefined);

      const res = await app.request("/");

      expect(res.status).toBe(500);
      expect(handler).not.toHaveBeenCalled();
      expect(resolveMock).not.toHaveBeenCalled();
    });
  });
});

describe("apiKeyCeilingDenialResponse()", () => {
  describe("when handed an unrelated error", () => {
    it("re-throws it rather than reporting a denial", () => {
      const boom = new Error("connection reset");

      expect(() => apiKeyCeilingDenialResponse(boom)).toThrow(boom);
    });
  });

  /**
   * Only the re-throw branch was covered, so the branch that BUILDS a response
   * drifted for free: it kept answering a hand-built `{ error: "Forbidden" }`
   * long after `requireApiKeyPermission` moved to the shared handled body, and
   * the suite stayed green through the whole divergence. This pins the wire
   * contract the eight ingest routes hand back.
   */
  describe("when handed an API key permission denial", () => {
    it("answers 403 with the handled body a caller can act on", () => {
      const denial = apiKeyCeilingDenialResponse(
        new ApiKeyPermissionDeniedError("traces:create", {
          meta: { apiKeyId: "apikey1", projectId: "proj1" },
        }),
      );

      expect(denial.status).toBe(403);
      const body = denial.body as Record<string, unknown>;
      expect(body.error).toBe("api_key_permission_denied");
      // The permission is the whole point of the meta: a CLI reads it to say
      // WHICH grant is missing, and nothing pinned it until now.
      expect(body.permission).toBe("traces:create");
      expect(body.apiKeyId).toBe("apikey1");
    });

    it("carries the remediation channel the hand-built body dropped", () => {
      const denial = apiKeyCeilingDenialResponse(
        new ApiKeyPermissionDeniedError("traces:create"),
      );

      const body = denial.body as Record<string, unknown>;
      expect(body.fault).toBe("customer");
      expect(body).toHaveProperty("message");
      expect(body.error).not.toBe("Forbidden");
    });
  });
});
