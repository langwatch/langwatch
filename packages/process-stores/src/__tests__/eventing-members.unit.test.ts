/**
 * @vitest-environment node
 */
import {
  ClickHouseQueryClient,
  type InsertRequest,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { createTenantId } from "@langwatch/eventing";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { buildEventing } from "../eventing-members.ts";
import { producerEventing } from "../eventing-role.ts";
import { ConsumerPipelines } from "../pipeline-selection.ts";

/** Stands in for the data-retention contract's classifier, which a framework may not import. */
const classifyAsTheWorkerDoes = ({ AggregateType }: { AggregateType: string }) =>
  AggregateType === "trace" ? "traces" : "indefinite";

/** The consuming role over a ClickHouse whose every insert is kept for the assertion. */
function consumingEventingOver({ inserts }: { inserts: InsertRequest[] }) {
  const refuse = () => Promise.reject(new Error("only inserts run here"));
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: {
      execute: refuse,
      command: refuse,
      insert: (request) => {
        inserts.push(request);
        return Promise.resolve();
      },
    },
  });
  return buildEventing({
    config: new ConsumerPipelines()
      .consume(classifyAsTheWorkerDoes)
      .configure({ defaultRetentionDays: 49 }),
    processName: "langwatch-worker",
    prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
    eventLog: { clickhouse },
  });
}

function eventOf({ aggregateType, type }: { aggregateType: "trace" | "user"; type: string }) {
  return {
    id: `evt_${aggregateType}`,
    tenantId: createTenantId("project_abc"),
    aggregateType,
    aggregateId: `${aggregateType}_1`,
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type,
    version: "2026-01-01",
    data: {},
  };
}

describe("buildEventing", () => {
  describe("given the producer role", () => {
    /** @scenario "The producer role holds the process store too" */
    it("supplies a process store beside its producer-only event store", async () => {
      const built = buildEventing({
        config: producerEventing({ executionTarget: "web" }),
        processName: "langwatch-api",
        prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
      });

      try {
        expect(built.value.processStore).toBeDefined();
      } finally {
        await built.close?.();
      }
    });
  });

  describe("given the consuming role and the worker's retention classifier", () => {
    /** @scenario "The consuming role stamps each event_log row with its retention class" */
    it("stamps a control-plane fact 0 and a trace event with the retention default", async () => {
      const inserts: InsertRequest[] = [];
      const built = consumingEventingOver({ inserts });
      const eventStore = built.value.eventStore;
      const tenantId = createTenantId("project_abc");

      try {
        await eventStore?.storeEvents(
          [eventOf({ aggregateType: "user", type: "lw.user.created" })],
          { tenantId },
          "user",
        );
        await eventStore?.storeEvents(
          [eventOf({ aggregateType: "trace", type: "lw.obs.trace.span_received" })],
          { tenantId },
          "trace",
        );

        expect(inserts.flatMap(({ rows }) => rows).map((row) => row["_retention_days"])).toEqual([
          0, 49,
        ]);
      } finally {
        await built.close?.();
      }
    });
  });
});
