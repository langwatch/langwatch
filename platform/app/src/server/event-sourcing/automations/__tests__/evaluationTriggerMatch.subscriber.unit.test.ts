import { TriggerAction } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvaluationTriggerMatchSubscriber,
  DEDUP_TTL_MS,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  MATCH_DELAY_MS,
  type EvaluationOutcomeEvent,
  type EvaluationTriggerMatchPorts,
} from "../subscribers/evaluationTriggerMatch.subscriber";

function completedEvent(
  data: Record<string, unknown> = {},
  overrides: Partial<EvaluationOutcomeEvent> = {},
): EvaluationOutcomeEvent {
  return {
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    tenantId: "project-1",
    aggregateId: "evaluation-1",
    occurredAt: Date.now(),
    data: { evaluationId: "evaluation-1", traceId: "trace-1", status: "processed", ...data },
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

function deps(triggerRows: TriggerRow[] = [trigger()]): EvaluationTriggerMatchPorts {
  return {
    getActiveTraceTriggersForProject: vi.fn().mockResolvedValue(triggerRows) as never,
    readTraceSummary: vi.fn().mockResolvedValue({ traceId: "trace-1" }) as never,
    recordMatch: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

function subscriberFor(ports: EvaluationTriggerMatchPorts) {
  return createEvaluationTriggerMatchSubscriber(ports);
}

describe("evaluation trigger match subscriber", () => {
  describe("given a terminal evaluation carrying its trace id", () => {
    it("records every evaluation-filtered match with its action class", async () => {
      const ports = deps([
        trigger(),
        trigger({ id: "trigger-2", action: TriggerAction.SEND_EMAIL }),
        // A trace-only trigger (no evaluation filters) is not read by this
        // subscriber — it belongs to the trace pipeline's own subscriber.
        trigger({ id: "trace-only", filters: { "traces.origin": ["application"] } }),
      ]);

      await subscriberFor(ports).handle(completedEvent(), { tenantId: "project-1" });

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
        expect.objectContaining({ triggerId: "trigger-2", actionClass: "notify" }),
      );
    });

    it("reads the trace id from the event, never from a projection of the same stream", async () => {
      const ports = deps();

      await subscriberFor(ports).handle(
        completedEvent({ traceId: "trace-from-the-event" }),
        { tenantId: "project-1" },
      );

      expect(ports.readTraceSummary).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project-1", traceId: "trace-from-the-event" }),
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
        completedEvent({ status: "error", traceId: "trace-9" }, { type: EVALUATION_REPORTED_EVENT_TYPE }),
        { tenantId: "project-1" },
      );

      expect(ports.recordMatch.send).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-9", triggerId: "trigger-1" }),
      );
    });
  });

  describe.each([
    ["a stale event", completedEvent({}, { occurredAt: Date.now() - 60 * 60 * 1000 - 1 })],
    ["a non-terminal status", completedEvent({ status: "in_progress" })],
    ["an evaluation naming no trace", completedEvent({ traceId: "" })],
    ["an event committed before the schema carried a trace id", completedEventWithoutTraceId()],
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
      (ports.readTraceSummary as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        subscriberFor(ports).handle(completedEvent(), { tenantId: "project-1" }),
      ).rejects.toThrow(/Trace summary not found/);

      expect(ports.getActiveTraceTriggersForProject).not.toHaveBeenCalled();
      expect(ports.recordMatch.send).not.toHaveBeenCalled();
    });
  });

  describe("given the subscriber contract", () => {
    it("subscribes to the two terminal evaluation events with no fold bound to it", () => {
      const subscriber = subscriberFor(deps());

      expect(subscriber.name).toBe("triggerMatch");
      expect([...subscriber.eventTypes].sort()).toEqual(
        [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE].sort(),
      );
    });

    it("carries the 10s debounce and 30s per-evaluation dedup window", () => {
      const subscriber = subscriberFor(deps());
      const dedup = subscriber.options?.deduplication;

      expect(subscriber.options?.delay).toBe(MATCH_DELAY_MS);
      expect(dedup?.ttlMs).toBe(DEDUP_TTL_MS);
      expect(dedup?.makeId(completedEvent())).toBe("subscriber:triggerMatch:project-1:evaluation-1");
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
          const malformed = { ...completedEvent(), data } as unknown as EvaluationOutcomeEvent;
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
