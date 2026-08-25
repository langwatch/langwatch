/**
 * @vitest-environment node
 * @unit
 *
 * The periodic sweep's selection: which branches it asks GitHub about again,
 * and which it has stopped caring about.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  RECHECK_ACTIVE_WITHIN_MS,
  RECHECK_BATCH_LIMIT,
  runBranchRecheckPass,
  runBranchRetentionPrune,
} from "../github-branch-recheck.worker";
import type {
  GithubBranchCheckRow,
  GithubPullRequestsRepository,
} from "../repositories/github-pull-requests.repository";

const NOW = Date.UTC(2026, 5, 1);
const DAY = 24 * 60 * 60 * 1000;

function checkRow(over: Partial<GithubBranchCheckRow>): GithubBranchCheckRow {
  return {
    organizationId: "org-1",
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    headBranch: "feat/linkage",
    lastCheckedAt: new Date(NOW - DAY),
    prCount: 0,
    notFoundAt: new Date(NOW - DAY),
    recheckAfter: new Date(NOW - 60_000),
    attempts: 2,
    lastRequestedAt: new Date(NOW - 60_000),
    ...over,
  };
}

/**
 * A faithful stand-in for the sweep query: it applies the very predicate the
 * caller asks for, so what the test proves is the WINDOW the sweep passes, not
 * a filter the fake invented.
 */
function repositoryHolding(rows: GithubBranchCheckRow[]): GithubPullRequestsRepository {
  return {
    upsertPullRequests: vi.fn(),
    findAllByBranches: vi.fn(),
    findAllByBranchKeys: vi.fn(),
    findByNumber: vi.fn(),
    refreshSnapshot: vi.fn(),
    findBranchCheck: vi.fn(),
    upsertBranchCheck: vi.fn(),
    claimBranchLookup: vi.fn(),
    touchBranchCheckRequestedAt: vi.fn(),
    deleteStaleBefore: vi.fn(),
    findRecheckDue: vi.fn(async ({ now, activeWithinMs, limit }) =>
      rows
        .filter(
          (row) =>
            row.notFoundAt !== null &&
            row.recheckAfter !== null &&
            row.recheckAfter.getTime() <= now.getTime() &&
            row.lastRequestedAt.getTime() > now.getTime() - activeWithinMs,
        )
        .slice(0, limit),
    ),
  } as unknown as GithubPullRequestsRepository;
}

describe("runBranchRecheckPass", () => {
  describe("given a branch whose sessions all ended more than a week ago", () => {
    /** @scenario "Rechecks stop for branches with no recent session activity" */
    it("does not recheck it", async () => {
      const stale = checkRow({
        headBranch: "feat/abandoned",
        lastRequestedAt: new Date(NOW - 8 * DAY),
      });
      const active = checkRow({ headBranch: "feat/live" });
      const mapBranch = vi.fn().mockResolvedValue(undefined);

      const rechecked = await runBranchRecheckPass({
        repository: repositoryHolding([stale, active]),
        mapping: { mapBranch },
        now: () => NOW,
      });

      expect(rechecked).toBe(1);
      expect(mapBranch).toHaveBeenCalledTimes(1);
      expect(mapBranch).toHaveBeenCalledWith(
        expect.objectContaining({ headBranch: "feat/live" }),
      );
    });

    /**
     * The sweep selects on `lastRequestedAt`, so a pass that presented itself
     * as demand would renew the column it reads and no branch would ever leave
     * the sweep. The origin is what the mapping service reads to decide.
     */
    /** @scenario "The sweep does not renew the demand it selects on" */
    it("asks the mapping on its own account rather than as demand", async () => {
      const mapBranch = vi.fn().mockResolvedValue(undefined);

      await runBranchRecheckPass({
        repository: repositoryHolding([checkRow({})]),
        mapping: { mapBranch },
        now: () => NOW,
      });

      expect(mapBranch).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "sweep" }),
      );
    });

    it("asks with a one-week activity window", async () => {
      const repository = repositoryHolding([]);
      await runBranchRecheckPass({
        repository,
        mapping: { mapBranch: vi.fn() },
        now: () => NOW,
      });

      expect(repository.findRecheckDue).toHaveBeenCalledWith({
        now: new Date(NOW),
        activeWithinMs: RECHECK_ACTIVE_WITHIN_MS,
        limit: RECHECK_BATCH_LIMIT,
      });
      expect(RECHECK_ACTIVE_WITHIN_MS).toBe(7 * DAY);
    });
  });

  describe("given a branch still inside its backoff", () => {
    it("does not recheck it", async () => {
      const mapBranch = vi.fn().mockResolvedValue(undefined);

      await runBranchRecheckPass({
        repository: repositoryHolding([
          checkRow({ recheckAfter: new Date(NOW + 60_000) }),
        ]),
        mapping: { mapBranch },
        now: () => NOW,
      });

      expect(mapBranch).not.toHaveBeenCalled();
    });
  });

  describe("given a due branch", () => {
    it("splits its repository back into owner and name for the mapping", async () => {
      const mapBranch = vi.fn().mockResolvedValue(undefined);

      await runBranchRecheckPass({
        repository: repositoryHolding([checkRow({})]),
        mapping: { mapBranch },
        now: () => NOW,
      });

      expect(mapBranch).toHaveBeenCalledWith({
        organizationId: "org-1",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
        origin: "sweep",
      });
    });
  });
});

describe("runBranchRetentionPrune", () => {
  describe("given rows outside the activity window", () => {
    /**
     * One horizon, not two. A branch outside the sweep's activity window has
     * already stopped being maintained by the feature, so keeping its
     * bookkeeping keeps a row that is never read and never refreshed. Bounding
     * the prune by a knob of its own would let the two drift into disagreeing
     * about what "abandoned" means.
     */
    it("prunes at the same horizon the sweep stops sweeping at", async () => {
      const repository = repositoryHolding([]);
      repository.deleteStaleBefore = vi.fn().mockResolvedValue({ branchChecks: 7 });

      const pruned = await runBranchRetentionPrune({
        repository,
        now: () => NOW,
      });

      expect(repository.deleteStaleBefore).toHaveBeenCalledWith({
        before: new Date(NOW - RECHECK_ACTIVE_WITHIN_MS),
      });
      expect(pruned).toEqual({ branchChecks: 7 });
    });
  });
});
