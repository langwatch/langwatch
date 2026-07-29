import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { BoundaryExitService } from "../boundaryExit.service";
import { BoundaryMeasurementService } from "../boundaryMeasurement.service";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";
import { floorToDay, partitionKeyFor, partitionStartFor } from "../sealedHour";
import { StorageSeedingService } from "../storageSeeding.service";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertSpan({
  client,
  tenantId,
  startTime,
  retentionDays,
  payloadBytes = 512,
}: {
  client: ClickHouseClient;
  tenantId: string;
  startTime: Date;
  retentionDays: number;
  payloadBytes?: number;
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
        SpanName: "seed-test-span",
        SpanKind: 1,
        ServiceName: "seed-test",
        ResourceAttributes: {},
        SpanAttributes: { "test.payload": "x".repeat(payloadBytes) },
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

describe.skipIf(!hasTestcontainers)("StorageSeedingService", () => {
  const organizationId = `org_test_seed_${nanoid(8)}`;
  const projectId = `project_test_seed_${nanoid(8)}`;
  let client: ClickHouseClient;
  let seeding: StorageSeedingService;
  let measurement: BoundaryMeasurementService;
  const events = new PrismaStorageBoundaryEventRepository(prisma);
  const gauge = new PrismaStorageBillableGaugeRepository(prisma);

  const at = new Date();
  // Two rows deep in the billable window (well past 35d, well under 91d
  // retention), in two different partitions.
  const oldRow1 = new Date(at.getTime() - 45 * DAY_MS);
  const oldRow2 = new Date(at.getTime() - 52 * DAY_MS);

  async function expectedBillableBytes(): Promise<bigint> {
    const result = await client.query({
      query: `
        SELECT toString(sum(_size_bytes)) AS bytes FROM stored_spans
        WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId: projectId },
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ bytes: string }>();
    return BigInt(row!.bytes ?? "0");
  }

  beforeAll(async () => {
    const containers = await startTestContainers();
    client = containers.clickHouseClient;
    const listProjectIds = async () => [projectId];
    measurement = new BoundaryMeasurementService({
      resolveClickHouseClient: async () => client,
      events,
      listProjectIds,
    });
    seeding = new StorageSeedingService({ measurement, listProjectIds });

    await insertSpan({
      client,
      tenantId: projectId,
      startTime: oldRow1,
      retentionDays: 91,
    });
    await insertSpan({
      client,
      tenantId: projectId,
      startTime: oldRow2,
      retentionDays: 91,
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.storageBoundaryEvent.deleteMany({ where: { organizationId } });
    await prisma.storageBillableGauge.deleteMany({ where: { organizationId } });
  });

  describe("when the seeding command runs over pre-engine data", () => {
    /** @scenario Seeding backfills data that was already billable at deploy time */
    it("records per-partition seed events and the gauge reads the full billable total", async () => {
      const result = await seeding.seedOrganization({
        organizationId,
        at,
        seedRunId: "seed_run_1",
        lookbackDays: 70,
      });
      expect(result.eventsAppended).toBeGreaterThanOrEqual(2);

      const log = await events.findAllByOrganization({ organizationId });
      expect(new Set(log.map((e) => e.edge))).toEqual(new Set(["SEED"]));
      expect(
        new Set(log.map((e) => e.partitionKey)).size,
      ).toBeGreaterThanOrEqual(2);

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(await expectedBillableBytes());
    });

    /** @scenario Re-running the seed produces no duplicate events */
    it("emits nothing on a re-run and the gauge is unchanged", async () => {
      const before = await gauge.findByOrganization({ organizationId });
      const eventsBefore = await events.findAllByOrganization({
        organizationId,
      });

      const rerun = await seeding.seedOrganization({
        organizationId,
        at,
        seedRunId: "seed_run_2",
        lookbackDays: 70,
      });

      expect(rerun.eventsAppended).toEqual(0);
      const after = await gauge.findByOrganization({ organizationId });
      expect(after?.billableBytes).toEqual(before?.billableBytes);
      expect(
        (await events.findAllByOrganization({ organizationId })).length,
      ).toEqual(eventsBefore.length);
    });

    /** @scenario Seeding a partition mid-crossing does not double count */
    it("counts a live-tracked mid-transit partition's slices exactly once", async () => {
      // A row on the exact slice live measurement covers today (the newest
      // complete slice): live measurement records it, then the seed covers
      // the same partition — cumulative-minus-prior must not re-add it.
      const currentSlice = new Date(
        Math.floor((at.getTime() - 35 * DAY_MS) / DAY_MS) * DAY_MS - DAY_MS,
      );
      const transitRow = new Date(currentSlice.getTime() + 2 * 60 * 60 * 1000);
      await insertSpan({
        client,
        tenantId: projectId,
        startTime: transitRow,
        retentionDays: 91,
      });

      await measurement.measureEntriesForOrg({ organizationId, at });
      const afterLive = await gauge.findByOrganization({ organizationId });

      await seeding.seedOrganization({
        organizationId,
        at,
        seedRunId: "seed_run_3",
        lookbackDays: 70,
      });

      const afterSeed = await gauge.findByOrganization({ organizationId });
      expect(afterSeed?.billableBytes).toEqual(afterLive?.billableBytes);
      expect(afterSeed?.billableBytes).toEqual(await expectedBillableBytes());
    });

    /** @scenario Operator re-seed corrects a broken gauge with a full audit trail */
    it("re-seeds a drifted org via corrective events, never overwriting the gauge", async () => {
      // Simulate a missed emit: delete one recorded event and roll its
      // delta out of the gauge — records now under-represent ClickHouse.
      const log = await events.findAllByOrganization({ organizationId });
      const victim = log[0]!;
      await prisma.storageBoundaryEvent.deleteMany({
        where: { organizationId, id: victim.id },
      });
      await prisma.storageBillableGauge.update({
        where: { organizationId },
        data: { billableBytes: { decrement: victim.deltaBytes } },
      });

      const reseed = await seeding.seedOrganization({
        organizationId,
        at,
        seedRunId: "seed_run_recover",
        lookbackDays: 70,
      });
      expect(reseed.eventsAppended).toBeGreaterThanOrEqual(1);

      // Recovered — and through appended corrective events, not an
      // overwrite: the correction is itself part of the audit trail.
      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(await expectedBillableBytes());
      const corrective = (
        await events.findAllByOrganization({ organizationId })
      ).filter((e) => e.dedupKey.includes("seed_run_recover"));
      expect(corrective.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when unseeded pre-engine data reaches its retention age", () => {
    /** @scenario Unseeded old data never drives the gauge negative */
    it("emits no exit for data that was never recorded", async () => {
      const unseededOrg = `org_test_unseeded_${nanoid(8)}`;
      // Data existed and TTL deleted it — but it was never seeded, so there
      // are no recorded groups. The exit sweep finds nothing to mirror.
      const exits = new BoundaryExitService({ events });
      await exits.emitExitsDue({
        organizationId: unseededOrg,
        at: new Date(at.getTime() + 400 * DAY_MS),
      });

      const log = await events.findAllByOrganization({
        organizationId: unseededOrg,
      });
      expect(log).toEqual([]);
      expect(
        await gauge.findByOrganization({ organizationId: unseededOrg }),
      ).toBeNull();
    });
  });
});
