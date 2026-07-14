import type { CustomGraph, Project, Trigger } from "@prisma/client";
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import type { GraphAlertDispatchResult } from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
} from "../graph-trigger-evaluation.service";
import {
  graphAlertIncidentKey,
  type GraphTriggerSentRepository,
  type OpenGraphTriggerSent,
} from "../repositories/trigger.repository";

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const GRAPH_ID = "graph-1";
const NOW = new Date("2026-06-20T12:00:00Z");

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: TRIGGER_ID,
    projectId: PROJECT_ID,
    name: "My Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: {
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0/metadata.trace_id/cardinality",
      members: ["a@example.com"],
    },
    filters: {},
    active: true,
    deleted: false,
    alertType: null,
    message: null,
    customGraphId: GRAPH_ID,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Trigger;
}

function makeGraph(overrides: Partial<CustomGraph> = {}): CustomGraph {
  return {
    id: GRAPH_ID,
    projectId: PROJECT_ID,
    name: "Trace count",
    graph: {
      series: [
        {
          name: "Trace count",
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          colorSet: "blueTones",
        },
      ],
      groupBy: undefined,
      groupByKey: undefined,
      timeScale: 60,
    },
    filters: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as CustomGraph;
}

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    name: "Demo",
    slug: "demo",
  } as unknown as Project;
}

function timeseries(value: number | null): TimeseriesResult {
  if (value === null) {
    return { currentPeriod: [], previousPeriod: [] };
  }
  return {
    currentPeriod: [
      {
        date: "2026-06-20T11:00:00Z",
        "0/metadata.trace_id/cardinality": value,
      },
    ],
    previousPeriod: [],
  } as unknown as TimeseriesResult;
}

class FakeTriggerSentRepo implements GraphTriggerSentRepository {
  openRows: OpenGraphTriggerSent[] = [];
  /** Every incident ever created, open or resolved — the fire generation the
   *  per-recipient idempotency digest is keyed on. */
  allRows: OpenGraphTriggerSent[] = [];
  claimCalls = 0;
  deleteCalls: Array<{ id: string; projectId: string }> = [];
  resolveCalls: Array<{ id: string; projectId: string; now: Date }> = [];

  async findOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    return (
      this.openRows.find(
        (r) =>
          r.triggerId === params.triggerId &&
          r.projectId === params.projectId &&
          r.customGraphId === params.customGraphId,
      ) ?? null
    );
  }

  async findLatestForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null> {
    const matches = this.allRows.filter(
      (r) =>
        r.triggerId === params.triggerId &&
        r.projectId === params.projectId &&
        r.customGraphId === params.customGraphId,
    );
    const latest = matches[matches.length - 1];
    return latest ? { id: latest.id } : null;
  }

  // Faithful to the DB: the atomic claim arbitrates on `openIncidentKey`
  // (= graphAlertIncidentKey(triggerId)). If an OPEN row already holds that
  // identity, the INSERT would hit the single-column unique — modelled here as
  // returning null. The check-and-push has no `await` between them, so it is
  // atomic under Promise.all exactly as a Postgres INSERT is.
  async claimOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    this.claimCalls++;
    const key = graphAlertIncidentKey({ triggerId: params.triggerId });
    const held = this.openRows.some(
      (r) => graphAlertIncidentKey({ triggerId: r.triggerId }) === key,
    );
    if (held) return null;
    const row: OpenGraphTriggerSent = {
      id: `sent-${this.allRows.length + 1}`,
      ...params,
    };
    this.openRows.push(row);
    this.allRows.push(row);
    return row;
  }

  async deleteOpenClaim(params: { id: string; projectId: string }): Promise<void> {
    this.deleteCalls.push(params);
    // A real delete removes the row entirely — from the open set AND the fire
    // generation, so a rolled-back claim never advances `findLatestForGraphAlert`.
    this.openRows = this.openRows.filter((r) => r.id !== params.id);
    this.allRows = this.allRows.filter((r) => r.id !== params.id);
  }

  async markResolvedById(params: {
    id: string;
    projectId: string;
    now: Date;
  }): Promise<void> {
    this.resolveCalls.push(params);
    // Resolve frees the identity (clears openIncidentKey): the row leaves the
    // OPEN set so the next claim on the same triggerId succeeds. It stays in
    // allRows — resolved incidents persist as the fire generation.
    this.openRows = this.openRows.filter((r) => r.id !== params.id);
  }
}

interface Harness {
  deps: GraphTriggerEvaluationDeps;
  triggerSent: FakeTriggerSentRepo;
  dispatch: ReturnType<typeof vi.fn>;
  getTimeseries: ReturnType<typeof vi.fn>;
  updateLastRunAt: ReturnType<typeof vi.fn>;
  loadTrigger: ReturnType<typeof vi.fn>;
  loadCustomGraph: ReturnType<typeof vi.fn>;
}

function makeHarness({
  trigger = makeTrigger(),
  graph = makeGraph(),
  project = makeProject(),
  series,
}: {
  trigger?: Trigger | null;
  graph?: CustomGraph | null;
  project?: Project | null;
  series: TimeseriesResult;
}): Harness {
  const dispatch = vi.fn<(input: unknown) => Promise<GraphAlertDispatchResult>>(
    async () => ({
      channel: "email",
      didSend: true,
      missingVariables: [],
      renderErrors: [],
    }),
  );
  const getTimeseries = vi.fn(async () => series);
  const updateLastRunAt = vi.fn(async () => undefined);
  const loadTrigger = vi.fn(async () => trigger);
  const loadCustomGraph = vi.fn(async () => graph);
  const triggerSent = new FakeTriggerSentRepo();

  const deps: GraphTriggerEvaluationDeps = {
    loadTrigger,
    loadCustomGraph,
    loadProject: async () => project,
    getTimeseries,
    triggerSent,
    updateLastRunAt,
    notifier: { dispatch },
    baseHost: "https://app.langwatch.test",
    now: () => NOW,
  };
  return {
    deps,
    triggerSent,
    dispatch,
    getTimeseries,
    updateLastRunAt,
    loadTrigger,
    loadCustomGraph,
  };
}

describe("evaluateGraphTrigger", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness({ series: timeseries(15) });
  });

  describe("given a keyed series whose stored identifier differs from the result bucket key", () => {
    // Regression: stored trigger identifiers are `{index}/{key|metric}/{agg}`
    // while result buckets are keyed `{queryIndex}/{metric}/{agg}/{key}`.
    // Before the buildSeriesName fix this lookup missed, read 0, and a `gt`
    // alert never fired.
    it("reads the bucket via the buildSeriesName encoding and fires", async () => {
      const harness = makeHarness({
        trigger: makeTrigger({
          actionParams: {
            threshold: 10,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/eval-checker-1/avg",
            members: ["a@example.com"],
          },
        } as Partial<Trigger>),
        graph: makeGraph({
          graph: {
            series: [
              {
                name: "Checker score",
                metric: "evaluations.evaluation_score",
                aggregation: "avg",
                key: "eval-checker-1",
                colorSet: "blueTones",
              },
            ],
            groupBy: undefined,
            groupByKey: undefined,
            timeScale: 60,
          },
        } as Partial<CustomGraph>),
        series: {
          currentPeriod: [
            {
              date: "2026-06-20T11:00:00Z",
              "0/evaluations.evaluation_score/avg/eval-checker-1": 15,
            },
          ],
          previousPeriod: [],
        } as unknown as TimeseriesResult,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(result.value).toBe(15);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a breach with no open TriggerSent", () => {
    it("fires the dispatch notifier and inserts a TriggerSent", async () => {
      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(result.value).toBe(15);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      expect(harness.triggerSent.claimCalls).toBe(1);
      expect(harness.triggerSent.openRows).toHaveLength(1);
      expect(harness.triggerSent.openRows[0]?.customGraphId).toBe(GRAPH_ID);
      expect(harness.updateLastRunAt).toHaveBeenCalledWith({
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
      });
    });

    it("hands the dispatch helper a built GraphAlertTemplateContext", async () => {
      await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      const arg = harness.dispatch.mock.calls[0]?.[0] as {
        trigger: Trigger;
        project: Project;
        context: {
          trigger: { id: string; name: string };
          graph: { id: string; name: string; url: string };
          metric: { label: string; seriesName: string };
          condition: {
            operator: string;
            operatorLabel: string;
            threshold: number;
            timePeriodMinutes: number;
            timePeriodLabel: string;
          };
          currentValue: number;
          occurredAt: string;
          reason: string;
          project: { id: string; name: string; slug: string; url: string };
        };
        recipients: string[];
        slackWebhook: string | null;
      };

      expect(arg.trigger.id).toBe(TRIGGER_ID);
      expect(arg.project.id).toBe(PROJECT_ID);
      expect(arg.context.graph.id).toBe(GRAPH_ID);
      expect(arg.context.graph.name).toBe("Trace count");
      // Windowed deep link: lands the reader on the incident window
      // (NOW - timePeriod → NOW), not "now".
      expect(arg.context.graph.url).toBe(
        "https://app.langwatch.test/demo/analytics/custom/graph-1" +
          `?startDate=${encodeURIComponent(new Date(NOW.getTime() - 60 * 60 * 1000).toISOString())}` +
          `&endDate=${encodeURIComponent(NOW.toISOString())}`,
      );
      expect(arg.context.metric.label).toBe("Trace count");
      expect(arg.context.metric.seriesName).toBe(
        "0/metadata.trace_id/cardinality",
      );
      expect(arg.context.condition.operator).toBe("gt");
      expect(arg.context.condition.operatorLabel).toBe("is greater than");
      expect(arg.context.condition.threshold).toBe(10);
      expect(arg.context.condition.timePeriodMinutes).toBe(60);
      expect(arg.context.condition.timePeriodLabel).toBe("last 1 hour");
      expect(arg.context.currentValue).toBe(15);
      expect(arg.context.occurredAt).toBe(NOW.toISOString());
      expect(arg.context.reason).toBe("real-time");
      // Graph data for templates: the buckets the threshold read, plus the
      // prebuilt sparkline; previousValue is null (harness has no previous
      // period).
      expect(
        (arg.context as unknown as { history: unknown }).history,
      ).toEqual([{ timestamp: "2026-06-20T11:00:00Z", value: 15 }]);
      expect(
        (arg.context as unknown as { sparkline: string }).sparkline,
      ).toHaveLength(1);
      expect(
        (arg.context as unknown as { previousValue: number | null })
          .previousValue,
      ).toBeNull();
      expect(arg.context.project.url).toBe("https://app.langwatch.test/demo");
      expect(arg.recipients).toEqual(["a@example.com"]);
      expect(arg.slackWebhook).toBeNull();
    });

    describe("when action is SEND_SLACK_MESSAGE", () => {
      it("dispatches with the trigger's Slack action set", async () => {
        harness = makeHarness({
          trigger: makeTrigger({
            action: TriggerAction.SEND_SLACK_MESSAGE,
            actionParams: {
              threshold: 10,
              operator: "gt",
              timePeriod: 60,
              seriesName: "0/metadata.trace_id/cardinality",
              slackWebhook: "https://hooks.slack.com/services/T/B/abc",
            },
          }),
          series: timeseries(15),
        });

        const result = await evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        });

        expect(result.status).toBe("fired");
        expect(harness.dispatch).toHaveBeenCalledTimes(1);
        const arg = harness.dispatch.mock.calls[0]?.[0] as {
          trigger: Trigger;
          slackWebhook: string | null;
        };
        expect(arg.trigger.action).toBe(TriggerAction.SEND_SLACK_MESSAGE);
        expect(arg.slackWebhook).toBe(
          "https://hooks.slack.com/services/T/B/abc",
        );
      });
    });
  });

  describe("given a breach with a non-empty previous window", () => {
    it("carries the previous-window aggregate as previousValue and prepends its points to history", async () => {
      harness = makeHarness({
        series: {
          currentPeriod: [
            {
              date: "2026-06-20T11:00:00Z",
              "0/metadata.trace_id/cardinality": 15,
            },
          ],
          previousPeriod: [
            {
              date: "2026-06-20T10:00:00Z",
              "0/metadata.trace_id/cardinality": 7,
            },
          ],
        } as unknown as TimeseriesResult,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      const arg = harness.dispatch.mock.calls[0]?.[0] as {
        context: {
          previousValue: number | null;
          history: Array<{ timestamp: string; value: number }>;
        };
      };
      // previousValue is the aggregate over the window preceding the alert
      // window (cardinality → additive sum of the previous buckets).
      expect(arg.context.previousValue).toBe(7);
      // history is chronological: previous-window points prepended before the
      // current-window points so templates can render the full trend.
      expect(arg.context.history).toEqual([
        { timestamp: "2026-06-20T10:00:00Z", value: 7 },
        { timestamp: "2026-06-20T11:00:00Z", value: 15 },
      ]);
    });
  });

  describe("given a series aggregated with terms whose bucket is keyed .../cardinality", () => {
    // Regression: `buildSeriesName` rewrites terms→cardinality when composing
    // the result-bucket key. The stored `seriesName` keeps `terms`, so the
    // evaluator must read the rewritten `.../cardinality` bucket — otherwise
    // it reads 0 and the alert never fires.
    it("reads the cardinality-keyed bucket and fires", async () => {
      const harness = makeHarness({
        trigger: makeTrigger({
          actionParams: {
            threshold: 10,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/metadata.user_id/terms",
            members: ["a@example.com"],
          },
        } as Partial<Trigger>),
        graph: makeGraph({
          graph: {
            series: [
              {
                name: "Distinct users",
                metric: "metadata.user_id",
                aggregation: "terms",
                colorSet: "blueTones",
              },
            ],
            groupBy: undefined,
            groupByKey: undefined,
            timeScale: 60,
          },
        } as Partial<CustomGraph>),
        series: {
          currentPeriod: [
            {
              date: "2026-06-20T11:00:00Z",
              "0/metadata.user_id/cardinality": 42,
            },
          ],
          previousPeriod: [],
        } as unknown as TimeseriesResult,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(result.value).toBe(42);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a breach with an existing open TriggerSent", () => {
    it("reports already_firing and does not re-notify", async () => {
      harness.triggerSent.openRows.push({
        id: "sent-prior",
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        customGraphId: GRAPH_ID,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("already_firing");
      expect(harness.dispatch).not.toHaveBeenCalled();
      // The cheap pre-check short-circuits before the claim INSERT is attempted.
      expect(harness.triggerSent.claimCalls).toBe(0);
      expect(harness.updateLastRunAt).toHaveBeenCalledTimes(1);
    });

    it("is idempotent across repeated invocations", async () => {
      // First call inserts the TriggerSent.
      await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });
      // Second call within the debounce window sees the open row and
      // does NOT re-notify.
      const second = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(second.status).toBe("already_firing");
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      expect(harness.triggerSent.claimCalls).toBe(1);
    });
  });

  describe("given the threshold no longer breaches with an open TriggerSent", () => {
    it("resolves the open row and reports resolved", async () => {
      harness = makeHarness({ series: timeseries(2) });
      harness.triggerSent.openRows.push({
        id: "sent-prior",
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        customGraphId: GRAPH_ID,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "heartbeat-resolve",
      });

      expect(result.status).toBe("resolved");
      expect(harness.triggerSent.resolveCalls).toHaveLength(1);
      expect(harness.triggerSent.resolveCalls[0]?.id).toBe("sent-prior");
      expect(harness.dispatch).not.toHaveBeenCalled();
    });
  });

  // Regression (dispatch5015-P1, Finding 3): the dispatch result used to be
  // discarded, so an alert that delivered NOTHING still opened its incident.
  // The UI then showed it "currently firing", nobody had been told, and the open
  // incident suppressed every future notification until the metric recovered.
  // The scheduled-report path deliberately does the opposite (`report-dispatch.ts`
  // gates `recordFire` on delivery) — this pins the alert path to match.
  describe("given a breach whose dispatch delivers nothing", () => {
    beforeEach(() => {
      harness.dispatch.mockResolvedValue({
        channel: "slack",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      });
    });

    it("rolls the claim back, so no open incident is left to suppress future notifications", async () => {
      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("not_delivered");
      expect(result.didSend).toBe(false);
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      // The claim is taken pre-send (claim-before-send), then rolled back
      // because nothing was delivered — so no open incident lingers.
      expect(harness.triggerSent.claimCalls).toBe(1);
      expect(harness.triggerSent.deleteCalls).toHaveLength(1);
      expect(harness.triggerSent.openRows).toHaveLength(0);
      // The pre-check is null again — the next evaluation can re-claim.
      expect(
        await harness.triggerSent.findOpenForGraphAlert({
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          customGraphId: GRAPH_ID,
        }),
      ).toBeNull();
    });

    it("re-dispatches on the next evaluation instead of reporting already_firing", async () => {
      await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });
      // A real second breach: had the first (undelivered) evaluation left an
      // open claim, this would short-circuit to `already_firing` and the
      // customer would never hear about the breach at all.
      harness.dispatch.mockResolvedValue({
        channel: "slack",
        didSend: true,
        missingVariables: [],
        renderErrors: [],
      });
      const second = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(second.status).toBe("fired");
      expect(harness.dispatch).toHaveBeenCalledTimes(2);
      // Both evaluations claimed; the first claim was rolled back, the second
      // kept — exactly one open incident survives.
      expect(harness.triggerSent.claimCalls).toBe(2);
      expect(harness.triggerSent.openRows).toHaveLength(1);
    });
  });

  describe("given a breach whose dispatch throws", () => {
    beforeEach(() => {
      harness.dispatch.mockRejectedValue(new Error("provider unreachable"));
    });

    it("rolls the claim back and rethrows, so the outbox retry can re-dispatch", async () => {
      await expect(
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
      ).rejects.toThrow("provider unreachable");

      // The claim was taken pre-send, then rolled back on the throw — had it
      // stayed open, the outbox retry would see it in the pre-check, back off
      // as `already_firing`, and the notification would be lost forever.
      expect(harness.triggerSent.claimCalls).toBe(1);
      expect(harness.triggerSent.deleteCalls).toHaveLength(1);
      expect(harness.triggerSent.openRows).toHaveLength(0);

      harness.dispatch.mockResolvedValue({
        channel: "slack",
        didSend: true,
        missingVariables: [],
        renderErrors: [],
      });
      const retry = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });
      expect(retry.status).toBe("fired");
      expect(harness.dispatch).toHaveBeenCalledTimes(2);
      expect(harness.triggerSent.openRows).toHaveLength(1);
    });

    it("propagates the dispatch error even when the rollback itself fails", async () => {
      vi.spyOn(harness.triggerSent, "deleteOpenClaim").mockRejectedValue(
        new Error("db gone"),
      );

      await expect(
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
      ).rejects.toThrow("provider unreachable");
    });
  });

  describe("given a breach whose dispatch reports render diagnostics", () => {
    it("surfaces missingVariables and renderErrors on the result", async () => {
      harness.dispatch.mockResolvedValue({
        channel: "email",
        didSend: true,
        missingVariables: ["metric.p99"],
        renderErrors: ["unknown filter: sparkline"],
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(result.didSend).toBe(true);
      expect(result.missingVariables).toEqual(["metric.p99"]);
      expect(result.renderErrors).toEqual(["unknown filter: sparkline"]);
    });
  });

  // Regression (dispatch5015-P1, Finding 3): a `bot`-delivery Slack alert whose
  // token or channel cannot be resolved used to fall through to the WEBHOOK
  // branch. Bot params carry no `slackWebhook`, so the dispatcher logged "no
  // Slack webhook configured" and returned didSend false — a silent hole.
  describe("given a bot-delivery Slack alert whose connection cannot be resolved", () => {
    it("throws rather than falling through to the webhook branch", async () => {
      harness = makeHarness({
        trigger: makeTrigger({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: {
            threshold: 10,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/metadata.trace_id/cardinality",
            slackDelivery: "bot",
            // No slackBotToken, no slackChannelId — and no slackWebhook either.
          },
        }),
        series: timeseries(15),
      });

      await expect(
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
      ).rejects.toThrow(/missing its token or channel/);

      expect(harness.dispatch).not.toHaveBeenCalled();
      // The throw happens during bot-destination resolution, which runs BEFORE
      // the claim — so no incident is claimed and none is orphaned.
      expect(harness.triggerSent.claimCalls).toBe(0);
    });
  });

  // ADR-034 P1: the claim is taken BEFORE the send, so once it commits an
  // outbox retry that re-runs the whole evaluation short-circuits at the
  // pre-check instead of dispatching a second time.
  describe("given a delivered fire whose bookkeeping then fails", () => {
    it("does not re-dispatch on the retry — the committed claim short-circuits the pre-check", async () => {
      let updateCalls = 0;
      harness.updateLastRunAt.mockImplementation(async () => {
        updateCalls++;
        // First attempt: the send succeeded and the claim committed, but the
        // trailing bookkeeping throws, so the outbox retries the evaluation.
        if (updateCalls === 1) throw new Error("postgres is down");
      });

      await expect(
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
      ).rejects.toThrow(/postgres is down/);

      const retry = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(retry.status).toBe("already_firing");
      // Exactly one delivery across the original attempt and its retry.
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      // The retry sees the open claim and never attempts a second INSERT.
      expect(harness.triggerSent.claimCalls).toBe(1);
    });
  });

  // ADR-034 P1 (the core fix): two evaluators that BOTH pass the
  // findOpenForGraphAlert pre-check race on the claim. Only the INSERT winner
  // may dispatch — the loser hits the openIncidentKey unique and backs off.
  describe("given two concurrent evaluators that both pass the open pre-check", () => {
    it("lets exactly one claim win and dispatch, the loser backs off", async () => {
      // Force BOTH evaluators past the cheap pre-check (as if each read the
      // empty open set before either wrote its row). The claim's atomic
      // check-and-insert in the fake is the only arbiter left — exactly the DB
      // unique constraint's job.
      harness.getTimeseries.mockResolvedValue(timeseries(15));
      const findOpen = vi
        .spyOn(harness.triggerSent, "findOpenForGraphAlert")
        .mockResolvedValue(null);

      const [a, b] = await Promise.all([
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
        evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual(["already_firing", "fired"]);
      // Only the winner dispatched — a single breach fans out one notification.
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      // Both attempted the claim; only one row survives open.
      expect(harness.triggerSent.claimCalls).toBe(2);
      expect(harness.triggerSent.openRows).toHaveLength(1);

      findOpen.mockRestore();
    });
  });

  describe("given an incident that resolves after firing", () => {
    it("frees the identity so the next breach can re-claim and dispatch again", async () => {
      // First breach fires and opens an incident.
      const first = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });
      expect(first.status).toBe("fired");
      expect(harness.triggerSent.openRows).toHaveLength(1);

      // Metric recovers → the open incident resolves and clears the key.
      harness.getTimeseries.mockResolvedValue(timeseries(2));
      const resolved = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "heartbeat-resolve",
      });
      expect(resolved.status).toBe("resolved");
      expect(harness.triggerSent.resolveCalls).toHaveLength(1);
      expect(harness.triggerSent.openRows).toHaveLength(0);

      // Metric breaches again → because the identity was freed, the same
      // trigger can re-claim and dispatch. (If resolve had NOT cleared the key,
      // this claim would collide and the alert could never fire twice.)
      harness.getTimeseries.mockResolvedValue(timeseries(20));
      const second = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(second.status).toBe("fired");
      expect(harness.dispatch).toHaveBeenCalledTimes(2);
      // The two fires carry DISTINCT digests — the resolved first incident is
      // the second fire's generation, so retries never conflate them.
      const firstDigest = (
        harness.dispatch.mock.calls[0]?.[0] as { fireDigest: string }
      ).fireDigest;
      const secondDigest = (
        harness.dispatch.mock.calls[1]?.[0] as { fireDigest: string }
      ).fireDigest;
      expect(firstDigest).toBeTruthy();
      expect(secondDigest).not.toBe(firstDigest);
    });
  });

  describe("given no breach and no open TriggerSent", () => {
    it("reports not_breached without firing", async () => {
      harness = makeHarness({ series: timeseries(2) });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("not_breached");
      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(harness.triggerSent.openRows).toHaveLength(0);
    });
  });

  describe("given a no-data trigger with an absent metric", () => {
    it("fires when the heartbeat invokes the evaluator", async () => {
      harness = makeHarness({
        trigger: makeTrigger({
          actionParams: {
            threshold: 1,
            operator: "lt",
            timePeriod: 60,
            seriesName: "0/metadata.trace_id/cardinality",
            members: ["a@example.com"],
          },
        }),
        series: timeseries(null),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "heartbeat-absence",
      });

      expect(result.status).toBe("fired");
      expect(result.detail).toBe("no-data predicate");
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
      expect(harness.triggerSent.claimCalls).toBe(1);
    });
  });

  describe("given an inactive trigger", () => {
    it("skips without calling analytics", async () => {
      harness = makeHarness({
        trigger: makeTrigger({ active: false }),
        series: timeseries(15),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toBe("trigger inactive");
      expect(harness.getTimeseries).not.toHaveBeenCalled();
    });
  });

  describe("given a missing graph", () => {
    it("skips with a graph-not-found detail", async () => {
      harness = makeHarness({ graph: null, series: timeseries(15) });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toBe("graph not found");
    });
  });

  describe("given a trigger missing actionParams.threshold", () => {
    it("skips without notifying", async () => {
      harness = makeHarness({
        trigger: makeTrigger({
          actionParams: { operator: "gt", timePeriod: 60, seriesName: "0" },
        }),
        series: timeseries(15),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toContain("threshold");
    });
  });
});
