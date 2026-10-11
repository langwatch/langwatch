/** Spec: modules/entitlement/specs/usage.feature (the trace count). */
import { createTenantId, FoldProjectionExecutor, type Event } from "@langwatch/eventing";
import {
  MONTH_TRACES_COUNTED_EVENT_TYPE,
  TRACE_FIRST_SEEN_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceCountRepository } from "../../repositories/memory/memory.trace-count.repository.ts";
import type { TraceCountState } from "../../repositories/trace-count.repository.ts";
import { traceCountOf } from "../../rules/trace-count.rules.ts";
import { TraceCountStoreService } from "../../services/trace-count-store.service.ts";
import { traceCountPeerFold } from "../trace-count.projection.ts";

const ORGANIZATION = "org_1";
const PROJECT = "project_a";
const MONTH = "2026-10";
const HOUR = 3_600_000;
const COUNTED_UNTIL = Date.UTC(2026, 9, 8, 14);

let sequence = 0;

function newTrace({
  traceId,
  firstSeenAt,
  id = `evt_${++sequence}`,
}: {
  traceId: string;
  firstSeenAt: number;
  id?: string;
}): Event {
  return {
    id,
    aggregateId: PROJECT,
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId(PROJECT),
    createdAt: firstSeenAt,
    occurredAt: firstSeenAt,
    type: TRACE_FIRST_SEEN_EVENT_TYPE,
    version: "2026-10-01",
    idempotencyKey: `${PROJECT}:${traceId}`,
    data: { tenantId: PROJECT, projectId: PROJECT, traceId, firstSeenAt },
  };
}

function monthCount({ traces, id = `evt_${++sequence}` }: { traces: number; id?: string }): Event {
  return {
    id,
    aggregateId: PROJECT,
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId(PROJECT),
    createdAt: COUNTED_UNTIL,
    occurredAt: COUNTED_UNTIL,
    type: MONTH_TRACES_COUNTED_EVENT_TYPE,
    version: "2026-10-01",
    idempotencyKey: `${PROJECT}:${MONTH}`,
    data: {
      tenantId: PROJECT,
      projectId: PROJECT,
      month: MONTH,
      countedUntil: COUNTED_UNTIL,
      traces,
    },
  };
}

/** The live lane: the real executor over the fold and its store, one delivery at a time. */
function liveLane({ placed = true }: { placed?: boolean } = {}) {
  const counts = MemoryTraceCountRepository.create();
  const warnings: unknown[] = [];
  const store = TraceCountStoreService.create({
    counts,
    projects: {
      getProjectPlacement: async () =>
        placed
          ? { kind: "placed" as const, organizationId: ORGANIZATION }
          : { kind: "unplaced" as const },
    },
    logger: { warn: (fields: unknown) => void warnings.push(fields) },
  });
  const { fold } = traceCountPeerFold(store);
  const executor = new FoldProjectionExecutor();
  const deliver = async (event: Event, deliveryAttempt = 1) => {
    const parsed = event as Parameters<typeof fold.apply>[1];
    await executor.execute(fold, parsed, {
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      key: fold.key?.(parsed),
      deliveryAttempt,
    });
  };
  const total = (month = MONTH) => counts.findTotal({ organizationId: ORGANIZATION, month });
  return { deliver, total, warnings };
}

/** A store a replay never touches: the pure fold is applied directly. */
const untouchedStore = TraceCountStoreService.create({
  counts: MemoryTraceCountRepository.create(),
  projects: { getProjectPlacement: async () => ({ kind: "unplaced" as const }) },
});

/** A replay: every event from init, deduplicated by idempotency key, in the order given. */
function replay(events: readonly Event[]): number {
  const { fold } = traceCountPeerFold(untouchedStore);
  const seen = new Set<string>();
  let state: TraceCountState = fold.init();
  for (const event of events) {
    const key = event.idempotencyKey ?? event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    state = fold.apply(state, event as Parameters<typeof fold.apply>[1]);
  }
  return traceCountOf(state);
}

describe("the trace count fold", () => {
  describe("when trace sends new-trace events", () => {
    /** @scenario "A new-trace event adds one to its project's month" */
    it("counts one per event in the month the trace was first seen", async () => {
      const lane = liveLane();
      await lane.deliver(newTrace({ traceId: "t1", firstSeenAt: COUNTED_UNTIL + HOUR }));
      await lane.deliver(newTrace({ traceId: "t2", firstSeenAt: COUNTED_UNTIL + 2 * HOUR }));
      await lane.deliver(newTrace({ traceId: "t3", firstSeenAt: Date.UTC(2026, 8, 30, 23) }));

      await expect(lane.total()).resolves.toBe(2);
      await expect(lane.total("2026-09")).resolves.toBe(1);
    });

    /** @scenario "A redelivered new-trace event does not count its trace twice" */
    it("skips a redelivery of the event it just applied", async () => {
      const lane = liveLane();
      const event = newTrace({ traceId: "t1", firstSeenAt: COUNTED_UNTIL + HOUR });
      await lane.deliver(event);
      await lane.deliver(event, 2);

      await expect(lane.total()).resolves.toBe(1);
    });
  });

  describe("when trace's upgrade records the month's count", () => {
    /** @scenario "The upgrade's count is added once, however often it is delivered" */
    it("adds the count once and keeps it on a redelivery or a re-sent event", async () => {
      const lane = liveLane();
      await lane.deliver(monthCount({ traces: 40 }));
      await lane.deliver(monthCount({ traces: 40, id: "evt_resent" }));

      await expect(lane.total()).resolves.toBe(40);
    });

    /** @scenario "The month is the upgrade's count plus one per new-trace event" */
    it("adds new-trace events to the count whichever arrives first", async () => {
      const lane = liveLane();
      await lane.deliver(newTrace({ traceId: "before", firstSeenAt: COUNTED_UNTIL }));
      await lane.deliver(monthCount({ traces: 40 }));
      await lane.deliver(newTrace({ traceId: "after", firstSeenAt: COUNTED_UNTIL + HOUR }));

      await expect(lane.total()).resolves.toBe(42);
    });
  });

  describe("when the month is rebuilt from trace's log", () => {
    /** @scenario "A replay of trace's events reaches the live count, in any order" */
    it("reaches the live lane's count whatever order the events are replayed in", async () => {
      const events = [
        newTrace({ traceId: "a", firstSeenAt: COUNTED_UNTIL }),
        monthCount({ traces: 40 }),
        newTrace({ traceId: "b", firstSeenAt: COUNTED_UNTIL + HOUR }),
      ];
      const resent = { ...events[1]!, id: "evt_resent_count" };
      const lane = liveLane();
      for (const event of events) await lane.deliver(event);

      const live = await lane.total();
      expect(live).toBe(42);
      expect(replay([...events, resent])).toBe(live);
      expect(replay([...events].reverse())).toBe(live);
    });
  });

  describe("when the project belongs to no organization", () => {
    /** @scenario "A new-trace event from a project in no organization is skipped, loudly" */
    it("writes no count and warns naming the project", async () => {
      const lane = liveLane({ placed: false });
      await lane.deliver(newTrace({ traceId: "t1", firstSeenAt: COUNTED_UNTIL + HOUR }));

      await expect(lane.total()).resolves.toBe(0);
      expect(lane.warnings).toEqual([{ projectId: PROJECT }]);
    });
  });
});
