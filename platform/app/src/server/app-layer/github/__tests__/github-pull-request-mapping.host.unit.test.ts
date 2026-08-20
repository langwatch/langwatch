/**
 * @vitest-environment node
 * @unit
 *
 * Branch mapping on an instance bound to a GitHub Enterprise Server host: which
 * repositories it answers for, and which host the rows it writes carry.
 *
 * The repository is a spy rather than the real Postgres one, because what is
 * under test is the host each write is keyed by, not that the write lands.
 *
 * @see specs/integrations/github-connection.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level declarations, so the mutable
// env object has to come from vi.hoisted to exist when the factory runs.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { GITHUB_LANGY_HOST: undefined as string | undefined },
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

import { GithubPullRequestMappingService } from "../github-pull-request-mapping.service";
import { parseGithubPullRequestEvent } from "../githubPullRequestEvent";

const GHES = "github.acme-corp.internal";

/** A delivery as GitHub sends it, trimmed to the fields the parser reads. */
function delivery() {
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
      html_url: `https://${GHES}/acme/widgets/pull/7`,
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
  };
}

function serviceWith() {
  const repository = {
    upsertPullRequests: vi.fn().mockResolvedValue(undefined),
    findBranchCheck: vi.fn().mockResolvedValue(null),
    upsertBranchCheck: vi.fn().mockResolvedValue(undefined),
    bringBranchRecheckForward: vi.fn().mockResolvedValue(undefined),
    claimBranchLookup: vi.fn().mockResolvedValue(true),
    touchBranchCheckRequestedAt: vi.fn().mockResolvedValue(undefined),
  };
  const listPullRequestsForHead = vi.fn().mockResolvedValue([]);
  const resolveInstallationForRepository = vi
    .fn()
    .mockResolvedValue({ installationId: "4242", repositoryId: "999" });
  const service = new GithubPullRequestMappingService({
    repository: repository as never,
    installations: {
      getByInstallationId: vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1" }),
      resolveInstallationForRepository,
    } as never,
    appTokens: { listPullRequestsForHead } as never,
    resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
    findProjectIds: vi.fn(),
    sessions: { listRecent: vi.fn() },
  });
  return { service, repository, listPullRequestsForHead };
}

function parsed(payload: unknown) {
  const event = parseGithubPullRequestEvent(payload);
  if (!event) throw new Error("expected the delivery to parse");
  return event;
}

describe("given an instance bound to a GitHub Enterprise Server host", () => {
  beforeEach(() => {
    mockEnv.GITHUB_LANGY_HOST = GHES;
  });

  describe("when GitHub announces a pull request", () => {
    /** @scenario "A pull request announced over the webhook is recorded under the configured host" */
    it("stores it under the configured host, not github.com", async () => {
      const { service, repository } = serviceWith();

      await expect(
        service.applyPullRequestEvent(parsed(delivery())),
      ).resolves.toBe(true);

      const [written] =
        repository.upsertPullRequests.mock.calls[0]![0].pullRequests;
      expect(written).toMatchObject({
        organizationId: "org-1",
        repositoryHost: GHES,
        repositoryFullName: "acme/widgets",
        prNumber: 7,
      });
      expect(repository.upsertBranchCheck).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryHost: GHES }),
      );
    });
  });

  describe("when a session reports a repository on the configured host", () => {
    /** @scenario "A repository on the configured host is mapped" */
    it("maps the branch and keys it by that host", async () => {
      const { service, repository, listPullRequestsForHead } = serviceWith();

      await service.requestBranchMapping({
        tenantId: "project-1",
        repositoryHost: GHES,
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
      });

      expect(listPullRequestsForHead).toHaveBeenCalledTimes(1);
      expect(repository.claimBranchLookup).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryHost: GHES }),
      );
    });

    it("maps a session that reported no host at all onto that host", async () => {
      const { service, repository } = serviceWith();

      await service.requestBranchMapping({
        tenantId: "project-1",
        repositoryHost: "",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
      });

      expect(repository.claimBranchLookup).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryHost: GHES }),
      );
    });
  });

  describe("when a session reports a github.com repository", () => {
    /** @scenario "A repository on github.com is not mapped by an Enterprise Server instance" */
    it("asks GitHub nothing, because this instance has no connection there", async () => {
      const { service, repository, listPullRequestsForHead } = serviceWith();

      await service.requestBranchMapping({
        tenantId: "project-1",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
      });

      expect(listPullRequestsForHead).not.toHaveBeenCalled();
      expect(repository.claimBranchLookup).not.toHaveBeenCalled();
      expect(repository.upsertBranchCheck).not.toHaveBeenCalled();
    });
  });
});
