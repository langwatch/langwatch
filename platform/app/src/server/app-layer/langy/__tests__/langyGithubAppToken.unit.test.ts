/**
 * @vitest-environment node
 *
 * Pins the security + correctness invariants of the GitHub App token service:
 *   - the app JWT is RS256, backdated, ≤10min, issued by the app id
 *   - installation tokens are minted with a scoped repository_ids + minimal
 *     permissions, and cached per (installation, scope)
 *   - a differently-scoped mint gets a different cache key (and thus a fresh
 *     mint), while a repeat of the same scope is served from cache
 *   - the scope key is stable + order-independent
 */
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeRepoScopeKey,
  LANGY_INSTALLATION_PERMISSIONS,
  LangyGithubAppTokenService,
  type RedisLike,
} from "../langyGithubAppToken";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function fakeRedis(): RedisLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async set(k, v, ...args) {
      // NX semantics for the lock path: refuse if present.
      if (args.includes("NX") && store.has(k)) return null;
      store.set(k, String(v));
      return "OK";
    },
    async del(k) {
      return store.delete(k) ? 1 : 0;
    },
    // Implements the compare-and-delete release script: eval(script, 1, key, token).
    async eval(_script, _numKeys, key, token) {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computeRepoScopeKey", () => {
  it("is stable and independent of repository id order", () => {
    const a = computeRepoScopeKey({ repositoryIds: ["1", "2", "3"] });
    const b = computeRepoScopeKey({ repositoryIds: ["3", "1", "2"] });
    expect(a).toBe(b);
  });

  it("differs between the full-installation scope and a single repo", () => {
    const all = computeRepoScopeKey({});
    const one = computeRepoScopeKey({ repositoryIds: ["42"] });
    expect(all).not.toBe(one);
  });
});

describe("signAppJwt", () => {
  it("signs an RS256 JWT issued by the app id, backdated, ≤10 minutes", () => {
    const svc = new LangyGithubAppTokenService("app-123", privateKey, null);
    const now = 1_000_000;
    const token = svc.signAppJwt(now);
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      // Verify relative to the same fixed clock we signed at (the token's iat/exp
      // are anchored to `now`, not the wall clock).
      clockTimestamp: now,
    }) as jwt.JwtPayload;
    expect(decoded.iss).toBe("app-123");
    expect(decoded.iat).toBe(now - 30);
    expect(decoded.exp).toBeLessThanOrEqual(now + 600);
    expect(decoded.exp).toBeGreaterThan(now);
  });
});

describe("mintInstallationToken", () => {
  describe("when scoped to a single repository", () => {
    it("POSTs repository_ids + minimal permissions and caches the token", async () => {
      const redis = fakeRedis();
      const svc = new LangyGithubAppTokenService("app-1", privateKey, redis);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({
            token: "ghs_minted",
            expires_at: "2030-01-01T00:00:00Z",
            repository_selection: "selected",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await svc.mintInstallationToken({
        installationId: "99",
        repositoryIds: ["42"],
      });

      expect(result.token).toBe("ghs_minted");
      // Exactly one GitHub call (the mint) and the request scopes the token.
      const mintCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/access_tokens"),
      );
      expect(mintCall).toBeDefined();
      const body = JSON.parse(String(mintCall?.[1]?.body));
      expect(body.repository_ids).toEqual([42]);
      expect(body.permissions).toEqual(LANGY_INSTALLATION_PERMISSIONS);

      // Cached under (installation, scope).
      const scope = computeRepoScopeKey({ repositoryIds: ["42"] });
      expect(redis.store.get(`langy:gh:insttoken:99:${scope}`)).toBe(
        "ghs_minted",
      );
    });
  });

  describe("when the same scope is requested twice", () => {
    it("serves the second from cache without a second mint", async () => {
      const redis = fakeRedis();
      const svc = new LangyGithubAppTokenService("app-1", privateKey, redis);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({ token: "ghs_1", expires_at: "2030-01-01T00:00:00Z" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await svc.mintInstallationToken({ installationId: "5" });
      await svc.mintInstallationToken({ installationId: "5" });

      const mintCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/access_tokens"),
      );
      expect(mintCalls).toHaveLength(1);
    });
  });

  describe("when a different scope is requested", () => {
    it("mints again because the cache key differs", async () => {
      const redis = fakeRedis();
      const svc = new LangyGithubAppTokenService("app-1", privateKey, redis);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({ token: "ghs_x", expires_at: "2030-01-01T00:00:00Z" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await svc.mintInstallationToken({ installationId: "5" });
      await svc.mintInstallationToken({
        installationId: "5",
        repositoryIds: ["7"],
      });

      const mintCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/access_tokens"),
      );
      expect(mintCalls).toHaveLength(2);
    });
  });

  describe("when GitHub rejects the mint", () => {
    it("throws without caching", async () => {
      const redis = fakeRedis();
      const svc = new LangyGithubAppTokenService("app-1", privateKey, redis);
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => new Response("nope", { status: 403 })),
      );
      await expect(
        svc.mintInstallationToken({ installationId: "5" }),
      ).rejects.toThrow();
      expect(redis.store.size).toBe(0);
    });
  });
});

describe("configured", () => {
  it("is false without a private key, true with app id + key", () => {
    expect(new LangyGithubAppTokenService("app", "", null).configured).toBe(
      false,
    );
    expect(
      new LangyGithubAppTokenService("app", privateKey, null).configured,
    ).toBe(true);
  });
});
