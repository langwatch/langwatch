import { TriggerAction } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvaluationTriggerMatchSubscriber,
  createGraphTriggerActivitySubscriber,
  DEDUP_TTL_MS,
  type EvaluationOutcomeEvent,
  type EvaluationTriggerMatchPorts,
  GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
  type GraphTriggerActivityPorts,
  graphTriggerActivityDedupId,
  MATCH_DELAY_MS,
  type TraceActivityEvent,
} from "../subscribers";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function completedEvent(
  data: Record<string, unknown> = {},
  overrides: Partial<EvaluationOutcomeEvent> = {},
): EvaluationOutcomeEvent {
  return {
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    tenantId: "project-1",
    aggregateId: "evaluation-1",
    occurredAt: Date.now(),
    data: {
      evaluationId: "evaluation-1",
      traceId: "trace-1",
      status: "processed",
      ...data,
    },
    ...overrides,
  };
}

function completedEventWithoutTraceId(): EvaluationOutcomeEvent {
  const base = completedEvent();
  const { traceId: _absent, ...data } = base.data as Record<string, unknown>;
  return { ...base, data };
}

interface TriggerRow {
  readonly id: string;
  readonly action: TriggerAction;
  readonly traceDebounceMs: number;
  readonly notificationCadence: "immediate";
  readonly filters: Record<string, unknown>;
  readonly filterQuery: null;
}

function trigger(overrides: Partial<TriggerRow> = {}): TriggerRow {
  return {
    id: "trigger-1",
    action: TriggerAction.ADD_TO_DATASET,
    traceDebounceMs: 30_000,
    notificationCadence: "immediate",
    filters: { "evaluations.passed": { "evaluator-1": ["true"] } },
    filterQuery: null,
    ...overrides,
  };
}

function deps(
  triggerRows: TriggerRow[] = [trigger()],
): EvaluationTriggerMatchPorts {
  return {
    getActiveTraceTriggersForProject: vi
      .fn()
      .mockResolvedValue(triggerRows) as never,
    readTraceSummary: vi
      .fn()
      .mockResolvedValue({ traceId: "trace-1" }) as never,
    recordMatch: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

const EVALUATION_COMPLETED_EVENT_TYPE = "lw.evaluation.completed";
const EVALUATION_REPORTED_EVENT_TYPE = "lw.evaluation.reported";

function subscriberFor(ports: EvaluationTriggerMatchPorts) {
  return createEvaluationTriggerMatchSubscriber({
    eventTypes: [
      EVALUATION_COMPLETED_EVENT_TYPE,
      EVALUATION_REPORTED_EVENT_TYPE,
    ],
    isTerminalStatus,
    ports,
  });
}

/** Stands in for what the composition root binds: the evaluation pipeline's own
 *  terminal-status predicate, narrowed from the unvalidated string an event
 *  payload carries. This pipeline declares no status vocabulary of its own. */
const isTerminalStatus = (status: string): boolean =>
  ["processed", "error", "skipped"].includes(status);

describe("the injected terminal-status predicate", () => {
  describe("given a status the composition root calls non-terminal", () => {
    it("decides the subscriber's answer — the subscriber holds no set of its own", () => {
      const subscriber = createEvaluationTriggerMatchSubscriber({
        eventTypes: [EVALUATION_COMPLETED_EVENT_TYPE],
        isTerminalStatus: (status) => status === "in_progress",
        ports: deps(),
      });

      expect(subscriber.enqueue?.filter(completedEvent())).toBe(false);
      expect(
        subscriber.enqueue?.filter(completedEvent({ status: "in_progress" })),
      ).toBe(true);
    });
  });
});

describe("evaluation trigger match subscriber", () => {
  describe("given a terminal evaluation carrying its trace id", () => {
    it("records every evaluation-filtered match with its action class", async () => {
      const ports = deps([
        trigger(),
        trigger({ id: "trigger-2", action: TriggerAction.SEND_EMAIL }),
        // A trace-only trigger (no evaluation filters) is not read by this
        // subscriber — it belongs to the trace pipeline's own subscriber.
        trigger({
          id: "trace-only",
          filters: { "traces.origin": ["application"] },
        }),
      ]);

      await subscriberFor(ports).handle(completedEvent(), {
        tenantId: "project-1",
      });

      expect(ports.recordMatch.send).toHaveBeenCalledTimes(2);
      expect(ports.recordMatch.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          tenantId: "project-1",
          triggerId: "trigger-1",
          traceId: "trace-1",
          actionClass: "persist",
        }),
      );
      expect(ports.recordMatch.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          triggerId: "trigger-2",
          actionClass: "notify",
        }),
      );
    });

    it("reads the trace id from the event, never from a projection of the same stream", async () => {
      const ports = deps();

      await subscriberFor(ports).handle(
        completedEvent({ traceId: "trace-from-the-event" }),
        { tenantId: "project-1" },
      );

      expect(ports.readTraceSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-from-the-event",
        }),
      );
      expect(ports.recordMatch.send).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-from-the-event" }),
      );
    });
  });

  describe("given a reported evaluation", () => {
    it("records the match off the same two fields the completed event carries", async () => {
      const ports = deps();

      await subscriberFor(ports).handle(
        completedEvent(
          { status: "error", traceId: "trace-9" },
          { type: EVALUATION_REPORTED_EVENT_TYPE },
        ),
        { tenantId: "project-1" },
      );

      expect(ports.recordMatch.send).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-9", triggerId: "trigger-1" }),
      );
    });
  });

  describe.each([
    [
      "a stale event",
      completedEvent({}, { occurredAt: Date.now() - 60 * 60 * 1000 - 1 }),
    ],
    ["a non-terminal status", completedEvent({ status: "in_progress" })],
    ["an evaluation naming no trace", completedEvent({ traceId: "" })],
    [
      "an event committed before the schema carried a trace id",
      completedEventWithoutTraceId(),
    ],
  ])("given %s", (_label, inputEvent) => {
    it("skips without reading the trace, recording a match, or throwing", async () => {
      const ports = deps();

      await expect(
        subscriberFor(ports).handle(inputEvent, { tenantId: "project-1" }),
      ).resolves.toBeUndefined();

      expect(ports.readTraceSummary).not.toHaveBeenCalled();
      expect(ports.recordMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the trace fold has not caught up", () => {
    it("throws so the (future) router asks again, instead of dropping the alerts", async () => {
      const ports = deps();
      (ports.readTraceSummary as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      await expect(
        subscriberFor(ports).handle(completedEvent(), {
          tenantId: "project-1",
        }),
      ).rejects.toThrow(/Trace summary not found/);

      expect(ports.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
      expect(ports.recordMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the subscriber contract", () => {
    it("subscribes to the event types it was mounted with, with no fold bound to it", () => {
      const subscriber = subscriberFor(deps());

      expect(subscriber.name).toBe("triggerMatch");
      expect([...subscriber.eventTypes].sort()).toEqual(
        [
          EVALUATION_COMPLETED_EVENT_TYPE,
          EVALUATION_REPORTED_EVENT_TYPE,
        ].sort(),
      );
    });

    it("carries the 10s debounce and 30s per-evaluation dedup window", () => {
      const subscriber = subscriberFor(deps());
      const dedup = subscriber.options?.deduplication;

      expect(subscriber.options?.delay).toBe(MATCH_DELAY_MS);
      expect(dedup?.ttlMs).toBe(DEDUP_TTL_MS);
      expect(dedup?.makeId(completedEvent())).toBe(
        "subscriber:triggerMatch:project-1:evaluation-1",
      );
      expect(
        dedup?.makeId(completedEvent({}, { aggregateId: "evaluation-2" })),
      ).not.toBe(dedup?.makeId(completedEvent()));
    });
  });

  describe("given the enqueue filter", () => {
    describe("when the event cannot produce a match", () => {
      it("declines it so no job is ever minted", () => {
        const filter = subscriberFor(deps()).enqueue?.filter;

        expect(filter?.(completedEvent())).toBe(true);
        expect(filter?.(completedEventWithoutTraceId())).toBe(false);
        expect(filter?.(completedEvent({ traceId: "" }))).toBe(false);
        expect(filter?.(completedEvent({ status: "in_progress" }))).toBe(false);
      });
    });

    describe("when the event payload is malformed", () => {
      it("returns false instead of throwing — a throw on the routing path loses the job permanently", () => {
        const filter = subscriberFor(deps()).enqueue?.filter;

        for (const data of [null, undefined, "not-an-object", 7, []]) {
          const malformed = {
            ...completedEvent(),
            data,
          } as unknown as EvaluationOutcomeEvent;
          expect(() => filter?.(malformed)).not.toThrow();
          expect(filter?.(malformed)).toBe(false);
        }
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

function event(
  overrides: Partial<TraceActivityEvent> = {},
): TraceActivityEvent {
  return {
    type: "trace/committed",
    tenantId: "project-1",
    occurredAt: Date.now(),
    ...overrides,
  };
}

function graphSubscriberFor(ports: GraphTriggerActivityPorts) {
  return createGraphTriggerActivitySubscriber({
    eventTypes: ["trace/committed"],
    ports,
  });
}

describe("graph trigger activity subscriber", () => {
  describe("given the subscriber contract", () => {
    it("carries the 5s non-extending, non-replacing debounce window", () => {
      const subscriber = graphSubscriberFor({
        getActiveGraphTriggers: vi.fn(),
        evaluateGraphTrigger: vi.fn(),
      });

      expect(subscriber.options?.delay).toBe(
        GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
      );
      expect(subscriber.options?.deduplication?.ttlMs).toBe(
        GRAPH_TRIGGER_ACTIVITY_DEBOUNCE_MS,
      );
      expect(subscriber.options?.deduplication?.extend).toBe(false);
      expect(subscriber.options?.deduplication?.replace).toBe(false);
      expect(subscriber.options?.deduplication?.makeId(event())).toBe(
        "graph-trigger-activity:project-1",
      );
    });

    it("dedup id is keyed only on tenant, so a burst collapses to one evaluation per project", () => {
      expect(graphTriggerActivityDedupId(event({ tenantId: "a" }))).not.toBe(
        graphTriggerActivityDedupId(event({ tenantId: "b" })),
      );
    });
  });

  describe("given a project with active graph triggers", () => {
    it("evaluates every active trigger with a real-time reason", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi
          .fn()
          .mockResolvedValue([{ id: "trigger-1" }, { id: "trigger-2" }]),
        evaluateGraphTrigger,
      };

      await graphSubscriberFor(ports).handle(event(), {
        tenantId: "project-1",
      });

      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        tenantId: "project-1",
        reason: "real-time",
      });
      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-2",
        tenantId: "project-1",
        reason: "real-time",
      });
    });
  });

  describe("given a project with no active graph triggers", () => {
    it("does nothing", async () => {
      const evaluateGraphTrigger = vi.fn();
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi.fn().mockResolvedValue([]),
        evaluateGraphTrigger,
      };

      await graphSubscriberFor(ports).handle(event(), {
        tenantId: "project-1",
      });

      expect(evaluateGraphTrigger).not.toHaveBeenCalled();
    });
  });

  describe("given a stale event past the age cutoff", () => {
    it("skips without evaluating any trigger", async () => {
      const getActiveGraphTriggers = vi.fn();
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers,
        evaluateGraphTrigger: vi.fn(),
      };

      await graphSubscriberFor(ports).handle(
        event({ occurredAt: Date.now() - 60 * 60 * 1000 - 1 }),
        { tenantId: "project-1" },
      );

      expect(getActiveGraphTriggers).not.toHaveBeenCalled();
    });
  });

  describe("given one of several triggers fails to evaluate", () => {
    it("still evaluates the rest, then throws once so the whole job retries", async () => {
      const evaluateGraphTrigger = vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);
      const ports: GraphTriggerActivityPorts = {
        getActiveGraphTriggers: vi
          .fn()
          .mockResolvedValue([{ id: "trigger-1" }, { id: "trigger-2" }]),
        evaluateGraphTrigger,
      };

      await expect(
        graphSubscriberFor(ports).handle(event(), { tenantId: "project-1" }),
      ).rejects.toThrow(/1\/2 evaluations failed/);

      expect(evaluateGraphTrigger).toHaveBeenCalledTimes(2);
    });
  });
});
