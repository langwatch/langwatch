/**
 * @vitest-environment node
 *
 * Regression guard for the MCP OAuth authorization-code exfiltration
 * vulnerability (RFC 6749 §10.6): POST /api/mcp/authorize used to accept ANY
 * redirect_uri, regardless of what the client_id registered via
 * POST /oauth/register. A caller who crafts the authorization request (not
 * necessarily the user who clicks Allow) could point redirect_uri at a
 * domain they control and have the approved code delivered there — PKCE does
 * not defend against this, since the attacker who authored the request also
 * controls the code_challenge/code_verifier pair.
 *
 * The fix: /oauth/register persists client_id -> redirect_uris (see
 * oauthClientRegistry.ts); /mcp/authorize now requires client_id, looks up
 * that registration, and rejects unless redirect_uri is an exact string
 * match against one of the registered URIs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AppLayerApp from "~/server/app-layer/app";
import { app } from "../misc";

const PROJECT_ID = "project_1";
const TEAM_ID = "team_1";
const ORG_ID = "org_1";
const REGISTERED_REDIRECT_URI = "https://registered.example/callback";

const { mockPrisma, mockRedis, SESSION } = vi.hoisted(() => {
  return {
    SESSION: { user: { id: "member_1" }, expires: "1" },
    mockRedis: {
      set: vi.fn().mockResolvedValue("OK"),
      get: vi.fn(),
    },
    mockPrisma: {
      organizationUser: {
        findFirst: vi.fn().mockResolvedValue({ role: "MEMBER" }),
      },
      groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      roleBinding: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { role: "ADMIN", customRoleId: null, scopeType: "TEAM" },
          ]),
      },
      customRole: { findUnique: vi.fn().mockResolvedValue(null) },
      teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
      project: {
        findUnique: vi.fn(({ select }: { select?: { team?: unknown } }) =>
          select?.team
            ? Promise.resolve({
                team: { id: TEAM_ID, organizationId: ORG_ID },
              })
            : Promise.resolve({
                id: PROJECT_ID,
                apiKey: "lw_test_key",
                archivedAt: null as Date | null,
              }),
        ),
      },
    },
  };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(SESSION),
}));
vi.mock("~/server/db", () => ({ prisma: mockPrisma }));
vi.mock("~/server/app-layer/app", async (importOriginal) => {
  const actual = await importOriginal<typeof AppLayerApp>();
  return { ...actual, getApp: () => ({ redis: mockRedis }) };
});
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) =>
    text.startsWith("encrypted:") ? text.slice(10) : text,
}));

function registeredClient(redirectUris = [REGISTERED_REDIRECT_URI]) {
  return JSON.stringify({ redirectUris, clientName: "Legit client" });
}

async function authorize(overrides: Record<string, unknown> = {}) {
  return app.request("http://localhost/api/mcp/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      redirect_uri: REGISTERED_REDIRECT_URI,
      code_challenge: "challenge123",
      code_challenge_method: "S256",
      client_id: "mcp_legit_client",
      state: "xyz",
      ...overrides,
    }),
  });
}

/**
 * `mockClear` does not drain a `mockResolvedValueOnce` queue, so a value a test
 * queued but the route never read would answer the next test's call and make
 * the outcome depend on execution order. Reset drains it, and also drops the
 * declared default, so each default is restated here.
 */
function resetMocks() {
  mockRedis.set.mockReset().mockResolvedValue("OK");
  mockRedis.get.mockReset();
  mockPrisma.roleBinding.findMany
    .mockReset()
    .mockResolvedValue([
      { role: "ADMIN", customRoleId: null, scopeType: "TEAM" },
    ]);
  mockPrisma.organizationUser.findFirst
    .mockReset()
    .mockResolvedValue({ role: "MEMBER" });
}

describe("POST /api/mcp/authorize — redirect_uri binding", () => {
  beforeEach(resetMocks);

  describe("when redirect_uri exactly matches a registered URI for client_id", () => {
    /** @scenario Authorization succeeds when redirect_uri exactly matches the registered client */
    it("issues an authorization code", async () => {
      mockRedis.get.mockResolvedValueOnce(registeredClient());

      const res = await authorize();
      const json = (await res.json()) as { redirect?: string; error?: string };

      expect(res.status).toBe(200);
      expect(json.error).toBeUndefined();
      expect(json.redirect).toContain("code=");
    });
  });

  describe("when redirect_uri does not match any URI registered for client_id (the exfiltration attempt)", () => {
    /** @scenario Authorization is rejected when redirect_uri does not match the registered client */
    it("rejects with 400 and never mints an authorization code", async () => {
      // client_id genuinely registered — just with a DIFFERENT redirect_uri
      // than the one this request supplies. This is the exact reported
      // exploit: register with a legitimate URI, then authorize against an
      // attacker-controlled one.
      mockRedis.get.mockResolvedValueOnce(registeredClient());

      const res = await authorize({
        redirect_uri: "https://attacker.invalid/callback",
      });
      const json = (await res.json()) as { redirect?: string; error?: string };

      expect(res.status).toBe(400);
      expect(json.error).toContain("redirect_uri does not match");
      expect(json.redirect).toBeUndefined();
      // No auth code was ever written to Redis for this request.
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe.each([
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://app.langwatch.ai/00000000-0000-4000-8000-000000000000",
    "filesystem:https://app.langwatch.ai/temporary/x",
  ])("when redirect_uri is %s", (redirect_uri) => {
    /** @scenario Authorization is rejected when redirect_uri uses a scheme the browser executes */
    it("rejects with 400 and never mints an authorization code", async () => {
      // No registration is queued on purpose: the scheme is refused before the
      // client registry is ever consulted, which is what keeps a client that
      // registered such a URI from being able to use it.
      const res = await authorize({ redirect_uri });
      const json = (await res.json()) as { redirect?: string; error?: string };

      expect(res.status).toBe(400);
      expect(json.error).toContain("disallowed scheme");
      expect(json.redirect).toBeUndefined();
      expect(mockRedis.set).not.toHaveBeenCalled();
      // Proves the ordering the comment above relies on.
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe("when client_id was never registered via /oauth/register", () => {
    /** @scenario Authorization is rejected for an unregistered client_id */
    it("rejects with 400 and never mints an authorization code", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const res = await authorize({ client_id: "mcp_never_registered" });
      const json = (await res.json()) as { redirect?: string; error?: string };

      expect(res.status).toBe(400);
      expect(json.error).toBe("Unknown or unregistered client_id");
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("when client_id is omitted", () => {
    /** @scenario Authorization is rejected when client_id is missing */
    it("rejects with 400 before ever looking up a registration", async () => {
      const res = await authorize({ client_id: undefined });
      const json = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(json.error).toContain("client_id");
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});

/**
 * RFC 6749 §4.1.2.1: once the client_id is known and the presented
 * redirect_uri is one it registered, an authorization failure has to travel
 * back to that redirect_uri as an OAuth error. The advertised authorize
 * endpoint is a page in this app, so a failure rendered only as a toast here
 * leaves the client's popup waiting forever with nothing to report.
 */
describe("POST /api/mcp/authorize — where failures are reported", () => {
  beforeEach(resetMocks);

  describe("when the client is verified but the request has no code challenge", () => {
    /** @scenario A consent failure a client can be told about is redirected back to the client */
    it("sends the browser back to the registered redirect URI with the OAuth error", async () => {
      mockRedis.get.mockResolvedValueOnce(registeredClient());

      const res = await authorize({ code_challenge: undefined });
      const json = (await res.json()) as {
        error?: string;
        redirect?: string;
      };

      expect(res.status).toBe(400);
      expect(json.error).toBe("invalid_request");
      const redirect = new URL(json.redirect ?? "");
      expect(redirect.origin + redirect.pathname).toBe(REGISTERED_REDIRECT_URI);
      expect(redirect.searchParams.get("error")).toBe("invalid_request");
      expect(redirect.searchParams.get("error_description")).toContain(
        "code_challenge",
      );
      expect(redirect.searchParams.get("state")).toBe("xyz");
      expect(redirect.searchParams.get("code")).toBeNull();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("when the client is verified but asks for a PKCE method we do not support", () => {
    /** @scenario A code challenge method other than S256 is refused at the authorization request */
    it("refuses it rather than minting a code that can never be redeemed", async () => {
      mockRedis.get.mockResolvedValueOnce(registeredClient());

      const res = await authorize({ code_challenge_method: "plain" });
      const json = (await res.json()) as { error?: string; redirect?: string };

      expect(res.status).toBe(400);
      expect(json.error).toBe("invalid_request");
      const redirect = new URL(json.redirect ?? "");
      expect(redirect.searchParams.get("error_description")).toContain("S256");
      expect(redirect.searchParams.get("code")).toBeNull();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("when the client is verified but the user cannot reach the project", () => {
    /** @scenario A project the user cannot reach is reported to the client as access denied */
    it("sends the browser back to the registered redirect URI as access denied", async () => {
      mockRedis.get.mockResolvedValueOnce(registeredClient());
      mockPrisma.roleBinding.findMany.mockResolvedValueOnce([]);
      mockPrisma.organizationUser.findFirst.mockResolvedValueOnce(null);

      const res = await authorize();
      const json = (await res.json()) as { error?: string; redirect?: string };

      expect(res.status).toBe(403);
      expect(json.error).toBe("access_denied");
      const redirect = new URL(json.redirect ?? "");
      expect(redirect.searchParams.get("error")).toBe("access_denied");
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("when the failure cannot be attributed to a registered client", () => {
    /** @scenario A consent failure that cannot be attributed to a client stays on the LangWatch page */
    it("offers no redirect back to the caller", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const res = await authorize({ client_id: "mcp_never_registered" });
      const json = (await res.json()) as { error?: string; redirect?: string };

      expect(res.status).toBe(400);
      expect(json.redirect).toBeUndefined();
      expect(json.error).toBe("Unknown or unregistered client_id");
    });
  });
});
