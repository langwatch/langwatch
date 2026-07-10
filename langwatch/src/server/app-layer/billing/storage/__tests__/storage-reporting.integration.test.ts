import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { PrismaStorageBillingCheckpointRepository } from "../repositories/storage-billing-checkpoint.prisma.repository";
import { PrismaStorageUsageHourlyRepository } from "../repositories/storage-usage-hourly.prisma.repository";
import {
  buildStorageMeterIdentifier,
  StorageReportingService,
} from "../storageReporting.service";

const HOUR_MS = 60 * 60 * 1000;
const at = new Date(Date.UTC(2026, 6, 15, 12, 30));

const usedOrgs: string[] = [];
const usageHourly = new PrismaStorageUsageHourlyRepository(prisma);
const checkpoints = new PrismaStorageBillingCheckpointRepository(prisma);

function makeReporter({
  billingEnabled = true,
  failSends = 0,
  alreadyExists = false,
  permanentReject = false,
}: {
  billingEnabled?: boolean;
  failSends?: number;
  alreadyExists?: boolean;
  permanentReject?: boolean;
} = {}) {
  const sent: { identifier: string; value: number; timestamp: number }[] = [];
  const alerts: { kind: string }[] = [];
  let remainingFailures = failSends;
  let rejectNext = permanentReject;
  const service = new StorageReportingService({
    usageHourly,
    checkpoints,
    isBillingEnabled: async () => billingEnabled,
    getBillableOrg: async () => ({
      stripeCustomerId: "cus_test",
      subscriptions: [{ id: "sub_test" }],
    }),
    sendMeterEvent: vi.fn(async ({ identifier, value, timestamp }) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("stripe transient error");
      }
      if (rejectNext) {
        rejectNext = false;
        return { outcome: "permanent-reject" as const };
      }
      // Stripe-side dedup: a resend with a known identifier records nothing
      // new — like the real client mapping resource_already_exists.
      if (alreadyExists && sent.some((s) => s.identifier === identifier)) {
        return { outcome: "duplicate" as const };
      }
      sent.push({ identifier, value, timestamp });
      return { outcome: "sent" as const };
    }),
    onReportingAlert: ({ kind }) => alerts.push({ kind }),
  });
  return { service, sent, alerts };
}

async function orgWithHours(
  prefix: string,
  rows: { hoursAgo: number; megabytes: number }[],
) {
  const organizationId = `org_report_${prefix}_${nanoid(8)}`;
  usedOrgs.push(organizationId);
  await usageHourly.recordHours({
    organizationId,
    rows: rows.map((row) => ({
      sealedHour: new Date(at.getTime() - row.hoursAgo * HOUR_MS),
      megabytes: row.megabytes,
    })),
  });
  return organizationId;
}

afterAll(async () => {
  await prisma.storageUsageHourly.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
  await prisma.storageBillingCheckpoint.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
});

describe("StorageReportingService", () => {
  describe("when the reporter runs twice over the same hour", () => {
    /** @scenario Each organization hour is reported exactly once */
    it("sends one meter event and never a second", async () => {
      const organizationId = await orgWithHours("once", [
        { hoursAgo: 2, megabytes: 2048 },
      ]);
      const { service, sent } = makeReporter();

      await service.reportForOrg({ organizationId, at });
      await service.reportForOrg({ organizationId, at });

      expect(sent).toHaveLength(1);
      expect(sent[0]!.value).toEqual(2048);
    });
  });

  describe("when an hour sampled zero megabytes", () => {
    /** @scenario Zero-usage hours are settled without a Stripe call */
    it("stamps the row reported and sends nothing", async () => {
      const organizationId = await orgWithHours("zero", [
        { hoursAgo: 2, megabytes: 0 },
      ]);
      const { service, sent } = makeReporter();

      await service.reportForOrg({ organizationId, at });

      expect(sent).toEqual([]);
      const row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).not.toBeNull();
    });
  });

  describe("when a sent event's confirmation was lost and the hour is retried", () => {
    /** @scenario A resent meter event is deduplicated by Stripe */
    it("resends the SAME deterministic identifier so Stripe records the usage once", async () => {
      const organizationId = await orgWithHours("resend", [
        { hoursAgo: 3, megabytes: 1024 },
      ]);
      const { service, sent } = makeReporter({ alreadyExists: true });

      await service.reportForOrg({ organizationId, at });
      const firstIdentifier = sent[0]!.identifier;

      // Confirmation lost: the cursor never stamped. Force the retry state.
      await prisma.storageUsageHourly.updateMany({
        where: { organizationId },
        data: { reportedAt: null },
      });
      await service.reportForOrg({ organizationId, at });

      expect(firstIdentifier).toEqual(
        buildStorageMeterIdentifier({
          organizationId,
          sealedHour: new Date(at.getTime() - 3 * HOUR_MS),
        }),
      );
      // Stripe-side state: exactly one recorded event for that identifier.
      expect(sent.filter((s) => s.identifier === firstIdentifier)).toHaveLength(
        1,
      );
      const row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).not.toBeNull();
    });
  });

  describe("when Stripe rejects with a transient error", () => {
    /** @scenario A Stripe failure leaves the hour unreported for retry */
    it("leaves the hour unreported and the next run retries it", async () => {
      const organizationId = await orgWithHours("fail", [
        { hoursAgo: 2, megabytes: 512 },
      ]);
      const { service, sent } = makeReporter({ failSends: 1 });

      await service.reportForOrg({ organizationId, at });
      let row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).toBeNull();
      expect(sent).toEqual([]);

      // Next sweep: the transient condition cleared.
      await service.reportForOrg({ organizationId, at });
      row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).not.toBeNull();
      expect(sent).toHaveLength(1);
    });
  });

  describe("when an unreported hour is older than the Stripe backdate ceiling", () => {
    /** @scenario Hours older than the Stripe backdate ceiling are settled without reporting */
    it("marks it settled without a send and raises the alert", async () => {
      const organizationId = await orgWithHours("old", [
        { hoursAgo: 900, megabytes: 4096 }, // > 840h
      ]);
      const { service, sent, alerts } = makeReporter();

      await service.reportForOrg({ organizationId, at });

      expect(sent).toEqual([]);
      expect(alerts).toEqual([{ kind: "backdate-ceiling" }]);
      const row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).not.toBeNull();
    });
  });

  describe("when Stripe permanently rejects the oldest hour", () => {
    it("settles the poison row with an alert and reports the next hour", async () => {
      const organizationId = await orgWithHours("poison", [
        { hoursAgo: 3, megabytes: 100 },
        { hoursAgo: 2, megabytes: 200 },
      ]);
      const { service, sent, alerts } = makeReporter({ permanentReject: true });

      await service.reportForOrg({ organizationId, at });

      // The rejected hour is settled (never retried, never wedging the
      // queue) and the newer hour reported normally in the same run.
      expect(alerts).toEqual([{ kind: "permanent-reject" }]);
      expect(sent.map((s) => s.value)).toEqual([200]);
      const unreported = await prisma.storageUsageHourly.findMany({
        where: { organizationId, reportedAt: null },
      });
      expect(unreported).toEqual([]);
    });
  });

  describe("when the organization's billing gate is off", () => {
    /** @scenario Organizations without the billing gate are never reported */
    it("sends nothing and leaves every row unreported", async () => {
      const organizationId = await orgWithHours("gated", [
        { hoursAgo: 2, megabytes: 8192 },
      ]);
      const { service, sent } = makeReporter({ billingEnabled: false });

      await service.reportForOrg({ organizationId, at });

      expect(sent).toEqual([]);
      const row = await prisma.storageUsageHourly.findFirst({
        where: { organizationId },
      });
      expect(row?.reportedAt).toBeNull();
    });
  });
});
