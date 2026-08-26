/**
 * @vitest-environment node
 * @unit
 *
 * The live status read: what each combination of GitHub's own fields means,
 * and what a reader gets when GitHub refuses to answer.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import {
  GithubPullRequestStatusService,
  MAX_STATUS_REFS,
} from "../src/services/github-pull-request-status.service";
import { GithubRateLimitedError } from "../src/adapters/github-app-token.adapter";
import {
  GithubAppTokenPort,
  type GithubInstallationDetails,
  type GithubInstallationToken,
  type GithubPullRequestSummary,
  GithubRedisPort,
  type MintInstallationTokenInput,
} from "../src/ports/github-app-token.port";
import { NullGithubInstallationsRepository } from "../src/repositories/github-installations.repository";
import {
  type GithubPullRequestRow,
  NullGithubPullRequestsRepository,
  type RefreshGithubPullRequestSnapshotInput,
} from "../src/repositories/github-pull-requests.repository";
import { GithubInstallationAccessService } from "../src/services/github-installation-access.service";
import { GithubInstallationsService } from "../src/services/github-installations.service";
import { GithubPullRequestStatusCacheService } from "../src/services/github-pull-request-status-cache.service";
import { TestOrganizationService } from "./fixtures/github-services.fixture";

const REF = {
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 7,
};

const MAPPED_AT = new Date(Date.UTC(2026, 4, 1));
const deriveStatus = GithubPullRequestStatusService.deriveStatus;
type GetPullRequestInput = {
  installationId: string;
  repositoryId: string;
  owner: string;
  repo: string;
  number: number;
};

class TestRedis extends GithubRedisPort {
  readonly store = new Map<string, string>();

  tryGet(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  trySet(key: string, value: string): Promise<string | null> {
    this.store.set(key, value);
    return Promise.resolve("OK");
  }

  delete(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }

  tryGetDelete(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return Promise.resolve(value);
  }

  tryEval(): Promise<number | string | null> {
    return Promise.resolve(null);
  }
}

class TestPullRequestRepository extends NullGithubPullRequestsRepository {
  readonly refreshSnapshot = vi.fn((_input: RefreshGithubPullRequestSnapshotInput) =>
    Promise.resolve(),
  );

  constructor(
    private readonly find: (input: {
      prNumber: number;
    }) => Promise<GithubPullRequestRow | null>,
  ) {
    super();
  }

  tryFindByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequestRow | null> {
    return this.find(input);
  }
}

class TestInstallationRepository extends NullGithubInstallationsRepository {
  findAllForOrganization(organizationId: string) {
    const now = new Date();
    return Promise.resolve([
      {
        installationId: "555",
        organizationId,
        accountLogin: "acme",
        accountType: "Organization",
        accountId: "1",
        repositorySelection: "selected",
        repositories: [{ id: "999", fullName: "acme/widgets" }],
        suspendedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }
}

class TestAppTokens extends GithubAppTokenPort {
  readonly configured = true;

  constructor(
    private readonly readPullRequest: (
      input: GetPullRequestInput,
    ) => Promise<GithubPullRequestSummary>,
  ) {
    super();
  }

  getInstallation(installationId: string): Promise<GithubInstallationDetails> {
    return Promise.resolve({
      installationId,
      accountLogin: "acme",
      accountType: "Organization",
      accountId: "1",
      repositorySelection: "selected",
    });
  }

  mintInstallationToken(
    _input: MintInstallationTokenInput,
  ): Promise<GithubInstallationToken> {
    return Promise.resolve({ token: "token", expiresAt: "" });
  }

  listInstallationRepositories() {
    return Promise.resolve([{ id: "999", fullName: "acme/widgets" }]);
  }

  listPullRequestsForHead(): Promise<GithubPullRequestSummary[]> {
    return Promise.resolve([]);
  }

  getPullRequest(input: GetPullRequestInput): Promise<GithubPullRequestSummary> {
    return this.readPullRequest(input);
  }

  computeRepoScopeKey(): string {
    return "scope";
  }
}

function storedRow(over: Partial<GithubPullRequestRow> = {}) {
  return {
    organizationId: "org-1",
    repositoryHost: REF.repositoryHost,
    repositoryFullName: REF.repositoryFullName,
    headBranch: "feat/linkage",
    prNumber: REF.prNumber,
    htmlUrl: "https://github.com/acme/widgets/pull/7",
    title: "Link sessions to pull requests",
    state: "open",
    isDraft: false,
    authorLogin: "someone",
    prCreatedAt: MAPPED_AT,
    prClosedAt: null,
    prMergedAt: null,
    prUpdatedAt: MAPPED_AT,
    mappedAt: MAPPED_AT,
    lastCheckedAt: MAPPED_AT,
    ...over,
  } satisfies GithubPullRequestRow;
}

function serviceWith({
  stored,
  getPullRequest,
  redis = null,
  find,
}: {
  stored: GithubPullRequestRow | null;
  getPullRequest: (input: GetPullRequestInput) => Promise<GithubPullRequestSummary>;
  redis?: GithubRedisPort | null;
  find?: (input: { prNumber: number }) => Promise<GithubPullRequestRow | null>;
}) {
  const repository = new TestPullRequestRepository(
    find ?? (() => Promise.resolve(stored)),
  );
  const appTokens = new TestAppTokens(getPullRequest);
  const installationRepository = new TestInstallationRepository();
  const access = GithubInstallationAccessService.create(
    installationRepository,
    appTokens,
  );
  const installations = GithubInstallationsService.create(
    installationRepository,
    appTokens,
    new TestOrganizationService(),
    access,
  );
  const service = GithubPullRequestStatusService.create({
    repository,
    installations,
    appTokens,
    cache: GithubPullRequestStatusCacheService.create(redis),
  });
  return { service, refreshSnapshot: repository.refreshSnapshot };
}

describe("deriveStatus", () => {
  describe("given pull requests in each state on GitHub", () => {
    /** @scenario "Live status derives open, draft, merged and closed" */
    it("derives the matching status from state, draft flag and merge time", () => {
      expect(deriveStatus({ mergedAt: null, state: "open", draft: false })).toBe("open");
      expect(deriveStatus({ mergedAt: null, state: "open", draft: true })).toBe("draft");
      expect(
        deriveStatus({
          mergedAt: "2026-05-02T00:00:00Z",
          state: "closed",
          draft: false,
        }),
      ).toBe("merged");
      expect(deriveStatus({ mergedAt: null, state: "closed", draft: false })).toBe(
        "closed",
      );
    });

    it("calls a merged pull request merged even while GitHub still calls it a draft", () => {
      expect(
        deriveStatus({
          mergedAt: "2026-05-02T00:00:00Z",
          state: "closed",
          draft: true,
        }),
      ).toBe("merged");
    });
  });
});

describe("GithubPullRequestStatusService", () => {
  describe("given GitHub rate limits the live status read", () => {
    /** @scenario "A rate limited live read falls back to the stored snapshot" */
    it("returns the stored snapshot label, marked as a snapshot", async () => {
      const { service } = serviceWith({
        stored: storedRow({ state: "closed", prMergedAt: MAPPED_AT }),
        getPullRequest: vi
          .fn()
          .mockRejectedValue(
            new GithubRateLimitedError({ retryAfterSec: 30, resetAt: null }),
          ),
      });

      const [status] = await service.getLiveStatuses({
        organizationId: "org-1",
        refs: [REF],
      });

      expect(status).toEqual({
        ...REF,
        status: "merged",
        source: "snapshot",
        mappedAt: MAPPED_AT,
      });
    });
  });

  describe("given GitHub answers", () => {
    it("returns the live status and refreshes a snapshot that has drifted", async () => {
      const { service, refreshSnapshot } = serviceWith({
        stored: storedRow(),
        getPullRequest: vi.fn().mockResolvedValue({
          number: 7,
          htmlUrl: REF.repositoryFullName,
          title: "Link sessions to pull requests",
          state: "closed",
          draft: false,
          mergedAt: "2026-05-03T00:00:00Z",
          closedAt: "2026-05-03T00:00:00Z",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-03T00:00:00Z",
          authorLogin: "someone",
        }),
      });

      const [status] = await service.getLiveStatuses({
        organizationId: "org-1",
        refs: [REF],
      });

      expect(status?.status).toBe("merged");
      expect(status?.source).toBe("live");
      expect(refreshSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          prNumber: 7,
          state: "closed",
          // Carried so the store can refuse this write if a webhook has
          // already stored something newer.
          prUpdatedAt: new Date("2026-05-03T00:00:00Z"),
        }),
      );
    });

    it("leaves the snapshot alone when nothing moved", async () => {
      const { service, refreshSnapshot } = serviceWith({
        stored: storedRow(),
        getPullRequest: vi.fn().mockResolvedValue({
          number: 7,
          htmlUrl: REF.repositoryFullName,
          title: "Link sessions to pull requests",
          state: "open",
          draft: false,
          mergedAt: null,
          closedAt: null,
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
          authorLogin: "someone",
        }),
      });

      await service.getLiveStatuses({ organizationId: "org-1", refs: [REF] });

      expect(refreshSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("given a pull request the organization never mapped", () => {
    it("omits it rather than inventing a status", async () => {
      const { service } = serviceWith({
        stored: null,
        getPullRequest: vi.fn(),
      });

      await expect(
        service.getLiveStatuses({ organizationId: "org-1", refs: [REF] }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a live status is cached", () => {
    it("caches each pull request under its own key", async () => {
      const redis = new TestRedis();
      const getPullRequest = vi
        .fn()
        .mockResolvedValueOnce({
          number: 7,
          htmlUrl: "https://github.com/acme/widgets/pull/7",
          title: "Seven",
          state: "closed",
          draft: false,
          mergedAt: "2026-05-02T00:00:00Z",
          closedAt: "2026-05-02T00:00:00Z",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-02T00:00:00Z",
          authorLogin: "someone",
        })
        .mockResolvedValueOnce({
          number: 8,
          htmlUrl: "https://github.com/acme/widgets/pull/8",
          title: "Eight",
          state: "open",
          draft: false,
          mergedAt: null,
          closedAt: null,
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-02T00:00:00Z",
          authorLogin: "someone",
        });
      const { service } = serviceWith({
        stored: null,
        find: ({ prNumber }) => Promise.resolve(storedRow({ prNumber })),
        getPullRequest,
        redis,
      });

      const [merged] = await service.getLiveStatuses({
        organizationId: "org-1",
        refs: [{ ...REF, prNumber: 7 }],
      });
      const [open] = await service.getLiveStatuses({
        organizationId: "org-1",
        refs: [{ ...REF, prNumber: 8 }],
      });

      expect(merged?.status).toBe("merged");
      // The second pull request must not be answered from the first one's entry.
      expect(open?.status).toBe("open");
      expect([...redis.store.keys()].sort()).toEqual([
        "gh:prstatus:org-1:github.com:acme/widgets:7",
        "gh:prstatus:org-1:github.com:acme/widgets:8",
      ]);
    });

    /** @scenario "Live status is cached briefly" */
    it("answers the second read of one pull request from the cache", async () => {
      const redis = new TestRedis();
      const getPullRequest = vi.fn().mockResolvedValue({
        number: 7,
        htmlUrl: "https://github.com/acme/widgets/pull/7",
        title: "Seven",
        state: "open",
        draft: false,
        mergedAt: null,
        closedAt: null,
        createdAt: "2026-05-01T00:00:00Z",
        updatedAt: "2026-05-02T00:00:00Z",
        authorLogin: "someone",
      });
      const { service } = serviceWith({
        stored: storedRow(),
        getPullRequest,
        redis,
      });

      await service.getLiveStatuses({ organizationId: "org-1", refs: [REF] });
      await service.getLiveStatuses({ organizationId: "org-1", refs: [REF] });

      expect(getPullRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("given invalid input", () => {
    it("refuses the whole call rather than answering part of it", async () => {
      const { service } = serviceWith({
        stored: storedRow(),
        getPullRequest: vi.fn(),
      });

      for (const refs of [
        [{ ...REF, repositoryFullName: "widgets" }],
        [{ ...REF, prNumber: 0 }],
        [{ ...REF, repositoryHost: "" }],
        Array.from({ length: MAX_STATUS_REFS + 1 }, () => REF),
      ]) {
        await expect(
          service.getLiveStatuses({ organizationId: "org-1", refs }),
        ).rejects.toBeInstanceOf(HandledError);
      }
    });
  });
});
