import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveApiKeyPermission } from "~/server/rbac/role-binding-resolver";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  requireApiKeyPermission,
} from "../auth-middleware";
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

const resolveMock = vi.mocked(resolveApiKeyPermission);

const prisma = {} as never;

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

const legacyProjectKeyToken: ResolvedToken = {
  type: "legacyProjectKey",
  project,
};

/**
 * Mounts the middleware behind a stub that seeds `resolvedToken`, so the test
 * drives it through a real Hono request rather than a hand-built context.
 */
function appWith(resolved: ResolvedToken | undefined) {
  const handler = vi.fn((c: { text: (body: string) => Response }) =>
    c.text("reached"),
  );
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (resolved) c.set("resolvedToken" as never, resolved as never);
    await next();
  });
  app.use(
    "*",
    requireApiKeyPermission({ prisma, permission: "project:update" }),
  );
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
            prisma,
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
            prisma,
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
          prisma,
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
          prisma,
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
     * The middleware passes the request through when nothing authenticated it.
     * That is safe only while it is chained behind the unified auth middleware,
     * which rejects unauthenticated callers first — mounted alone, this gate
     * does nothing. Pinned so the fail-open is an asserted decision and any
     * future mis-wiring has to change a test to land.
     */
    it("passes the request through without any permission check", async () => {
      const { app, handler } = appWith(undefined);

      const res = await app.request("/");

      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
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
});
