import { describe, expect, it } from "vitest";

import { GithubAppTokenAdapter } from "../../adapters/github-app-token.adapter.ts";
import { GithubHostService } from "../github-host.service.ts";
import { NullGithubInstallationsRepository } from "../../repositories/github-installations.repository.ts";
import {
  type GithubBranchCheckRow,
  NullGithubPullRequestsRepository,
} from "../../repositories/github-pull-requests.repository.ts";
import { GithubInstallationAccessService } from "../github-installation-access.service.ts";
import { GithubBranchMappingService } from "../github-branch-mapping.service.ts";
import { GithubBranchMaintenanceService } from "../github-branch-maintenance.service.ts";
import { Temporal, type Instant } from "@langwatch/time";

const NOW = Date.UTC(2026, 5, 1);
const DAY = 24 * 60 * 60 * 1000;

class MaintenanceRepository extends NullGithubPullRequestsRepository {
  findRecheckInput: {
    now: Instant;
    activeWithinMs: number;
    limit: number;
  } | null = null;
  deleteBefore: Instant | null = null;
  due: GithubBranchCheckRow[] = [];
  deleted = { branchChecks: 0 };

  async findRecheckDue(input: {
    now: Instant;
    activeWithinMs: number;
    limit: number;
  }): Promise<GithubBranchCheckRow[]> {
    this.findRecheckInput = input;
    return this.due;
  }

  async deleteStaleBefore(input: { before: Instant }): Promise<{ branchChecks: number }> {
    this.deleteBefore = input.before;
    return this.deleted;
  }
}

/**
 * The sweep's own graph: pull-request rows, installation reads, an App token
 * and a host. No organization service and no project service appear here, and
 * that is the point — the sweep spans every tenant and has neither in hand.
 */
function service(repository: MaintenanceRepository) {
  const appTokens = GithubAppTokenAdapter.create("app", "test-key", null);
  const access = GithubInstallationAccessService.create(
    new NullGithubInstallationsRepository(),
    appTokens,
  );

  return GithubBranchMaintenanceService.create({
    repository,
    mapping: GithubBranchMappingService.create({
      repository,
      installations: access,
      appTokens,
      host: GithubHostService.create(),
      now: () => NOW,
    }),
    now: () => NOW,
  });
}

describe("GitHub branch maintenance", () => {
  /** @scenario "The sweep reads a bounded page of branches demanded recently" */
  it("asks only for fifty due branches demanded within the last week", async () => {
    const repository = new MaintenanceRepository();

    await service(repository).recheckDueBranches();

    expect(repository.findRecheckInput).toEqual({
      now: Temporal.Instant.fromEpochMilliseconds(NOW),
      activeWithinMs: 7 * DAY,
      limit: 50,
    });
  });

  /** @scenario "Branch bookkeeping is dropped past the activity horizon" */
  /** @scenario "Bookkeeping for a branch outside the activity window is removed" */
  it("prunes bookkeeping at the same one-week activity horizon", async () => {
    const repository = new MaintenanceRepository();
    repository.deleted = { branchChecks: 7 };

    await expect(service(repository).pruneStaleBranchLinkage()).resolves.toEqual({
      branchChecks: 7,
    });
    expect(repository.deleteBefore).toEqual(Temporal.Instant.fromEpochMilliseconds(NOW - 7 * DAY));
  });
});
