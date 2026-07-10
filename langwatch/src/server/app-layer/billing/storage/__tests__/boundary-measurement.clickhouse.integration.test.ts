import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { BoundaryMeasurementService } from "../boundaryMeasurement.service";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";
import { partitionStartFor } from "../sealedHour";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertSpan({
  client,
  tenantId,
  startTime,
  retentionDays,
}: {
  client: ClickHouseClient;
  tenantId: string;
  startTime: Date;
  retentionDays: number;
}): Promise<void> {
  await client.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: `trace-${nanoid()}`,
        SpanId: `span-${nanoid()}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: startTime,
        EndTime: new Date(startTime.getTime() + 100),
        DurationMs: 100,
        SpanName: "billing-test-span",
        SpanKind: 1,
        ServiceName: "billing-test",
        ResourceAttributes: {},
        SpanAttributes: { "test.payload": "x".repeat(512) },
        StatusCode: 1,
        StatusMessage: null,
        ScopeName: "test",
        ScopeVersion: null,
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.Attributes": [],
        DroppedAttributesCount: 0,
        DroppedEventsCount: 0,
        DroppedLinksCount: 0,
        CreatedAt: startTime,
        UpdatedAt: startTime,
        _retention_days: retentionDays,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

describe.skipIf(!hasTestcontainers)("BoundaryMeasurementService", () => {
  const organizationId = `org_test_measure_${nanoid(8)}`;
  const projectId = `project_test_measure_${nanoid(8)}`;
  let client: ClickHouseClient;
  let service: BoundaryMeasurementService;
  const gauge = new PrismaStorageBillableGaugeRepository(prisma);

  // Measurement instant: now. The crossing slice is the day 35 days ago.
  const at = new Date();
  const crossingDay = new Date(
    Math.floor((at.getTime() - 35 * DAY_MS) / DAY_MS) * DAY_MS,
  );

  beforeAll(async () => {
    const containers = await startTestContainers();
    client = containers.clickHouseClient;
    service = new BoundaryMeasurementService({
      resolveClickHouseClient: async () => client,
      events: new PrismaStorageBoundaryEventRepository(prisma),
      listProjectIds: async () => [projectId],
    });

    // A row crossing the 35-day line right now (in the transiting partition)…
    await insertSpan({
      client,
      tenantId: projectId,
      startTime: new Date(crossingDay.getTime() + 2 * 60 * 60 * 1000),
      retentionDays: 63,
    });
    // …and a row in a much older partition (aged 50 days, long past its
    // crossing): steady-state measurement must never read that partition.
    await insertSpan({
      client,
      tenantId: projectId,
      startTime: new Date(at.getTime() - 50 * DAY_MS),
      retentionDays: 63,
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.storageBoundaryEvent.deleteMany({ where: { organizationId } });
    await prisma.storageBillableGauge.deleteMany({ where: { organizationId } });
  });

  describe("when the daily crossing is measured", () => {
    /** @scenario Data aging past 35 days increases the gauge that day */
    it("records an entry event and the gauge increases by the crossing bytes", async () => {
      await service.measureEntriesForOrg({ organizationId, at });

      const events = await prisma.storageBoundaryEvent.findMany({
        where: { organizationId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.edge).toBe("ENTRY");
      expect(events[0]!.deltaBytes).toBeGreaterThan(0n);

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(events[0]!.deltaBytes);
    });

    /** @scenario Measuring a crossing reads only the crossing week partition */
    it("leaves the long-crossed older partition unread (its bytes never enter the gauge)", async () => {
      // The 50-day-old row is billable-aged but lives outside the transiting
      // partition — steady state never measures it (that is seeding's job).
      const events = await prisma.storageBoundaryEvent.findMany({
        where: { organizationId },
      });
      const totalRecorded = events.reduce((sum, e) => sum + e.deltaBytes, 0n);

      const result = await client.query({
        query: `
          SELECT toString(sum(_size_bytes)) AS bytes FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND StartTime >= {partitionStart:DateTime64(3)}
            AND StartTime < {partitionEnd:DateTime64(3)}
        `,
        query_params: {
          tenantId: projectId,
          partitionStart: partitionStartFor(crossingDay),
          partitionEnd: new Date(
            partitionStartFor(crossingDay).getTime() + 7 * DAY_MS,
          ),
        },
        format: "JSONEachRow",
      });
      const [row] = await result.json<{ bytes: string }>();
      expect(totalRecorded).toEqual(BigInt(row!.bytes));
    });

    it("prunes to a single partition (EXPLAIN-verified, not just a string test)", async () => {
      const partitionStart = partitionStartFor(crossingDay);
      const result = await client.query({
        query: `
          EXPLAIN indexes = 1
          SELECT sum(_size_bytes) FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND StartTime >= {partitionStart:DateTime64(3)}
            AND StartTime < {partitionEnd:DateTime64(3)}
            AND StartTime <= {cutoff:DateTime64(3)}
        `,
        query_params: {
          tenantId: projectId,
          partitionStart,
          partitionEnd: new Date(partitionStart.getTime() + 7 * DAY_MS),
          cutoff: new Date(at.getTime() - 35 * DAY_MS),
        },
        format: "TabSeparatedRaw",
      });
      const plan = await result.text();

      // The Partition pruning stage translates the Sunday-aligned range
      // predicate into a toYearWeek interval; a single-partition query has
      // EQUAL bounds (in (-Inf, W] ∧ in [W, +Inf) → exactly partition W).
      // Unequal bounds would mean the range straddles two partitions — the
      // budget violation this test exists to catch.
      const partitionStage =
        /Partition[\s\S]*?in \(-Inf, (\d+)\][\s\S]*?in \[(\d+), \+Inf\)/.exec(
          plan,
        );
      expect(
        partitionStage,
        `no partition pruning stage in plan:\n${plan}`,
      ).not.toBeNull();
      const [, upperWeek, lowerWeek] = partitionStage!;
      expect(upperWeek).toEqual(lowerWeek);
    });
  });
});
