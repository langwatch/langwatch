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
  deriveStatus,
  GithubPullRequestStatusService,
  MAX_STATUS_REFS,
} from "../github-pull-request-status.service";
import { GithubRateLimitedError } from "../githubAppToken";
import type { GithubPullRequestRow } from "../repositories/github-pull-requests.repository";

const REF = {
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 7,
};

const MAPPED_AT = new Date(Date.UTC(2026, 4, 1));

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
    mappedAt: MAPPED_AT,
    lastCheckedAt: MAPPED_AT,
    ...over,
  } satisfies GithubPullRequestRow;
}

function serviceWith({
  stored,
  getPullRequest,
}: {
  stored: GithubPullRequestRow | null;
  getPullRequest: ReturnType<typeof vi.fn>;
}) {
  const refreshSnapshot = vi.fn().mockResolvedValue(undefined);
  const service = new GithubPullRequestStatusService({
    repository: {
      findByNumber: vi.fn().mockResolvedValue(stored),
      refreshSnapshot,
    } as never,
    installations: {
      resolveInstallationForRepository: vi.fn().mockResolvedValue({
        installationId: "555",
        repositoryId: "999",
      }),
    } as never,
    appTokens: { getPullRequest } as never,
    redis: null,
  });
  return { service, refreshSnapshot };
}

describe("deriveStatus", () => {
  describe("given pull requests in each state on GitHub", () => {
    /** @scenario "Live status derives open, draft, merged and closed" */
    it("derives the matching status from state, draft flag and merge time", () => {
      expect(
        deriveStatus({ mergedAt: null, state: "open", draft: false }),
      ).toBe("open");
      expect(deriveStatus({ mergedAt: null, state: "open", draft: true })).toBe(
        "draft",
      );
      expect(
        deriveStatus({
          mergedAt: "2026-05-02T00:00:00Z",
          state: "closed",
          draft: false,
        }),
      ).toBe("merged");
      expect(
        deriveStatus({ mergedAt: null, state: "closed", draft: false }),
      ).toBe("closed");
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
        expect.objectContaining({ prNumber: 7, state: "closed" }),
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
