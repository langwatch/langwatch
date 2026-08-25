/**
 * GitHub App authentication for the organization's GitHub connection: signs the
 * app JWT (RS256, with the App private key) and mints short-lived (1h)
 * INSTALLATION access tokens scoped to a chosen repository set and a minimal
 * permission set. This is the crown-jewel boundary, the private key lives only
 * here, in the control plane, and never goes near a worker. Minted tokens are
 * cached in Redis under (installation, scope) for a hair under their lifetime;
 * tokens are NEVER logged.
 *
 * Two permission sets are minted against the same installation: write, for
 * Langy's bot-authored pull requests, and read-only pull requests, for the
 * pull-request linkage the coding-agent read path uses. The scope key covers
 * the permission set as well as the repositories, so the two never share a
 * cached token. See specs/integrations/github-connection.feature.
 */
import { createLogger } from "@langwatch/observability";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";

import { GithubRepositoryNotAccessibleError } from "../services/github-errors.service";
import {
  GITHUB_DOT_COM,
  getGithubApiBase,
  getGithubHost,
  type GithubHostConfig,
} from "./github.github-host.adapter";

const logger = createLogger("langwatch:github:app-token");

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

// How long a confirmed-alive result is trusted before the next cache hit
// probes GitHub again. Deliberately much shorter than the token cache TTL —
// this bounds how stale a missed-webhook deletion can go undetected, without
// turning every cache hit (i.e. every normal turn) into a live GitHub call.
const LIVENESS_RECHECK_TTL_SEC = 5 * 60;
// A transient probe failure (network blip, 5xx, rate limit) backs off for a
// shorter window before trying again — long enough that a GitHub outage
// doesn't cost every subsequent turn its own probe (and the 10s githubFetch
// timeout on top), short enough to notice GitHub recovering reasonably fast.
const LIVENESS_FAILURE_BACKOFF_SEC = 60;

/**
 * The least-privilege permission set the write path asks for at mint time, and
 * the mint default. Cannot exceed the installation's own grant (GitHub clamps
 * it). Kept minimal so a leaked token can only touch code + PRs on the scoped
 * repositories.
 */
export const GITHUB_WRITE_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
} as const;

/**
 * The permission set the read path asks for: enough to look a pull request up,
 * nothing else. A token minted for pull-request linkage cannot push a commit or
 * open a pull request even though the installation itself may allow both.
 */
export const GITHUB_READ_PULL_PERMISSIONS = {
  pull_requests: "read",
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

/** The pull-request fields the read path stores and renders. */
export interface GithubPullRequestSummary {
  number: number;
  htmlUrl: string;
  title: string;
  /** GitHub's own state string: "open" or "closed". */
  state: string;
  draft: boolean;
  /** ISO-8601, or null while the pull request is unmerged. */
  mergedAt: string | null;
  /** ISO-8601, or null while the pull request is open. */
  closedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
  /**
   * ISO-8601: GitHub's own `updated_at` for this snapshot, and the ordering
   * key the store writes behind. Both sources carry it, because both can
   * arrive late: GitHub permits out-of-order webhook delivery, and a slow REST
   * listing can answer after a webhook already applied a newer state.
   */
  updatedAt: string;
  authorLogin: string | null;
}

/**
 * Thrown when GitHub confirms (HTTP 404, not a timeout/5xx/permission error)
 * that an installation no longer exists — it was uninstalled on GitHub's side
 * but our row was never cleaned up (a missed webhook delivery, or an
 * installation that predates the webhook being configured). Callers use this
 * to tell "this installation is gone, stop selecting it" apart from a
 * transient failure that must NOT delete a possibly-still-live installation.
 */
export class GithubInstallationNotFoundError extends Error {
  public readonly installationId: string;

  constructor(installationId: string) {
    super(`GitHub installation ${installationId} not found`);
    this.name = "GithubInstallationNotFoundError";
    this.installationId = installationId;
  }
}

/**
 * Thrown when GitHub answers with a rate-limit refusal rather than a failure of
 * the request itself: a 429, or the 403 GitHub uses for both its primary limit
 * (`x-ratelimit-remaining: 0`) and its secondary one (`retry-after`). It is an
 * internal error, not a handled one, because only the caller knows whether the
 * customer can act on it: a background refresh backs off silently where a
 * customer-triggered read surfaces `github_rate_limited`.
 */
export class GithubRateLimitedError extends Error {
  /** Seconds GitHub asked us to wait, when it said. */
  public readonly retryAfterSec: number | null;
  /** When the limit window resets, when GitHub said. */
  public readonly resetAt: Date | null;

  constructor({
    retryAfterSec,
    resetAt,
  }: {
    retryAfterSec: number | null;
    resetAt: Date | null;
  }) {
    super("GitHub rate limit reached");
    this.name = "GithubRateLimitedError";
    this.retryAfterSec = retryAfterSec;
    this.resetAt = resetAt;
  }
}

/**
 * Reads a rate-limit refusal off a response, or null when the status is a
 * plain authorization/permission failure. A 403 without either header is
 * exactly that, so it must not be reported as a rate limit the caller can wait
 * out.
 */
function readRateLimit(res: Response): GithubRateLimitedError | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfterHeader = res.headers.get("retry-after");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const resetHeader = res.headers.get("x-ratelimit-reset");
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : null;
  const isExhausted = remaining === "0";
  const hasRetryAfter = retryAfterSec != null && Number.isFinite(retryAfterSec);
  if (!isExhausted && !hasRetryAfter) return null;
  const resetSec = resetHeader ? Number(resetHeader) : null;
  return new GithubRateLimitedError({
    retryAfterSec: hasRetryAfter ? retryAfterSec : null,
    resetAt:
      resetSec != null && Number.isFinite(resetSec) ? new Date(resetSec * 1000) : null,
  });
}

/**
 * The subset of GitHub's pull-request JSON the read path reads.
 *
 * Exported because a `pull_request` webhook carries the very same object under
 * `pull_request`, so the event path normalises through the function below
 * rather than growing a second reading of GitHub's field names.
 */
export interface GithubApiPullRequest {
  number: number;
  html_url: string;
  title: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  user?: { login?: string } | null;
}

export function toPullRequestSummary(
  pull: GithubApiPullRequest,
): GithubPullRequestSummary {
  return {
    number: pull.number,
    htmlUrl: pull.html_url,
    title: pull.title,
    state: pull.state,
    draft: pull.draft ?? false,
    mergedAt: pull.merged_at ?? null,
    closedAt: pull.closed_at ?? null,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    authorLogin: pull.user?.login ?? null,
  };
}

/** The narrow Redis surface this service uses (ioredis-compatible). */
export abstract class RedisLike {
  abstract get(key: string): Promise<string | null>;
  abstract set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null>;
  abstract del(key: string): Promise<number>;
  abstract eval?(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>;
}

export interface MintInstallationTokenArgs {
  installationId: string;
  /** Numeric repository ids to scope to (≤500). Omit for the full installation. */
  repositoryIds?: string[];
  /** Permission subset. Defaults to {@link GITHUB_WRITE_PERMISSIONS}. */
  permissions?: Record<string, string>;
}

/**
 * Computes a short, stable key for a token's scope so the cache re-mints when
 * (and only when) the repository set or permission set changes. Also the
 * "repo-scope key" threaded into the worker credential signature so a scope
 * change re-warms the worker (specs/langy/langy-github-install.feature).
 */
export function computeRepoScopeKey({
  repositoryIds,
  permissions = GITHUB_WRITE_PERMISSIONS as unknown as Record<string, string>,
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
  return createHash("sha256").update(`${repos}|${perms}`).digest("hex").slice(0, 16);
}

/**
 * Redis key prefix for one installation's cached token and liveness marker.
 *
 * An installation id is unique within one GitHub, not across two. Without the
 * host in the key, installation 42 on github.com and installation 42 on an
 * Enterprise Server share a cache entry, and a live bearer token minted for one
 * is handed to the other.
 *
 * github.com keeps the unqualified shape, so tokens cached before this existed
 * stay valid and the default deployment sees no change at all.
 */
function installationCacheKeyPrefix(
  installationId: string,
  hostConfig: GithubHostConfig,
): string {
  const host = getGithubHost(hostConfig);
  const hostSegment = host === GITHUB_DOT_COM ? "" : `${host}:`;
  // The `langy:` prefix is kept so tokens cached before the deploy stay valid.
  return `langy:gh:insttoken:${hostSegment}${installationId}`;
}

export class GithubAppTokenService {
  static create(
    appId: string,
    privateKeyPem: string,
    redis: RedisLike | null,
    hostConfig: GithubHostConfig = {},
  ): GithubAppTokenService {
    return new GithubAppTokenService(appId, privateKeyPem, redis, hostConfig);
  }

  private constructor(
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly redis: RedisLike | null,
    private readonly hostConfig: GithubHostConfig = {},
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
  async getInstallation(installationId: string): Promise<GithubInstallationDetails> {
    const res = await this.githubFetch(
      `${getGithubApiBase(this.hostConfig)}/app/installations/${encodeURIComponent(installationId)}`,
      { headers: { Authorization: `Bearer ${this.signAppJwt()}` } },
    );
    if (!res.ok) {
      if (res.status === 404) {
        throw new GithubInstallationNotFoundError(installationId);
      }
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

  // Confirms an installation still exists before trusting a cached token for
  // it — but only actually probes GitHub once per LIVENESS_RECHECK_TTL_SEC.
  // Without that marker, every cache hit (i.e. every normal turn) would cost
  // a live GitHub call: the lock below only coalesces callers that overlap
  // in time, and is released the moment the probe returns, so sequential
  // turns each re-acquire it and each pay for their own GET. That would turn
  // the 50-minute token cache into ~one GitHub App API request per turn, and
  // during a GitHub outage or rate-limit response every turn would sit on
  // `githubFetch`'s 10s timeout before falling back to the cached token —
  // reintroducing exactly the GitHub-availability dependency the token cache
  // exists to remove.
  //
  // Only a confirmed 404 (GithubInstallationNotFoundError) propagates and
  // skips the marker entirely — the installation is about to be deleted, so
  // there is nothing to mark alive. Any other failure (network blip, GitHub
  // 5xx, rate limit) fails OPEN and sets a much shorter backoff marker, so an
  // outage costs at most one stalled probe per LIVENESS_FAILURE_BACKOFF_SEC
  // rather than one per turn.
  private async assertInstallationStillExists(installationId: string): Promise<void> {
    const markerKey = `${installationCacheKeyPrefix(installationId, this.hostConfig)}:liveness`;
    if (await this.redisGet(markerKey)) return;

    // Lock-guarded the same way the mint path guards its own stampede: a
    // caller that loses the (non-blocking, try-once) lock race trusts the
    // cache for this call — the prober holding the lock still throws (and
    // still self-heals the shared installation list) on a confirmed 404,
    // which is enough for every later call to see it removed.
    const lockKey = `${markerKey}:lock`;
    const lock = await this.tryLockOnce(lockKey);
    if (!lock) return;
    try {
      await this.getInstallation(installationId);
      await this.redisSetEx(markerKey, LIVENESS_RECHECK_TTL_SEC, "alive");
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) throw error;
      await this.redisSetEx(markerKey, LIVENESS_FAILURE_BACKOFF_SEC, "backoff");
    } finally {
      await this.releaseLock(lockKey, lock);
    }
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
    const cacheKey = `${installationCacheKeyPrefix(
      args.installationId,
      this.hostConfig,
    )}:${scopeKey}`;

    const cached = await this.redisGet(cacheKey);
    if (cached) {
      // A cache hit alone doesn't mean the installation is still alive: the
      // token's ~50min TTL comfortably outlasts a missed deletion webhook, so
      // without this check a dead installation would keep being served a
      // "valid" token — and every self-heal path in the caller (which only
      // ever sees GithubInstallationNotFoundError from a REAL mint attempt)
      // would never fire until the cache happened to expire.
      await this.assertInstallationStillExists(args.installationId);
      return { token: cached, expiresAt: "" };
    }

    // Best-effort lock to avoid a mint stampede; every branch falls through to a
    // direct mint (minting twice is harmless, unlike the old refresh rotation).
    const lock = await this.acquireLock(`${cacheKey}:lock`);
    try {
      const fresh = await this.redisGet(cacheKey);
      if (fresh) return { token: fresh, expiresAt: "" };

      const minted = await this.mintAtGithub(args);
      await this.redisSetEx(cacheKey, INSTALLATION_TOKEN_CACHE_TTL_SEC, minted.token);
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
    // Bound the walk so a pathological account can't loop forever.
    for (let page = 1; page <= 20; page++) {
      const batch = await this.fetchInstallationRepositoryPage({
        token: minted.token,
        page,
      });
      for (const repo of batch) {
        repos.push({ id: String(repo.id), fullName: repo.full_name });
      }
      // A short page is the last page.
      if (batch.length < 100) break;
    }
    return repos;
  }

  /** One page of GET /installation/repositories, already error-checked. */
  private async fetchInstallationRepositoryPage({
    token,
    page,
  }: {
    token: string;
    page: number;
  }): Promise<{ id: number; full_name: string }[]> {
    const res = await this.githubFetch(
      `${getGithubApiBase(this.hostConfig)}/installation/repositories?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const rateLimited = readRateLimit(res);
      if (rateLimited) throw rateLimited;
      throw new Error(`GitHub GET /installation/repositories failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      repositories?: { id: number; full_name: string }[];
    };
    return body.repositories ?? [];
  }

  /**
   * List the pull requests opened from `branch` on `owner/repo`, newest first
   * as GitHub returns them, using a token that can only read pull requests.
   * Closed and merged ones are included: a session's branch is often already
   * merged by the time anyone looks at it.
   */
  async listPullRequestsForHead({
    installationId,
    repositoryId,
    owner,
    repo,
    branch,
  }: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]> {
    const head = `${owner}:${branch}`;
    const body = await this.readAsPullReader<GithubApiPullRequest[]>({
      installationId,
      repositoryId,
      owner,
      repo,
      path: `/pulls?head=${encodeURIComponent(head)}&state=all&per_page=50`,
      what: "GET /repos/{owner}/{repo}/pulls",
    });
    return Array.isArray(body) ? body.map(toPullRequestSummary) : [];
  }

  /** Re-read one pull request, for refreshing a mapping that already exists. */
  async getPullRequest({
    installationId,
    repositoryId,
    owner,
    repo,
    number,
  }: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary> {
    const body = await this.readAsPullReader<GithubApiPullRequest>({
      installationId,
      repositoryId,
      owner,
      repo,
      path: `/pulls/${encodeURIComponent(String(number))}`,
      what: "GET /repos/{owner}/{repo}/pulls/{number}",
    });
    return toPullRequestSummary(body);
  }

  // Both read paths mint the same repository-scoped, read-only token and map
  // the same failure classes, so they share this.
  private async readAsPullReader<T>({
    installationId,
    repositoryId,
    owner,
    repo,
    path,
    what,
  }: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    path: string;
    what: string;
  }): Promise<T> {
    const minted = await this.mintInstallationToken({
      installationId,
      repositoryIds: [repositoryId],
      permissions: GITHUB_READ_PULL_PERMISSIONS as unknown as Record<string, string>,
    });
    const res = await this.githubFetch(
      `${getGithubApiBase(this.hostConfig)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
      { headers: { Authorization: `Bearer ${minted.token}` } },
    );
    if (!res.ok) {
      const rateLimited = readRateLimit(res);
      if (rateLimited) throw rateLimited;
      // GitHub answers 404 rather than 403 for a repository the token cannot
      // see, so a missing repository and an unreachable one are the same fact
      // to us, and the same remedy: add it to the installation.
      if (res.status === 404) {
        throw new GithubRepositoryNotAccessibleError({
          repositoryFullName: `${owner}/${repo}`,
        });
      }
      throw new Error(`GitHub ${what} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  // POST /app/installations/{id}/access_tokens — the actual mint.
  private async mintAtGithub(
    args: MintInstallationTokenArgs,
  ): Promise<GithubInstallationToken> {
    const payload: Record<string, unknown> = {
      permissions: args.permissions ?? GITHUB_WRITE_PERMISSIONS,
    };
    if (args.repositoryIds && args.repositoryIds.length > 0) {
      // GitHub takes numeric repository ids here.
      payload.repository_ids = args.repositoryIds.map((id) => Number(id));
    }
    const res = await this.githubFetch(
      `${getGithubApiBase(this.hostConfig)}/app/installations/${encodeURIComponent(
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
      // A 404 here is GitHub confirming the installation is gone — distinct
      // from every other failure (401/403/5xx/network), which may well be
      // transient and must never be treated as "this installation is dead".
      if (res.status === 404) {
        throw new GithubInstallationNotFoundError(args.installationId);
      }
      const rateLimited = readRateLimit(res);
      if (rateLimited) throw rateLimited;
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
        "User-Agent": "langwatch",
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

  private async redisSetEx(key: string, ttlSec: number, value: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, value, "EX", ttlSec);
    } catch {
      /* best-effort cache */
    }
  }

  // A single, non-blocking lock attempt — unlike acquireLock, never retries.
  // acquireLock's retry-for-up-to-3s exists because the mint path MUST
  // eventually mint (there's no valid "just skip it" outcome); the liveness
  // probe has one, so a caller that loses the race should trust the cache
  // immediately rather than spin waiting for a lock it doesn't need.
  private async tryLockOnce(key: string): Promise<string | null> {
    if (!this.redis) return null;
    const token = randomBytes(16).toString("hex");
    try {
      const ok = await this.redis.set(key, token, "NX", "EX", LOCK_TTL_SEC);
      return ok === "OK" ? token : null;
    } catch {
      return null;
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
