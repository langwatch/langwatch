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

import type * as ServerRedis from "~/server/redis";
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
        findMany: vi.fn().mockResolvedValue([
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
vi.mock("~/server/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerRedis>();
  return { ...actual, connection: mockRedis };
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

describe("POST /api/mcp/authorize — redirect_uri binding", () => {
  beforeEach(() => {
    mockRedis.set.mockClear();
    mockRedis.get.mockClear();
  });

  describe("when redirect_uri exactly matches a registered URI for client_id", () => {
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

  describe("when client_id was never registered via /oauth/register", () => {
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
    it("rejects with 400 before ever looking up a registration", async () => {
      const res = await authorize({ client_id: undefined });
      const json = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(json.error).toContain("client_id");
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});
