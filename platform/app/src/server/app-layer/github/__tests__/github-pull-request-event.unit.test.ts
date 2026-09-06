/**
 * @vitest-environment node
 *
 * The `pull_request` webhook at the seam where a delivery becomes a write:
 * which actions count, which deliveries are dropped and why, and the fact that
 * none of it calls GitHub back.
 *
 * The repository is a spy rather than the real Postgres one, because what is
 * under test here is the decision to write at all. That the write lands
 * correctly is the integration suite's job.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it, vi } from "vitest";

import { GithubPullRequestMappingService } from "../github-pull-request-mapping.service";
import { parseGithubPullRequestEvent } from "../githubPullRequestEvent";

/** A delivery as GitHub sends it, trimmed to the fields the parser reads. */
function delivery(over: Record<string, unknown> = {}) {
  return {
    action: "opened",
    installation: { id: 4242 },
    repository: {
      name: "widgets",
      full_name: "acme/widgets",
      owner: { login: "acme" },
    },
    pull_request: {
      number: 7,
      html_url: "https://github.com/acme/widgets/pull/7",
      title: "Link sessions to pull requests",
      state: "open",
      draft: false,
      merged_at: null,
      closed_at: null,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-01T11:00:00.000Z",
      user: { login: "someone" },
      head: { ref: "feat/linkage", repo: { full_name: "acme/widgets" } },
    },
    ...over,
  };
}

function serviceWith({
  installation,
}: {
  installation: { organizationId: string } | null;
}) {
  const repository = {
    upsertPullRequests: vi.fn().mockResolvedValue(undefined),
    findBranchCheck: vi.fn().mockResolvedValue(null),
    upsertBranchCheck: vi.fn().mockResolvedValue(undefined),
    bringBranchRecheckForward: vi.fn().mockResolvedValue(undefined),
  };
  const listPullRequestsForHead = vi.fn();
  const getByInstallationId = vi.fn().mockResolvedValue(installation);
  const service = new GithubPullRequestMappingService({
    repository: repository as never,
    installations: { getByInstallationId } as never,
    appTokens: { listPullRequestsForHead } as never,
    resolveOrganizationId: vi.fn(),
    findProjectIds: vi.fn(),
    sessions: { listRecent: vi.fn() },
  });
  return { service, repository, listPullRequestsForHead, getByInstallationId };
}

/** Parse a delivery the route would accept, failing loudly if it does not. */
function parsed(payload: unknown) {
  const event = parseGithubPullRequestEvent(payload);
  if (!event) throw new Error("expected the delivery to parse");
  return event;
}

describe("pull request announcements", () => {
  describe("when a pull request is opened on a covered repository", () => {
    it("writes the pull request without asking GitHub anything", async () => {
      const { service, repository, listPullRequestsForHead } = serviceWith({
        installation: { organizationId: "org-1" },
      });

      await expect(
        service.applyPullRequestEvent(parsed(delivery())),
      ).resolves.toBe(true);

      expect(listPullRequestsForHead).not.toHaveBeenCalled();
      expect(repository.upsertPullRequests).toHaveBeenCalledTimes(1);
      const [written] =
        repository.upsertPullRequests.mock.calls[0]![0].pullRequests;
      expect(written).toMatchObject({
        organizationId: "org-1",
        repositoryHost: "github.com",
        repositoryFullName: "acme/widgets",
        headBranch: "feat/linkage",
        prNumber: 7,
        state: "open",
        isDraft: false,
        authorLogin: "someone",
        // The delivery's own `updated_at`, carried through so the store can
        // order this write against another delivery about the same row.
        prUpdatedAt: new Date("2026-08-01T11:00:00.000Z"),
      });
    });
  });

  describe("when the announcement carries no usable update time", () => {
    it("does not parse without one, because it cannot be ordered against another delivery", () => {
      const { updated_at: _dropped, ...rest } = delivery().pull_request as {
        updated_at: string;
      } & Record<string, unknown>;

      expect(
        parseGithubPullRequestEvent(delivery({ pull_request: rest })),
      ).toBeNull();
    });

    it("does not parse one that is not an instant, rather than storing an invalid date", () => {
      const malformed = delivery({
        pull_request: { ...delivery().pull_request, updated_at: "yesterday" },
      });

      expect(parseGithubPullRequestEvent(malformed)).toBeNull();
    });

    it("parses an update time carrying a zone offset", () => {
      const offset = delivery({
        pull_request: {
          ...delivery().pull_request,
          updated_at: "2026-08-01T13:00:00+02:00",
        },
      });

      expect(parsed(offset).pullRequest.updatedAt).toBe(
        "2026-08-01T13:00:00+02:00",
      );
    });
  });

  describe("when the announcement carries an installation with no local record", () => {
    /** @scenario "An announcement for a connection this instance does not hold is dropped" */
    it("stores nothing for it", async () => {
      const { service, repository } = serviceWith({ installation: null });

      await expect(
        service.applyPullRequestEvent(parsed(delivery())),
      ).resolves.toBe(false);

      expect(repository.upsertPullRequests).not.toHaveBeenCalled();
      expect(repository.upsertBranchCheck).not.toHaveBeenCalled();
    });
  });

  describe("when the announcement changes nothing the page shows", () => {
    /** @scenario "An announcement that changes nothing the page shows is dropped" */
    it("writes nothing for a label being added", async () => {
      const { service, repository, getByInstallationId } = serviceWith({
        installation: { organizationId: "org-1" },
      });

      await expect(
        service.applyPullRequestEvent(parsed(delivery({ action: "labeled" }))),
      ).resolves.toBe(false);

      expect(repository.upsertPullRequests).not.toHaveBeenCalled();
      expect(repository.upsertBranchCheck).not.toHaveBeenCalled();
      // Dropped before the connection is even resolved, so a busy repository's
      // label traffic costs no read either.
      expect(getByInstallationId).not.toHaveBeenCalled();
    });
  });

  describe("when the announcement changes something stored or shown", () => {
    it.each([
      "reopened",
      "closed",
      "edited",
      "ready_for_review",
      "converted_to_draft",
      "synchronize",
    ])("applies the %s announcement", async (action) => {
      const { service, repository } = serviceWith({
        installation: { organizationId: "org-1" },
      });

      await expect(
        service.applyPullRequestEvent(parsed(delivery({ action }))),
      ).resolves.toBe(true);

      expect(repository.upsertPullRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the pull request was opened from a fork", () => {
    /** @scenario "An announcement for a pull request opened from a fork is dropped" */
    it("does not parse into something to store", () => {
      const forked = delivery({
        pull_request: {
          ...delivery().pull_request,
          head: {
            ref: "feat/linkage",
            repo: { full_name: "contributor/widgets" },
          },
        },
      });

      expect(parseGithubPullRequestEvent(forked)).toBeNull();
    });

    it("does not parse when the head repository is already deleted", () => {
      const headless = delivery({
        pull_request: {
          ...delivery().pull_request,
          head: { ref: "feat/linkage", repo: null },
        },
      });

      expect(parseGithubPullRequestEvent(headless)).toBeNull();
    });
  });

  describe("when the delivery is not a pull request event at all", () => {
    it("does not parse", () => {
      expect(parseGithubPullRequestEvent({ zen: "hi" })).toBeNull();
      expect(parseGithubPullRequestEvent(null)).toBeNull();
      // No installation means no organization to attribute the work to.
      expect(
        parseGithubPullRequestEvent(delivery({ installation: null })),
      ).toBeNull();
    });
  });
});
