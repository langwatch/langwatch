/**
 * @vitest-environment node
 *
 * HTTP-level tests for the Backoffice admin routes.
 *
 * The route had no test file at all, so all four of its error paths were
 * uncovered — including two whose status quietly moved from 400 to 422 when
 * they became `ValidationError`s. Everything here goes through the real Hono
 * app and the real `createServiceApp` `onError`, because the serialised body
 * IS the contract: a code the client can key copy off, and nothing else.
 *
 * Assertions are on `body.error` (the code) and the status. Never on message
 * prose — that is copy and will change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
const getBetterAuthSession = vi.fn();
const impersonationStart = vi.fn();
const impersonationStop = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));

vi.mock("~/server/better-auth", () => ({
  auth: {
    api: { getSession: (...args: unknown[]) => getBetterAuthSession(...args) },
  },
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/auditLog", () => ({ auditLog: vi.fn() }));

vi.mock("~/server/users/user.service", () => ({
  UserService: { create: () => ({}) },
}));

vi.mock("ra-data-simple-prisma", () => ({
  defaultHandler: vi.fn(async () => ({ data: [] })),
  getListHandler: vi.fn(async () => ({ data: [], total: 0 })),
  getOneHandler: vi.fn(async () => ({ data: null })),
}));

vi.mock("../../impersonation.service", () => ({
  ImpersonationService: {
    create: () => ({
      start: (...args: unknown[]) => impersonationStart(...args),
      stop: (...args: unknown[]) => impersonationStop(...args),
    }),
  },
}));

import { app } from "../admin";

const ADMIN_SESSION = {
  user: { id: "user_admin", name: "Ada", email: "ada@example.com" },
};

/** Signs the caller in as a super-admin with a live auth session behind it. */
function signInAsAdmin() {
  getServerAuthSession.mockResolvedValue(ADMIN_SESSION);
  getBetterAuthSession.mockResolvedValue({ session: { id: "sess_1" } });
}

async function post(
  path: string,
  body: string,
  contentType = "application/json",
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

async function bodyOf(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe("admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `isAdmin` reads the real implementation, so admin-ness is decided by the
    // session shape the auth mock returns.
    process.env.ADMIN_EMAILS = "ada@example.com";
  });

  describe("given a caller who is not an admin", () => {
    beforeEach(() => {
      getServerAuthSession.mockResolvedValue({
        user: { id: "user_1", email: "someone@example.com" },
      });
    });

    it("answers 404 with the generic not_found code", async () => {
      const response = await post(
        "/api/admin/impersonate",
        JSON.stringify({ userIdToImpersonate: "u1", reason: "support" }),
      );

      expect(response.status).toBe(404);
      expect((await bodyOf(response)).error).toBe("not_found");
    });

    it("names nothing that confirms the admin surface exists", async () => {
      const body = await bodyOf(
        await post("/api/admin/user", JSON.stringify({ method: "getList" })),
      );

      // The earlier spelling answered `{ id: "/api/admin", message: "Route not
      // found: /api/admin" }`, which told a prober the route is real and they
      // merely lack the session for it.
      expect(body).not.toHaveProperty("id");
      expect(body).not.toHaveProperty("resource");
      expect(JSON.stringify(body)).not.toContain("/api/admin");
    });

    it("does not reach the impersonation service", async () => {
      await post(
        "/api/admin/impersonate",
        JSON.stringify({ userIdToImpersonate: "u1", reason: "support" }),
      );

      expect(impersonationStart).not.toHaveBeenCalled();
    });
  });

  describe("given an admin whose auth session has expired", () => {
    it("answers 401 with the unauthorized code", async () => {
      getServerAuthSession.mockResolvedValue(ADMIN_SESSION);
      getBetterAuthSession.mockResolvedValue(null);

      const response = await post(
        "/api/admin/impersonate",
        JSON.stringify({ userIdToImpersonate: "u1", reason: "support" }),
      );

      expect(response.status).toBe(401);
      expect((await bodyOf(response)).error).toBe("unauthorized");
    });
  });

  describe("given an admin sending a body that is not a JSON object", () => {
    beforeEach(signInAsAdmin);

    it.each([
      ["unparseable", "{not json"],
      ["null", "null"],
      ["a number", "5"],
      ["an array", "[]"],
    ])("answers 400 malformed_request for %s", async (_label, payload) => {
      const response = await post("/api/admin/impersonate", payload);

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error).toBe("malformed_request");
    });

    it("never lets a non-object body reach the handler as one", async () => {
      // `null` and `5` parse fine, so they used to be returned as "the body"
      // and destructured / assigned onto one line later — a TypeError escaping
      // as an unhandled 500 for the exact case the helper names.
      for (const payload of ["null", "5", "[]"]) {
        const response = await post("/api/admin/user", payload);
        expect(response.status).toBe(400);
      }
      expect(impersonationStart).not.toHaveBeenCalled();
    });
  });

  describe("given an admin impersonation request missing its fields", () => {
    beforeEach(signInAsAdmin);

    it("answers 422 validation_error naming each missing field", async () => {
      const response = await post("/api/admin/impersonate", JSON.stringify({}));

      expect(response.status).toBe(422);
      const body = await bodyOf(response);
      expect(body.error).toBe("validation_error");
      expect(Object.keys(body.fieldErrors)).toEqual([
        "userIdToImpersonate",
        "reason",
      ]);
    });

    it("rejects a field of the wrong type rather than passing it on", async () => {
      const response = await post(
        "/api/admin/impersonate",
        JSON.stringify({ userIdToImpersonate: 12, reason: "   " }),
      );

      expect(response.status).toBe(422);
      expect(impersonationStart).not.toHaveBeenCalled();
    });
  });

  describe("given an admin asking for a resource the API does not serve", () => {
    beforeEach(signInAsAdmin);

    it("answers 422 validation_error", async () => {
      const response = await post(
        "/api/admin/secrets",
        JSON.stringify({ method: "getList" }),
      );

      expect(response.status).toBe(422);
      expect((await bodyOf(response)).error).toBe("validation_error");
    });

    it("does not reflect the caller's value back into the response", async () => {
      const probe = "<img src=x onerror=alert(1)>";
      const body = await bodyOf(
        await post(
          "/api/admin/user",
          JSON.stringify({ resource: probe, method: "getList" }),
        ),
      );

      expect(JSON.stringify(body)).not.toContain("onerror");
      expect(body.fieldErrors.resource).toHaveLength(1);
    });
  });
});
