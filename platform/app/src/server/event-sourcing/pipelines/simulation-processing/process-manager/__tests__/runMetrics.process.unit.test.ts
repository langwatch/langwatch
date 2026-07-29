import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  buildRunMetricsEventView,
  handleDeleted,
  handleFinished,
  handleMeasured,
  runMetricsWake,
} from "../runMetrics.process";
import {
  computeRunMetricsMessageKey,
  INITIAL_RUN_METRICS_STATE,
  RUN_METRICS_MAX_MEASUREMENTS,
  RUN_METRICS_REMEASURE_DELAYS_MS,
  RUN_METRICS_SETTLE_PERIOD_MS,
  type RunMetricsState,
} from "../runMetricsProcess.types";

const RUN_ID = "run-1";
const NOW = 1_700_000_000_000;

type Intents = Parameters<typeof runMetricsWake>[1]["intents"];

function makeCtx(
  overrides: {
    at?: number;
    now?: number;
    key?: string;
    projectId?: string;
  } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: overrides.key ?? RUN_ID,
    projectId: overrides.projectId ?? "project-1",
    intents: {
      computeRunMetrics: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "computeRunMetrics",
        payload,
      }),
    } as unknown as Intents,
  };
}

const VIEW = { scenarioRunId: RUN_ID };

function state(overrides: Partial<RunMetricsState> = {}): RunMetricsState {
  return { ...INITIAL_RUN_METRICS_STATE, scenarioRunId: RUN_ID, ...overrides };
}

describe("runMetrics process", () => {
  describe("given a run that has just reported its result", () => {
    describe("when the finished event is folded", () => {
      /** @scenario "A run that reports its result arms a settle period that outlives its worker" */
      it("arms the settle period as a durable deadline", () => {
        const result = handleFinished(
          INITIAL_RUN_METRICS_STATE,
          VIEW,
          makeCtx(),
        );

        expect(result.state.deadlineAt).toBe(
          NOW + RUN_METRICS_SETTLE_PERIOD_MS,
        );
        expect(result.nextWakeAt).toBe(NOW + RUN_METRICS_SETTLE_PERIOD_MS);
      });

      /** @scenario "Nothing is measured while the settle period is still standing" */
      it("asks for nothing yet", () => {
        const result = handleFinished(
          INITIAL_RUN_METRICS_STATE,
          VIEW,
          makeCtx(),
        );

        expect(result.intents ?? []).toEqual([]);
      });

      /** @scenario "A terminal event that omits the run id is still addressable" */
      it("takes the run id from the process key when the event omits it", () => {
        const result = handleFinished(
          INITIAL_RUN_METRICS_STATE,
          { scenarioRunId: null },
          makeCtx(),
        );

        expect(result.state.scenarioRunId).toBe(RUN_ID);
      });
    });

    describe("when the event was delivered long after it occurred", () => {
      /** @scenario "A terminal event delivered late still gets its full settle period" */
      it("schedules from the present, not from the event's own time", () => {
        const result = handleFinished(
          INITIAL_RUN_METRICS_STATE,
          VIEW,
          makeCtx({ at: NOW - 3_600_000, now: NOW }),
        );

        expect(result.state.deadlineAt).toBe(
          NOW + RUN_METRICS_SETTLE_PERIOD_MS,
        );
      });
    });

    describe("when a second finished event arrives", () => {
      /** @scenario "A repeated terminal event does not push the deadline out" */
      it("leaves the standing deadline where it is", () => {
        const armed = state({ deadlineAt: NOW + 1_000 });

        const result = handleFinished(armed, VIEW, makeCtx({ now: NOW + 500 }));

        expect(result.state.deadlineAt).toBe(NOW + 1_000);
        expect(result.nextWakeAt).toBe(NOW + 1_000);
      });

      /** @scenario "A terminal event arriving after the measurement was asked for arms nothing" */
      it("does not re-arm once the measurement was already asked for", () => {
        const done = state({ attempts: 1, deadlineAt: null });

        const result = handleFinished(done, VIEW, makeCtx());

        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given the settle period has elapsed", () => {
    describe("when the wake fires", () => {
      /** @scenario "The settle period elapsing asks for the run's metrics" */
      it("asks for the run's metrics under a key derived from the run", () => {
        const result = runMetricsWake(
          state({ deadlineAt: NOW }),
          makeCtx({ at: NOW, now: NOW }),
        );

        expect(result.intents).toEqual([
          {
            messageKey: computeRunMetricsMessageKey(RUN_ID, 1),
            intentType: "computeRunMetrics",
            payload: { tenantId: "project-1", scenarioRunId: RUN_ID },
          },
        ]);
      });

      /**
       * The deadline that fired is always consumed — what replaces it is either
       * the next rung of the re-measure ladder or nothing at all, never the same
       * instant again. That is what stops the wake worker re-finding one
       * instance forever, and it is the claim the ladder must not weaken.
       *
       * @scenario "A fired wake consumes its deadline rather than leaving it standing"
       */
      it("consumes the deadline it fired for, and arms none once the ladder is spent", () => {
        const first = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(first.state.deadlineAt).not.toBe(NOW);
        expect(first.nextWakeAt).not.toBe(NOW);

        const spent = runMetricsWake(
          state({
            deadlineAt: NOW,
            attempts: RUN_METRICS_MAX_MEASUREMENTS - 1,
          }),
          makeCtx(),
        );

        expect(spent.state.deadlineAt).toBeNull();
        expect(spent.nextWakeAt).toBeNull();
      });

      /** @scenario "The run records that its measurement was asked for" */
      it("records that the measurement was asked for", () => {
        const result = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(result.state.attempts).toBe(1);
      });

      /** @scenario "Nothing upstream has to accumulate the run's trace ids" */
      it("carries no trace ids, so nothing had to accumulate them", () => {
        const result = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(result.intents?.[0]?.payload).not.toHaveProperty("traceIds");
      });
    });

    describe("when a second wake races the first", () => {
      /**
       * A race is two wakes against the SAME stored state — one of them loses
       * on revision. Feeding the first wake's state into the second would model
       * a re-measure instead, which is a different question with the opposite
       * answer (see the next case).
       *
       * @scenario "Two wakes racing each other ask for the measurement once"
       */
      it("collapses onto the same message key", () => {
        const armed = state({ deadlineAt: NOW });

        const first = runMetricsWake(armed, makeCtx());
        const second = runMetricsWake(armed, makeCtx({ now: NOW + 10 }));

        expect(second.intents?.[0]?.messageKey).toBe(
          first.intents?.[0]?.messageKey,
        );
      });
    });

    describe("when the measurement found nothing and the next one comes due", () => {
      it("asks under a key of its own, so the outbox does not suppress it", () => {
        const first = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());
        const remeasure = runMetricsWake(
          first.state,
          makeCtx({ now: first.nextWakeAt! }),
        );

        expect(remeasure.intents?.[0]?.messageKey).not.toBe(
          first.intents?.[0]?.messageKey,
        );
      });

      it("arms each rung of the ladder from the present", () => {
        const first = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(first.nextWakeAt).toBe(
          NOW + RUN_METRICS_REMEASURE_DELAYS_MS[0]!,
        );
      });
    });

    describe("when the run's metrics were already recorded", () => {
      it("asks for nothing further", () => {
        const result = runMetricsWake(
          state({ measured: true, attempts: 1, deadlineAt: NOW }),
          makeCtx(),
        );

        expect(result.intents ?? []).toEqual([]);
        expect(result.nextWakeAt).toBeNull();
      });
    });

    describe("when the instance cannot be addressed", () => {
      /** @scenario "A run that cannot be addressed stops being retried" */
      it("clears rather than retrying forever", () => {
        const result = runMetricsWake(
          state({ scenarioRunId: "", deadlineAt: NOW }),
          makeCtx({ key: "" }),
        );

        expect(result.intents ?? []).toEqual([]);
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given the run's measurement came back with an answer", () => {
    describe("when the metrics event is folded back", () => {
      it("drops the re-measure that was standing", () => {
        const awaiting = state({
          attempts: 1,
          deadlineAt: NOW + RUN_METRICS_REMEASURE_DELAYS_MS[0]!,
        });

        const result = handleMeasured(awaiting, VIEW, makeCtx());

        expect(result.state.measured).toBe(true);
        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });

      it("keeps a later terminal event from arming anything", () => {
        const measured = handleMeasured(state(), VIEW, makeCtx()).state;

        const result = handleFinished(measured, VIEW, makeCtx());

        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given the run was deleted", () => {
    describe("when the deleted event is folded", () => {
      /** @scenario "Deleting a run drops its pending measurement" */
      it("drops the pending measurement", () => {
        const armed = state({ deadlineAt: NOW + 1_000 });

        const result = handleDeleted(armed, VIEW, makeCtx());

        expect(result.state.deleted).toBe(true);
        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });
    });

    describe("when a finished event arrives afterwards", () => {
      /** @scenario "A deleted run is not revived by a later terminal event" */
      it("arms nothing", () => {
        const result = handleFinished(
          state({ deleted: true }),
          VIEW,
          makeCtx(),
        );

        expect(result.state.deadlineAt).toBeNull();
      });
    });

    describe("when a wake fires anyway", () => {
      /** @scenario "A wake on a deleted run asks for nothing" */
      it("asks for nothing", () => {
        const result = runMetricsWake(
          state({ deleted: true, deadlineAt: NOW }),
          makeCtx(),
        );

        expect(result.intents ?? []).toEqual([]);
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given a committed event is narrowed for the process", () => {
    describe("when the event carries the run's conversation and verdict", () => {
      /** @scenario "The conversation and the judge's reasoning never reach process state" */
      it("keeps the run id and nothing else", () => {
        const narrowed = buildRunMetricsEventView({
          data: {
            scenarioRunId: RUN_ID,
            results: {
              verdict: "failure",
              reasoning: "the agent leaked the customer's address",
            },
            messages: [{ role: "user", content: "my card number is …" }],
          },
        } as unknown as SimulationProcessingEvent);

        expect(narrowed).toEqual({ scenarioRunId: RUN_ID });
      });
    });

    describe("when the event is unreadable", () => {
      /** @scenario "An unreadable terminal event does not wedge the run" */
      it("yields a null id instead of throwing", () => {
        expect(
          buildRunMetricsEventView({} as SimulationProcessingEvent),
        ).toEqual({ scenarioRunId: null });
        expect(
          buildRunMetricsEventView({
            data: { scenarioRunId: 42 },
          } as unknown as SimulationProcessingEvent),
        ).toEqual({ scenarioRunId: null });
      });
    });
  });
});
