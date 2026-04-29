/**
 * @vitest-environment node
 *
 * Integration tests for the Auth0 password service.
 *
 * We stand up a real local HTTP server that impersonates Auth0's
 * /oauth/token and /api/v2/users/{id} endpoints. This exercises the
 * full HTTP path — body parsing, headers, JSON round-trip, error
 * mapping — without hitting the real Auth0 API.
 */
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let auth0Issuer = "http://127.0.0.1:0";

vi.mock("../../../env.mjs", () => ({
  env: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "AUTH0_ISSUER") return auth0Issuer;
        if (prop === "AUTH0_CLIENT_ID") return "test-client-id";
        if (prop === "AUTH0_CLIENT_SECRET") return "test-client-secret";
        return undefined;
      },
    },
  ),
}));

import {
  Auth0ApiError,
  _resetManagementApiTokenCache,
  changeAuth0Password,
  getManagementApiToken,
  updateUserPassword,
  verifyCurrentPassword,
} from "../passwordService";

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

type Handler = (req: CapturedRequest) => {
  status: number;
  body?: unknown;
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

let server: Server;
let captured: CapturedRequest[] = [];
let handler: Handler = () => ({ status: 404 });

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readJsonBody(req);
      const captured1: CapturedRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body,
      };
      captured.push(captured1);

      const result = handler(captured1);
      res.statusCode = result.status;
      res.setHeader("content-type", "application/json");
      res.end(result.body === undefined ? "" : JSON.stringify(result.body));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  auth0Issuer = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  captured = [];
  handler = () => ({ status: 404 });
  // Reset between cases so each test starts with no cached Management
  // API token (the cache is module-scoped).
  _resetManagementApiTokenCache();
});

describe("getManagementApiToken", () => {
  describe("when client credentials grant succeeds", () => {
    it("returns the access token", async () => {
      handler = () => ({
        status: 200,
        body: {
          access_token: "mgmt-token",
          token_type: "Bearer",
          expires_in: 3600,
        },
      });

      const token = await getManagementApiToken();
      expect(token).toBe("mgmt-token");
      expect(captured[0]?.body).toMatchObject({
        grant_type: "client_credentials",
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        audience: `${auth0Issuer}/api/v2/`,
      });
    });
  });

  describe("when called twice within the cache lifetime", () => {
    it("returns the cached token without a second token request", async () => {
      handler = () => ({
        status: 200,
        body: {
          access_token: "cached-mgmt-token",
          token_type: "Bearer",
          expires_in: 3600,
        },
      });

      const t1 = await getManagementApiToken();
      const t2 = await getManagementApiToken();

      expect(t1).toBe("cached-mgmt-token");
      expect(t2).toBe("cached-mgmt-token");
      // Only ONE request was made — second call was served from cache.
      expect(captured).toHaveLength(1);
    });
  });

  describe("when the response is missing expires_in", () => {
    it("does not cache the token (defensive)", async () => {
      handler = () => ({
        status: 200,
        body: { access_token: "uncached-mgmt-token", token_type: "Bearer" },
      });

      await getManagementApiToken();
      await getManagementApiToken();
      // Both calls hit the network because we refused to cache without
      // an explicit expiry.
      expect(captured).toHaveLength(2);
    });
  });

  describe("when Auth0 returns no access_token", () => {
    it("throws Auth0ApiError", async () => {
      handler = () => ({
        status: 401,
        body: { error: "access_denied" },
      });
      await expect(getManagementApiToken()).rejects.toBeInstanceOf(
        Auth0ApiError,
      );
    });
  });

  describe("when the Auth0 host is unreachable (transport error)", () => {
    // Network-layer failures (DNS, connection refused, AbortError from the
    // 10s timeout) used to leak as raw Error and break the caller's
    // `instanceof Auth0ApiError` check. fetchAuth0 normalizes them.
    it("normalizes network errors to Auth0ApiError", async () => {
      const original = auth0Issuer;
      auth0Issuer = "http://127.0.0.1:1"; // closed port
      try {
        await expect(getManagementApiToken()).rejects.toBeInstanceOf(
          Auth0ApiError,
        );
      } finally {
        auth0Issuer = original;
      }
    });
  });
});

describe("updateUserPassword", () => {
  describe("when the Management API returns 200 OK", () => {
    it("sends the password + connection and bearer token", async () => {
      handler = (req) => {
        if (
          req.method === "PATCH" &&
          req.path === "/api/v2/users/auth0%7Cabc123"
        ) {
          return { status: 200, body: { user_id: "auth0|abc123" } };
        }
        return { status: 404 };
      };

      await updateUserPassword({
        auth0UserId: "auth0|abc123",
        newPassword: "n3w-secret-pw",
        managementToken: "mgmt-token",
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.headers.authorization).toBe("Bearer mgmt-token");
      expect(captured[0]?.body).toEqual({
        password: "n3w-secret-pw",
        connection: "Username-Password-Authentication",
      });
    });
  });

  describe("when the Auth0 app is missing the update:users scope", () => {
    /** @scenario Surfaces a clear error when the Auth0 Management API scope is missing */
    it("throws Auth0ApiError with code=insufficient_scope", async () => {
      handler = () => ({
        status: 403,
        body: {
          statusCode: 403,
          error: "Forbidden",
          message: "Insufficient scope, expected any of: update:users",
          errorCode: "insufficient_scope",
        },
      });

      await expect(
        updateUserPassword({
          auth0UserId: "auth0|abc",
          newPassword: "pw12345678",
          managementToken: "tok",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "insufficient_scope",
      });
    });
  });

  describe("when the Management API returns a generic 500", () => {
    it("throws Auth0ApiError with code=unknown", async () => {
      handler = () => ({
        status: 500,
        body: { message: "boom" },
      });

      await expect(
        updateUserPassword({
          auth0UserId: "auth0|abc",
          newPassword: "pw12345678",
          managementToken: "tok",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "unknown",
        status: 500,
      });
    });
  });

  describe("when the new password violates the tenant password policy", () => {
    // Auth0 surfaces tenant-policy violations as a 400 with
    // `message: "PasswordStrengthError: ..."`. We map this to a typed
    // weak_password code so the caller can render the user-facing
    // reason verbatim instead of the generic "try again later".
    it("throws Auth0ApiError code=weak_password with the cleaned-up message", async () => {
      handler = () => ({
        status: 400,
        body: {
          statusCode: 400,
          error: "Bad Request",
          message: "PasswordStrengthError: Password is too weak",
        },
      });

      await expect(
        updateUserPassword({
          auth0UserId: "auth0|abc",
          newPassword: "short",
          managementToken: "tok",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "weak_password",
        message: expect.stringContaining("Password is too weak"),
      });
    });

    it("recognizes PasswordHistoryError too", async () => {
      handler = () => ({
        status: 400,
        body: {
          statusCode: 400,
          error: "Bad Request",
          message:
            "PasswordHistoryError: Password has previously been used",
        },
      });

      await expect(
        updateUserPassword({
          auth0UserId: "auth0|abc",
          newPassword: "short",
          managementToken: "tok",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "weak_password",
        message: expect.stringContaining("previously been used"),
      });
    });
  });

  describe("when the Management API returns 403 with a non-scope errorCode", () => {
    // E.g. a blocked user. Earlier code matched on status alone and
    // would have mis-labeled this as `insufficient_scope`. Now it
    // should fall through to `unknown` so callers don't surface bad
    // remediation advice ("enable update:users scope") for an
    // unrelated 403.
    it("throws Auth0ApiError with code=unknown, not insufficient_scope", async () => {
      handler = () => ({
        status: 403,
        body: {
          statusCode: 403,
          error: "Forbidden",
          errorCode: "unauthorized",
          message: "User is blocked",
        },
      });

      await expect(
        updateUserPassword({
          auth0UserId: "auth0|abc",
          newPassword: "pw12345678",
          managementToken: "tok",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "unknown",
        status: 403,
      });
    });
  });
});

describe("verifyCurrentPassword", () => {
  describe("when Auth0 accepts the password (200)", () => {
    /** @scenario Auth0 backend verifies the current password via Resource Owner Password Grant before updating */
    it("returns true and sends a Resource Owner Password Grant request", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          return {
            status: 200,
            body: { access_token: "user-access-token", id_token: "id-token" },
          };
        }
        return { status: 404 };
      };

      const ok = await verifyCurrentPassword({
        email: "user@example.com",
        password: "hunter2",
      });

      expect(ok).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.body).toEqual({
        grant_type: "password",
        username: "user@example.com",
        password: "hunter2",
        audience: `${auth0Issuer}/api/v2/`,
        scope: "openid",
        client_id: "test-client-id",
        client_secret: "test-client-secret",
      });
    });
  });

  describe("when the current password is wrong", () => {
    it("returns false on invalid_grant", async () => {
      handler = () => ({
        status: 403,
        body: {
          error: "invalid_grant",
          error_description: "Wrong email or password.",
        },
      });

      const ok = await verifyCurrentPassword({
        email: "user@example.com",
        password: "wrong",
      });
      expect(ok).toBe(false);
    });
  });

  describe("when the M2M app does not have the Password grant enabled", () => {
    /** @scenario Surfaces a clear error when the Auth0 Password grant is missing on the M2M app */
    it("throws Auth0ApiError with code=password_grant_not_enabled", async () => {
      handler = () => ({
        status: 403,
        body: {
          error: "unauthorized_client",
          error_description:
            "Grant type 'password' not allowed for the client.",
        },
      });

      await expect(
        verifyCurrentPassword({ email: "u@example.com", password: "x" }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "password_grant_not_enabled",
      });
    });
  });

  describe("when Auth0 returns an unmapped error", () => {
    it("throws Auth0ApiError with code=unknown", async () => {
      handler = () => ({
        status: 500,
        body: { error: "server_error", error_description: "boom" },
      });

      await expect(
        verifyCurrentPassword({ email: "u@example.com", password: "x" }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "unknown",
      });
    });
  });
});

describe("changeAuth0Password", () => {
  describe("given a correct current password and valid M2M credentials", () => {
    /** @scenario Auth0 backend uses a separate Machine-to-Machine app for the Management API */
    it("verifies, gets management token, and PATCHes the user's password", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          const body = req.body as { grant_type?: string } | undefined;
          if (body?.grant_type === "password") {
            return { status: 200, body: { access_token: "user-tok" } };
          }
          if (body?.grant_type === "client_credentials") {
            return {
              status: 200,
              body: { access_token: "mgmt-tok", expires_in: 3600 },
            };
          }
        }
        if (req.method === "PATCH" && req.path.startsWith("/api/v2/users/")) {
          return { status: 200, body: {} };
        }
        return { status: 404 };
      };

      const result = await changeAuth0Password({
        email: "user@example.com",
        auth0UserId: "auth0|abc",
        currentPassword: "old-pw-1",
        newPassword: "new-pw-12345",
      });

      expect(result).toEqual({ ok: true });
      // 1) ROPG verify, 2) client_credentials, 3) PATCH
      expect(captured).toHaveLength(3);
      expect(
        (captured[0]?.body as { grant_type?: string }).grant_type,
      ).toBe("password");
      expect(
        (captured[1]?.body as { grant_type?: string }).grant_type,
      ).toBe("client_credentials");
      expect(captured[2]?.method).toBe("PATCH");
      expect(captured[2]?.headers.authorization).toBe("Bearer mgmt-tok");
      expect(captured[2]?.body).toEqual({
        password: "new-pw-12345",
        connection: "Username-Password-Authentication",
      });
    });
  });

  describe("given the wrong current password", () => {
    /** @scenario Auth0 backend returns 401 UNAUTHORIZED when the current password is wrong */
    it("returns { ok: false, reason: 'wrong_password' } and never touches the Management API", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          return {
            status: 403,
            body: { error: "invalid_grant" },
          };
        }
        // Anything else is a bug — fail loudly.
        return { status: 500 };
      };

      const result = await changeAuth0Password({
        email: "user@example.com",
        auth0UserId: "auth0|abc",
        currentPassword: "wrong",
        newPassword: "new-pw-12345",
      });

      expect(result).toEqual({ ok: false, reason: "wrong_password" });
      expect(captured).toHaveLength(1); // ONLY the verify call
    });
  });

  describe("given the Management API rejects with insufficient_scope", () => {
    it("propagates Auth0ApiError so the caller can show a config error", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          const body = req.body as { grant_type?: string } | undefined;
          if (body?.grant_type === "password") {
            return { status: 200, body: { access_token: "user-tok" } };
          }
          return {
            status: 200,
            body: { access_token: "mgmt-tok", expires_in: 3600 },
          };
        }
        return {
          status: 403,
          body: {
            statusCode: 403,
            error: "Forbidden",
            errorCode: "insufficient_scope",
            message: "Insufficient scope, expected any of: update:users",
          },
        };
      };

      await expect(
        changeAuth0Password({
          email: "user@example.com",
          auth0UserId: "auth0|abc",
          currentPassword: "old-pw",
          newPassword: "new-pw-12345",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "insufficient_scope",
      });
    });
  });
});
