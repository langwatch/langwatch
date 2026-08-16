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
  GITHUB_READ_PULL_PERMISSIONS,
  GITHUB_WRITE_PERMISSIONS,
  GithubAppTokenService,
  GithubInstallationNotFoundError,
  GithubRateLimitedError,
  type RedisLike,
} from "../githubAppToken";

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
    // Takes the trailing arguments as the rest parameter RedisLike declares,
    // rather than naming them, so the fake keeps the real client's shape.
    async eval(_script, _numKeys, ...args) {
      const [key, token] = args;
      if (key && store.get(key) === token) {
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
    const svc = new GithubAppTokenService("app-123", privateKey, null);
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
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
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
      expect(body.permissions).toEqual(GITHUB_WRITE_PERMISSIONS);

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
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({
            token: "ghs_1",
            expires_at: "2030-01-01T00:00:00Z",
          }),
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
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({
            token: "ghs_x",
            expires_at: "2030-01-01T00:00:00Z",
          }),
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
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
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

  describe("when GitHub confirms the installation no longer exists (404)", () => {
    it("throws GithubInstallationNotFoundError, distinct from other failures", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(
          async () => new Response("not found", { status: 404 }),
        ),
      );
      await expect(
        svc.mintInstallationToken({ installationId: "dead-inst" }),
      ).rejects.toBeInstanceOf(GithubInstallationNotFoundError);
      expect(redis.store.size).toBe(0);
    });
  });

  describe("when a token is cached but the installation was uninstalled since it was minted", () => {
    it("rejects with GithubInstallationNotFoundError instead of serving the stale cached token", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      // Simulate an already-warm cache entry from an earlier, successful mint —
      // the exact state a missed deletion webhook leaves behind for up to the
      // token's ~50min TTL.
      redis.store.set(`langy:gh:insttoken:dead-inst:${scope}`, "ghs_stale");
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(
          async () => new Response("not found", { status: 404 }),
        ),
      );

      await expect(
        svc.mintInstallationToken({ installationId: "dead-inst" }),
      ).rejects.toBeInstanceOf(GithubInstallationNotFoundError);
    });
  });

  describe("when a token is cached and the liveness probe itself fails transiently", () => {
    it("still serves the cached token (fails open, not closed)", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      redis.store.set(`langy:gh:insttoken:5:${scope}`, "ghs_cached");
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => new Response("boom", { status: 500 })),
      );

      const result = await svc.mintInstallationToken({ installationId: "5" });

      expect(result.token).toBe("ghs_cached");
    });
  });

  describe("when many concurrent calls hit a cached token for the same installation", () => {
    it("probes GitHub liveness only once, not once per caller", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      redis.store.set(`langy:gh:insttoken:5:${scope}`, "ghs_cached");
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({ id: 5, account: { login: "acme", type: "User" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          svc.mintInstallationToken({ installationId: "5" }),
        ),
      );

      expect(results.every((r) => r.token === "ghs_cached")).toBe(true);
      const livenessCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/app/installations/5"),
      );
      expect(livenessCalls).toHaveLength(1);
    });
  });

  describe("when the same installation is checked across multiple sequential turns", () => {
    it("probes GitHub once, then trusts the liveness marker for later cached calls", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      redis.store.set(`langy:gh:insttoken:5:${scope}`, "ghs_cached");
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({ id: 5, account: { login: "acme", type: "User" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      // Three separate turns, one after another — no overlap, so the
      // stampede lock alone would not prevent a probe on every single one.
      await svc.mintInstallationToken({ installationId: "5" });
      await svc.mintInstallationToken({ installationId: "5" });
      await svc.mintInstallationToken({ installationId: "5" });

      const livenessCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/app/installations/5"),
      );
      expect(livenessCalls).toHaveLength(1);
    });
  });

  describe("when the liveness marker has expired", () => {
    it("probes GitHub again on the next cached call", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      redis.store.set(`langy:gh:insttoken:5:${scope}`, "ghs_cached");
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({ id: 5, account: { login: "acme", type: "User" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await svc.mintInstallationToken({ installationId: "5" });
      redis.store.delete("langy:gh:insttoken:5:liveness"); // simulate TTL expiry
      await svc.mintInstallationToken({ installationId: "5" });

      const livenessCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/app/installations/5"),
      );
      expect(livenessCalls).toHaveLength(2);
    });
  });

  describe("when a liveness probe fails transiently", () => {
    it("backs off instead of probing again on the very next cached call", async () => {
      const redis = fakeRedis();
      const svc = new GithubAppTokenService("app-1", privateKey, redis);
      const scope = computeRepoScopeKey({});
      redis.store.set(`langy:gh:insttoken:5:${scope}`, "ghs_cached");
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response("boom", { status: 500 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const first = await svc.mintInstallationToken({ installationId: "5" });
      const second = await svc.mintInstallationToken({ installationId: "5" });

      expect(first.token).toBe("ghs_cached");
      expect(second.token).toBe("ghs_cached");
      const livenessCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/app/installations/5"),
      );
      expect(livenessCalls).toHaveLength(1);
    });
  });
});

describe("listPullRequestsForHead", () => {
  describe("when asking GitHub about a branch", () => {
    /** @scenario "Pull request reads mint a read-only token" */
    it("mints a repository-scoped token that can only read pull requests", async () => {
      const svc = new GithubAppTokenService("app-1", privateKey, fakeRedis());
      const fetchMock = vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("/access_tokens")) {
          return new Response(
            JSON.stringify({
              token: "ghs_read",
              expires_at: "2030-01-01T00:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      await svc.listPullRequestsForHead({
        installationId: "99",
        repositoryId: "42",
        owner: "acme",
        repo: "service-x",
        branch: "feature/thing",
      });

      const mintCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/access_tokens"),
      );
      const body = JSON.parse(String(mintCall?.[1]?.body));
      expect(body.permissions).toEqual(GITHUB_READ_PULL_PERMISSIONS);
      expect(body.permissions).not.toHaveProperty("contents");
      expect(body.repository_ids).toEqual([42]);
    });

    it("asks for the branch's pull requests in any state", async () => {
      const svc = new GithubAppTokenService("app-1", privateKey, fakeRedis());
      const fetchMock = vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("/access_tokens")) {
          return new Response(
            JSON.stringify({ token: "ghs_read", expires_at: "" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([
            {
              number: 7,
              html_url: "https://github.com/acme/service-x/pull/7",
              title: "Add the thing",
              state: "closed",
              draft: false,
              merged_at: "2026-01-02T00:00:00Z",
              closed_at: "2026-01-02T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
              user: { login: "octocat" },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const pulls = await svc.listPullRequestsForHead({
        installationId: "99",
        repositoryId: "42",
        owner: "acme",
        repo: "service-x",
        branch: "feature/thing",
      });

      const readCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/pulls"),
      );
      expect(String(readCall?.[0])).toContain("head=acme%3Afeature%2Fthing");
      expect(String(readCall?.[0])).toContain("state=all");
      expect(pulls).toEqual([
        {
          number: 7,
          htmlUrl: "https://github.com/acme/service-x/pull/7",
          title: "Add the thing",
          state: "closed",
          draft: false,
          mergedAt: "2026-01-02T00:00:00Z",
          closedAt: "2026-01-02T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          authorLogin: "octocat",
        },
      ]);
    });
  });

  describe("when GitHub answers 403 with its rate-limit headers", () => {
    it("reports a rate limit, not a permission failure", async () => {
      const svc = new GithubAppTokenService("app-1", privateKey, fakeRedis());
      const fetchMock = vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("/access_tokens")) {
          return new Response(
            JSON.stringify({ token: "ghs_read", expires_at: "" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1900000000",
          },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        svc.listPullRequestsForHead({
          installationId: "99",
          repositoryId: "42",
          owner: "acme",
          repo: "service-x",
          branch: "main",
        }),
      ).rejects.toBeInstanceOf(GithubRateLimitedError);
    });
  });

  describe("when the repository is not on the installation", () => {
    it("reports it as unreachable rather than as an unknown failure", async () => {
      const svc = new GithubAppTokenService("app-1", privateKey, fakeRedis());
      const fetchMock = vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("/access_tokens")) {
          return new Response(
            JSON.stringify({ token: "ghs_read", expires_at: "" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        svc.listPullRequestsForHead({
          installationId: "99",
          repositoryId: "42",
          owner: "acme",
          repo: "hidden",
          branch: "main",
        }),
      ).rejects.toMatchObject({ code: "github_repo_not_accessible" });
    });
  });
});

describe("configured", () => {
  it("is false without a private key, true with app id + key", () => {
    expect(new GithubAppTokenService("app", "", null).configured).toBe(false);
    expect(new GithubAppTokenService("app", privateKey, null).configured).toBe(
      true,
    );
  });
});
