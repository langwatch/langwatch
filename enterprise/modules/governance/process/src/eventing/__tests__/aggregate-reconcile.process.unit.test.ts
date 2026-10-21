// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  InMemoryProcessStore,
  type JsonValue,
  OutboxDispatcherService,
  type ProcessStore,
} from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  OutboxAggregateReconcile,
  runAggregatePrune,
  runAggregateReconcile,
} from "../aggregate-reconcile.intent.ts";
import {
  AGGREGATE_PRUNE_INTENT,
  AGGREGATE_RECONCILE_INTENT,
  AGGREGATE_RECONCILE_MAX_ATTEMPTS,
  AGGREGATE_RECONCILE_PROCESS_NAME,
  AGGREGATE_RECONCILE_RETENTION_MS,
  aggregatePruneWake,
  aggregateReconcileIntentSchema,
  aggregateReconcileProcessKey,
} from "../aggregate-reconcile.process.ts";
import {
  AGGREGATE_RECONCILE_SETTLE_MS,
  enqueueAffectedAggregates,
  enqueueChangedAggregate,
  enqueueMemberAggregates,
  settleAggregateReconcile,
} from "../aggregate-reconcile.subscriber.ts";

const AT = 1_760_000_000_000;
const ORG = "org_1";
const RETRY_MS = 60_000;

const refOf = (aggregateProjectId: string) => ({
  processName: AGGREGATE_RECONCILE_PROCESS_NAME,
  projectId: ORG,
  processKey: aggregateReconcileProcessKey({ aggregateProjectId }),
});

/**
 * The reconcile outbox on the memory process store, drained by the real dispatcher ladder.
 * `failing` throws on every try; `refusedOnce` attaches all but `p_b` on the first try only.
 */
function outboxWorld({
  failing,
  refusedOnce = new Set(),
}: {
  failing: ReadonlySet<string>;
  refusedOnce?: ReadonlySet<string>;
}) {
  const store = InMemoryProcessStore.createForTesting();
  const asked: string[] = [];
  const run = runAggregateReconcile({
    reconcile: async ({ aggregateProjectId }) => {
      asked.push(aggregateProjectId);
      if (failing.has(aggregateProjectId)) throw new Error("authz unavailable");
      const firstTry = asked.filter((id) => id === aggregateProjectId).length === 1;
      if (refusedOnce.has(aggregateProjectId) && firstTry) {
        return { attached: ["p_a"], reattached: [], revoked: [], unchanged: [], failed: ["p_b"] };
      }
      return { attached: [], reattached: [], revoked: [], unchanged: [], failed: [] };
    },
  });
  const dispatcher = new OutboxDispatcherService({
    store,
    handlers: {
      [AGGREGATE_RECONCILE_INTENT]: ({ message }) =>
        run(aggregateReconcileIntentSchema.parse(message.payload), message),
    },
    maxAttempts: AGGREGATE_RECONCILE_MAX_ATTEMPTS,
    retryDelayMs: () => RETRY_MS,
    processNames: [AGGREGATE_RECONCILE_PROCESS_NAME],
  });
  // The outbox stamps a row with the wall clock, so the dispatcher's clock starts there.
  let clock = nowInstant().epochMilliseconds;
  const outbox = OutboxAggregateReconcile.create(store);
  return {
    store,
    asked,
    enqueue: (aggregateProjectIds: string[]) =>
      outbox.enqueue({ organizationId: ORG, aggregateProjectIds, cause: "rule-changed:1" }),
    drain: async (passes: number) => {
      for (let pass = 0; pass < passes; pass++) {
        clock += RETRY_MS;
        await dispatcher.runOnce({ now: clock, limit: 50 });
      }
    },
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    statuses: async (aggregateProjectIds: string[]) =>
      (
        await Promise.all(
          aggregateProjectIds.map((id) => store.findMessagesByRef({ ref: refOf(id) })),
        )
      )
        .flat()
        .map((message) => message.status),
  };
}

describe("aggregate project reconcile process", () => {
  describe("when the daily wake fires", () => {
    /** @scenario "The daily wake only clears finished reconciles" */
    it("asks for one prune keyed by its schedule time and no reconcile", () => {
      const prune = vi.fn((messageKey: string, payload: JsonValue) => ({
        messageKey,
        intentType: AGGREGATE_PRUNE_INTENT,
        payload,
      }));
      const evolution = aggregatePruneWake(
        { lastPruneAt: null },
        {
          at: AT,
          now: AT,
          key: AGGREGATE_RECONCILE_PROCESS_NAME,
          projectId: "__global__",
          intent: intentAccessorOf({ [AGGREGATE_PRUNE_INTENT]: prune }),
        },
      );

      expect(prune).toHaveBeenCalledWith(`prune:${AT}`, { scheduledFor: AT });
      expect(evolution.intents).toHaveLength(1);
      expect(evolution.state).toEqual({ lastPruneAt: AT });
    });
  });

  describe("given a finished reconcile and one parked as dead, both over two days old", () => {
    /** @scenario "The daily wake only clears finished reconciles" */
    it("deletes the finished one, keeps the dead one and queues nothing", async () => {
      const world = outboxWorld({ failing: new Set(["agg_bad"]) });
      await world.enqueue(["agg_ok", "agg_bad"]);
      await world.drain(AGGREGATE_RECONCILE_MAX_ATTEMPTS + 1);
      expect(await world.statuses(["agg_ok", "agg_bad"])).toEqual(["dispatched", "dead"]);

      world.advance(AGGREGATE_RECONCILE_RETENTION_MS + 1);
      await runAggregatePrune({
        deleteDispatchedBefore: (params) => world.store.deleteDispatchedBefore(params),
        now: world.now,
      })();

      expect(await world.statuses(["agg_ok", "agg_bad"])).toEqual(["dead"]);
    });

    it("leaves a finished reconcile younger than two days", async () => {
      const world = outboxWorld({ failing: new Set() });
      await world.enqueue(["agg_ok"]);
      await world.drain(1);

      world.advance(AGGREGATE_RECONCILE_RETENTION_MS - RETRY_MS);
      await runAggregatePrune({
        deleteDispatchedBefore: (params) => world.store.deleteDispatchedBefore(params),
        now: world.now,
      })();

      expect(await world.statuses(["agg_ok"])).toEqual(["dispatched"]);
    });
  });

  describe("given a reconcile that fails on every attempt", () => {
    /** @scenario "A reconcile that keeps failing is parked for an operator after five tries" */
    it("tries it five times, then parks it as dead and tries no more", async () => {
      const world = outboxWorld({ failing: new Set(["agg_bad"]) });
      await world.enqueue(["agg_bad"]);

      await world.drain(AGGREGATE_RECONCILE_MAX_ATTEMPTS);
      await world.drain(AGGREGATE_RECONCILE_MAX_ATTEMPTS);

      expect(world.asked).toEqual(Array.from({ length: 5 }, () => "agg_bad"));
      expect(await world.statuses(["agg_bad"])).toEqual(["dead"]);
    });
  });

  describe("given a reconcile in which one member's attach is refused", () => {
    /** @scenario "A reconcile that attaches every member but one is tried again" */
    it("is not marked finished, then finishes on the try the attach goes through", async () => {
      const world = outboxWorld({ failing: new Set(), refusedOnce: new Set(["agg_short"]) });
      await world.enqueue(["agg_short"]);

      await world.drain(1);
      expect(world.asked).toEqual(["agg_short"]);
      expect(await world.statuses(["agg_short"])).toEqual(["pending"]);

      await world.drain(1);
      expect(world.asked).toEqual(["agg_short", "agg_short"]);
      expect(await world.statuses(["agg_short"])).toEqual(["dispatched"]);
    });
  });

  describe("given several member facts in one organisation within the settle window", () => {
    const memberFact = (userId: string, occurredAt: number) => ({
      data: { organizationId: ORG, userId, occurredAt },
    });
    const settle = settleAggregateReconcile({
      lane: "reconcileAggregatesOnMemberRemoved",
      per: "organization",
    });

    /** @scenario "A burst of changes in one organisation queues one reconcile" */
    it("holds one job per organisation for 30s, the newest fact replacing the older", () => {
      const ids = [memberFact("u_a", 1), memberFact("u_b", 2), memberFact("u_c", 3)].map((fact) =>
        settle.deduplication.makeId(fact),
      );

      expect(new Set(ids).size).toBe(1);
      expect(settle.delay).toBe(AGGREGATE_RECONCILE_SETTLE_MS);
      expect(settle.deduplication.ttlMs).toBeGreaterThan(settle.delay);
      // Replace and extend left on: the queue keeps the newest payload and restarts the window.
      expect(settle.deduplication).not.toHaveProperty("replace");
      expect(settle.deduplication).not.toHaveProperty("extend");
    });

    /** @scenario "A burst of changes in one organisation queues one reconcile" */
    it("queues the reconcile under the newest fact's own key", async () => {
      const enqueue = vi.fn(async () => undefined);
      await enqueueMemberAggregates({
        reconciler: { aggregatesToReconcile: async () => ["agg_1"] },
        outbox: { enqueue },
        trigger: "member-removed",
      })(memberFact("u_c", 3).data);

      expect(enqueue).toHaveBeenCalledExactlyOnceWith({
        organizationId: ORG,
        aggregateProjectIds: ["agg_1"],
        cause: "member-removed:u_c:3",
      });
    });

    it("keeps another organisation's burst apart", () => {
      expect(settle.deduplication.makeId({ data: { organizationId: "org_2" } })).not.toBe(
        settle.deduplication.makeId(memberFact("u_a", 1)),
      );
    });
  });

  describe("given project facts the handler reads the project of", () => {
    const settle = settleAggregateReconcile({
      lane: "reconcileAggregatesOnProjectArchived",
      per: "project",
    });

    it("keeps each project's fact apart, so an archived aggregate is still retired", () => {
      expect(
        settle.deduplication.makeId({ data: { organizationId: ORG, projectId: "agg_old" } }),
      ).not.toBe(settle.deduplication.makeId({ data: { organizationId: ORG, projectId: "p_b" } }));
    });
  });

  describe("when a reconcile is enqueued", () => {
    it("appends one intent per aggregate on that aggregate's own instance", async () => {
      const appendIntents = vi.fn<ProcessStore["appendIntents"]>(async () => ({
        insertedMessageKeys: [],
        duplicateMessageKeys: [],
      }));

      await OutboxAggregateReconcile.create({ appendIntents }).enqueue({
        organizationId: ORG,
        aggregateProjectIds: ["agg_1"],
        cause: "rule-changed:1",
      });

      expect(appendIntents).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: refOf("agg_1"),
          messages: [
            expect.objectContaining({
              messageKey: "reconcile:agg_1:rule-changed:1",
              intentType: "reconcile",
              payload: { organizationId: ORG, aggregateProjectId: "agg_1" },
            }),
          ],
        }),
      );
    });
  });

  describe("when a project fact arrives", () => {
    const fact = { projectId: "p_a", organizationId: ORG, occurredAt: 7 };

    it("enqueues the aggregates it touches, under a key a redelivery repeats", async () => {
      const enqueue = vi.fn(async () => undefined);
      await enqueueAffectedAggregates({
        reconciler: { aggregatesToReconcile: async () => ["agg_1"] },
        outbox: { enqueue },
        trigger: "project-archived",
      })(fact);

      expect(enqueue).toHaveBeenCalledWith({
        organizationId: ORG,
        aggregateProjectIds: ["agg_1"],
        cause: "project-archived:p_a:7",
      });
    });

    it("enqueues only the aggregate whose rule changed", async () => {
      const enqueue = vi.fn(async () => undefined);
      await enqueueChangedAggregate({ outbox: { enqueue } })(fact);

      expect(enqueue).toHaveBeenCalledWith({
        organizationId: ORG,
        aggregateProjectIds: ["p_a"],
        cause: "rule-changed:7",
      });
    });
  });
});
