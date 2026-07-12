import { describe, expect, it } from "vitest";
import {
  explainLangyError,
  KNOWN_LANGY_ERROR_KINDS,
} from "../logic/langyErrorExplainer";
import {
  canAutoRecover,
  isMutatingLangyTool,
  LANGY_RECOVERY_POLICIES,
  langyRecoveryPolicy,
  RECOVERY_POLICY_KINDS,
} from "../logic/langyRecoveryPolicy";

/**
 * The policy is the whole point of typing the failures: a kind that means
 * "a deploy interrupted you, nothing was lost" should never cost the user their
 * question, and a kind that means "the session is gone" should never be retried
 * into the same wall. These tests pin both halves, and pin the fail-safe: an
 * unrecognised kind is NOT retried.
 */

describe("langyRecoveryPolicy", () => {
  describe("given every kind the explainer knows about", () => {
    it("has an explicit policy for each one — no silent default", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        expect(
          Object.hasOwn(LANGY_RECOVERY_POLICIES, kind),
          `no explicit recovery policy for kind "${kind}" — add one to langyRecoveryPolicy.ts`,
        ).toBe(true);
      }
    });

    it("covers every kind in KNOWN_LANGY_ERROR_KINDS plus unknown", () => {
      expect([...RECOVERY_POLICY_KINDS]).toEqual([
        ...KNOWN_LANGY_ERROR_KINDS,
        "unknown",
      ]);
    });

    it("gives every retrying policy a message and a bounded attempt count", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        const policy = langyRecoveryPolicy(kind);
        if (!policy.retry) continue;
        expect(policy.attempts).toBeGreaterThan(0);
        expect(policy.attempts).toBeLessThanOrEqual(3);
        expect(policy.recoveringMessage.length).toBeGreaterThan(0);
      }
    });

    it("gives every retrying policy a non-decreasing backoff", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        const policy = langyRecoveryPolicy(kind);
        if (!policy.retry) continue;
        for (let attempt = 2; attempt <= policy.attempts; attempt++) {
          expect(policy.delayMs(attempt)).toBeGreaterThanOrEqual(
            policy.delayMs(attempt - 1),
          );
        }
      }
    });
  });

  describe("when the worker restarted mid-turn", () => {
    const policy = langyRecoveryPolicy("langy_worker_restarting");

    it("auto-retries — a deploy must never cost the user their question", () => {
      expect(policy.retry).toBe(true);
      expect(policy.attempts).toBe(2);
    });

    it("waits long enough for the conversation fold to terminalize", () => {
      // Fired instantly, the retry races the async fold projection and bounces
      // off the chat route's `running` busy-guard.
      expect(policy.delayMs(1)).toBeGreaterThanOrEqual(1_000);
      expect(policy.delayMs(2)).toBeGreaterThan(policy.delayMs(1));
    });

    it("tells the user it is picking up where it left off", () => {
      expect(policy.recoveringMessage).toContain(
        "picking up where it left off",
      );
    });
  });

  describe("when the turn timed out", () => {
    const policy = langyRecoveryPolicy("langy_turn_timeout");

    it("auto-retries exactly once, then gives up to the card", () => {
      expect(policy.retry).toBe(true);
      expect(policy.attempts).toBe(1);
      expect(
        canAutoRecover({
          kind: policy.kind,
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(true);
      expect(
        canAutoRecover({
          kind: policy.kind,
          attemptsUsed: 1,
          sideEffectsObserved: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the agent was unavailable or at capacity", () => {
    // The SERVER already backed off and retried these, three times, on the live
    // stream. Reaching the browser means that budget is spent — retrying again
    // here would silently double it and hold the user in a spinner. See
    // `server/app-layer/langy/execution/langy-turn-recovery.ts`.
    it("does NOT retry again on the client — the server already spent the budget", () => {
      for (const kind of [
        "langy_agent_unavailable",
        "langy_agent_at_capacity",
      ]) {
        const policy = langyRecoveryPolicy(kind);
        expect(policy.retry, kind).toBe(false);
        expect(policy.attempts, kind).toBe(0);
        expect(
          canAutoRecover({ kind, attemptsUsed: 0, sideEffectsObserved: false }),
          kind,
        ).toBe(false);
      }
    });
  });

  describe("when the agent session was lost", () => {
    const policy = langyRecoveryPolicy("langy_agent_session_lost");

    it("is TERMINAL — retrying walks straight back into the same wall", () => {
      expect(policy.retry).toBe(false);
      expect(policy.attempts).toBe(0);
      expect(
        canAutoRecover({
          kind: policy.kind,
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the failure is unknown", () => {
    it("never auto-retries — we do not guess at what we cannot name", () => {
      expect(langyRecoveryPolicy("unknown").retry).toBe(false);
      expect(
        canAutoRecover({
          kind: "unknown",
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the kind is not recognised at all", () => {
    it("fails safe: no retry, no attempts", () => {
      const policy = langyRecoveryPolicy("langy_some_kind_from_the_future");
      expect(policy.retry).toBe(false);
      expect(policy.attempts).toBe(0);
      expect(policy.delayMs(1)).toBe(0);
      expect(
        canAutoRecover({
          kind: "langy_some_kind_from_the_future",
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the conversation itself is gone or not theirs", () => {
    it("never retries — a retry cannot change either fact", () => {
      expect(langyRecoveryPolicy("langy_conversation_not_found").retry).toBe(
        false,
      );
      expect(langyRecoveryPolicy("langy_conversation_not_owned").retry).toBe(
        false,
      );
    });
  });

  describe("when Langy needs GitHub and the user has not connected it", () => {
    const policy = langyRecoveryPolicy("langy_github_not_connected");

    it("is awaiting the USER — not a failure, and not a dead end", () => {
      // "Don't auto-retry" is not one answer but two. Filing this under
      // `terminal` would render the red error card, which is the product blaming
      // someone for not having finished onboarding. It is a missing prerequisite
      // with a perfectly good next action.
      expect(policy.disposition).toBe("awaiting-user");
      expect(policy.disposition).not.toBe("terminal");
    });

    it("does not auto-retry — no amount of backing off connects an account", () => {
      expect(policy.retry).toBe(false);
      expect(policy.attempts).toBe(0);
      expect(
        canAutoRecover({
          kind: policy.kind,
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(false);
    });

    it("shows the connect card, never the error card", () => {
      // The explainer is what the panel keys its rendering off; this pins the two
      // modules to the same story.
      const presentation = explainLangyError({
        kind: "langy_github_not_connected",
        httpStatus: 409,
        meta: {},
      });
      expect(presentation.render).toBe("suppress");
      expect(presentation.action?.kind).toBe("connect-github");
    });
  });
});

/**
 * The contract BETWEEN the explainer and this policy. They are separate modules
 * on purpose — the explainer owns the copy, the policy owns the recovery — but
 * they must not tell the user two different stories about the same failure.
 */
describe("the explainer and the policy agree", () => {
  describe("given a kind the explainer suppresses (not an error at all)", () => {
    it("is awaiting-user in the policy, and is never auto-retried", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        const presentation = explainLangyError({
          kind,
          httpStatus: 500,
          meta: {},
        });
        if (presentation.render !== "suppress") continue;
        const policy = langyRecoveryPolicy(kind);
        expect(policy.disposition, kind).toBe("awaiting-user");
        expect(policy.retry, kind).toBe(false);
      }
    });
  });

  describe("given a kind the policy auto-retries", () => {
    it("is never one the explainer suppresses — we would retry behind a card", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        const policy = langyRecoveryPolicy(kind);
        if (!policy.retry) continue;
        expect(policy.disposition, kind).toBe("auto");
        expect(
          explainLangyError({ kind, httpStatus: 500, meta: {} }).render,
          kind,
        ).not.toBe("suppress");
      }
    });
  });

  describe("given an awaiting-user kind", () => {
    it("never auto-retries — the whole point is that a human unblocks it", () => {
      for (const kind of RECOVERY_POLICY_KINDS) {
        const policy = langyRecoveryPolicy(kind);
        if (policy.disposition !== "awaiting-user") continue;
        expect(policy.retry, kind).toBe(false);
        expect(policy.attempts, kind).toBe(0);
      }
    });
  });
});

describe("canAutoRecover", () => {
  describe("when the failed turn already changed something", () => {
    it("refuses to auto-retry even the most recoverable kind", () => {
      // The agent has no idempotency key: a replay can open a SECOND PR. The
      // user decides whether to run that risk, from the card.
      expect(
        canAutoRecover({
          kind: "langy_worker_restarting",
          attemptsUsed: 0,
          sideEffectsObserved: true,
        }),
      ).toBe(false);
      expect(
        canAutoRecover({
          kind: "langy_agent_at_capacity",
          attemptsUsed: 0,
          sideEffectsObserved: true,
        }),
      ).toBe(false);
    });
  });

  describe("when the failed turn only read", () => {
    it("allows the auto-retry", () => {
      expect(
        canAutoRecover({
          kind: "langy_worker_restarting",
          attemptsUsed: 0,
          sideEffectsObserved: false,
        }),
      ).toBe(true);
    });
  });
});

describe("isMutatingLangyTool", () => {
  describe("when the tool only reads", () => {
    it("is not treated as a side effect", () => {
      for (const name of [
        "search_traces",
        "get_trace",
        "get_analytics",
        "list_prompts",
        "list_evaluators",
        "read",
        "grep",
        "glob",
        "todowrite",
      ]) {
        expect(isMutatingLangyTool(name), name).toBe(false);
      }
    });
  });

  describe("when the tool changes the project", () => {
    it("is treated as a side effect", () => {
      for (const name of [
        "create_prompt",
        "update_monitor",
        "delete_dataset",
        "run_evaluation",
        "github.open_pr",
        "bash",
        "write",
        "edit",
      ]) {
        expect(isMutatingLangyTool(name), name).toBe(true);
      }
    });
  });

  describe("when the name arrives in the stream's tool-part shape", () => {
    it("strips the `tool-` prefix before classifying", () => {
      expect(isMutatingLangyTool("tool-create_prompt")).toBe(true);
      expect(isMutatingLangyTool("tool-search_traces")).toBe(false);
    });
  });
});
