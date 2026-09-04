import { describe, expect, it, vi } from "vitest";
import { GithubBranchInstallationsPort } from "../../ports/github-branch-installations.port";
import { GithubAppTokenPort, type GithubPullRequestSummary } from "../../ports/github-app-token.port";
import { GithubHostPort } from "../../ports/github-host.port";
import { GithubPullRequestsRepository } from "../../repositories/github-pull-requests.repository";
import type {
  GithubBranchCheckRow,
  UpsertGithubBranchCheckInput,
} from "../../repositories/github-pull-requests.repository";
import { GithubBranchMappingService, type BranchMappingTarget } from "../github-branch-mapping.service";

const NOW = new Date("2026-01-01T00:00:00Z").getTime();

const target: BranchMappingTarget = {
  organizationId: "org-1",
  repositoryHost: "github.com",
  repositoryOwner: "langwatch",
  repositoryName: "langwatch",
  headBranch: "feat/x",
  origin: "sweep",
};

class FakeHost extends GithubHostPort {
  getHost(): string {
    return "github.com";
  }
  getApiBase(): string {
    return "https://api.github.com";
  }
  getWebBase(): string {
    return "https://github.com";
  }
  getAppInstallUrl(): string {
    return "https://github.com/apps/x";
  }
  isMappable(): boolean {
    return true;
  }
  normalize(host: string): string {
    return host;
  }
}

class FakeInstallations extends GithubBranchInstallationsPort {
  installation: { organizationId: string } | null = null;
  tryGetByInstallationId(): Promise<{ organizationId: string } | null> {
    return Promise.resolve(this.installation);
  }
  tryResolveInstallationForRepository(): Promise<{ installationId: string; repositoryId: string } | null> {
    return Promise.resolve({ installationId: "install-1", repositoryId: "repo-1" });
  }
}

class FakeAppTokens extends GithubAppTokenPort {
  pullRequests: GithubPullRequestSummary[] = [];
  listPullRequestsForHead(): Promise<GithubPullRequestSummary[]> {
    return Promise.resolve(this.pullRequests);
  }
  getPullRequest(): Promise<GithubPullRequestSummary> {
    throw new Error("not used");
  }
}

class FakeRepository extends GithubPullRequestsRepository {
  readonly upserts: UpsertGithubBranchCheckInput[] = [];
  branchCheck: GithubBranchCheckRow | null = null;

  upsertPullRequests(): Promise<void> {
    return Promise.resolve();
  }
  findAllByBranches(): Promise<never[]> {
    return Promise.resolve([]);
  }
  findAllByBranchKeys(): Promise<never[]> {
    return Promise.resolve([]);
  }
  tryFindByNumber(): Promise<null> {
    return Promise.resolve(null);
  }
  refreshSnapshot(): Promise<void> {
    return Promise.resolve();
  }
  tryFindBranchCheck(): Promise<GithubBranchCheckRow | null> {
    return Promise.resolve(this.branchCheck);
  }
  upsertBranchCheck(input: UpsertGithubBranchCheckInput): Promise<void> {
    this.upserts.push(input);
    return Promise.resolve();
  }
  claimBranchLookup(): Promise<boolean> {
    return Promise.resolve(true);
  }
  bringBranchRecheckForward(): Promise<void> {
    return Promise.resolve();
  }
  touchBranchCheckRequestedAt(): Promise<void> {
    return Promise.resolve();
  }
}

function service(
  repository: FakeRepository,
  appTokens = new FakeAppTokens(),
  installations = new FakeInstallations(),
) {
  return GithubBranchMappingService.create({
    repository,
    installations,
    appTokens,
    host: new FakeHost(),
    now: () => NOW,
  });
}

const pullRequestEvent = {
  action: "opened",
  installationId: "install-1",
  repositoryOwner: "langwatch",
  repositoryName: "langwatch",
  headBranch: "feat/x",
  pullRequest: {
    number: 1,
    htmlUrl: "https://github.com/langwatch/langwatch/pull/1",
    title: "Add linkage",
    state: "open",
    draft: false,
    mergedAt: null,
    closedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    authorLogin: "ada",
  },
};

describe("given a branch with no pull request that the sweep asks GitHub about", () => {
  describe("when the sweep records the empty answer", () => {
    /** @scenario "The sweep does not renew the demand it selects on" */
    it("leaves the branch's last demand time unchanged", async () => {
      const repository = new FakeRepository();

      await service(repository).map({ ...target, origin: "sweep" });

      expect(repository.upserts).toHaveLength(1);
      expect(repository.upserts[0]?.lastRequestedAt).toBeNull();
    });
  });
});

describe("given a branch with no pull request", () => {
  describe("when a session folds on that branch and the mapping runs", () => {
    /** @scenario "A session folding on a branch records demand for it" */
    it("moves the branch's last demand time to the time of the fold", async () => {
      const repository = new FakeRepository();

      await service(repository).map({ ...target, origin: "demand" });

      expect(repository.upserts).toHaveLength(1);
      expect(repository.upserts[0]?.lastRequestedAt).toEqual(new Date(NOW));
    });
  });
});

describe("given an announcement carrying an installation with no local record", () => {
  describe("when it arrives", () => {
    /** @scenario "An announcement for a connection this instance does not hold is dropped" */
    it("stores nothing for it", async () => {
      const repository = new FakeRepository();
      const installations = new FakeInstallations();
      installations.installation = null;

      const applied = await service(repository, new FakeAppTokens(), installations).applyPullRequestEvent(
        pullRequestEvent,
      );

      expect(applied).toBe(false);
      expect(repository.upserts).toHaveLength(0);
    });
  });
});

describe("given an announcement that a label was added to a pull request", () => {
  describe("when it arrives", () => {
    /** @scenario "An announcement that changes nothing the page shows is dropped" */
    it("writes nothing", async () => {
      const repository = new FakeRepository();
      const installations = new FakeInstallations();
      installations.installation = { organizationId: "org-1" };

      const applied = await service(repository, new FakeAppTokens(), installations).applyPullRequestEvent({
        ...pullRequestEvent,
        action: "labeled",
      });

      expect(applied).toBe(false);
      expect(repository.upserts).toHaveLength(0);
    });
  });
});
