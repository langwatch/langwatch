/**
 * @vitest-environment node
 * @unit
 *
 * The fleet-wide scheduling of pull-request linkage maintenance: one sweep per
 * tick across the whole fleet rather than one per replica, and a retention
 * prune riding the same schedule.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { InMemoryProcessStore, type ProcessHandlerContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { TestGithubService } from "../fixtures/github-service.fixture";

import { EventingGithubMaintenanceAdapter } from "../../src/adapters/eventing.github-maintenance.adapter";
import {
  runGithubBranchRecheck,
  runGithubRetentionPrune,
} from "../../src/intents/github-branch-recheck.intent";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  GITHUB_RETENTION_PRUNE_INTERVAL_MS,
  type GithubBranchRecheckIntents,
  githubBranchRecheckWake,
} from "../../src/processes/github-branch-recheck.process";

const wakeContext = (at: number): ProcessHandlerContext<GithubBranchRecheckIntents> => ({
  at,
  now: at,
  key: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  projectId: "__global__",
  intents: {
    recheck: (key, payload) => ({
      intentType: "recheck",
      messageKey: key,
      payload,
    }),
    prune: (key, payload) => ({
      intentType: "prune",
      messageKey: key,
      payload,
    }),
  },
});

function createDeps() {
  return {
    github: TestGithubService.create(),
    processStore: new InMemoryProcessStore(),
  };
}

describe("githubBranchRecheck process", () => {
  describe("given the schedule fires", () => {
    describe("when the wake handler runs", () => {
      it("emits one recheck intent keyed by the tick", () => {
        const evolution = githubBranchRecheckWake(
          { lastRecheckAt: 500, lastPruneAt: 1_000 },
          wakeContext(1_000),
        );

        expect(evolution.state.lastRecheckAt).toBe(1_000);
        expect(evolution.intents).toEqual([
          {
            intentType: "recheck",
            messageKey: "recheck:1000",
            payload: { scheduledFor: 1_000 },
          },
        ]);
      });

      /**
       * The fence: a redelivered wake at the same slot must produce the same
       * intent key, so exactly one of the racing workers commits and the rest
       * stand down instead of all sweeping.
       */
      it("keys the intent by the tick so a redelivered wake collapses", () => {
        const first = githubBranchRecheckWake(
          GITHUB_BRANCH_RECHECK_INITIAL_STATE,
          wakeContext(2_000),
        );
        const redelivered = githubBranchRecheckWake(first.state, wakeContext(2_000));

        expect(redelivered.intents?.[0]).toEqual(first.intents?.[0]);
        expect(redelivered.intents?.[0]).toBeDefined();
      });
    });
  });

  describe("given the prune interval has not elapsed", () => {
    it("emits no prune intent, and leaves the prune clock alone", () => {
      const evolution = githubBranchRecheckWake(
        { lastRecheckAt: 0, lastPruneAt: 1_000 },
        wakeContext(1_000 + GITHUB_RETENTION_PRUNE_INTERVAL_MS - 1),
      );

      expect(evolution.intents).toHaveLength(1);
      expect(evolution.state.lastPruneAt).toBe(1_000);
    });
  });

  describe("given the prune interval has elapsed", () => {
    it("emits the prune alongside the recheck", () => {
      const at = 1_000 + GITHUB_RETENTION_PRUNE_INTERVAL_MS;
      const evolution = githubBranchRecheckWake(
        { lastRecheckAt: 0, lastPruneAt: 1_000 },
        wakeContext(at),
      );

      expect(evolution.intents).toMatchObject([{ intentType: "recheck" }, { intentType: "prune" }]);
      expect(evolution.state.lastPruneAt).toBe(at);
    });

    it("prunes on the very first wake, when nothing has been pruned yet", () => {
      const evolution = githubBranchRecheckWake(
        GITHUB_BRANCH_RECHECK_INITIAL_STATE,
        wakeContext(1_000),
      );

      expect(evolution.intents).toHaveLength(2);
    });
  });

  describe("given branches are due", () => {
    describe("when the recheck intent runs", () => {
      it("runs exactly one pass", async () => {
        const deps = createDeps();
        const recheck = vi.spyOn(deps.github, "recheckDueBranches").mockResolvedValue(4);

        await runGithubBranchRecheck(deps)();

        expect(recheck).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given rows past the activity horizon", () => {
    describe("when the prune intent runs", () => {
      it("prunes them and its own bookkeeping rows", async () => {
        const deps = createDeps();
        const prune = vi.spyOn(deps.github, "pruneStaleBranchLinkage").mockResolvedValue({
          branchChecks: 12,
        });
        const deleteDispatchedBefore = vi.spyOn(deps.processStore, "deleteDispatchedBefore");

        vi.spyOn(Date, "now").mockReturnValue(10_000_000);

        await runGithubRetentionPrune(deps)();

        expect(prune).toHaveBeenCalledOnce();
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
          before: 10_000_000 - 24 * 60 * 60 * 1000,
        });
      });

      it("still counts the prune as done when its own retention fails", async () => {
        const deps = createDeps();
        const prune = vi.spyOn(deps.github, "pruneStaleBranchLinkage").mockResolvedValue({
          branchChecks: 1,
        });
        vi.spyOn(deps.processStore, "deleteDispatchedBefore").mockRejectedValue(
          new Error("pg down"),
        );

        await expect(runGithubRetentionPrune(deps)()).resolves.toBeUndefined();

        expect(prune).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the pipeline is built", () => {
    describe("when its shape is inspected", () => {
      /** @scenario "The recheck sweep runs once per fleet, not once per replica" */
      it("registers the sweep as a scheduled process and appends no events", () => {
        const pipeline = EventingGithubMaintenanceAdapter.create({
          ...createDeps(),
        }).build();

        const pm = pipeline.processManagers.get(GITHUB_BRANCH_RECHECK_PROCESS_NAME);
        expect(pm).toBeDefined();
        expect(pm?.config.schedule?.everyMs).toBeGreaterThan(0);
        // No event handlers: a scheduled-only process must not register a
        // subscriber, or a maintenance sweep starts costing per-event work.
        expect(pm?.config.eventTypes).toHaveLength(0);
        // The GitHub calls run behind the lease, not in the wake commit.
        expect(pm?.config.outbox?.leaseDurationMs).toBeGreaterThan(0);
      });
    });
  });
});
