import type { GithubRepository } from "@langwatch/github-contract";
import { GithubRepositoryNotAccessibleError } from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { GithubApiPort } from "../ports/github-api.port";
import {
  GithubInstallationNotFoundError,
  type GithubInstallationDetails,
  type GithubInstallationToken,
  GithubRateLimitedError,
  type GithubPullRequestSummary,
  type MintInstallationTokenInput,
} from "../ports/github-app-token.port";
import type { GithubHostPort } from "../ports/github-host.port";

const logger = createLogger("langwatch:github:api");
const HTTP_TIMEOUT_MS = 10_000;
const APP_JWT_TTL_SEC = 9 * 60;
const APP_JWT_SKEW_SEC = 30;

const pullRequestSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  merged_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
  user: z.object({ login: z.string().optional() }).nullish(),
});

const installationSchema = z.object({
  id: z.number(),
  account: z
    .object({
      login: z.string().optional(),
      type: z.string().optional(),
      id: z.number().optional(),
    })
    .nullish(),
  repository_selection: z.string().optional(),
});

const repositoriesSchema = z.object({
  repositories: z.array(z.object({ id: z.number(), full_name: z.string() })).optional(),
});

const tokenSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  repository_selection: z.string().optional(),
});

function tryReadRateLimit(response: Response): GithubRateLimitedError | null {
  if (response.status !== 403 && response.status !== 429) {
    return null;
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : null;
  const exhausted = response.headers.get("x-ratelimit-remaining") === "0";
  const hasRetryAfter = retryAfterSec !== null && Number.isFinite(retryAfterSec);
  if (!exhausted && !hasRetryAfter) {
    return null;
  }

  const resetHeader = response.headers.get("x-ratelimit-reset");
  const resetSec = resetHeader ? Number(resetHeader) : null;
  return new GithubRateLimitedError({
    retryAfterSec: hasRetryAfter ? retryAfterSec : null,
    resetAt:
      resetSec !== null && Number.isFinite(resetSec) ? new Date(resetSec * 1000) : null,
  });
}

function toPullRequestSummary(
  pull: z.infer<typeof pullRequestSchema>,
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

export class GithubApiAdapter extends GithubApiPort {
  static create(
    appId: string,
    privateKey: string,
    host: GithubHostPort,
  ): GithubApiAdapter {
    return new GithubApiAdapter(appId, privateKey, host);
  }

  private constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly host: GithubHostPort,
  ) {
    super();
  }

  get configured(): boolean {
    return Boolean(this.appId && this.privateKey);
  }

  signAppJwt(nowSec: number = Math.floor(Date.now() / 1000)): string {
    const key = this.privateKey.includes("\\n")
      ? this.privateKey.replace(/\\n/g, "\n")
      : this.privateKey;

    return jwt.sign(
      {
        iat: nowSec - APP_JWT_SKEW_SEC,
        exp: nowSec + APP_JWT_TTL_SEC,
        iss: this.appId,
      },
      key,
      { algorithm: "RS256" },
    );
  }

  async getInstallation(installationId: string): Promise<GithubInstallationDetails> {
    const response = await this.request(
      `${this.host.getApiBase()}/app/installations/${encodeURIComponent(installationId)}`,
      { headers: { Authorization: `Bearer ${this.signAppJwt()}` } },
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new GithubInstallationNotFoundError(installationId);
      }
      throw new Error(`GitHub GET /app/installations failed: ${response.status}`);
    }

    const body = installationSchema.parse(await response.json());
    return {
      installationId: String(body.id),
      accountLogin: body.account?.login ?? "",
      accountType: body.account?.type ?? "",
      accountId: body.account?.id !== void 0 ? String(body.account.id) : "",
      repositorySelection: body.repository_selection ?? "all",
    };
  }

  async mintInstallationToken(
    input: MintInstallationTokenInput,
  ): Promise<GithubInstallationToken> {
    const payload: Record<string, unknown> = {
      permissions: input.permissions,
    };
    if (input.repositoryIds?.length) {
      payload.repository_ids = input.repositoryIds.map(Number);
    }

    const response = await this.request(
      `${this.host.getApiBase()}/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.signAppJwt()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      logger.warn(
        { status: response.status, installationId: input.installationId },
        "installation token mint failed",
      );
      if (response.status === 404) {
        throw new GithubInstallationNotFoundError(input.installationId);
      }

      const rateLimit = tryReadRateLimit(response);
      if (rateLimit) {
        throw rateLimit;
      }
      throw new Error(`GitHub token mint failed: ${response.status}`);
    }

    const body = tokenSchema.parse(await response.json());
    return {
      token: body.token,
      expiresAt: body.expires_at,
      ...(body.repository_selection
        ? { repositorySelection: body.repository_selection }
        : {}),
    };
  }

  async listInstallationRepositories(token: string): Promise<GithubRepository[]> {
    const repositories: GithubRepository[] = [];
    for (let page = 1; page <= 20; page++) {
      const response = await this.request(
        `${this.host.getApiBase()}/installation/repositories?per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const rateLimit = tryReadRateLimit(response);
        if (rateLimit) {
          throw rateLimit;
        }
        throw new Error(
          `GitHub GET /installation/repositories failed: ${response.status}`,
        );
      }

      const body = repositoriesSchema.parse(await response.json());
      const pageRepositories = body.repositories ?? [];
      repositories.push(
        ...pageRepositories.map((repository) => ({
          id: String(repository.id),
          fullName: repository.full_name,
        })),
      );
      if (pageRepositories.length < 100) {
        break;
      }
    }

    return repositories;
  }

  async listPullRequestsForHead(input: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]> {
    const head = `${input.owner}:${input.branch}`;
    const body = await this.readPullRequests(
      input,
      `/pulls?head=${encodeURIComponent(head)}&state=all&per_page=50`,
      z.array(pullRequestSchema),
    );
    return body.map(toPullRequestSummary);
  }

  async getPullRequest(input: {
    token: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary> {
    const body = await this.readPullRequests(
      input,
      `/pulls/${encodeURIComponent(String(input.number))}`,
      pullRequestSchema,
    );
    return toPullRequestSummary(body);
  }

  private async readPullRequests<T>(
    input: { token: string; owner: string; repo: string },
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.request(
      `${this.host.getApiBase()}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}${path}`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    if (!response.ok) {
      const rateLimit = tryReadRateLimit(response);
      if (rateLimit) {
        throw rateLimit;
      }
      if (response.status === 404) {
        throw new GithubRepositoryNotAccessibleError({
          repositoryFullName: `${input.owner}/${input.repo}`,
        });
      }
      throw new Error(`GitHub pull-request read failed: ${response.status}`);
    }

    return schema.parse(await response.json());
  }

  private request(
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
}
