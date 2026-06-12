/**
 * @vitest-environment node
 *
 * Pins the security + correctness invariants of langyGithubToken:
 *  - returns null cleanly when GitHub isn't configured on the instance
 *  - returns null when the user hasn't connected (no row)
 *  - persists the ROTATED refresh token after a refresh (single-use grants
 *    would otherwise be burned by a second chat)
 *  - on revoked / expired refresh, deletes the row so the next chat hits
 *    the connect card instead of looping on a dead credential
 *  - cached access token short-circuits the GitHub call entirely
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORIG_ENV = { ...process.env };

const findUnique = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();
const decrypt = vi.fn();
const encrypt = vi.fn((v: string) => `enc(${v})`);

vi.mock("~/utils/encryption", () => ({
  decrypt: (v: string) => decrypt(v),
  encrypt: (v: string) => encrypt(v),
}));
// Redis layer off — the service's "no redis" path returns null on get and
// no-ops on set, which is what we want under unit test (each call exercises
// the real refresh path instead of a sticky cache).
vi.mock("~/server/redis", () => ({ connection: null }));

const prisma = {
  userGitHubCredential: {
    findUnique: (...a: unknown[]) => findUnique(...a),
    update: (...a: unknown[]) => update(...a),
    deleteMany: (...a: unknown[]) => deleteMany(...a),
  },
};

async function callMint() {
  const { getGithubTokenForUser } = await import("../langyGithubToken");
  return getGithubTokenForUser({
    prisma: prisma as never,
    userId: "u1",
    organizationId: "org1",
  });
}

function mockRefresh(
  body: Record<string, unknown>,
  status = 200,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
  process.env.GITHUB_LANGY_CLIENT_ID = "id";
  process.env.GITHUB_LANGY_CLIENT_SECRET = "secret";
  vi.resetModules();
});

describe("getGithubTokenForUser", () => {
  describe("when the GitHub App isn't configured on this instance", () => {
    it("returns null without hitting the DB or GitHub", async () => {
      delete process.env.GITHUB_LANGY_CLIENT_ID;
      delete process.env.GITHUB_LANGY_CLIENT_SECRET;
      const fetchMock = mockRefresh({});
      expect(await callMint()).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("when the user hasn't connected GitHub", () => {
    it("returns null without calling GitHub", async () => {
      findUnique.mockResolvedValue(null);
      const fetchMock = mockRefresh({});
      expect(await callMint()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("when the refresh round-trip succeeds", () => {
    it("persists the rotated refresh token and returns the new access token", async () => {
      findUnique.mockResolvedValue({
        encryptedRefreshToken: "enc(old-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("old-refresh");
      mockRefresh({
        access_token: "new-at",
        refresh_token: "new-refresh",
        expires_in: 28800,
      });

      const result = await callMint();

      expect(result).toEqual({ token: "new-at", githubLogin: "tester" });
      // The rotated refresh token MUST be encrypted and written, otherwise
      // the next refresh re-uses the now-burned old token.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { encryptedRefreshToken: "enc(new-refresh)" },
        }),
      );
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub returns an error_description for refresh", () => {
    it("deletes the row so the next chat surfaces the connect card", async () => {
      findUnique.mockResolvedValue({
        encryptedRefreshToken: "enc(dead-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("dead-refresh");
      mockRefresh({ error: "bad_refresh_token" }, 400);

      expect(await callMint()).toBeNull();

      expect(deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1", organizationId: "org1" },
      });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub is transiently down (5xx) during refresh", () => {
    it("returns null but KEEPS the row — a GitHub blip must not force re-OAuth", async () => {
      findUnique.mockResolvedValue({
        encryptedRefreshToken: "enc(good-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("good-refresh");
      mockRefresh({}, 503);

      expect(await callMint()).toBeNull();
      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the refresh fetch throws (network error / timeout)", () => {
    it("returns null and keeps the row", async () => {
      findUnique.mockResolvedValue({
        encryptedRefreshToken: "enc(good-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("good-refresh");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNRESET");
        }),
      );

      expect(await callMint()).toBeNull();
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the row vanishes between the pre-lock read and the locked re-read", () => {
    it("returns null without refreshing (disconnect raced the mint)", async () => {
      findUnique
        .mockResolvedValueOnce({
          encryptedRefreshToken: "enc(old)",
          githubLogin: "tester",
        })
        .mockResolvedValueOnce(null);
      const fetchMock = mockRefresh({});

      expect(await callMint()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the stored refresh token can't be decrypted", () => {
    it("deletes the row and returns null", async () => {
      findUnique.mockResolvedValue({
        encryptedRefreshToken: "garbage",
        githubLogin: "tester",
      });
      decrypt.mockImplementation(() => {
        throw new Error("invalid auth tag");
      });
      const fetchMock = mockRefresh({});

      expect(await callMint()).toBeNull();
      expect(deleteMany).toHaveBeenCalled();
      // We never reach the network on an unreadable refresh token.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
