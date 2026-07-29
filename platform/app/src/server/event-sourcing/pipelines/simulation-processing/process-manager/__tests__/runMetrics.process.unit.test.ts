import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  buildRunMetricsEventView,
  handleDeleted,
  handleFinished,
  runMetricsWake,
} from "../runMetrics.process";
import {
  computeRunMetricsMessageKey,
  INITIAL_RUN_METRICS_STATE,
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

      it("asks for nothing yet", () => {
        const result = handleFinished(
          INITIAL_RUN_METRICS_STATE,
          VIEW,
          makeCtx(),
        );

        expect(result.intents ?? []).toEqual([]);
      });

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
      it("leaves the standing deadline where it is", () => {
        const armed = state({ deadlineAt: NOW + 1_000 });

        const result = handleFinished(armed, VIEW, makeCtx({ now: NOW + 500 }));

        expect(result.state.deadlineAt).toBe(NOW + 1_000);
        expect(result.nextWakeAt).toBe(NOW + 1_000);
      });

      it("does not re-arm once the measurement was already asked for", () => {
        const done = state({ requested: true, deadlineAt: null });

        const result = handleFinished(done, VIEW, makeCtx());

        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given the settle period has elapsed", () => {
    describe("when the wake fires", () => {
      it("asks for the run's metrics under a key derived from the run", () => {
        const result = runMetricsWake(
          state({ deadlineAt: NOW }),
          makeCtx({ at: NOW, now: NOW }),
        );

        expect(result.intents).toEqual([
          {
            messageKey: computeRunMetricsMessageKey(RUN_ID),
            intentType: "computeRunMetrics",
            payload: { tenantId: "project-1", scenarioRunId: RUN_ID },
          },
        ]);
      });

      it("disarms so the wake worker stops re-finding the instance", () => {
        const result = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });

      it("records that the measurement was asked for", () => {
        const result = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(result.state.requested).toBe(true);
      });

      it("carries no trace ids, so nothing had to accumulate them", () => {
        const result = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());

        expect(result.intents?.[0]?.payload).not.toHaveProperty("traceIds");
      });
    });

    describe("when a second wake races the first", () => {
      it("collapses onto the same message key", () => {
        const first = runMetricsWake(state({ deadlineAt: NOW }), makeCtx());
        const second = runMetricsWake(first.state, makeCtx({ now: NOW + 10 }));

        expect(second.intents?.[0]?.messageKey).toBe(
          first.intents?.[0]?.messageKey,
        );
      });
    });

    describe("when the instance cannot be addressed", () => {
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

  describe("given the run was deleted", () => {
    describe("when the deleted event is folded", () => {
      it("drops the pending measurement", () => {
        const armed = state({ deadlineAt: NOW + 1_000 });

        const result = handleDeleted(armed, VIEW, makeCtx());

        expect(result.state.deleted).toBe(true);
        expect(result.state.deadlineAt).toBeNull();
        expect(result.nextWakeAt).toBeNull();
      });
    });

    describe("when a finished event arrives afterwards", () => {
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
