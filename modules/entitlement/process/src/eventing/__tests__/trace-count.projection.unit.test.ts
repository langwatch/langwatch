/** Spec: modules/entitlement/specs/usage.feature (the trace count). */
import { createTenantId, FoldProjectionExecutor, type Event } from "@langwatch/eventing";
import {
  TRACE_FIRST_SEEN_EVENT_TYPE,
  TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE,
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
const CUT = Date.UTC(2026, 9, 8, 14);

let sequence = 0;

function firstSeen({
  traceId,
  firstSeenAt,
  id = `evt_${++sequence}`,
  projectId = PROJECT,
}: {
  traceId: string;
  firstSeenAt: number;
  id?: string;
  projectId?: string;
}): Event {
  return {
    id,
    aggregateId: projectId,
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId(projectId),
    createdAt: firstSeenAt,
    occurredAt: firstSeenAt,
    type: TRACE_FIRST_SEEN_EVENT_TYPE,
    version: "2026-10-01",
    idempotencyKey: `${projectId}:trace_first_seen:${traceId}:${MONTH}`,
    data: { tenantId: projectId, projectId, traceId, firstSeenAt },
  };
}

function seed({
  traces,
  cutAt = CUT,
  id = `evt_${++sequence}`,
}: {
  traces: number;
  cutAt?: number;
  id?: string;
}): Event {
  return {
    id,
    aggregateId: PROJECT,
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId(PROJECT),
    createdAt: cutAt,
    occurredAt: cutAt,
    type: TRACES_COUNTED_BEFORE_CUT_EVENT_TYPE,
    version: "2026-10-01",
    idempotencyKey: `${PROJECT}:traces_counted_before_cut:${MONTH}`,
    data: { tenantId: PROJECT, projectId: PROJECT, month: MONTH, cutAt, traces },
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

/** A replay: every fact from init, deduplicated by idempotency key, in the order given. */
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
  describe("when traces are first seen", () => {
    /** @scenario "A trace first seen adds one to its project's month" */
    it("counts one per trace in the month it was first seen", async () => {
      const lane = liveLane();
      await lane.deliver(firstSeen({ traceId: "t1", firstSeenAt: CUT + HOUR }));
      await lane.deliver(firstSeen({ traceId: "t2", firstSeenAt: CUT + 2 * HOUR }));
      await lane.deliver(firstSeen({ traceId: "t3", firstSeenAt: Date.UTC(2026, 8, 30, 23) }));

      await expect(lane.total()).resolves.toBe(2);
      await expect(lane.total("2026-09")).resolves.toBe(1);
    });

    /** @scenario "A redelivered first sighting does not count its trace twice" */
    it("skips a redelivery of the fact it just applied", async () => {
      const lane = liveLane();
      const fact = firstSeen({ traceId: "t1", firstSeenAt: CUT + HOUR });
      await lane.deliver(fact);
      await lane.deliver(fact, 2);

      await expect(lane.total()).resolves.toBe(1);
    });
  });

  describe("when trace's upgrade records the month before the cut", () => {
    /** @scenario "The seed sets the month's base, however often it is delivered" */
    it("sets the base once and keeps it on a redelivery or a re-sent fact", async () => {
      const lane = liveLane();
      await lane.deliver(seed({ traces: 40 }));
      await lane.deliver(seed({ traces: 40, id: "evt_resent" }));

      await expect(lane.total()).resolves.toBe(40);
    });

    /** @scenario "A trace is counted by the seed or by its sighting, never by both" */
    it("drops sightings before the cut whether they arrive before or after the seed", async () => {
      const lane = liveLane();
      await lane.deliver(firstSeen({ traceId: "early", firstSeenAt: CUT - HOUR }));
      await lane.deliver(firstSeen({ traceId: "late", firstSeenAt: CUT + 1 }));
      await lane.deliver(seed({ traces: 40 }));
      await lane.deliver(firstSeen({ traceId: "lagging", firstSeenAt: CUT - 1 }));
      await lane.deliver(firstSeen({ traceId: "after", firstSeenAt: CUT + HOUR }));

      await expect(lane.total()).resolves.toBe(42);
    });

    /** @scenario "A later seed's cut wins whatever order the seeds arrive in" */
    it("keeps the latest cut when an earlier one arrives after it", async () => {
      const lane = liveLane();
      await lane.deliver(firstSeen({ traceId: "between", firstSeenAt: CUT + 30 * 60_000 }));
      await lane.deliver(seed({ traces: 41, cutAt: CUT + HOUR }));
      await lane.deliver(seed({ traces: 40, cutAt: CUT }));

      await expect(lane.total()).resolves.toBe(41);
    });
  });

  describe("when the month is rebuilt from trace's log", () => {
    /** @scenario "A replay of trace's facts reaches the live count, in any order" */
    it("reaches the live lane's count whatever order the facts are replayed in", async () => {
      const facts = [
        firstSeen({ traceId: "early", firstSeenAt: CUT - HOUR }),
        firstSeen({ traceId: "late", firstSeenAt: CUT + 1 }),
        seed({ traces: 40 }),
        firstSeen({ traceId: "after", firstSeenAt: CUT + HOUR }),
      ];
      const resent = { ...facts[1]!, id: "evt_resent_late" };
      const lane = liveLane();
      for (const fact of facts) await lane.deliver(fact);

      const live = await lane.total();
      expect(live).toBe(42);
      expect(replay([...facts, resent])).toBe(live);
      expect(replay([...facts].reverse())).toBe(live);
    });
  });

  describe("when the project belongs to no organization", () => {
    /** @scenario "A first sighting from a project in no organization is skipped, loudly" */
    it("writes no count and warns naming the project", async () => {
      const lane = liveLane({ placed: false });
      await lane.deliver(firstSeen({ traceId: "t1", firstSeenAt: CUT + HOUR }));

      await expect(lane.total()).resolves.toBe(0);
      expect(lane.warnings).toEqual([{ projectId: PROJECT }]);
    });
  });
});
