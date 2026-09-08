/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-health-canary.feature
 *
 * `classifyLangyCanaryOutcome` is the pure settlement -> healthy/reason mapper;
 * `runLangyCanary` is the orchestrator driven against an injected start/await
 * boundary under fake timers, so a 55-second budget elapses in microseconds;
 * `createSingleFlightLangyCanary` wraps it so a concurrent call for the same
 * caller is told busy; `buildProductionLangyCanaryDeps` is the one place the
 * real turn service and fold reader are wired, pinned by argument shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger, startConversationTurn, awaitTurnSettlement } = vi.hoisted(
  () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    startConversationTurn: vi.fn(),
    awaitTurnSettlement: vi.fn(),
  }),
);

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ langy: { turns: { startConversationTurn } } }),
}));

vi.mock("~/server/app-layer/langy/streaming/awaitTurnSettlement", () => ({
  awaitTurnSettlement,
}));

import type { TurnSettlement } from "~/server/app-layer/langy/streaming/awaitTurnSettlement";
import type { Session } from "~/server/auth";
import {
  buildProductionLangyCanaryDeps,
  classifyLangyCanaryOutcome,
  createSingleFlightLangyCanary,
  LANGY_CANARY_BUDGET_MS,
  LANGY_CANARY_GREETING,
  type LangyCanaryDeps,
  type LangyCanaryOutcome,
  runLangyCanary,
  type StartedTurn,
} from "../langy-canary.service";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STARTED: StartedTurn = { conversationId: "conv-1", turnId: "turn-1" };

function completed(text: string): TurnSettlement {
  return { succeeded: true, outcome: "completed", text, error: null };
}

function stopped(text: string): TurnSettlement {
  return { succeeded: true, outcome: "stopped", text, error: null };
}

function failed(error = "boom"): TurnSettlement {
  return { succeeded: false, outcome: "failed", text: null, error };
}

function settlesOnlyOnAbort(): LangyCanaryDeps["awaitSettlement"] {
  return ({ signal }) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(null), { once: true });
    });
}

function depsThatSettle(settlement: TurnSettlement | null): LangyCanaryDeps {
  return {
    startTurn: vi.fn(async () => STARTED),
    awaitSettlement: vi.fn(async () => settlement),
    now: () => 0,
  };
}

describe("classifyLangyCanaryOutcome", () => {
  describe("given a turn that settled as completed with a non-empty reply", () => {
    describe("when the settlement is classified", () => {
      /** @scenario "A completed turn with text is healthy" */
      it("is healthy", () => {
        expect(classifyLangyCanaryOutcome(completed("Hello!"))).toEqual({
          healthy: true,
        });
      });
    });
  });

  describe("given a turn that settled as failed", () => {
    describe("when the settlement is classified", () => {
      /** @scenario "A failed turn is turn_failed" */
      it("is turn_failed", () => {
        expect(classifyLangyCanaryOutcome(failed())).toEqual({
          healthy: false,
          reason: "turn_failed",
        });
      });
    });
  });

  describe("given a turn that settled as stopped", () => {
    describe("when the settlement is classified", () => {
      /** @scenario "A stopped turn is turn_failed" */
      it("is turn_failed even when text came back", () => {
        expect(classifyLangyCanaryOutcome(stopped("partial"))).toEqual({
          healthy: false,
          reason: "turn_failed",
        });
      });
    });
  });

  describe("given a turn that settled as completed with only whitespace", () => {
    describe("when the settlement is classified", () => {
      /** @scenario "A completed turn with only whitespace is empty_reply" */
      it("is empty_reply", () => {
        expect(classifyLangyCanaryOutcome(completed("  \n\t"))).toEqual({
          healthy: false,
          reason: "empty_reply",
        });
      });
    });
  });

  describe("given no settlement arrived before the budget ran out", () => {
    describe("when the missing settlement is classified", () => {
      /** @scenario "A turn that never settled is timeout" */
      it("is timeout", () => {
        expect(classifyLangyCanaryOutcome(null)).toEqual({
          healthy: false,
          reason: "timeout",
        });
      });
    });
  });
});

describe("runLangyCanary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("given two consecutive canary runs", () => {
    describe("when both runs start their turns", () => {
      /** @scenario "Every run starts its turn with a fresh idempotency key" */
      it("starts each turn with a different UUID", async () => {
        const deps = depsThatSettle(completed("Hi"));

        await runLangyCanary(deps);
        await runLangyCanary(deps);

        const keys = vi
          .mocked(deps.startTurn)
          .mock.calls.map(([{ idempotencyKey }]) => idempotencyKey);
        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
        for (const key of keys) expect(key).toMatch(UUID_V4);
      });
    });
  });

  describe("given a turn that starts and settles as completed with text", () => {
    describe("when the canary runs", () => {
      /** @scenario "A healthy run reports the ids of the turn it sent" */
      it("is healthy and reports the turn's ids and duration", async () => {
        let clock = 1_000;
        const deps: LangyCanaryDeps = {
          startTurn: async () => {
            clock += 400;
            return STARTED;
          },
          awaitSettlement: async () => {
            clock += 2_600;
            return completed("Hello there.");
          },
          now: () => clock,
        };

        const outcome = await runLangyCanary(deps);

        expect(outcome).toEqual({
          healthy: true,
          conversationId: "conv-1",
          turnId: "turn-1",
          durationMs: 3_000,
        });
      });
    });
  });

  describe("given a turn that starts but never settles", () => {
    describe("when the budget elapses", () => {
      /** @scenario "A turn that does not settle inside the budget is timeout" */
      it("reports timeout once the budget elapses and aborts the wait", async () => {
        let seenSignal: AbortSignal | undefined;
        const wait = settlesOnlyOnAbort();
        const deps: LangyCanaryDeps = {
          startTurn: async () => STARTED,
          awaitSettlement: (options) => {
            seenSignal = options.signal;
            return wait(options);
          },
          now: () => 0,
        };

        const pending = runLangyCanary(deps);
        await vi.advanceTimersByTimeAsync(LANGY_CANARY_BUDGET_MS);
        const outcome = await pending;

        expect(outcome).toMatchObject({
          healthy: false,
          reason: "timeout",
          conversationId: "conv-1",
          turnId: "turn-1",
        });
        expect(seenSignal?.aborted).toBe(true);
      });
    });
  });

  describe("given a turn that starts and a settlement wait that ignores its signal", () => {
    describe("when the budget elapses", () => {
      /** @scenario "A settlement wait that ignores its signal is still timeout" */
      it("reports timeout when the budget elapses instead of hanging", async () => {
        let clock = 0;
        const deps: LangyCanaryDeps = {
          startTurn: async () => STARTED,
          awaitSettlement: () =>
            new Promise(() => {
              // Intentionally never resolved: the double ignores its signal.
            }),
          now: () => clock,
        };

        const pending = runLangyCanary(deps);
        clock = LANGY_CANARY_BUDGET_MS;
        await vi.advanceTimersByTimeAsync(LANGY_CANARY_BUDGET_MS);
        const outcome = await pending;

        expect(outcome).toEqual({
          healthy: false,
          reason: "timeout",
          conversationId: "conv-1",
          turnId: "turn-1",
          durationMs: LANGY_CANARY_BUDGET_MS,
        });
      });
    });
  });

  describe("given the turn service throws when the turn is started", () => {
    describe("when the canary runs", () => {
      /** @scenario "A turn that cannot even start is turn_failed" */
      it("reports turn_failed with no conversation id", async () => {
        const deps: LangyCanaryDeps = {
          startTurn: async () => {
            throw new Error("Agent not configured");
          },
          awaitSettlement: vi.fn(),
          now: () => 0,
        };

        const outcome = await runLangyCanary(deps);

        expect(outcome).toEqual({
          healthy: false,
          reason: "turn_failed",
          durationMs: 0,
        });
        expect(deps.awaitSettlement).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the turn service never returns from starting the turn", () => {
    describe("when the budget elapses", () => {
      /** @scenario "A turn start that hangs is bounded by the same budget" */
      it("reports timeout once the budget elapses", async () => {
        const deps: LangyCanaryDeps = {
          startTurn: () => new Promise(() => undefined),
          awaitSettlement: vi.fn(),
          now: () => 0,
        };

        const pending = runLangyCanary(deps);
        await vi.advanceTimersByTimeAsync(LANGY_CANARY_BUDGET_MS);
        const outcome = await pending;

        expect(outcome).toEqual({
          healthy: false,
          reason: "timeout",
          durationMs: 0,
        });
        expect(deps.awaitSettlement).not.toHaveBeenCalled();
      });
    });
  });
});

describe("createSingleFlightLangyCanary", () => {
  function deferredRun() {
    const resolvers: Array<(outcome: LangyCanaryOutcome) => void> = [];
    const run = vi.fn(
      () =>
        new Promise<LangyCanaryOutcome>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    return {
      run,
      settle: () => {
        for (const resolve of resolvers)
          resolve({ healthy: true, durationMs: 1 });
      },
    };
  }

  const deps = depsThatSettle(completed("Hi"));

  describe("given a canary run in flight for one caller", () => {
    describe("when another check arrives", () => {
      /** @scenario "A second check for the same caller while one is in flight is busy" */
      it("tells a second check for the same caller it is busy and starts no second turn", async () => {
        const { run, settle } = deferredRun();
        const guarded = createSingleFlightLangyCanary(run);

        const first = guarded({ key: "proj/user", deps });
        const second = await guarded({ key: "proj/user", deps });

        expect(second).toEqual({ busy: true });
        expect(run).toHaveBeenCalledOnce();
        settle();
        await expect(first).resolves.toEqual({ healthy: true, durationMs: 1 });
      });

      /** @scenario "Checks for different callers do not block each other" */
      it("runs a check for a different caller", async () => {
        const { run, settle } = deferredRun();
        const guarded = createSingleFlightLangyCanary(run);

        const first = guarded({ key: "proj/user-a", deps });
        const second = guarded({ key: "proj/user-b", deps });

        expect(run).toHaveBeenCalledTimes(2);
        settle();
        await Promise.all([first, second]);
      });
    });
  });

  describe("given a canary run that has settled for one caller", () => {
    describe("when the same caller checks again", () => {
      /** @scenario "The guard releases once the run settles" */
      it("runs a new check for the same caller", async () => {
        const run = vi.fn(
          async (): Promise<LangyCanaryOutcome> => ({
            healthy: true,
            durationMs: 1,
          }),
        );
        const guarded = createSingleFlightLangyCanary(run);

        await guarded({ key: "proj/user", deps });
        const again = await guarded({ key: "proj/user", deps });

        expect(again).toEqual({ healthy: true, durationMs: 1 });
        expect(run).toHaveBeenCalledTimes(2);
      });
    });
  });

  /**
   * A movable clock, because the reservation a timeout takes is measured on
   * the injected `now` rather than a real timer.
   */
  function depsAtClock(clock: { value: number }): LangyCanaryDeps {
    return {
      startTurn: vi.fn(async () => STARTED),
      awaitSettlement: vi.fn(async () => completed("Hi")),
      now: () => clock.value,
    };
  }

  function runAnswering(outcome: LangyCanaryOutcome) {
    return vi.fn(async (): Promise<LangyCanaryOutcome> => outcome);
  }

  const TIMED_OUT: LangyCanaryOutcome = {
    healthy: false,
    reason: "timeout",
    durationMs: LANGY_CANARY_BUDGET_MS,
  };

  describe("given a canary run for one caller that answered timeout", () => {
    describe("when the same caller checks again inside one budget", () => {
      /** @scenario "A check arriving straight after a timeout is busy" */
      it("tells the caller it is busy and starts no second turn", async () => {
        const clock = { value: 0 };
        const timedOutDeps = depsAtClock(clock);
        const run = runAnswering(TIMED_OUT);
        const guarded = createSingleFlightLangyCanary(run);

        await guarded({ key: "proj/user", deps: timedOutDeps });
        clock.value = LANGY_CANARY_BUDGET_MS - 1;
        const again = await guarded({ key: "proj/user", deps: timedOutDeps });

        expect(again).toEqual({ busy: true });
        expect(run).toHaveBeenCalledOnce();
      });
    });

    describe("when the same caller checks again after one budget", () => {
      /** @scenario "The reservation a timeout takes lapses after one budget" */
      it("runs the new check", async () => {
        const clock = { value: 0 };
        const timedOutDeps = depsAtClock(clock);
        const run = runAnswering(TIMED_OUT);
        const guarded = createSingleFlightLangyCanary(run);

        await guarded({ key: "proj/user", deps: timedOutDeps });
        clock.value = LANGY_CANARY_BUDGET_MS;
        const again = await guarded({ key: "proj/user", deps: timedOutDeps });

        expect(again).toEqual(TIMED_OUT);
        expect(run).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a different caller checks inside one budget", () => {
      /** @scenario "A timeout for one caller does not reserve another caller" */
      it("runs the other caller check", async () => {
        const clock = { value: 0 };
        const timedOutDeps = depsAtClock(clock);
        const run = runAnswering(TIMED_OUT);
        const guarded = createSingleFlightLangyCanary(run);

        await guarded({ key: "proj/user-a", deps: timedOutDeps });
        clock.value = 1;
        const other = await guarded({ key: "proj/user-b", deps: timedOutDeps });

        expect(other).toEqual(TIMED_OUT);
        expect(run).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a canary run for one caller that answered turn_failed", () => {
    describe("when the same caller checks again inside one budget", () => {
      /** @scenario "A settled unhealthy run that is not a timeout reserves nothing" */
      it("runs the new check", async () => {
        const clock = { value: 0 };
        const failedDeps = depsAtClock(clock);
        const outcome: LangyCanaryOutcome = {
          healthy: false,
          reason: "turn_failed",
          durationMs: 1,
        };
        const run = runAnswering(outcome);
        const guarded = createSingleFlightLangyCanary(run);

        await guarded({ key: "proj/user", deps: failedDeps });
        clock.value = 1;
        const again = await guarded({ key: "proj/user", deps: failedDeps });

        expect(again).toEqual(outcome);
        expect(run).toHaveBeenCalledTimes(2);
      });
    });
  });
});

describe("buildProductionLangyCanaryDeps", () => {
  const session: Session = {
    user: { id: "user-1", name: "Canary", email: null, image: null },
    expires: "2026-01-01T00:00:00.000Z",
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given the project and session the auth chain resolved", () => {
    describe("when the production deps run a turn", () => {
      /** @scenario "The production turn is the greeting, sent as the key's principal" */
      it("starts one greeting turn as that session and follows the fold as its user", async () => {
        startConversationTurn.mockResolvedValue(STARTED);
        awaitTurnSettlement.mockResolvedValue(completed("Hi!"));
        const deps = buildProductionLangyCanaryDeps({
          projectId: "proj-1",
          session,
        });

        const started = await deps.startTurn({ idempotencyKey: "key-1" });
        const signal = new AbortController().signal;
        await deps.awaitSettlement({ ...started, signal });

        expect(startConversationTurn).toHaveBeenCalledWith({
          projectId: "proj-1",
          idempotencyKey: "key-1",
          session,
          requestedConversationId: null,
          messages: [
            {
              role: "user",
              parts: [{ type: "text", text: LANGY_CANARY_GREETING }],
            },
          ],
          isRetry: false,
          turnContext: {},
        });
        expect(awaitTurnSettlement).toHaveBeenCalledWith({
          projectId: "proj-1",
          conversationId: "conv-1",
          turnId: "turn-1",
          userId: "user-1",
          signal,
        });
      });
    });
  });
});
