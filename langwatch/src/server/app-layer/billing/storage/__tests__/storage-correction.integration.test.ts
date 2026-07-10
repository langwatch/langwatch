import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { BoundaryExitService } from "../boundaryExit.service";
import { GaugeSamplingService } from "../gaugeSampling.service";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";
import { PrismaStorageUsageHourlyRepository } from "../repositories/storage-usage-hourly.prisma.repository";
import { StorageCorrectionService } from "../storageCorrection.service";

const GIB = 1024n * 1024n * 1024n;
const DAY_MS = 24 * 60 * 60 * 1000;

const usedOrgs: string[] = [];
const events = new PrismaStorageBoundaryEventRepository(prisma);
const gauge = new PrismaStorageBillableGaugeRepository(prisma);
const corrections = new StorageCorrectionService({ events });
const exits = new BoundaryExitService({ events });

const sliceDate = new Date(Date.UTC(2026, 4, 1));

function makeOrg(prefix: string) {
  const organizationId = `org_${prefix}_${nanoid(8)}`;
  usedOrgs.push(organizationId);
  const projectId = `project_${organizationId}`;
  return { organizationId, projectId };
}

async function seedEntry({
  organizationId,
  projectId,
  bytes,
}: {
  organizationId: string;
  projectId: string;
  bytes: bigint;
}) {
  await events.append({
    organizationId,
    projectId,
    category: "traces",
    partitionKey: "2026-04-26",
    sliceDate,
    retentionDays: 63,
    edge: "ENTRY",
    deltaBytes: bytes,
    occurredAt: new Date(sliceDate.getTime() + 35 * DAY_MS),
  });
}

afterAll(async () => {
  await prisma.storageBoundaryEvent.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
  await prisma.storageBillableGauge.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
  await prisma.storageUsageHourly.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
});

describe("StorageCorrectionService", () => {
  describe("when a project contributing 5 GiB is deleted", () => {
    /** @scenario Deleting a project lowers the bill the same hour */
    it("records negative events before deletion and the next hourly sample reflects the drop", async () => {
      const { organizationId, projectId } = makeOrg("del");
      await seedEntry({ organizationId, projectId, bytes: 5n * GIB });

      const deletionAt = new Date(sliceDate.getTime() + 40 * DAY_MS);
      await corrections.emitDataDeletion({
        organizationId,
        projectId,
        causeId: "project_delete_1",
        at: deletionAt,
      });

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(0n);

      const sampled: number[] = [];
      const sampling = new GaugeSamplingService({
        events,
        usageHourly: new PrismaStorageUsageHourlyRepository(prisma),
        onDriftAlarm: () => {},
      });
      await sampling.sampleHoursForOrg({
        organizationId,
        at: new Date(deletionAt.getTime() + 2 * 60 * 60 * 1000),
      });
      const hourly = await prisma.storageUsageHourly.findMany({
        where: { organizationId },
      });
      sampled.push(...hourly.map((h) => h.megabytes));
      expect(sampled).toEqual([0]);
    });
  });

  describe("when an erasure request covers billable data", () => {
    /** @scenario A privacy erasure request lowers the bill before the data is erased */
    it("records the negation keyed by the erasure request before anything is erased", async () => {
      const { organizationId, projectId } = makeOrg("erase");
      await seedEntry({ organizationId, projectId, bytes: 2n * GIB });

      await corrections.emitDataDeletion({
        organizationId,
        projectId,
        causeId: "erasure_request_42",
        at: new Date(sliceDate.getTime() + 40 * DAY_MS),
      });

      const log = await events.findAllByOrganization({ organizationId });
      expect(log.map((e) => [e.edge, e.deltaBytes])).toEqual([
        ["ENTRY", 2n * GIB],
        ["DELETION", -2n * GIB],
      ]);
      expect(log[1]!.dedupKey).toContain("erasure_request_42");

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(0n);
    });
  });

  describe("when retention changes from 63 to 91 days", () => {
    /** @scenario A retention policy change re-books affected data under the new retention */
    it("reverses and re-emits under 91 days: gauge unchanged, exits move to day 91", async () => {
      const { organizationId, projectId } = makeOrg("rebook");
      await seedEntry({ organizationId, projectId, bytes: 3n * GIB });

      await corrections.emitRetentionChange({
        organizationId,
        projectId,
        category: "traces",
        newRetentionDays: 91,
        causeId: "retention_change_1",
        at: new Date(sliceDate.getTime() + 40 * DAY_MS),
      });

      const afterChange = await gauge.findByOrganization({ organizationId });
      expect(afterChange?.billableBytes).toEqual(3n * GIB);

      // The old exit date passes: nothing exits (the 63d group nets to zero).
      await exits.emitExitsDue({
        organizationId,
        at: new Date(sliceDate.getTime() + 63 * DAY_MS),
      });
      expect(
        (await gauge.findByOrganization({ organizationId }))?.billableBytes,
      ).toEqual(3n * GIB);

      // The new exit date passes: the re-booked group exits.
      await exits.emitExitsDue({
        organizationId,
        at: new Date(sliceDate.getTime() + 91 * DAY_MS),
      });
      expect(
        (await gauge.findByOrganization({ organizationId }))?.billableBytes,
      ).toEqual(0n);
    });
  });

  describe("when retention is lowered below the data's age", () => {
    it("reverses without re-booking — the bytes leave the bill now", async () => {
      const { organizationId, projectId } = makeOrg("lower");
      await seedEntry({ organizationId, projectId, bytes: 1n * GIB });

      // Data is 50 days old; retention drops to 42 → already past entitlement.
      await corrections.emitRetentionChange({
        organizationId,
        projectId,
        category: "traces",
        newRetentionDays: 42,
        causeId: "retention_change_low",
        at: new Date(sliceDate.getTime() + 50 * DAY_MS),
      });

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(0n);
    });
  });
});
