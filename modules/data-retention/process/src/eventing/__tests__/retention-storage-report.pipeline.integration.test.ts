/**
 * The event-sourced report end to end: the measure command asks the storage meter for the bytes
 * before the cutoff, records one event per organization and day, and the billing process sends it
 * to the meter through its outbox. Each owner's read before a cutoff is tested in its own module.
 * @see specs/billing/retention-storage-billing.feature
 */
/** @vitest-environment node */
import { randomUUID } from "node:crypto";

import { retentionStorageDayOf } from "@langwatch/enterprise-billing-contract";
import type {
  BillingApi,
  RetentionStorageOutcome,
  RetentionStorageReport,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { emptyStoredBytesOwners } from "../../__tests__/support/stored-bytes-owners.fixture.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryStorageMeterCacheRepository } from "../../repositories/memory/memory.storage-meter-cache.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import { RetentionStorageReportService } from "../../services/retention-storage-report.service.ts";
import { StorageMeterService } from "../../services/storage-meter.service.ts";
import { ReportRetentionStorageCommand } from "../retention-storage-report.commands.ts";
import type { ReportRetentionStorageCommandData } from "../retention-storage-report.events.ts";
import {
  RETENTION_STORAGE_AGGREGATE_TYPE,
  RETENTION_STORAGE_MEASURED_EVENT_TYPE,
} from "../retention-storage-report.events.ts";
import { buildRetentionStorageReportPipeline } from "../retention-storage-report.pipeline.ts";

const DAY_MS = 86_400_000;
const projectId = `${randomUUID()}-retention-storage-report`;
const now = Date.now();

/** The event log stands in for every owner's dated rows: one write 120 days ago, one today. */
function storageMeter(): StorageMeterService {
  const eventLog = MemoryStorageMeterRepository.create();
  eventLog.recordAt({ tenantId: projectId, bytes: 4_096, atMs: now - 120 * DAY_MS });
  eventLog.recordAt({ tenantId: projectId, bytes: 1_024, atMs: now });
  return StorageMeterService.create({
    owners: emptyStoredBytesOwners(),
    eventLog,
    cache: MemoryStorageMeterCacheRepository.create(),
  });
}

/** Billing that keeps the storage line, records each meter send and refuses the first few. */
function meterBilling({ failSends = 0 }: { failSends?: number } = {}) {
  const sends: RetentionStorageReport[] = [];
  let refused = 0;
  const billing = createApiFixture<BillingApi>({
    recordRetentionStorage: async (input: RetentionStorageReport) => {
      const outcome: RetentionStorageOutcome = { line: "kept", reportedGbMonths: null };
      if (input.bytesAboveIncluded === undefined) return outcome;
      if (refused < failSends) {
        refused += 1;
        throw new Error("Stripe is unavailable");
      }
      sends.push(input);
      return { ...outcome, reportedGbMonths: 0 };
    },
  });
  return { billing, sends, refusals: () => refused };
}

async function setup({ failSends }: { failSends?: number } = {}) {
  const organizationId = `organization-${randomUUID()}`;
  const policies = MemoryDataRetentionRepository.create();
  await policies.upsertForScope({
    organizationId,
    scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    category: "traces",
    retentionDays: 182,
  });
  const projects = { findScopeProjectIds: async () => [projectId] };
  let measurements = 0;
  const meter = storageMeter();
  const countingMeter = {
    getStoredBytesBefore: (input: { tenantId: string; beforeMs: number }) => {
      measurements += 1;
      return meter.getStoredBytesBefore(input);
    },
  };
  const { billing, sends, refusals } = meterBilling(failSends === undefined ? {} : { failSends });
  const report = RetentionStorageReportService.create({
    policies,
    projects,
    meter: countingMeter,
    billing,
  });
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const registered = eventing.register(
    buildRetentionStorageReportPipeline({
      reportCommand: ReportRetentionStorageCommand.create({ measurer: report }),
      sweep: {
        request: async () => ({ requested: 0, failed: 0 }),
        deleteDispatchedBefore: async () => 0,
      },
      bill: (measured) => report.bill(measured),
      billRetryDelayMs: () => 10,
    }),
  );
  const command = (at: number): ReportRetentionStorageCommandData => ({
    tenantId: organizationId,
    organizationId,
    day: retentionStorageDayOf(at).day,
    occurredAt: at,
  });
  const send = (at: number) => registered.commands.reportRetentionStorage!.send(command(at));
  const measuredEvents = async () =>
    (
      await eventStore.getEvents({
        aggregateId: organizationId,
        context: { tenantId: createTenantId(organizationId) },
        aggregateType: RETENTION_STORAGE_AGGREGATE_TYPE,
      })
    ).filter((event) => event.type === RETENTION_STORAGE_MEASURED_EVENT_TYPE);
  return {
    organizationId,
    eventing,
    send,
    sends,
    refusals,
    measuredEvents,
    measurements: () => measurements,
  };
}

describe("the event-sourced retention storage report", () => {
  describe("when the measure command runs for an organization keeping 182 days", () => {
    /** @scenario "Each organization is measured once a day as one event" */
    it("records one measurement event and sends the day's share to the meter once", async () => {
      const { organizationId, eventing, send, sends, measuredEvents } = await setup();
      const day = retentionStorageDayOf(now).day;

      try {
        await send(now);
        await vi.waitFor(() => expect(sends).toHaveLength(1), { timeout: 20_000 });

        const events = await measuredEvents();
        expect(events).toHaveLength(1);
        const [event] = events;
        expect(event?.idempotencyKey).toBe(`retention-storage:${organizationId}:${day}`);
        expect(event?.data).toMatchObject({
          organizationId,
          day,
          longestRetentionDays: 182,
          identifier: `retention-storage:${organizationId}:${day}`,
          measuredAt: now,
        });
        const data = event?.data as { bytesAboveIncluded: number; gbBeyondIncluded: number };
        expect(data.bytesAboveIncluded).toBeGreaterThan(0);
        expect(data.gbBeyondIncluded).toBe(data.bytesAboveIncluded / 1_000_000_000);
        expect(sends).toEqual([
          {
            organizationId,
            longestRetentionDays: 182,
            bytesAboveIncluded: data.bytesAboveIncluded,
            measuredAt: now,
          },
        ]);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when the measure command runs again the same day", () => {
    /** @scenario "A rerun on the same day bills nothing twice" */
    it("sends no second share for that day", async () => {
      const { eventing, send, sends, measurements } = await setup();

      try {
        await send(now);
        await vi.waitFor(() => expect(sends).toHaveLength(1), { timeout: 20_000 });
        await send(now + 1_000);
        await vi.waitFor(() => expect(measurements()).toBe(2), { timeout: 20_000 });
        // The next day's bill lands behind the rerun in the organization's lane.
        await send(now + DAY_MS);
        await vi.waitFor(() => expect(sends).toHaveLength(2), { timeout: 20_000 });

        expect(sends.map((sent) => sent.measuredAt)).toEqual([now, now + DAY_MS]);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when billing fails the first meter send", () => {
    /** @scenario "A failed meter send retries without a second measurement" */
    it("retries the send and measures the storage once", async () => {
      const { eventing, send, sends, refusals, measurements } = await setup({ failSends: 1 });

      try {
        await send(now);
        await vi.waitFor(() => expect(sends).toHaveLength(1), { timeout: 20_000 });

        expect(refusals()).toBe(1);
        expect(measurements()).toBe(1);
      } finally {
        await eventing.close();
      }
    });
  });
});
