/**
 * @vitest-environment node
 *
 * Pins the security + correctness invariants of the GitHub credentials service:
 *  - returns null cleanly when GitHub isn't configured on the instance
 *  - returns null when the user hasn't connected (no row)
 *  - persists the ROTATED refresh token after a refresh (single-use grants
 *    would otherwise be burned by a second chat)
 *  - on revoked / expired refresh, deletes the row so the next chat hits
 *    the connect card instead of looping on a dead credential
 *  - keeps the row on a transient refresh failure (a GitHub blip must not
 *    force re-OAuth)
 *  - a cached access token short-circuits the GitHub call entirely
 *  - fails closed (no delete, no GitHub call) when there is no distributed lock
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GithubOAuthClient } from "../../clients/github/github-oauth.client";
import type {
  LangyGithubCredentialRow,
  LangyUserGithubCredentialsRepository,
} from "../repositories/langy-user-github-credentials.repository";

const decrypt = vi.fn((v: string) => v.replace(/^enc\(|\)$/g, ""));
const encrypt = vi.fn((v: string) => `enc(${v})`);
vi.mock("~/utils/encryption", () => ({
  decrypt: (v: string) => decrypt(v),
  encrypt: (v: string) => encrypt(v),
}));

// A minimum-viable Redis satisfying acquireLock (SET NX EX → "OK"),
// redisGet (cold cache), redisSetEx, redisDel. The no-redis fail-closed path
// has its own suite that re-mocks with `connection: null`.
const redisGet = vi.fn().mockResolvedValue(null);
const redisSet = vi.fn().mockResolvedValue("OK");
const redisDel = vi.fn().mockResolvedValue(1);
vi.mock("~/server/redis", () => ({
  get connection() {
    return { get: redisGet, set: redisSet, del: redisDel };
  },
}));

function makeRepo(
  overrides: Partial<LangyUserGithubCredentialsRepository> = {},
): {
  repo: LangyUserGithubCredentialsRepository;
  findCredential: ReturnType<typeof vi.fn>;
  updateRefreshToken: ReturnType<typeof vi.fn>;
  deleteByUserOrg: ReturnType<typeof vi.fn>;
} {
  const findCredential = vi.fn<[], Promise<LangyGithubCredentialRow | null>>();
  const updateRefreshToken = vi.fn().mockResolvedValue(undefined);
  const deleteByUserOrg = vi.fn().mockResolvedValue(1);
  const repo = {
    findCredential,
    updateRefreshToken,
    deleteByUserOrg,
    findConnection: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    isOrganizationMember: vi.fn().mockResolvedValue(true),
    findFirstAdminUserId: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as LangyUserGithubCredentialsRepository;
  return { repo, findCredential, updateRefreshToken, deleteByUserOrg };
}

function makeClient(
  overrides: Partial<GithubOAuthClient> = {},
): GithubOAuthClient {
  return {
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
    fetchUser: vi.fn(),
    revokeGrant: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GithubOAuthClient;
}

async function importService() {
  const { LangyGithubCredentialsService } = await import(
    "../langy-github-credentials.service"
  );
  return LangyGithubCredentialsService;
}

beforeEach(() => {
  vi.clearAllMocks();
  redisGet.mockResolvedValue(null);
  redisSet.mockResolvedValue("OK");
  redisDel.mockResolvedValue(1);
});

describe("LangyGithubCredentialsService.getAccessToken", () => {
  describe("when the GitHub App isn't configured on this instance", () => {
    it("returns null without hitting the repo or GitHub", async () => {
      const Service = await importService();
      const { repo, findCredential } = makeRepo();
      const refreshToken = vi.fn();
      const service = new Service(repo, makeClient({ refreshToken }), false);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(findCredential).not.toHaveBeenCalled();
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when the user hasn't connected GitHub", () => {
    it("returns null without calling GitHub", async () => {
      const Service = await importService();
      const { repo, findCredential } = makeRepo();
      findCredential.mockResolvedValue(null);
      const refreshToken = vi.fn();
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when a cached access token is present", () => {
    it("returns it without refreshing", async () => {
      const Service = await importService();
      const { repo, findCredential } = makeRepo();
      findCredential.mockResolvedValue({
        encryptedRefreshToken: "enc(rt)",
        githubLogin: "tester",
      });
      redisGet.mockResolvedValue("cached-at");
      const refreshToken = vi.fn();
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toEqual({ token: "cached-at", githubLogin: "tester" });
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when the refresh round-trip succeeds", () => {
    it("persists the rotated refresh token and returns the new access token", async () => {
      const Service = await importService();
      const { repo, findCredential, updateRefreshToken, deleteByUserOrg } =
        makeRepo();
      findCredential.mockResolvedValue({
        encryptedRefreshToken: "enc(old-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("old-refresh");
      const refreshToken = vi.fn().mockResolvedValue({
        ok: true,
        tokens: {
          accessToken: "new-at",
          refreshToken: "new-refresh",
          expiresIn: 28800,
        },
      });
      const service = new Service(repo, makeClient({ refreshToken }), true);

      const result = await service.getAccessToken({
        userId: "u1",
        organizationId: "org1",
      });

      expect(result).toEqual({ token: "new-at", githubLogin: "tester" });
      expect(updateRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ encryptedRefreshToken: "enc(new-refresh)" }),
      );
      expect(deleteByUserOrg).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub reports a dead grant on refresh", () => {
    it("deletes the row so the next chat surfaces the connect card", async () => {
      const Service = await importService();
      const { repo, findCredential, updateRefreshToken, deleteByUserOrg } =
        makeRepo();
      findCredential.mockResolvedValue({
        encryptedRefreshToken: "enc(dead-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("dead-refresh");
      const refreshToken = vi
        .fn()
        .mockResolvedValue({ ok: false, grantDead: true });
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(deleteByUserOrg).toHaveBeenCalledWith({
        userId: "u1",
        organizationId: "org1",
      });
      expect(updateRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when GitHub is transiently down during refresh", () => {
    it("returns null but KEEPS the row — a blip must not force re-OAuth", async () => {
      const Service = await importService();
      const { repo, findCredential, updateRefreshToken, deleteByUserOrg } =
        makeRepo();
      findCredential.mockResolvedValue({
        encryptedRefreshToken: "enc(good-refresh)",
        githubLogin: "tester",
      });
      decrypt.mockReturnValue("good-refresh");
      const refreshToken = vi
        .fn()
        .mockResolvedValue({ ok: false, grantDead: false });
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(deleteByUserOrg).not.toHaveBeenCalled();
      expect(updateRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when the stored refresh token can't be decrypted", () => {
    it("deletes the row and never reaches GitHub", async () => {
      const Service = await importService();
      const { repo, findCredential, deleteByUserOrg } = makeRepo();
      findCredential.mockResolvedValue({
        encryptedRefreshToken: "garbage",
        githubLogin: "tester",
      });
      decrypt.mockImplementation(() => {
        throw new Error("invalid auth tag");
      });
      const refreshToken = vi.fn();
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(deleteByUserOrg).toHaveBeenCalled();
      expect(refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("when the row vanishes between the pre-lock and locked reads", () => {
    it("returns null without refreshing (disconnect raced the mint)", async () => {
      const Service = await importService();
      const { repo, findCredential, deleteByUserOrg } = makeRepo();
      findCredential
        .mockResolvedValueOnce({
          encryptedRefreshToken: "enc(old)",
          githubLogin: "tester",
        })
        .mockResolvedValueOnce(null);
      const refreshToken = vi.fn();
      const service = new Service(repo, makeClient({ refreshToken }), true);

      expect(
        await service.getAccessToken({ userId: "u1", organizationId: "org1" }),
      ).toBeNull();
      expect(refreshToken).not.toHaveBeenCalled();
      expect(deleteByUserOrg).not.toHaveBeenCalled();
    });
  });
});

// Dedicated suite for the no-redis fail-closed branch: without a distributed
// lock, concurrent callers race the single-use refresh token; failing closed
// (null, no delete, no GitHub call) is the least-bad outcome.
describe("LangyGithubCredentialsService without a distributed lock (Redis down)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("~/server/redis", () => ({ connection: null }));
    vi.doMock("~/utils/encryption", () => ({
      decrypt: (v: string) => `dec(${v})`,
      encrypt: (v: string) => `enc(${v})`,
    }));
  });

  it("returns null without calling GitHub or deleting the row", async () => {
    const { LangyGithubCredentialsService } = await import(
      "../langy-github-credentials.service"
    );
    const findCredential = vi.fn().mockResolvedValue({
      encryptedRefreshToken: "enc(refresh-old)",
      githubLogin: "tester",
    });
    const updateRefreshToken = vi.fn();
    const deleteByUserOrg = vi.fn();
    const refreshToken = vi.fn();
    const service = new LangyGithubCredentialsService(
      {
        findCredential,
        updateRefreshToken,
        deleteByUserOrg,
        findConnection: vi.fn(),
        upsert: vi.fn(),
        isOrganizationMember: vi.fn(),
        findFirstAdminUserId: vi.fn(),
      } as never,
      { refreshToken } as never,
      true,
    );

    const result = await service.getAccessToken({
      userId: "u1",
      organizationId: "org1",
    });

    expect(result).toBeNull();
    expect(refreshToken).not.toHaveBeenCalled();
    expect(updateRefreshToken).not.toHaveBeenCalled();
    expect(deleteByUserOrg).not.toHaveBeenCalled();
  });
});
