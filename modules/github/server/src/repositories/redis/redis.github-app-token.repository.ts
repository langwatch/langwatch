import { createHash } from "node:crypto";
import type { GithubRepository } from "@langwatch/github-contract";

import type { GithubApiRepository } from "../github-api.repository.ts";
import {
  GITHUB_READ_PULL_PERMISSIONS,
  GITHUB_WRITE_PERMISSIONS,
  GithubAppTokenRepository,
  GithubInstallationNotFoundError,
  type GithubInstallationDetails,
  type GithubInstallationToken,
  type GithubPullRequestSummary,
  type MintInstallationTokenInput,
} from "../github-app-token.repository.ts";
import type { GithubRedisPort } from "./github-redis.connection.ts";
import type { GithubHostPort } from "../../ports/github-host.port.ts";
import type { GithubTokenCacheRepository } from "../github-token-cache.repository.ts";
import { GithubTokenCacheRedisRepository } from "./redis.github-token-cache.repository.ts";
import { GithubApiAdapter } from "../../adapters/github-api.adapter.ts";
import { GithubHostService } from "../../services/github-host.service.ts";

export {
  GITHUB_READ_PULL_PERMISSIONS,
  GITHUB_WRITE_PERMISSIONS,
  GithubInstallationNotFoundError,
  GithubRateLimitedError,
  type GithubInstallationDetails,
  type GithubInstallationToken,
  type GithubPullRequestSummary,
  type MintInstallationTokenInput,
} from "../github-app-token.repository.ts";
export type { GithubRedisPort } from "./github-redis.connection.ts";

const INSTALLATION_TOKEN_CACHE_TTL_SEC = 50 * 60;
const LIVENESS_RECHECK_TTL_SEC = 5 * 60;
const LIVENESS_FAILURE_BACKOFF_SEC = 60;

export class RedisGithubAppTokenRepository extends GithubAppTokenRepository {
  static create(
    appId: string,
    privateKey: string,
    redis: GithubRedisPort | null,
    host: GithubHostPort = GithubHostService.create(),
  ): RedisGithubAppTokenRepository {
    const api = GithubApiAdapter.create(appId, privateKey, host);
    const cache = GithubTokenCacheRedisRepository.create({ redis, host });
    return new RedisGithubAppTokenRepository(api, cache);
  }

  private constructor(
    private readonly api: GithubApiRepository,
    private readonly cache: GithubTokenCacheRepository,
  ) {
    super();
  }

  get configured(): boolean {
    return this.api.configured;
  }

  computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string {
    return RedisGithubAppTokenRepository.computeRepoScopeKey(input);
  }

  static computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string {
    const repositories = input.repositoryIds?.length
      ? [...input.repositoryIds].sort().join(",")
      : "all";
    const permissions = Object.entries(input.permissions ?? GITHUB_WRITE_PERMISSIONS)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
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
    const scopeKey = this.computeRepoScopeKey({
      repositoryIds: input.repositoryIds,
      permissions,
    });
    const cacheKey = {
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
        ...input,
        permissions,
      });
      await this.cache.storeToken({
        ...cacheKey,
        token: minted.token,
        ttlSec: INSTALLATION_TOKEN_CACHE_TTL_SEC,
      });
      return minted;
    } finally {
      if (lock) {
        await this.cache.releaseMintLock({ ...cacheKey, token: lock });
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
    if (await this.cache.hasLiveness(installationId)) {
      return;
    }

    const lock = await this.cache.acquireLivenessLock(installationId);
    if (!lock) {
      return;
    }

    try {
      await this.getInstallation(installationId);
      await this.cache.markLiveness({
        installationId,
        value: "alive",
        ttlSec: LIVENESS_RECHECK_TTL_SEC,
      });
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) {
        throw error;
      }

      await this.cache.markLiveness({
        installationId,
        value: "backoff",
        ttlSec: LIVENESS_FAILURE_BACKOFF_SEC,
      });
    } finally {
      await this.cache.releaseLivenessLock({ installationId, token: lock });
    }
  }
}
