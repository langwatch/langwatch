import { describe, expect, it, vi } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ProcessHandlerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import type { Command } from "../../../../";
import { ComputeRunMetricsCommand } from "../../commands/computeRunMetrics.command";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import type { ComputeRunMetricsCommandData } from "../../schemas/commands";
import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  buildRunMetricsEventView,
  handleDeleted,
  handleFinished,
  handleMeasured,
  runMetricsWake,
} from "../runMetrics.process";
import {
  INITIAL_RUN_METRICS_STATE,
  RUN_METRICS_MAX_MEASUREMENTS,
  RUN_METRICS_REMEASURE_DELAYS_MS,
  RUN_METRICS_SETTLE_PERIOD_MS,
  type RunMetricsState,
} from "../runMetricsProcess.types";

/**
 * The late-cost path, driven through the two halves that decide it together:
 * the process manager's pure timing logic and the real measurement command.
 *
 * Split across the two files that hold them, the defect is invisible — the
 * process asks once and looks correct, the command declines to record an empty
 * answer and looks correct, and the run shows no cost forever. So this drives a
 * run the way the runtime does: arm, wake, measure, fold whatever came back,
 * and let the clock move on.
 *
 * The outbox is modelled rather than mocked away, because its duplicate-key
 * suppression is what a re-measure has to get past: a message key that does not
 * vary per attempt is accepted by the process, dispatched by nothing, and shows
 * up as silence.
 */

const RUN_ID = "run-1";
const TENANT_ID = "project-1";
const NOW = 1_700_000_000_000;
const LATE_COST = 0.004;

type Intents = Parameters<typeof runMetricsWake>[1]["intents"];

function ctxAt(now: number): ProcessHandlerContext<any> {
  return {
    at: now,
    now,
    key: RUN_ID,
    projectId: TENANT_ID,
    intents: {
      computeRunMetrics: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "computeRunMetrics",
        payload,
      }),
    } as unknown as Intents,
  };
}

/** Only the fields the command reads; the rest of the fold is irrelevant here. */
const STORED_RUN = {
  ScenarioRunId: RUN_ID,
  TraceIds: ["trace-1"],
  ArchivedAt: null,
} as SimulationRunStateData;

/**
 * One run, driven forward in time.
 *
 * `totalCost` is the world outside: null while cost enrichment is still in
 * flight, a number once it has landed. Nothing tells the run when that
 * happens — that is the whole problem being tested.
 */
class RunUnderTest {
  state: RunMetricsState = INITIAL_RUN_METRICS_STATE;
  totalCost: number | null = null;
  /** Message keys the outbox accepted, in order. A duplicate never lands twice. */
  readonly dispatched: string[] = [];
  /** Message keys the outbox suppressed as already-dispatched. */
  readonly suppressed: string[] = [];
  measurements = 0;

  private wakeAt: number | null = null;
  private readonly outbox = new Set<string>();

  finished(now: number): void {
    this.apply(
      handleFinished(this.state, { scenarioRunId: RUN_ID }, ctxAt(now)),
    );
  }

  deleted(now: number): void {
    this.apply(
      handleDeleted(this.state, { scenarioRunId: RUN_ID }, ctxAt(now)),
    );
  }

  /** Is a wake standing, and would it fire by `now`? */
  wakeDueBy(now: number): boolean {
    return this.wakeAt !== null && this.wakeAt <= now;
  }

  get nextWakeAt(): number | null {
    return this.wakeAt;
  }

  /** Runs every wake that comes due up to `now`, measuring as each one fires. */
  async runUntil(now: number): Promise<void> {
    while (this.wakeDueBy(now)) {
      const firedAt = this.wakeAt!;
      const evolution = runMetricsWake(this.state, ctxAt(firedAt));
      this.apply(evolution);

      for (const intent of evolution.intents ?? []) {
        if (this.outbox.has(intent.messageKey)) {
          this.suppressed.push(intent.messageKey);
          continue;
        }
        this.outbox.add(intent.messageKey);
        this.dispatched.push(intent.messageKey);
        await this.measure(firedAt);
      }
    }
  }

  /** The real command, against the cost the world reports right now. */
  private async measure(now: number): Promise<void> {
    this.measurements += 1;

    const events = await new ComputeRunMetricsCommand({
      simulationRunStore: {
        get: vi.fn().mockResolvedValue(STORED_RUN),
        store: vi.fn(),
      },
      traceSummaryStore: {
        get: vi.fn().mockResolvedValue({
          traceId: "trace-1",
          totalCost: this.totalCost,
          occurredAt: 1_000,
          spanCount: 3,
        } as TraceSummaryData),
        store: vi.fn(),
      },
      deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
        scenarioRoleCosts: {},
        scenarioRoleLatencies: {},
      }),
    }).handle({
      tenantId: TENANT_ID,
      data: { tenantId: TENANT_ID, scenarioRunId: RUN_ID, occurredAt: now },
    } as Command<ComputeRunMetricsCommandData>);

    // What the runtime does with the result: a recorded measurement is committed
    // and comes back to the process on its own inbox. An empty answer is not an
    // event, so the process is told nothing at all.
    for (const event of events) {
      if (event.type !== SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED) continue;
      this.recorded = event as SimulationProcessingEvent;
      this.apply(
        handleMeasured(
          this.state,
          buildRunMetricsEventView(event as SimulationProcessingEvent),
          ctxAt(now),
        ),
      );
    }
  }

  recorded: SimulationProcessingEvent | null = null;

  private apply(evolution: {
    state: RunMetricsState;
    nextWakeAt?: number | null;
  }): void {
    this.state = evolution.state;
    this.wakeAt = evolution.nextWakeAt ?? null;
  }
}

/** When the last wake of the ladder fires, relative to the run finishing. */
const LAST_WAKE_AT =
  NOW +
  RUN_METRICS_SETTLE_PERIOD_MS +
  RUN_METRICS_REMEASURE_DELAYS_MS.reduce((a, b) => a + b, 0);

describe("a simulation run whose cost lands after it settles", () => {
  describe("given the run's traces report no cost when the settle period elapses", () => {
    describe("when the measurement comes back with nothing to record", () => {
      /** @scenario "A measurement that found no cost is asked for again" */
      it("schedules a further measurement instead of leaving the run unpriced", async () => {
        const run = new RunUnderTest();
        run.finished(NOW);

        await run.runUntil(NOW + RUN_METRICS_SETTLE_PERIOD_MS);

        expect(run.measurements).toBe(1);
        expect(run.recorded).toBeNull();
        expect(run.nextWakeAt).toBe(
          NOW +
            RUN_METRICS_SETTLE_PERIOD_MS +
            RUN_METRICS_REMEASURE_DELAYS_MS[0]!,
        );
      });
    });
  });

  describe("given the cost lands after the run was already measured", () => {
    describe("when the next measurement runs", () => {
      /** @scenario "A cost that lands after the settle period is still recorded" */
      it("records the cost the first measurement missed", async () => {
        const run = new RunUnderTest();
        run.finished(NOW);

        await run.runUntil(NOW + RUN_METRICS_SETTLE_PERIOD_MS);
        expect(run.recorded).toBeNull();

        run.totalCost = LATE_COST;
        await run.runUntil(LAST_WAKE_AT);

        expect(run.recorded?.data).toMatchObject({
          scenarioRunId: RUN_ID,
          totalCost: LATE_COST,
        });
      });

      /** @scenario "Each re-measure is asked for under its own key" */
      it("asks under a key of its own, so the outbox dispatches it", async () => {
        const run = new RunUnderTest();
        run.finished(NOW);

        await run.runUntil(NOW + RUN_METRICS_SETTLE_PERIOD_MS);
        run.totalCost = LATE_COST;
        await run.runUntil(LAST_WAKE_AT);

        expect(run.dispatched).toHaveLength(2);
        expect(run.dispatched[1]).not.toBe(run.dispatched[0]);
        expect(run.suppressed).toEqual([]);
      });
    });
  });

  describe("given a run whose metrics were recorded", () => {
    describe("when the recorded event is folded back", () => {
      /** @scenario "A recorded measurement stops the re-measures" */
      it("stops scheduling measurements", async () => {
        const run = new RunUnderTest();
        run.totalCost = LATE_COST;
        run.finished(NOW);

        await run.runUntil(LAST_WAKE_AT);

        expect(run.measurements).toBe(1);
        expect(run.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given traces that never report a cost", () => {
    describe("when every measurement comes back with nothing to record", () => {
      /** @scenario "A run whose traces never report a cost stops asking" */
      it("stops asking once the ladder is exhausted", async () => {
        const run = new RunUnderTest();
        run.finished(NOW);

        await run.runUntil(LAST_WAKE_AT + 24 * 60 * 60 * 1000);

        expect(run.measurements).toBe(RUN_METRICS_MAX_MEASUREMENTS);
        expect(run.nextWakeAt).toBeNull();
      });
    });
  });

  describe("given a run with a re-measure scheduled", () => {
    describe("when the run is deleted", () => {
      /** @scenario "Deleting a run stops its re-measures too" */
      it("asks for nothing more", async () => {
        const run = new RunUnderTest();
        run.finished(NOW);
        await run.runUntil(NOW + RUN_METRICS_SETTLE_PERIOD_MS);

        run.deleted(NOW + RUN_METRICS_SETTLE_PERIOD_MS + 1);
        run.totalCost = LATE_COST;
        await run.runUntil(LAST_WAKE_AT);

        expect(run.measurements).toBe(1);
        expect(run.nextWakeAt).toBeNull();
      });
    });
  });
});
