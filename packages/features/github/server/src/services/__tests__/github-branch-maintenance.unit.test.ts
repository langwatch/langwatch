import { describe, expect, it } from "vitest";

import { GithubAppTokenAdapter } from "../../adapters/github-app-token.adapter";
import { GithubHostAdapter } from "../../adapters/github-host.adapter";
import { NullGithubInstallationsRepository } from "../../repositories/github-installations.repository";
import {
  type GithubBranchCheckRow,
  NullGithubPullRequestsRepository,
} from "../../repositories/github-pull-requests.repository";
import { GithubInstallationsService } from "../github-installations.service";
import { GithubInstallationAccessService } from "../github-installation-access.service";
import { GithubBranchMappingService } from "../github-branch-mapping.service";
import { GithubBranchMaintenanceService } from "../github-branch-maintenance.service";
import { GithubPullRequestMappingService } from "../github-pull-request-mapping.service";
import {
  TestOrganizationService,
  TestProjectService,
} from "./fixtures/github-services.fixture";

const NOW = Date.UTC(2026, 5, 1);
const DAY = 24 * 60 * 60 * 1000;

class MaintenanceRepository extends NullGithubPullRequestsRepository {
  findRecheckInput: {
    now: Date;
    activeWithinMs: number;
    limit: number;
  } | null = null;
  deleteBefore: Date | null = null;
  due: GithubBranchCheckRow[] = [];
  deleted = { branchChecks: 0 };

  async findRecheckDue(input: {
    now: Date;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    this.findRecheckInput = input;
    return this.due;
  }

  async deleteStaleBefore(input: { before: Date }): Promise<{ branchChecks: number }> {
    this.deleteBefore = input.before;
    return this.deleted;
  }
}

function service(repository: MaintenanceRepository) {
  const appTokens = GithubAppTokenAdapter.create("app", "test-key", null);
  const organizations = new TestOrganizationService();
  const installationRepository = new NullGithubInstallationsRepository();
  const access = GithubInstallationAccessService.create(
    installationRepository,
    appTokens,
  );
  const installations = GithubInstallationsService.create(
    installationRepository,
    appTokens,
    organizations,
    access,
  );

  const branches = GithubBranchMappingService.create({
    repository,
    installations,
    appTokens,
    project: new TestProjectService("org-1"),
    host: GithubHostAdapter.create(),
    now: () => NOW,
  });
  const maintenance = GithubBranchMaintenanceService.create({
    repository,
    mapping: branches,
    now: () => NOW,
  });

  return GithubPullRequestMappingService.create({
    repository,
    branches,
    maintenance,
  });
}

describe("GitHub branch maintenance", () => {
  it("asks only for fifty due branches demanded within the last week", async () => {
    const repository = new MaintenanceRepository();

    await service(repository).recheckDueBranches();

    expect(repository.findRecheckInput).toEqual({
      now: new Date(NOW),
      activeWithinMs: 7 * DAY,
      limit: 50,
    });
  });

  it("prunes bookkeeping at the same one-week activity horizon", async () => {
    const repository = new MaintenanceRepository();
    repository.deleted = { branchChecks: 7 };

    await expect(service(repository).pruneStaleBranchLinkage()).resolves.toEqual({
      branchChecks: 7,
    });
    expect(repository.deleteBefore).toEqual(new Date(NOW - 7 * DAY));
  });
});
