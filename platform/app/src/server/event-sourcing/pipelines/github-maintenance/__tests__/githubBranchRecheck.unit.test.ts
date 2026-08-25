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
import { describe, expect, it, vi } from "vitest";

import { createGithubMaintenancePipeline } from "../pipeline";
import {
  GITHUB_BRANCH_RECHECK_INITIAL_STATE,
  GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  GITHUB_RETENTION_PRUNE_INTERVAL_MS,
  githubBranchRecheckWake,
  runGithubBranchRecheck,
  runGithubRetentionPrune,
} from "../process-manager/githubBranchRecheck.process";

const wakeContext = (at: number) => ({
  at,
  now: at,
  key: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
  projectId: "__global__",
  intents: {
    recheck: (key: string, payload: unknown) => ({
      type: "recheck",
      key,
      payload,
    }),
    prune: (key: string, payload: unknown) => ({ type: "prune", key, payload }),
  },
});

const noopDeps = {
  recheck: async () => 0,
  prune: async () => ({ branchChecks: 0, pullRequests: 0 }),
  deleteDispatchedBefore: async () => 0,
};

describe("githubBranchRecheck process", () => {
  describe("given the schedule fires", () => {
    describe("when the wake handler runs", () => {
      it("emits one recheck intent keyed by the tick", () => {
        const evolution = githubBranchRecheckWake(
          { lastRecheckAt: 500, lastPruneAt: 1_000 },
          wakeContext(1_000) as never,
        );

        expect(evolution.state.lastRecheckAt).toBe(1_000);
        expect(evolution.intents).toEqual([
          {
            type: "recheck",
            key: "recheck:1000",
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
          wakeContext(2_000) as never,
        );
        const redelivered = githubBranchRecheckWake(
          first.state,
          wakeContext(2_000) as never,
        );

        expect(redelivered.intents?.[0]).toEqual(first.intents?.[0]);
        expect(redelivered.intents?.[0]).toBeDefined();
      });
    });
  });

  describe("given the prune interval has not elapsed", () => {
    it("emits no prune intent, and leaves the prune clock alone", () => {
      const evolution = githubBranchRecheckWake(
        { lastRecheckAt: 0, lastPruneAt: 1_000 },
        wakeContext(1_000 + GITHUB_RETENTION_PRUNE_INTERVAL_MS - 1) as never,
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
        wakeContext(at) as never,
      );

      expect(evolution.intents?.map((intent) => (intent as any).type)).toEqual([
        "recheck",
        "prune",
      ]);
      expect(evolution.state.lastPruneAt).toBe(at);
    });

    it("prunes on the very first wake, when nothing has been pruned yet", () => {
      const evolution = githubBranchRecheckWake(
        GITHUB_BRANCH_RECHECK_INITIAL_STATE,
        wakeContext(1_000) as never,
      );

      expect(evolution.intents).toHaveLength(2);
    });
  });

  describe("given branches are due", () => {
    describe("when the recheck intent runs", () => {
      it("runs exactly one pass", async () => {
        const recheck = vi.fn(async () => 4);

        await runGithubBranchRecheck({ ...noopDeps, recheck })();

        expect(recheck).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given rows past the activity horizon", () => {
    describe("when the prune intent runs", () => {
      it("prunes them and its own bookkeeping rows", async () => {
        const prune = vi.fn(async () => ({
          branchChecks: 12,
          pullRequests: 3,
        }));
        const deleteDispatchedBefore = vi.fn(async () => 0);

        await runGithubRetentionPrune({
          ...noopDeps,
          prune,
          deleteDispatchedBefore,
          now: () => 10_000_000,
        })();

        expect(prune).toHaveBeenCalledOnce();
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
          before: 10_000_000 - 24 * 60 * 60 * 1000,
        });
      });

      it("still counts the prune as done when its own retention fails", async () => {
        const prune = vi.fn(async () => ({
          branchChecks: 1,
          pullRequests: 0,
        }));

        await expect(
          runGithubRetentionPrune({
            ...noopDeps,
            prune,
            deleteDispatchedBefore: async () => {
              throw new Error("pg down");
            },
          })(),
        ).resolves.toBeUndefined();

        expect(prune).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the pipeline is built", () => {
    describe("when its shape is inspected", () => {
      /** @scenario "The recheck sweep runs once per fleet, not once per replica" */
      it("registers the sweep as a scheduled process and appends no events", () => {
        const pipeline = createGithubMaintenancePipeline({
          branchRecheck: noopDeps,
        });

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
