import { describe, expect, it, vi } from "vitest";
import {
  decideReconcileAction,
  reconcileLangyTurns,
  type InFlightTurnCandidate,
} from "../langy-turn-reconciler";

describe("decideReconcileAction", () => {
  describe("given a turn that already finalized", () => {
    it("resumes (no-op) rather than re-driving", () => {
      expect(
        decideReconcileAction({
          finalized: true,
          hardError: false,
          attempts: 1,
          maxAttempts: 3,
          hadSideEffect: false,
        }),
      ).toBe("resume");
    });
  });

  describe("given a hard, non-retryable worker error", () => {
    it("fails fast without retry", () => {
      expect(
        decideReconcileAction({
          finalized: false,
          hardError: true,
          attempts: 1,
          maxAttempts: 3,
          hadSideEffect: false,
        }),
      ).toBe("fail-fast");
    });
  });

  describe("given a stalled turn that already had a side effect", () => {
    it("gives up rather than risk a duplicate side effect (not idempotent)", () => {
      expect(
        decideReconcileAction({
          finalized: false,
          hardError: false,
          attempts: 1,
          maxAttempts: 3,
          hadSideEffect: true,
        }),
      ).toBe("give-up");
    });
  });

  describe("given a stalled turn with retries left and no side effect", () => {
    it("retries", () => {
      expect(
        decideReconcileAction({
          finalized: false,
          hardError: false,
          attempts: 1,
          maxAttempts: 3,
          hadSideEffect: false,
        }),
      ).toBe("retry");
    });
  });

  describe("given a turn that exhausted its retry budget", () => {
    it("gives up", () => {
      expect(
        decideReconcileAction({
          finalized: false,
          hardError: false,
          attempts: 3,
          maxAttempts: 3,
          hadSideEffect: false,
        }),
      ).toBe("give-up");
    });
  });
});

describe("reconcileLangyTurns", () => {
  const candidate = (turnId: string): InFlightTurnCandidate => ({
    projectId: "proj_1",
    conversationId: `conv_${turnId}`,
    turnId,
    lastActivityAtMs: 0,
  });

  describe("when a turn's heartbeat has lapsed", () => {
    it("drives it to a terminal failure", async () => {
      const failTurn = vi.fn().mockResolvedValue(undefined);
      const buffer = {
        liveness: vi
          .fn()
          .mockResolvedValue({ present: false, stale: true, lastBeatAt: null }),
      };

      const result = await reconcileLangyTurns({
        buffer,
        conversations: { failTurn },
        findCandidates: async () => [candidate("t1")],
      });

      expect(result.failed).toBe(1);
      expect(result.skippedAlive).toBe(0);
      expect(failTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj_1",
          conversationId: "conv_t1",
          turnId: "t1",
        }),
      );
    });
  });

  describe("when a turn's heartbeat is still fresh", () => {
    it("leaves the healthy turn alone", async () => {
      const failTurn = vi.fn().mockResolvedValue(undefined);
      const buffer = {
        liveness: vi
          .fn()
          .mockResolvedValue({ present: true, stale: false, lastBeatAt: 1 }),
      };

      const result = await reconcileLangyTurns({
        buffer,
        conversations: { failTurn },
        findCandidates: async () => [candidate("t2")],
      });

      expect(result.failed).toBe(0);
      expect(result.skippedAlive).toBe(1);
      expect(failTurn).not.toHaveBeenCalled();
    });
  });

  describe("when one turn's failTurn dispatch throws", () => {
    it("counts it as errored and continues the sweep", async () => {
      const failTurn = vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue(undefined);
      const buffer = {
        liveness: vi
          .fn()
          .mockResolvedValue({ present: false, stale: true, lastBeatAt: null }),
      };

      const result = await reconcileLangyTurns({
        buffer,
        conversations: { failTurn },
        findCandidates: async () => [candidate("t3"), candidate("t4")],
      });

      expect(result.errored).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
