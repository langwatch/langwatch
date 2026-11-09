/** @vitest-environment node */

/**
 * The event-sourced report end to end: the measure command reads the migrated ClickHouse, records
 * one event per organization and day, and the billing process sends it to the meter through its
 * outbox. A native ClickHouse when LANGWATCH_TEST_CLICKHOUSE_URL is set, else a container.
 * @see specs/billing/retention-storage-billing.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import type {
  BillingApi,
  RetentionStorageOutcome,
  RetentionStorageReport,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ClickHouseStorageMeterRepository } from "../../repositories/clickhouse/clickhouse.storage-meter.repository.ts";
import { MemoryDataRetentionDirectoryRepository } from "../../repositories/memory/memory.data-retention-directory.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { retentionStorageDayOf } from "../../rules/retention-storage.rules.ts";
import { RetentionStorageReportService } from "../../services/retention-storage-report.service.ts";
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

let ch: ClickHouseClient;
let meter: ClickHouseStorageMeterRepository;

function queryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({ query: request.sql });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

function span({ id, atMs }: { id: string; atMs: number }): Record<string, unknown> {
  const at = new Date(atMs).toISOString();
  return {
    ProjectionId: `${id}-projection`,
    TenantId: projectId,
    TraceId: `${id}-trace`,
    SpanId: id,
    SpanName: "llm",
    StartTime: at,
    EndTime: at,
    UpdatedAt: at,
    _retention_days: 371,
  };
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "retention-storage-report",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the storage report");
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which needs a Keeper.
      const previousCluster = process.env.CLICKHOUSE_CLUSTER;
      delete process.env.CLICKHOUSE_CLUSTER;
      try {
        await ClickHouseMigrateTask.createFromConfig({
          config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
        }).execute();
      } finally {
        if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
      }
    },
  });
  ch = createClient({
    url: endpoint.url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  meter = ClickHouseStorageMeterRepository.create({ clickhouse: queryClient(ch) });
  await ch.insert({
    table: "stored_spans",
    format: "JSONEachRow",
    values: [span({ id: "old-1", atMs: now - 120 * DAY_MS }), span({ id: "new-1", atMs: now })],
  });
}, 180_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId: projectId },
  });
  await ch.close();
});

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
  const directory = MemoryDataRetentionDirectoryRepository.create({
    scopeProjects: [{ id: projectId, teamId: "team-1" }],
  });
  let measurements = 0;
  const countingMeter = {
    getTenantBytesBefore: (input: { tenantId: string; beforeMs: number }) => {
      measurements += 1;
      return meter.getTenantBytesBefore(input);
    },
  };
  const { billing, sends, refusals } = meterBilling(failSends === undefined ? {} : { failSends });
  const report = RetentionStorageReportService.create({
    policies,
    directory,
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
