import { describe, expect, it } from "vitest";
import { AGENT_CHAT_TIMEOUT_MS } from "../langy-turn-errors";
import {
  CLIENT_RECOVERABLE_KINDS,
  MIN_RETRY_HEADROOM_MS,
  resolveServerRecovery,
} from "../langy-turn-recovery";

/**
 * Recovery belongs on the server wherever the server can actually do it: the
 * turn processor already knows what failed and why, and re-driving the turn from
 * here means the user's message is never re-posted, no PR permit is re-reserved,
 * and the open stream just keeps streaming. These tests pin WHICH failures it
 * takes on, and — more importantly — the two gates that stop it replaying
 * something it shouldn't.
 */

function decide(overrides: Partial<Parameters<typeof resolveServerRecovery>[0]>) {
  return resolveServerRecovery({
    kind: "langy_agent_at_capacity",
    attemptsUsed: 0,
    elapsedMs: 0,
    producedOutput: false,
    ...overrides,
  });
}

describe("resolveServerRecovery", () => {
  describe("given the manager is at capacity", () => {
    it("retries in process, with a growing backoff", () => {
      const first = decide({ attemptsUsed: 0 });
      const second = decide({ attemptsUsed: 1 });
      const third = decide({ attemptsUsed: 2 });
      expect(first.retry).toBe(true);
      expect(second.retry).toBe(true);
      expect(third.retry).toBe(true);
      expect(second.delayMs).toBeGreaterThan(first.delayMs);
      expect(third.delayMs).toBeGreaterThan(second.delayMs);
    });

    it("tells the user it is busy, and how long the wait is", () => {
      const { status, delayMs } = decide({ attemptsUsed: 0 });
      expect(status).toContain("busy");
      expect(status).toContain(`${Math.round(delayMs / 1_000)}s`);
    });

    it("is bounded — it gives up after three goes", () => {
      const exhausted = decide({ attemptsUsed: 3 });
      expect(exhausted.retry).toBe(false);
      expect(exhausted.reason).toBe("attempts-exhausted");
    });
  });

  describe("given the manager is unreachable", () => {
    it("retries fast, then backs off", () => {
      const first = decide({ kind: "langy_agent_unavailable", attemptsUsed: 0 });
      const third = decide({ kind: "langy_agent_unavailable", attemptsUsed: 2 });
      expect(first.retry).toBe(true);
      expect(first.status).toContain("Reconnecting");
      expect(third.delayMs).toBeGreaterThan(first.delayMs);
    });

    it("waits less than a busy manager — one is broken, the other is loaded", () => {
      const unavailable = decide({
        kind: "langy_agent_unavailable",
        attemptsUsed: 0,
      });
      const atCapacity = decide({
        kind: "langy_agent_at_capacity",
        attemptsUsed: 0,
      });
      expect(unavailable.delayMs).toBeLessThan(atCapacity.delayMs);
    });
  });

  describe("when the failed attempt already emitted something", () => {
    // The hard gate. Two independent reasons, either fatal on its own: the agent
    // has no idempotency key (a replay can open a SECOND PR), and the tokens are
    // already in the durable buffer and on the user's screen (a replay appends a
    // second answer after half of a first).
    it("refuses to retry, whatever the kind says", () => {
      for (const kind of [
        "langy_agent_at_capacity",
        "langy_agent_unavailable",
      ]) {
        const decision = decide({ kind, producedOutput: true });
        expect(decision.retry, kind).toBe(false);
        expect(decision.reason, kind).toBe("turn-produced-output");
      }
    });

    it("outranks a budget that would otherwise allow a retry", () => {
      expect(decide({ producedOutput: true, elapsedMs: 0 }).retry).toBe(false);
    });
  });

  describe("when the browser's attach budget cannot fit another go", () => {
    // `attachTurnStream` aborts its follow at AGENT_CHAT_TIMEOUT_MS. A retry that
    // lands after that streams into a socket nobody is reading, and the user just
    // watches the answer stop — worse than an honest card.
    it("gives up rather than stream into a dead socket", () => {
      const decision = decide({
        attemptsUsed: 0,
        elapsedMs: AGENT_CHAT_TIMEOUT_MS - MIN_RETRY_HEADROOM_MS,
      });
      expect(decision.retry).toBe(false);
      expect(decision.reason).toBe("budget-exhausted");
    });

    it("still retries while there is real headroom left", () => {
      expect(decide({ attemptsUsed: 0, elapsedMs: 1_000 }).retry).toBe(true);
    });
  });

  describe("given a failure the server cannot fix from inside itself", () => {
    it("leaves the timeout and the draining worker to the client", () => {
      // A timeout has already burned the browser's whole attach budget, and a
      // draining pod cannot sleep and try again — it is going away. Both are the
      // client policy's job (features/langy/logic/langyRecoveryPolicy.ts).
      for (const kind of CLIENT_RECOVERABLE_KINDS) {
        const decision = decide({ kind });
        expect(decision.retry, kind).toBe(false);
        expect(decision.reason, kind).toBe("terminal-kind");
      }
    });

    it("never retries a lost session — it walks into the same wall", () => {
      const decision = decide({ kind: "langy_agent_session_lost" });
      expect(decision.retry).toBe(false);
      expect(decision.reason).toBe("terminal-kind");
    });

    it("never retries what it cannot name", () => {
      expect(decide({ kind: "unknown" }).retry).toBe(false);
      expect(decide({ kind: "langy_kind_from_the_future" }).retry).toBe(false);
    });
  });
});
