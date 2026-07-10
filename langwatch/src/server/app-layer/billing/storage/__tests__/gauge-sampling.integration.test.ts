import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { GaugeSamplingService } from "../gaugeSampling.service";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";
import { PrismaStorageUsageHourlyRepository } from "../repositories/storage-usage-hourly.prisma.repository";

const GIB = 1024n * 1024n * 1024n;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const usedOrgs: string[] = [];

function makeFixture() {
  const organizationId = `org_test_sample_${nanoid(8)}`;
  usedOrgs.push(organizationId);
  const events = new PrismaStorageBoundaryEventRepository(prisma);
  const usageHourly = new PrismaStorageUsageHourlyRepository(prisma);
  const alarms: { gaugeBytes: bigint }[] = [];
  const service = new GaugeSamplingService({
    events,
    usageHourly,
    onDriftAlarm: (params) => alarms.push(params),
  });
  return { organizationId, events, usageHourly, service, alarms };
}

const sliceDate = new Date(Date.UTC(2026, 4, 1));
// Unique project per org: the dedup identity is project-grained (project ids
// are globally unique in production), so reusing one project id across test
// orgs would collide keys.
const baseEvent = (organizationId: string) =>
  ({
    organizationId,
    projectId: `project_${organizationId}`,
    category: "traces",
    partitionKey: "2026-04-26",
    sliceDate,
    retentionDays: 63,
  }) as const;

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

describe("GaugeSamplingService", () => {
  describe("when 6 hours went unsampled", () => {
    /** @scenario Missed hours are filled by one ordered catch-up replay */
    it("produces all 6 hourly rows in order from a single replay", async () => {
      const { organizationId, events, usageHourly, service } = makeFixture();
      const t0 = new Date(Date.UTC(2026, 6, 10, 0));

      await events.append({
        ...baseEvent(organizationId),
        edge: "ENTRY",
        deltaBytes: 2n * GIB,
        occurredAt: new Date(t0.getTime() - DAY_MS),
      });
      // Seed the cursor: hour t0 already sampled, then a 6-hour gap.
      await usageHourly.recordHours({
        organizationId,
        rows: [{ sealedHour: t0, megabytes: 2048 }],
      });

      await service.sampleHoursForOrg({
        organizationId,
        at: new Date(t0.getTime() + 7 * HOUR_MS + 10 * 60 * 1000),
      });

      const rows = await prisma.storageUsageHourly.findMany({
        where: { organizationId },
        orderBy: { sealedHour: "asc" },
      });
      expect(rows.map((r) => r.sealedHour.getTime())).toEqual(
        Array.from({ length: 7 }, (_, i) => t0.getTime() + i * HOUR_MS),
      );
      expect(rows.slice(1).map((r) => r.megabytes)).toEqual(
        Array.from({ length: 6 }, () => 2048),
      );
    });
  });

  describe("when the gauge changed between a missed hour and now", () => {
    /** @scenario A caught-up hour records its true historical value, never the current one */
    it("stamps each caught-up hour with its fold-to-H value", async () => {
      const { organizationId, events, usageHourly, service } = makeFixture();
      const t0 = new Date(Date.UTC(2026, 6, 10, 0));

      await events.append({
        ...baseEvent(organizationId),
        edge: "ENTRY",
        deltaBytes: 1n * GIB,
        occurredAt: new Date(t0.getTime() - DAY_MS),
      });
      await usageHourly.recordHours({
        organizationId,
        rows: [{ sealedHour: t0, megabytes: 1024 }],
      });
      // Mid-gap the gauge grows: a 2 GiB entry lands effective at hour +3.
      await events.append({
        ...baseEvent(organizationId),
        sliceDate: new Date(sliceDate.getTime() + DAY_MS),
        edge: "ENTRY",
        deltaBytes: 2n * GIB,
        occurredAt: new Date(t0.getTime() + 3 * HOUR_MS),
      });

      await service.sampleHoursForOrg({
        organizationId,
        at: new Date(t0.getTime() + 6 * HOUR_MS + 5 * 60 * 1000),
      });

      const rows = await prisma.storageUsageHourly.findMany({
        where: { organizationId },
        orderBy: { sealedHour: "asc" },
      });
      // Hours +1,+2 hold the historical 1 GiB; +3 onward the grown 3 GiB —
      // never today's value stamped backwards.
      expect(rows.map((r) => r.megabytes)).toEqual([
        1024, 1024, 1024, 3072, 3072, 3072,
      ]);
    });
  });

  describe("when the gauge is far below zero", () => {
    /** @scenario A gauge negative beyond tolerance raises a drift alarm without blocking sampling */
    it("raises the drift alarm and still writes the clamped zero row", async () => {
      const { organizationId, events, usageHourly, service, alarms } =
        makeFixture();
      const t0 = new Date(Date.UTC(2026, 6, 10, 0));

      await events.append({
        ...baseEvent(organizationId),
        edge: "EXIT",
        deltaBytes: -5n * GIB,
        occurredAt: new Date(t0.getTime() - DAY_MS),
      });
      await usageHourly.recordHours({
        organizationId,
        rows: [{ sealedHour: t0, megabytes: 0 }],
      });

      // At 02:05 the sealed hour is 01:00 — one new hour to sample.
      await service.sampleHoursForOrg({
        organizationId,
        at: new Date(t0.getTime() + 2 * HOUR_MS + 5 * 60 * 1000),
      });

      expect(alarms.length).toBeGreaterThan(0);
      expect(alarms[0]!.gaugeBytes).toEqual(-5n * GIB);

      const rows = await prisma.storageUsageHourly.findMany({
        where: { organizationId },
        orderBy: { sealedHour: "asc" },
      });
      expect(rows.map((r) => r.megabytes)).toEqual([0, 0]);
    });
  });
});
