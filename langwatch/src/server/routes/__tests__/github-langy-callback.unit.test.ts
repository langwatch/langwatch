/**
 * @vitest-environment node
 *
 * Locks the security-critical bits of the GitHub OAuth callback:
 *   - rejects unsigned or expired state without touching GitHub or the DB
 *   - rejects when the session user doesn't match the state's user
 *   - on success: persists the ENCRYPTED refresh token (never plaintext),
 *     audits the connect, and (popup mode) returns an HTML shim that
 *     postMessage's the opener and closes the window
 *
 * Token exchange and /user are mocked at the fetch boundary; the DB is mocked
 * at the Prisma boundary. Hono is exercised end-to-end through `app.request`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SIGNING_KEY = "x".repeat(64);
process.env.CREDENTIALS_SECRET = TEST_SIGNING_KEY;
process.env.GITHUB_LANGY_CLIENT_ID = "test-client-id";
process.env.GITHUB_LANGY_CLIENT_SECRET = "test-client-secret";

const getServerAuthSession = vi.fn();
const upsert = vi.fn();
const auditLog = vi.fn();
const encrypt = vi.fn((v: string) => `enc(${v})`);

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/db", () => ({
  prisma: {
    userGitHubCredential: {
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));
vi.mock("~/server/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/utils/encryption", () => ({
  encrypt: (v: string) => encrypt(v),
}));

async function callCallback(url: string) {
  const { app } = await import("../github-langy");
  return app.request(url, { method: "GET" });
}

async function makeState(
  payload: Partial<{
    userId: string;
    organizationId: string;
    mode: "popup" | "redirect";
    returnTo: string;
    issuedAt: number;
  }> = {},
) {
  const { signGithubOauthState } = await import(
    "~/server/services/langy/githubOauthState"
  );
  return signGithubOauthState(
    {
      userId: payload.userId ?? "u1",
      organizationId: payload.organizationId ?? "org1",
      mode: payload.mode ?? "popup",
      returnTo: payload.returnTo ?? "/settings/integrations#github",
      issuedAt: payload.issuedAt ?? Date.now(),
      nonce: "n",
    },
    TEST_SIGNING_KEY,
  );
}

function mockGithubFetch({
  exchange,
  user,
}: {
  exchange?: () => Response | Promise<Response>;
  user?: () => Response | Promise<Response>;
} = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("github.com/login/oauth/access_token")) {
      return (
        exchange?.() ??
        new Response(
          JSON.stringify({
            access_token: "at-123",
            refresh_token: "rt-abc",
            expires_in: 28800,
            scope: "repo",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("api.github.com/user")) {
      return (
        user?.() ??
        new Response(JSON.stringify({ id: 999, login: "tester" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/github-langy/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
  });

  describe("when state is missing or malformed", () => {
    it("returns 400 without touching GitHub or the DB", async () => {
      mockGithubFetch();
      const res = await callCallback(
        "http://localhost/api/github-langy/callback?code=c",
      );
      expect(res.status).toBe(400);
      expect(upsert).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  describe("when state is older than the TTL", () => {
    it("rejects without exchanging the code", async () => {
      const stale = await makeState({
        issuedAt: Date.now() - 11 * 60 * 1000,
      });
      const fetchMock = mockGithubFetch();
      const res = await callCallback(
        `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(stale)}`,
      );
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("when the session user doesn't match the state user", () => {
    it("rejects after state passes signature check", async () => {
      const state = await makeState({ userId: "u1" });
      getServerAuthSession.mockResolvedValue({ user: { id: "someone-else" } });
      mockGithubFetch();
      const res = await callCallback(
        `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(401);
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub's token exchange fails", () => {
    it("does not persist anything and surfaces an error to the popup", async () => {
      const state = await makeState({ mode: "popup" });
      mockGithubFetch({
        exchange: () =>
          new Response(
            JSON.stringify({ error: "bad_verification_code" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      });
      const res = await callCallback(
        `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
      );
      expect(upsert).not.toHaveBeenCalled();
      const html = await res.text();
      expect(html).toContain("langy-github-error");
    });
  });

  describe("when the round-trip succeeds in popup mode", () => {
    it("upserts with the encrypted refresh token and returns a postMessage shim", async () => {
      const state = await makeState({ mode: "popup" });
      mockGithubFetch();
      const res = await callCallback(
        `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
      );

      expect(res.status).toBe(200);

      // Critically: the row gets the encrypted value, never the raw token.
      expect(upsert).toHaveBeenCalledOnce();
      const call = upsert.mock.calls[0]?.[0] as {
        create: { encryptedRefreshToken: string };
        update: { encryptedRefreshToken: string };
      };
      expect(call.create.encryptedRefreshToken).toBe("enc(rt-abc)");
      expect(call.update.encryptedRefreshToken).toBe("enc(rt-abc)");
      expect(encrypt).toHaveBeenCalledWith("rt-abc");

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "langy.github.connect" }),
      );

      const html = await res.text();
      expect(html).toContain("langy-github-connected");
      expect(html).toContain("@tester");
    });
  });

  describe("when the round-trip succeeds in redirect mode", () => {
    it("302s back to the safe returnTo", async () => {
      const state = await makeState({
        mode: "redirect",
        returnTo: "/settings/integrations#github",
      });
      mockGithubFetch();
      const res = await callCallback(
        `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "/settings/integrations#github",
      );
    });
  });
});
