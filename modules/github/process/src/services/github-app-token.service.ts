import { createHash } from "node:crypto";

import type { GithubRepository } from "@langwatch/github-contract";
import { differenceInSeconds, nowInstant } from "@langwatch/time";

import type {
  GithubAppClient,
  GithubAppTokenCache,
  GithubCheckRunSummary,
  GithubCheckSuiteSummary,
  GithubInstallationDetails,
  GithubInstallationToken,
  GithubPullRequestSummary,
  MintInstallationTokenInput,
} from "../app/github.app.ts";
import { GithubInstallationNotFoundError } from "../channels/github-api.channel.ts";
import type { GithubTokenCacheRepository } from "../repositories/github-token-cache.repository.ts";
import {
  GITHUB_READ_CHECKS_PERMISSIONS,
  GITHUB_READ_PULL_PERMISSIONS,
  GITHUB_WRITE_PERMISSIONS,
  permissionsWithinGrant,
} from "../rules/github-app-permissions.rules.ts";
import type { GithubHost } from "../rules/github-host.rules.ts";
import { githubHostOf } from "../rules/github-host.rules.ts";

/** A cached token is never served in its last minute; the cache itself caps it at a minute. */
const TOKEN_EXPIRY_MARGIN_SEC = 60;
const LIVENESS_RECHECK_TTL_SEC = 60;
const LIVENESS_FAILURE_BACKOFF_SEC = 60;

/** This process's shared token cache in front of the raw GitHub App client. */
export class GithubAppTokenService implements GithubAppTokenCache {
  static create({
    api,
    tokenCache,
    host = githubHostOf(),
  }: {
    api: GithubAppClient;
    tokenCache: GithubTokenCacheRepository;
    host?: GithubHost;
  }): GithubAppTokenService {
    return new GithubAppTokenService(api, tokenCache, host);
  }

  private constructor(
    private readonly api: GithubAppClient,
    private readonly cache: GithubTokenCacheRepository,
    private readonly host: GithubHost,
  ) {}

  get configured(): boolean {
    return this.api.configured;
  }

  computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string {
    return GithubAppTokenService.computeRepoScopeKey(input);
  }

  static computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string {
    const repositories = input.repositoryIds?.length
      ? [...input.repositoryIds].toSorted().join(",")
      : "all";
    const permissions = Object.entries(input.permissions ?? GITHUB_WRITE_PERMISSIONS)
      .map(([key, value]) => `${key}=${value}`)
      .toSorted()
      .join(",");

    return createHash("sha256").update(`${repositories}|${permissions}`).digest("hex").slice(0, 16);
  }

  signAppJwt(nowSec?: number): string {
    return this.api.signAppJwt(nowSec);
  }

  getInstallation(installationId: string): Promise<GithubInstallationDetails> {
    return this.api.getInstallation(installationId);
  }

  async mintInstallationToken(input: MintInstallationTokenInput): Promise<GithubInstallationToken> {
    const permissions = input.permissions ?? GITHUB_WRITE_PERMISSIONS;
    // Keyed by what was asked for, so the grant is read only when a token is minted.
    const scopeKey = this.computeRepoScopeKey({
      repositoryIds: input.repositoryIds,
      permissions: { ...input.optionalPermissions, ...permissions },
    });
    const cacheKey = {
      host: this.host.getHost(),
      installationId: input.installationId,
      scopeKey,
    };

    const cached = await this.cache.findToken(cacheKey);
    if (cached) {
      await this.assertInstallationStillExists(input.installationId);
      return { token: cached, expiresAt: "" };
    }

    const lock = await this.cache.acquireMintLock(cacheKey);
    try {
      const fresh = await this.cache.findToken(cacheKey);
      if (fresh) {
        return { token: fresh, expiresAt: "" };
      }

      const minted = await this.api.mintInstallationToken({
        installationId: input.installationId,
        ...(input.repositoryIds ? { repositoryIds: input.repositoryIds } : {}),
        permissions: await this.grantedPermissions({ ...input, permissions }),
      });
      const ttlSec =
        differenceInSeconds(minted.expiresAt, nowInstant().epochMilliseconds) -
        TOKEN_EXPIRY_MARGIN_SEC;
      if (ttlSec > 0) {
        await this.cache.storeToken({ ...cacheKey, token: minted.token, ttlSec });
      }
      return minted;
    } finally {
      if (lock.acquired) {
        await this.cache.releaseMintLock({ ...cacheKey, token: lock.token });
      }
    }
  }

  async listInstallationRepositories(installationId: string): Promise<GithubRepository[]> {
    const minted = await this.mintInstallationToken({ installationId });
    return this.api.listInstallationRepositories(minted.token);
  }

  async listPullRequestsForHead(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]> {
    const token = await this.mintPullRequestReadToken(input);
    return this.api.listPullRequestsForHead({
      token,
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
    });
  }

  async getPullRequest(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary> {
    const token = await this.mintPullRequestReadToken(input);
    return this.api.getPullRequest({
      token,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
    });
  }

  async readCommitChecks(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    sha: string;
  }): Promise<{ suites: GithubCheckSuiteSummary[]; runs: GithubCheckRunSummary[] }> {
    const minted = await this.mintInstallationToken({
      installationId: input.installationId,
      repositoryIds: [input.repositoryId],
      permissions: GITHUB_READ_CHECKS_PERMISSIONS,
    });
    const commit = { token: minted.token, owner: input.owner, repo: input.repo, sha: input.sha };
    const [suites, runs] = await Promise.all([
      this.api.listCommitCheckSuites(commit),
      this.api.listCommitCheckRuns(commit),
    ]);
    return { suites, runs };
  }

  /** The required permissions, plus the optional ones as far as the installation granted them. */
  private async grantedPermissions(
    input: MintInstallationTokenInput & { permissions: Record<string, string> },
  ): Promise<Record<string, string>> {
    if (!input.optionalPermissions) return input.permissions;
    const details = await this.api.getInstallation(input.installationId);
    return permissionsWithinGrant({
      required: input.permissions,
      optional: input.optionalPermissions,
      granted: details.permissions,
    });
  }

  private async mintPullRequestReadToken(input: {
    installationId: string;
    repositoryId: string;
  }): Promise<string> {
    const minted = await this.mintInstallationToken({
      installationId: input.installationId,
      repositoryIds: [input.repositoryId],
      permissions: GITHUB_READ_PULL_PERMISSIONS,
    });
    return minted.token;
  }

  private async assertInstallationStillExists(installationId: string): Promise<void> {
    const key = { host: this.host.getHost(), installationId };
    if (await this.cache.hasLiveness(key)) {
      return;
    }

    const lock = await this.cache.acquireLivenessLock(key);
    if (!lock.acquired) {
      return;
    }

    try {
      await this.getInstallation(installationId);
      await this.cache.markLiveness({
        ...key,
        value: "alive",
        ttlSec: LIVENESS_RECHECK_TTL_SEC,
      });
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) {
        throw error;
      }

      await this.cache.markLiveness({
        ...key,
        value: "backoff",
        ttlSec: LIVENESS_FAILURE_BACKOFF_SEC,
      });
    } finally {
      await this.cache.releaseLivenessLock({ ...key, token: lock.token });
    }
  }
}
