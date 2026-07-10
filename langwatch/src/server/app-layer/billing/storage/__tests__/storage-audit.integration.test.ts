import { nanoid } from "nanoid";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { PrismaStorageAuditStateRepository } from "../repositories/storage-audit-state.prisma.repository";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";
import { StorageAuditService } from "../storageAudit.service";
import { StorageAuditTierService } from "../storageAuditTier.service";

const GIB = 1024n * 1024n * 1024n;
const DAY_MS = 24 * 60 * 60 * 1000;

const usedOrgs: string[] = [];
const events = new PrismaStorageBoundaryEventRepository(prisma);
const gauge = new PrismaStorageBillableGaugeRepository(prisma);
const auditState = new PrismaStorageAuditStateRepository(prisma);

const at = new Date(Date.UTC(2026, 6, 15, 1));
const sliceDate = new Date(Date.UTC(2026, 5, 1));

function makeAudit({
  measuredBytes = null,
}: {
  /** null = the reference measurement must never be called. */
  measuredBytes?: bigint | null;
}) {
  const alarms: { kind: string }[] = [];
  const measureReferenceBytes = vi.fn(async () => {
    if (measuredBytes === null) {
      throw new Error("ClickHouse must not be touched by this audit");
    }
    return measuredBytes;
  });
  const service = new StorageAuditService({
    events,
    gauge,
    auditState,
    measurement: { measureReferenceBytes },
    tier: { computeTier: async () => ({ tier: "daily", reasons: [] }) },
    onAuditAlarm: ({ kind }) => alarms.push({ kind }),
  });
  return { service, alarms, measureReferenceBytes };
}

async function seedOrg(prefix: string, bytes: bigint) {
  const organizationId = `org_audit_${prefix}_${nanoid(8)}`;
  usedOrgs.push(organizationId);
  await events.append({
    organizationId,
    projectId: `project_${organizationId}`,
    category: "traces",
    partitionKey: "2026-05-31",
    sliceDate,
    retentionDays: 91,
    edge: "ENTRY",
    deltaBytes: bytes,
    occurredAt: new Date(sliceDate.getTime() + 35 * DAY_MS),
  });
  return organizationId;
}

afterAll(async () => {
  await prisma.storageBoundaryEvent.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
  await prisma.storageBillableGauge.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
  await prisma.storageAuditState.deleteMany({
    where: { organizationId: { in: usedOrgs } },
  });
});

describe("StorageAuditService", () => {
  describe("when the fold audit runs over a healthy org", () => {
    /** @scenario The daily fold audit recomputes every gauge from its event log */
    it("compares fold(events) to the gauge row without touching ClickHouse", async () => {
      const organizationId = await seedOrg("clean", 2n * GIB);
      const { service, alarms, measureReferenceBytes } = makeAudit({
        measuredBytes: null,
      });

      const result = await service.runFoldAudit({ organizationId, at });

      expect(result.clean).toBe(true);
      expect(alarms).toEqual([]);
      expect(measureReferenceBytes).not.toHaveBeenCalled();
    });
  });

  describe("when a gauge row was corrupted", () => {
    /** @scenario A gauge that disagrees with its event log raises an alarm */
    it("alarms and leaves the corrupted gauge untouched", async () => {
      const organizationId = await seedOrg("corrupt", 2n * GIB);
      await prisma.storageBillableGauge.update({
        where: { organizationId },
        data: { billableBytes: 999n },
      });

      const { service, alarms } = makeAudit({ measuredBytes: null });
      const result = await service.runFoldAudit({ organizationId, at });

      expect(result.clean).toBe(false);
      expect(alarms).toEqual([{ kind: "fold" }]);
      // NOT auto-corrected.
      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(999n);
      // And the org is latched.
      const state = await auditState.findByOrganization({ organizationId });
      expect(state?.everAlarmedAt).not.toBeNull();
    });
  });

  describe("when the reference audit re-measures its rotation slice", () => {
    /** @scenario The reference audit re-measures a bounded rotating slice per day */
    it("covers every partition exactly once across 7 consecutive days", async () => {
      const organizationId = `org_audit_rotate_${nanoid(8)}`;
      usedOrgs.push(organizationId);
      // 14 partitions of recorded groups.
      for (let week = 0; week < 14; week++) {
        await events.append({
          organizationId,
          projectId: `project_${organizationId}`,
          category: "traces",
          partitionKey: `2026-${String(week + 10).padStart(2, "0")}-01`,
          sliceDate: new Date(sliceDate.getTime() + week * 7 * DAY_MS),
          retentionDays: 0, // indefinite: never exits, stable fixture
          edge: "ENTRY",
          deltaBytes: 1n * GIB,
          occurredAt: new Date(sliceDate.getTime() + 35 * DAY_MS),
        });
      }

      const { service } = makeAudit({ measuredBytes: 1n * GIB });
      const perDay: number[] = [];
      let total = 0;
      for (let day = 0; day < 7; day++) {
        const result = await service.runReferenceAudit({
          organizationId,
          at: new Date(at.getTime() + day * DAY_MS),
        });
        perDay.push(result.partitionsChecked);
        total += result.partitionsChecked;
      }

      expect(total).toEqual(14); // full coverage in 7 days
      expect(Math.max(...perDay)).toBeLessThan(14); // never everything at once
    });
  });

  describe("when re-measured bytes disagree with the recorded events", () => {
    /** @scenario A reference mismatch alarms and is never auto-corrected */
    it("alarms without writing any corrective events", async () => {
      const organizationId = await seedOrg("mismatch", 2n * GIB);
      const { service, alarms } = makeAudit({ measuredBytes: 10n * GIB });

      // Run across a full rotation so the org's single partition gets its turn.
      for (let day = 0; day < 7; day++) {
        await service.runReferenceAudit({
          organizationId,
          at: new Date(at.getTime() + day * DAY_MS),
        });
      }

      expect(alarms).toEqual([{ kind: "reference" }]);
      const log = await events.findAllByOrganization({ organizationId });
      expect(log).toHaveLength(1); // nothing auto-corrected
      const state = await auditState.findByOrganization({ organizationId });
      expect(state?.lastAlarmKind).toEqual("reference");
    });
  });
});

describe("StorageAuditTierService", () => {
  const makeTier = (inFlight: boolean) =>
    new StorageAuditTierService({
      auditState,
      hasRetentionMutationInFlight: async () => inFlight,
    });

  describe("when an organization has ever tripped an audit alarm", () => {
    /** @scenario An alarmed organization stays on daily audit permanently */
    it("stays on the daily tier even when the default relaxes to weekly", async () => {
      const organizationId = `org_audit_tier_${nanoid(8)}`;
      usedOrgs.push(organizationId);
      await auditState.recordAlarm({ organizationId, kind: "fold", at });

      const { tier, reasons } = await makeTier(false).computeTier({
        organizationId,
        defaultTier: "weekly",
      });
      expect(tier).toEqual("daily");
      expect(reasons).toContain("alarmed-permanently-daily");
    });
  });

  describe("when a retention relabeling is stuck partway", () => {
    /** @scenario An organization with a stuck retention change stays on daily audit until it completes */
    it("pins the org to daily while in flight and releases it once complete", async () => {
      const organizationId = `org_audit_wedge_${nanoid(8)}`;
      usedOrgs.push(organizationId);

      const wedged = await makeTier(true).computeTier({
        organizationId,
        defaultTier: "weekly",
      });
      expect(wedged.tier).toEqual("daily");
      expect(wedged.reasons).toContain("retention-mutation-in-flight");

      const completed = await makeTier(false).computeTier({
        organizationId,
        defaultTier: "weekly",
      });
      expect(completed.tier).toEqual("weekly");
      expect(completed.reasons).toEqual([]);
    });
  });
});
