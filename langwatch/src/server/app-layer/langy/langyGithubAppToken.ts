/**
 * GitHub App authentication for Langy: signs the app JWT (RS256, with the App
 * private key) and mints short-lived (1h) INSTALLATION access tokens scoped to a
 * chosen repository set and a minimal permission set. This is the crown-jewel
 * boundary — the private key lives only here, in the control plane, and never
 * goes near a worker. Minted tokens are cached in Redis under (installation,
 * scope) for a hair under their lifetime; tokens are NEVER logged.
 *
 * Replaces the per-user OAuth/refresh-token machinery (issue #4747). See
 * LANGY_GITHUB_AUTH_PLAN.md §2–3 and specs/langy/langy-github-install.feature.
 */
import { createLogger } from "@langwatch/observability";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";

const logger = createLogger("langwatch:langy:github-app-token");

const GITHUB_API = "https://api.github.com";
const HTTP_TIMEOUT_MS = 10_000;

// App JWT lifetime. GitHub caps it at 10 minutes; use 9 with a -30s backdated
// iat to absorb clock skew between us and GitHub.
const APP_JWT_TTL_SEC = 9 * 60;
const APP_JWT_SKEW_SEC = 30;

// Cache installation tokens a hair under their fixed 1h lifetime so we don't
// mint one per turn while still refreshing before expiry.
const INSTALLATION_TOKEN_CACHE_TTL_SEC = 50 * 60;

// Best-effort mint lock so concurrent turns don't stampede the mint endpoint.
// Unlike the old refresh-token rotation this is NOT a correctness lock (minting
// twice merely wastes a call), so every branch fails open to a direct mint.
const LOCK_TTL_SEC = 15;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 3_000;

/**
 * The least-privilege permission set Langy asks for at mint time. Cannot exceed
 * the installation's own grant (GitHub clamps it). Kept minimal so a leaked
 * token can only touch code + PRs on the scoped repositories.
 */
export const LANGY_INSTALLATION_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
} as const;

export interface GithubInstallationToken {
  token: string;
  /** ISO-8601 expiry GitHub returned (fixed ~1h out). */
  expiresAt: string;
  /** "all" | "selected" — GitHub's echo of the token's repository scope. */
  repositorySelection?: string;
}

export interface GithubInstallationDetails {
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
}

export interface GithubRepository {
  id: string;
  fullName: string;
}

/** The narrow Redis surface this service uses (ioredis-compatible). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  eval?(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>;
}

export interface MintInstallationTokenArgs {
  installationId: string;
  /** Numeric repository ids to scope to (≤500). Omit for the full installation. */
  repositoryIds?: string[];
  /** Permission subset. Defaults to {@link LANGY_INSTALLATION_PERMISSIONS}. */
  permissions?: Record<string, string>;
}

/**
 * Computes a short, stable key for a token's scope so the cache re-mints when
 * (and only when) the repository set or permission set changes. Also the
 * "repo-scope key" threaded into the worker credential signature so a scope
 * change re-warms the worker (LANGY_GITHUB_AUTH_PLAN.md §3).
 */
export function computeRepoScopeKey({
  repositoryIds,
  permissions = LANGY_INSTALLATION_PERMISSIONS as unknown as Record<
    string,
    string
  >,
}: {
  repositoryIds?: string[];
  permissions?: Record<string, string>;
}): string {
  const repos =
    repositoryIds && repositoryIds.length > 0
      ? [...repositoryIds].sort().join(",")
      : "all";
  const perms = Object.entries(permissions)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(",");
  return createHash("sha256")
    .update(`${repos}|${perms}`)
    .digest("hex")
    .slice(0, 16);
}

export class LangyGithubAppTokenService {
  constructor(
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly redis: RedisLike | null,
  ) {}

  /**
   * True when the App private key + id are configured. Callers short-circuit to
   * "GitHub unavailable" when false, before touching the DB or GitHub.
   */
  get configured(): boolean {
    return Boolean(this.appId && this.privateKeyPem);
  }

  /** Sign a short-lived RS256 app JWT. Never logged. */
  signAppJwt(nowSec: number = Math.floor(Date.now() / 1000)): string {
    // Env commonly carries the PEM with escaped newlines; normalise them.
    const pem = this.privateKeyPem.includes("\\n")
      ? this.privateKeyPem.replace(/\\n/g, "\n")
      : this.privateKeyPem;
    return jwt.sign(
      {
        iat: nowSec - APP_JWT_SKEW_SEC,
        exp: nowSec + APP_JWT_TTL_SEC,
        iss: this.appId,
      },
      pem,
      { algorithm: "RS256" },
    );
  }

  /** GET /app/installations/{id} — the account + repo-selection metadata. */
  async getInstallation(
    installationId: string,
  ): Promise<GithubInstallationDetails> {
    const res = await this.githubFetch(
      `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}`,
      { headers: { Authorization: `Bearer ${this.signAppJwt()}` } },
    );
    if (!res.ok) {
      throw new Error(`GitHub GET /app/installations failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      id: number;
      account?: { login?: string; type?: string; id?: number } | null;
      repository_selection?: string;
    };
    return {
      installationId: String(body.id),
      accountLogin: body.account?.login ?? "",
      accountType: body.account?.type ?? "",
      accountId: body.account?.id != null ? String(body.account.id) : "",
      repositorySelection: body.repository_selection ?? "all",
    };
  }

  /**
   * Mint an installation access token scoped to `repositoryIds` (or the full
   * installation) and `permissions`. Redis-cached under (installation, scope).
   * Tokens are never logged.
   */
  async mintInstallationToken(
    args: MintInstallationTokenArgs,
  ): Promise<GithubInstallationToken> {
    const scopeKey = computeRepoScopeKey({
      repositoryIds: args.repositoryIds,
      permissions: args.permissions,
    });
    const cacheKey = `langy:gh:insttoken:${args.installationId}:${scopeKey}`;

    const cached = await this.redisGet(cacheKey);
    if (cached) return { token: cached, expiresAt: "" };

    // Best-effort lock to avoid a mint stampede; every branch falls through to a
    // direct mint (minting twice is harmless, unlike the old refresh rotation).
    const lock = await this.acquireLock(`${cacheKey}:lock`);
    try {
      const fresh = await this.redisGet(cacheKey);
      if (fresh) return { token: fresh, expiresAt: "" };

      const minted = await this.mintAtGithub(args);
      await this.redisSetEx(
        cacheKey,
        INSTALLATION_TOKEN_CACHE_TTL_SEC,
        minted.token,
      );
      return minted;
    } finally {
      if (lock) await this.releaseLock(`${cacheKey}:lock`, lock);
    }
  }

  /**
   * List every repository the installation can see, via GET
   * /installation/repositories authed with a freshly minted installation token.
   * Paginated. Used by the settings UI + repo resolution.
   */
  async listInstallationRepositories(
    installationId: string,
  ): Promise<GithubRepository[]> {
    const minted = await this.mintInstallationToken({ installationId });
    const repos: GithubRepository[] = [];
    let page = 1;
    // Bound the walk so a pathological account can't loop forever.
    for (; page <= 20; page++) {
      const res = await this.githubFetch(
        `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${minted.token}` } },
      );
      if (!res.ok) {
        throw new Error(
          `GitHub GET /installation/repositories failed: ${res.status}`,
        );
      }
      const body = (await res.json()) as {
        repositories?: { id: number; full_name: string }[];
      };
      const batch = body.repositories ?? [];
      for (const r of batch) {
        repos.push({ id: String(r.id), fullName: r.full_name });
      }
      if (batch.length < 100) break;
    }
    return repos;
  }

  // POST /app/installations/{id}/access_tokens — the actual mint.
  private async mintAtGithub(
    args: MintInstallationTokenArgs,
  ): Promise<GithubInstallationToken> {
    const payload: Record<string, unknown> = {
      permissions: args.permissions ?? LANGY_INSTALLATION_PERMISSIONS,
    };
    if (args.repositoryIds && args.repositoryIds.length > 0) {
      // GitHub takes numeric repository ids here.
      payload.repository_ids = args.repositoryIds.map((id) => Number(id));
    }
    const res = await this.githubFetch(
      `${GITHUB_API}/app/installations/${encodeURIComponent(
        args.installationId,
      )}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.signAppJwt()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      // Log the status only — never the response body (may echo the token on a
      // 201, and error bodies can carry sensitive install detail).
      logger.warn(
        { status: res.status, installationId: args.installationId },
        "installation token mint failed",
      );
      throw new Error(`GitHub token mint failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      token: string;
      expires_at: string;
      repository_selection?: string;
    };
    return {
      token: body.token,
      expiresAt: body.expires_at,
      ...(body.repository_selection
        ? { repositorySelection: body.repository_selection }
        : {}),
    };
  }

  private githubFetch(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "langwatch-langy",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }

  // ---------- Redis helpers (no-op / fail-open when unavailable) ----------

  private async redisGet(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async redisSetEx(
    key: string,
    ttlSec: number,
    value: string,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, value, "EX", ttlSec);
    } catch {
      /* best-effort cache */
    }
  }

  private async acquireLock(key: string): Promise<string | null> {
    if (!this.redis) return null;
    const token = randomBytes(16).toString("hex");
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const ok = await this.redis.set(key, token, "NX", "EX", LOCK_TTL_SEC);
        if (ok === "OK") return token;
      } catch {
        return null;
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
    // Couldn't get the lock in time — fail open (mint directly). The waiter
    // re-checks the cache first, so a stampede is still mostly collapsed.
    return null;
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    if (!this.redis) return;
    try {
      if (typeof this.redis.eval === "function") {
        await this.redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        );
        return;
      }
      const current = await this.redis.get(key);
      if (current === token) await this.redis.del(key);
    } catch {
      /* lock will expire on its own */
    }
  }
}
