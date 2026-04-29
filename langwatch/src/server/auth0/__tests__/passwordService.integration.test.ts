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
});

describe("updateUserPassword", () => {
  describe("when the Management API returns 204 OK", () => {
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

describe("changeAuth0Password", () => {
  describe("given valid Management API credentials", () => {
    it("gets a management token and PATCHes the user's password", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          return { status: 200, body: { access_token: "mgmt-tok" } };
        }
        if (req.method === "PATCH" && req.path.startsWith("/api/v2/users/")) {
          return { status: 200, body: {} };
        }
        return { status: 404 };
      };

      await changeAuth0Password({
        auth0UserId: "auth0|abc",
        newPassword: "new-pw-12345",
      });

      expect(captured).toHaveLength(2);
      expect(
        (captured[0]?.body as { grant_type?: string }).grant_type,
      ).toBe("client_credentials");
      expect(captured[1]?.method).toBe("PATCH");
      expect(captured[1]?.headers.authorization).toBe("Bearer mgmt-tok");
      expect(captured[1]?.body).toEqual({
        password: "new-pw-12345",
        connection: "Username-Password-Authentication",
      });
    });
  });

  describe("given the Management API rejects with insufficient_scope", () => {
    it("propagates Auth0ApiError so the caller can show a config error", async () => {
      handler = (req) => {
        if (req.method === "POST" && req.path === "/oauth/token") {
          return { status: 200, body: { access_token: "mgmt-tok" } };
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
          auth0UserId: "auth0|abc",
          newPassword: "new-pw-12345",
        }),
      ).rejects.toMatchObject({
        name: "Auth0ApiError",
        code: "insufficient_scope",
      });
    });
  });
});
