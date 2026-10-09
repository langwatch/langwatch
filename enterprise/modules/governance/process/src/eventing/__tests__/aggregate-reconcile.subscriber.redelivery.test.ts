// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { OutboxAggregateReconcile } from "../aggregate-reconcile.intent.ts";
import {
  enqueueAffectedAggregates,
  enqueueChangedAggregate,
  enqueueMemberAggregates,
} from "../aggregate-reconcile.subscriber.ts";

/** An outbox that keeps one row per message key, as the process store does. */
function keyedOutbox() {
  const rows = new Map<string, unknown>();
  const appendIntents: ProcessStore["appendIntents"] = async ({ messages }) => {
    for (const message of messages) rows.set(message.messageKey, message.payload);
  };
  return { rows, outbox: OutboxAggregateReconcile.create({ appendIntents }) };
}

const fact = { projectId: "p_a", organizationId: "org_1", occurredAt: 7 };

describe("aggregate reconcile subscribers", () => {
  describe("when a project fact is delivered twice", () => {
    it("leaves one reconcile per touched aggregate", async () => {
      const { rows, outbox } = keyedOutbox();
      const handle = enqueueAffectedAggregates({
        reconciler: { aggregatesToReconcile: async () => ["agg_1", "agg_2"] },
        outbox,
        trigger: "project-created",
      });

      await handle(fact);
      await handle(fact);

      expect([...rows.keys()]).toEqual([
        "reconcile:agg_1:project-created:p_a:7",
        "reconcile:agg_2:project-created:p_a:7",
      ]);
    });
  });

  describe("when a rule change is delivered twice", () => {
    it("leaves one reconcile of that aggregate", async () => {
      const { rows, outbox } = keyedOutbox();
      const handle = enqueueChangedAggregate({ outbox });

      await handle(fact);
      await handle(fact);

      expect(rows.size).toBe(1);
    });
  });

  describe("when a member fact is delivered twice", () => {
    it("asks for the organisation's aggregates alone and leaves one reconcile each", async () => {
      const { rows, outbox } = keyedOutbox();
      const asked: unknown[] = [];
      const handle = enqueueMemberAggregates({
        reconciler: {
          aggregatesToReconcile: async (input) => {
            asked.push(input);
            return ["agg_1"];
          },
        },
        outbox,
        trigger: "member-removed",
      });
      const member = { organizationId: "org_1", userId: "user_1", occurredAt: 9 };

      await handle(member);
      await handle(member);

      expect(asked).toEqual([{ organizationId: "org_1" }, { organizationId: "org_1" }]);
      expect([...rows.keys()]).toEqual(["reconcile:agg_1:member-removed:user_1:9"]);
    });
  });

  describe("when a member is re-enabled", () => {
    /** @scenario "Re-enabling a member reconciles the organisation's aggregates" */
    it("queues one reconcile per organisation aggregate, however often the fact arrives", async () => {
      const { rows, outbox } = keyedOutbox();
      const handle = enqueueMemberAggregates({
        reconciler: { aggregatesToReconcile: async () => ["agg_1", "agg_2"] },
        outbox,
        trigger: "member-enabled",
      });
      const member = { organizationId: "org_1", userId: "user_1", occurredAt: 9 };

      await handle(member);
      await handle(member);

      expect([...rows.keys()]).toEqual([
        "reconcile:agg_1:member-enabled:user_1:9",
        "reconcile:agg_2:member-enabled:user_1:9",
      ]);
    });
  });
});
