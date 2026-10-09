// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { JsonValue, ProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { OutboxAggregateReconcile, runAggregateSweep } from "../aggregate-reconcile.intent.ts";
import {
  AGGREGATE_RECONCILE_PROCESS_NAME,
  AGGREGATE_RECONCILE_RETENTION_MS,
  aggregateSweepWake,
} from "../aggregate-reconcile.process.ts";
import {
  enqueueAffectedAggregates,
  enqueueChangedAggregate,
} from "../aggregate-reconcile.subscriber.ts";

const AT = 1_760_000_000_000;
const intentContext = { attempt: 1 };

describe("aggregate project reconcile process", () => {
  it("asks for one sweep on every wake, keyed by its schedule time", () => {
    const sweep = vi.fn((messageKey: string, payload: JsonValue) => ({
      messageKey,
      intentType: "sweep",
      payload,
    }));
    const evolution = aggregateSweepWake(
      { lastSweepAt: null },
      {
        at: AT,
        now: AT,
        key: AGGREGATE_RECONCILE_PROCESS_NAME,
        projectId: "__global__",
        intent: intentAccessorOf({ sweep }),
      },
    );
    expect(sweep).toHaveBeenCalledWith(`sweep:${AT}`, { scheduledFor: AT });
    expect(evolution.state).toEqual({ lastSweepAt: AT });
  });

  describe("when the sweep runs", () => {
    it("enqueues every live aggregate and prunes old rows", async () => {
      const enqueue = vi.fn(async () => undefined);
      const deleteDispatchedBefore = vi.fn<ProcessStore["deleteDispatchedBefore"]>(async () => 0);

      await runAggregateSweep({
        reconciler: {
          liveAggregates: async () => [
            { id: "agg_1", organizationId: "org_1" },
            { id: "agg_2", organizationId: "org_2" },
          ],
        },
        outbox: { enqueue },
        deleteDispatchedBefore,
        now: () => AT,
      })({ scheduledFor: AT }, intentContext);

      expect(enqueue).toHaveBeenCalledWith({
        organizationId: "org_2",
        aggregateProjectIds: ["agg_2"],
        cause: `sweep:${AT}`,
      });
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: AGGREGATE_RECONCILE_PROCESS_NAME,
        before: AT - AGGREGATE_RECONCILE_RETENTION_MS,
      });
    });
  });

  describe("when a reconcile is enqueued", () => {
    it("appends one intent per aggregate on that aggregate's own instance", async () => {
      const appendIntents = vi.fn<ProcessStore["appendIntents"]>(async () => undefined);

      await OutboxAggregateReconcile.create({ appendIntents }).enqueue({
        organizationId: "org_1",
        aggregateProjectIds: ["agg_1"],
        cause: "rule-changed:1",
      });

      expect(appendIntents).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: {
            processName: AGGREGATE_RECONCILE_PROCESS_NAME,
            projectId: "org_1",
            processKey: "aggregate:agg_1",
          },
          messages: [
            expect.objectContaining({
              messageKey: "reconcile:agg_1:rule-changed:1",
              intentType: "reconcile",
              payload: { organizationId: "org_1", aggregateProjectId: "agg_1" },
            }),
          ],
        }),
      );
    });
  });

  describe("when a project fact arrives", () => {
    const fact = { projectId: "p_a", organizationId: "org_1", occurredAt: 7 };

    it("enqueues the aggregates it touches, under a key a redelivery repeats", async () => {
      const enqueue = vi.fn(async () => undefined);
      await enqueueAffectedAggregates({
        reconciler: { aggregatesToReconcile: async () => ["agg_1"] },
        outbox: { enqueue },
        trigger: "project-archived",
      })(fact);

      expect(enqueue).toHaveBeenCalledWith({
        organizationId: "org_1",
        aggregateProjectIds: ["agg_1"],
        cause: "project-archived:p_a:7",
      });
    });

    it("enqueues only the aggregate whose rule changed", async () => {
      const enqueue = vi.fn(async () => undefined);
      await enqueueChangedAggregate({ outbox: { enqueue } })(fact);

      expect(enqueue).toHaveBeenCalledWith({
        organizationId: "org_1",
        aggregateProjectIds: ["p_a"],
        cause: "rule-changed:7",
      });
    });
  });
});
