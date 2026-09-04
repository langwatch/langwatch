/**
 * What each graph-alert check leaves behind for the automation's view.
 *
 * Binds specs/automations/evaluation-visibility.feature — the "An evaluation
 * is recorded on every check" rule.
 */

import { describe, expect, it, vi } from "vitest";
import type { CustomGraph, Project, Trigger } from "~/generated/prisma/client";
import { TriggerAction } from "~/generated/prisma/client";
import type { TimeseriesResult } from "~/server/analytics/types";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
} from "../graph-trigger-evaluation.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "../repositories/trigger.repository";
import type { RecordEvaluationInput } from "../repositories/trigger-latest-evaluation.repository";

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const GRAPH_ID = "graph-1";
const NOW = new Date("2026-08-12T12:00:00Z");
const SERIES_KEY = "0/metadata.trace_id/cardinality";

function makeTrigger(actionParams: Record<string, unknown>): Trigger {
  return {
    id: TRIGGER_ID,
    projectId: PROJECT_ID,
    name: "My Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams,
    filters: {},
    active: true,
    deleted: false,
    customGraphId: GRAPH_ID,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
  } as unknown as Trigger;
}

function makeGraph(graph?: Record<string, unknown>): CustomGraph {
  return {
    id: GRAPH_ID,
    projectId: PROJECT_ID,
    name: "Trace count",
    graph: graph ?? {
      series: [
        {
          name: "Trace count",
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        },
      ],
      timeScale: 60,
    },
    filters: {},
  } as unknown as CustomGraph;
}

function timeseries(value: number): TimeseriesResult {
  return {
    currentPeriod: [{ date: "2026-08-12T11:00:00Z", [SERIES_KEY]: value }],
    previousPeriod: [],
  } as unknown as TimeseriesResult;
}

/** Enough of the ledger for the paths under test: the claim always succeeds
 *  and nothing is ever already open. */
class StubTriggerSentRepo implements GraphTriggerSentRepository {
  async findOpenForGraphAlert(): Promise<OpenGraphTriggerSent | null> {
    return null;
  }
  async findLatestForGraphAlert(): Promise<{ id: string } | null> {
    return null;
  }
  async claimOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    return { id: "sent-1", ...params };
  }
  async deleteOpenClaim(): Promise<void> {}
  async markResolvedById(): Promise<void> {}
}

function makeDeps({
  trigger,
  graph = makeGraph(),
  series = timeseries(1),
  recordEvaluation,
  getTimeseries,
}: {
  trigger: Trigger;
  graph?: CustomGraph;
  series?: TimeseriesResult;
  recordEvaluation: (input: RecordEvaluationInput) => Promise<void>;
  getTimeseries?: () => Promise<TimeseriesResult>;
}): GraphTriggerEvaluationDeps {
  return {
    loadTrigger: async () => trigger,
    loadCustomGraph: async () => graph,
    loadProject: async () =>
      ({ id: PROJECT_ID, name: "Demo", slug: "demo" }) as Project,
    getTimeseries: getTimeseries ?? (async () => series),
    triggerSent: new StubTriggerSentRepo(),
    // These fixtures never reach a Slack dispatch, so nothing resolves.
    resolveSlackToken: async () => null,
    updateLastRunAt: async () => undefined,
    notifier: {
      dispatch: async () => ({
        channel: "email",
        didSend: true,
        missingVariables: [],
        renderErrors: [],
      }),
    },
    recordEvaluation,
    baseHost: "https://app.langwatch.test",
    now: () => NOW,
  };
}

const workingCondition = {
  threshold: 100,
  operator: "gt",
  timePeriod: 60,
  seriesName: SERIES_KEY,
  members: ["a@example.com"],
};

describe("graph alert evaluation recording", () => {
  describe("given a metric below its threshold", () => {
    describe("when the evaluator checks it", () => {
      /** @scenario An evaluation that did not breach records its observed value */
      it("records the observed value, the threshold, and that it did not fire", async () => {
        const recorded: RecordEvaluationInput[] = [];
        const deps = makeDeps({
          trigger: makeTrigger(workingCondition),
          series: timeseries(42),
          recordEvaluation: async (input) => {
            recorded.push(input);
          },
        });

        const result = await evaluateGraphTrigger({
          deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        });

        expect(result.status).toBe("not_breached");
        expect(recorded).toEqual([
          {
            triggerId: TRIGGER_ID,
            projectId: PROJECT_ID,
            evaluatedAt: NOW,
            verdict: "not_breached",
            observedValue: 42,
            threshold: 100,
            operator: "gt",
            timePeriodMinutes: 60,
            skipCode: null,
          },
        ]);
      });
    });
  });

  describe("given a timeseries read that exceeds the row ceiling", () => {
    describe("when the evaluator checks it", () => {
      /** @scenario A skipped check records why it was skipped */
      it("records the skip as an oversized result, keeping the condition it tried", async () => {
        const recorded: RecordEvaluationInput[] = [];
        const deps = makeDeps({
          trigger: makeTrigger(workingCondition),
          recordEvaluation: async (input) => {
            recorded.push(input);
          },
          getTimeseries: async () => {
            throw Object.assign(new Error("TOO_MANY_ROWS_OR_BYTES"), {
              code: 396,
            });
          },
        });

        const result = await evaluateGraphTrigger({
          deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "heartbeat-absence",
        });

        expect(result.status).toBe("skipped");
        expect(recorded[0]).toMatchObject({
          verdict: "skipped",
          skipCode: "result_too_large",
          observedValue: null,
          threshold: 100,
          timePeriodMinutes: 60,
        });
      });
    });
  });

  describe("given an alert with no series selected", () => {
    describe("when the evaluator checks it", () => {
      /** @scenario A misconfigured automation records the configuration that is missing */
      it("records the skip as incomplete configuration", async () => {
        const recorded: RecordEvaluationInput[] = [];
        const deps = makeDeps({
          trigger: makeTrigger({
            threshold: 100,
            operator: "gt",
            timePeriod: 60,
          }),
          recordEvaluation: async (input) => {
            recorded.push(input);
          },
        });

        const result = await evaluateGraphTrigger({
          deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        });

        expect(result.status).toBe("skipped");
        expect(recorded[0]).toMatchObject({
          verdict: "skipped",
          skipCode: "incomplete_configuration",
          observedValue: null,
          // The check never got as far as knowing what it was comparing
          // against, and says so rather than inventing one.
          threshold: null,
        });
      });
    });
  });

  describe("given recording the evaluation fails", () => {
    describe("when the evaluator checks an alert that crossed its threshold", () => {
      /** @scenario A failure to record an evaluation never fails the automation */
      it("still fires the alert", async () => {
        const recordEvaluation = vi.fn(async () => {
          throw new Error("the recording table is unreachable");
        });
        const deps = makeDeps({
          trigger: makeTrigger(workingCondition),
          series: timeseries(250),
          recordEvaluation,
        });

        const result = await evaluateGraphTrigger({
          deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        });

        expect(recordEvaluation).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("fired");
        expect(result.didSend).toBe(true);
      });
    });
  });
});
