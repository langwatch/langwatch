/**
 * @vitest-environment node
 *
 * The two denial modes of the org-permission check: `requireOrgPermission`
 * answers the family's legacy body itself (pinned, existing consumers parse
 * it), `requireOrgPermissionOrThrow` raises `insufficient_permissions` so the
 * family's error handler owns the response shape. Both run the SAME check,
 * `orgPermissionAllowed`, which these tests exercise through the public
 * middleware rather than directly.
 */
import { HandledError } from "@langwatch/handled-error";
import { Hono, type MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

const resolveApiKeyPermission = vi.fn();
vi.mock("~/server/rbac/role-binding-resolver", () => ({
  resolveApiKeyPermission: (...args: unknown[]) =>
    resolveApiKeyPermission(...args),
}));

// The middleware resolves its service from the App on the request context.
vi.mock("~/server/app-layer/app", async () => {
  const { appCredentialPermissionsMock } = await import(
    "~/test-utils/appCredentialPermissionsMock"
  );
  return appCredentialPermissionsMock();
});

import { requireOrgPermission, requireOrgPermissionOrThrow } from "../org-auth";

type TestEnv = {
  Variables: {
    organization: { id: string };
    apiKeyId: string;
    apiKeyUserId: string | null;
  };
};

/**
 * A Hono app with the auth context the org auth middleware would have set,
 * so the permission middleware under test sees a fully authenticated request.
 */
function buildApp(middleware: MiddlewareHandler) {
  const caught: unknown[] = [];
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    caught.push(error);
    return c.json({ caught: true }, 500);
  });
  app.use(async (c, next) => {
    c.set("organization", { id: "org_1" });
    c.set("apiKeyId", "key_1");
    c.set("apiKeyUserId", "user_1");
    await next();
  });
  app.use(middleware);
  app.get("/probe", (c) => c.json({ ok: true }));
  return { app, caught };
}

beforeEach(() => {
  resolveApiKeyPermission.mockReset();
});

describe("requireOrgPermission", () => {
  describe("when the credential lacks the permission", () => {
    it("answers 403 with the legacy body itself", async () => {
      resolveApiKeyPermission.mockResolvedValue(false);
      const { app, caught } = buildApp(
        requireOrgPermission("organization:manage"),
      );

      const res = await app.request("/probe");

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Forbidden",
        message: "Insufficient permissions. Required: organization:manage",
      });
      expect(caught).toEqual([]);
    });
  });

  describe("when the credential holds the permission", () => {
    it("passes through and checks at organization scope", async () => {
      resolveApiKeyPermission.mockResolvedValue(true);
      const { app } = buildApp(requireOrgPermission("organization:manage"));

      const res = await app.request("/probe");

      expect(res.status).toBe(200);
      expect(resolveApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: "key_1",
          userId: "user_1",
          organizationId: "org_1",
          scope: { type: "org", id: "org_1" },
          permission: "organization:manage",
        }),
      );
    });
  });
});

describe("requireOrgPermissionOrThrow", () => {
  describe("when the credential lacks the permission", () => {
    it("throws insufficient_permissions naming the permission in meta", async () => {
      resolveApiKeyPermission.mockResolvedValue(false);
      const { app, caught } = buildApp(
        requireOrgPermissionOrThrow("organization:manage"),
      );

      await app.request("/probe");

      expect(caught).toHaveLength(1);
      const error = caught[0];
      expect(HandledError.isHandled(error)).toBe(true);
      expect((error as HandledError).code).toBe("insufficient_permissions");
      expect((error as HandledError).httpStatus).toBe(403);
      expect((error as HandledError).meta).toEqual({
        required_permission: "organization:manage",
      });
    });
  });

  describe("when the credential holds the permission", () => {
    it("passes through with the same organization-scope check", async () => {
      resolveApiKeyPermission.mockResolvedValue(true);
      const { app, caught } = buildApp(
        requireOrgPermissionOrThrow("organization:manage"),
      );

      const res = await app.request("/probe");

      expect(res.status).toBe(200);
      expect(caught).toEqual([]);
      expect(resolveApiKeyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: "org", id: "org_1" },
          permission: "organization:manage",
        }),
      );
    });
  });
});
