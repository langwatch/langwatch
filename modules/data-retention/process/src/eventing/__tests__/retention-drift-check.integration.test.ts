/**
 * @vitest-environment node
 * The drift check over a live ClickHouse: stored rows in a sampled window on another period are
 * flagged and recorded, rows on the current period or outside every window are not. Runs on a
 * scratch database. @see modules/data-retention/specs/retention-drift-check.feature
 */
import { retentionCategories } from "@langwatch/data-retention-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { generate } from "@langwatch/ksuid";
import type { CounterHandle } from "@langwatch/observability/metrics";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createScratchClickHouse,
  scratchClickHouseUrl,
  type ScratchClickHouse,
} from "../../__tests__/support/clickhouse-scratch.fixture.ts";
import {
  createDataRetentionTestApp,
  createDataRetentionTestProjectScopes,
  MemoryRetentionDirectory,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import type { DataRetentionDirectoryReader } from "../../app/data-retention.app.ts";
import { ClickHouseRetroactiveRetentionRepository } from "../../repositories/clickhouse/clickhouse.retroactive-retention.repository.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import type { RetentionApplyStatusRepository } from "../../repositories/retention-apply-status.repository.ts";
import { RetentionDriftCheckService } from "../../services/retention-drift-check.service.ts";
import {
  RETENTION_DRIFT_AGGREGATE_TYPE,
  RETENTION_DRIFT_DETECTED_EVENT_TYPE,
  retentionDriftDetectedEventDataSchema,
} from "../retention-drift.events.ts";

const organizationId = retentionTestGraph.organizationId ?? "";
const run = generate("test").toString();
const drifting = `project-drifting-${run}`;
const settled = `project-settled-${run}`;
const outside = `project-outside-${run}`;
const deferring = `project-deferring-${run}`;
const PERIOD = 91;
const DAY_MS = 86_400_000;
const NOW = Date.now();

/** An instant inside the sampled window `ageDays` old, which ends exactly `ageDays` ago. */
const inWindow = (ageDays: number): string =>
  new Date(NOW - ageDays * DAY_MS - 30 * 60_000).toISOString();

describe.skipIf(!scratchClickHouseUrl)("the drift check over stored rows", () => {
  let clickhouse: ScratchClickHouse;

  beforeAll(async () => {
    clickhouse = await createScratchClickHouse({
      url: scratchClickHouseUrl ?? "",
      prefix: "test_retention_drift",
    });
    const { scoped } = clickhouse;
    for (const [table, columns] of [
      ["trace_summaries", "TraceId String, OccurredAt DateTime64(3, 'UTC')"],
      ["simulation_runs", "ScenarioRunId String, StartedAt DateTime64(3, 'UTC')"],
      ["experiment_runs", "RunId String, StartedAt DateTime64(3, 'UTC')"],
    ] as const) {
      await scoped.command({
        query:
          `CREATE TABLE ${table} (TenantId String, ${columns}, _retention_days UInt16) ` +
          "ENGINE = MergeTree PARTITION BY toYearWeek(" +
          (table === "trace_summaries" ? "OccurredAt" : "StartedAt") +
          ") ORDER BY TenantId",
      });
    }
    await scoped.insert({
      table: "trace_summaries",
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
      values: [
        { TenantId: drifting, TraceId: "old-stamp", OccurredAt: inWindow(30), _retention_days: 30 },
        {
          TenantId: drifting,
          TraceId: "new-stamp",
          OccurredAt: inWindow(7),
          _retention_days: PERIOD,
        },
        {
          TenantId: settled,
          TraceId: "current",
          OccurredAt: inWindow(30),
          _retention_days: PERIOD,
        },
        {
          TenantId: deferring,
          TraceId: "kept-longer",
          OccurredAt: inWindow(30),
          _retention_days: 371,
        },
        {
          TenantId: outside,
          TraceId: "between-windows",
          OccurredAt: new Date(NOW - 45 * DAY_MS).toISOString(),
          _retention_days: 30,
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await clickhouse?.drop();
  });

  function service() {
    const { logger, lines } = createTestLogger();
    const calls: Record<string, unknown>[] = [];
    const drifts: CounterHandle = { inc: (attributes) => void calls.push({ ...attributes }) };
    const checker = RetentionDriftCheckService.create({
      projects: {
        findScopeProjectIds: async () => [drifting, settled, outside, deferring],
        getResolvedForProjects: async ({ projectIds }) =>
          new Map(
            projectIds.map((projectId) => [
              projectId,
              { traces: PERIOD, scenarios: PERIOD, experiments: PERIOD },
            ]),
          ),
      },
      stamps: ClickHouseRetroactiveRetentionRepository.create({
        clickhouse: clickhouse.queryClient,
      }),
      applyStatus: createApiFixture<RetentionApplyStatusRepository>({
        findForOrganization: async () => [
          {
            scopeType: "PROJECT",
            scopeId: deferring,
            changedAt: NOW - 3 * DAY_MS,
            appliedAt: null,
            shortenedAt: NOW - 3 * DAY_MS,
            shortenedAtByCategory: { traces: NOW - 3 * DAY_MS },
          },
        ],
      }),
      directory: createApiFixture<DataRetentionDirectoryReader>({
        findOrganizationDirectory: async () => ({
          teams: [],
          projects: [drifting, settled, outside, deferring].map((id) => ({
            id,
            name: id,
            teamId: "team-1",
            archived: false,
          })),
        }),
      }),
      logger,
      drifts,
    });
    return { checker, lines, calls };
  }

  describe("when a project's sampled traces are stamped for 30 days and it resolves to 91", () => {
    /** @scenario "Stored rows on another period are flagged" */
    it("flags that project on the metric and in an error log", async () => {
      const { checker, lines, calls } = service();
      const drifted = await checker.check({ organizationId, at: NOW });

      expect(drifted.filter((drift) => drift.projectId !== deferring)).toEqual([
        {
          projectId: drifting,
          category: "traces",
          expectedDays: PERIOD,
          found: [{ retentionDays: 30, rows: 1 }],
          kind: "unexpected",
        },
      ]);
      expect(calls).toContainEqual({ category: "traces", kind: "unexpected" });
      expect(lines.findLine("error", "retention other than")).toMatchObject({
        projectId: drifting,
        expected_days: PERIOD,
      });
    });

    it("records the drift as a fact on the organization", async () => {
      const app = createDataRetentionTestApp({
        repositories: {
          ...MemoryDataRetentionRepositories.create(),
          retroactive: ClickHouseRetroactiveRetentionRepository.create({
            clickhouse: clickhouse.queryClient,
          }),
          directory: MemoryRetentionDirectory.create(),
          projectScopes: createDataRetentionTestProjectScopes(
            { ...retentionTestGraph, projectId: drifting },
            [settled, outside],
          ),
        },
      });
      for (const category of retentionCategories) {
        await app.setForScope({
          organizationId,
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          category,
          retentionDays: PERIOD,
        });
      }
      const eventStore = EventStoreMemory.createForTesting();
      const eventing = new EventSourcing({
        eventStore,
        processStore: InMemoryProcessStore.createForTesting(),
      });
      try {
        const registered = eventing.register(
          app.driftCheckPipeline({ deleteDispatchedBefore: async () => 0 }),
        );
        app.connectDriftCheckCommands(registered.commands);
        await app.requestRetentionDriftCheck({ organizationId });

        const detected = async () =>
          (
            await eventStore.getEvents({
              aggregateId: organizationId,
              context: { tenantId: createTenantId(organizationId) },
              aggregateType: RETENTION_DRIFT_AGGREGATE_TYPE,
            })
          ).filter((event) => event.type === RETENTION_DRIFT_DETECTED_EVENT_TYPE);
        await vi.waitFor(async () => expect(await detected()).toHaveLength(1), { timeout: 20_000 });
        const [event] = await detected();
        expect(retentionDriftDetectedEventDataSchema.parse(event?.data).drifted).toEqual([
          expect.objectContaining({
            projectId: drifting,
            category: "traces",
            expectedDays: PERIOD,
          }),
        ]);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when a project's traces are kept for 371 days under a shorter save not applied", () => {
    /** @scenario "A deferred drift over stored rows is recorded apart from an unexpected one" */
    it("records that project's drift as deferred and counts it apart", async () => {
      const { checker, lines, calls } = service();
      const drifted = await checker.check({ organizationId, at: NOW });

      expect(drifted.find((drift) => drift.projectId === deferring)).toEqual({
        projectId: deferring,
        category: "traces",
        expectedDays: PERIOD,
        found: [{ retentionDays: 371, rows: 1 }],
        kind: "deferred",
      });
      expect(calls).toEqual([
        { category: "traces", kind: "unexpected" },
        { category: "traces", kind: "deferred" },
      ]);
      expect(lines.findLine("warn", "not applied")).toMatchObject({ projectId: deferring });
    });
  });

  describe("when every sampled trace carries the project's current period", () => {
    /** @scenario "Stored rows on the current period are not flagged" */
    it("flags nothing for that project", async () => {
      const { checker } = service();
      const drifted = await checker.check({ organizationId, at: NOW });
      expect(drifted.map((drift) => drift.projectId)).not.toContain(settled);
    });
  });

  describe("when a trace on another period sits outside every sampled window", () => {
    /** @scenario "A row outside the sampled windows is not read" */
    it("flags nothing for that project", async () => {
      const { checker } = service();
      const drifted = await checker.check({ organizationId, at: NOW });
      expect(drifted.map((drift) => drift.projectId)).not.toContain(outside);
    });
  });
});
