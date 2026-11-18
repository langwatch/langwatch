/**
 * @vitest-environment node
 * An organization's shorter period applied to stored data over a live ClickHouse: the apply request
 * fans out one rewrite per project and category, each recorded as applied. Runs on a scratch
 * database. The count past the period is each owner's read, proven in its own module.
 * @see modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import { retentionCategories } from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { generate } from "@langwatch/ksuid";
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
import type { DataRetentionModule } from "../../app/data-retention.app.ts";
import { ClickHouseRetroactiveRetentionRepository } from "../../repositories/clickhouse/clickhouse.retroactive-retention.repository.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
} from "../retention-extension.events.ts";

const organizationId = retentionTestGraph.organizationId ?? "";
const projectId = retentionTestGraph.projectId;
const siblingProjectId = `project-${generate("test").toString()}`;
const NEW_PERIOD = 91;

/** Columns beyond the tenant and the stamp: the span id this suite's own check reads back. */
const EXTRA_COLUMNS: Record<string, string> = { stored_spans: "SpanId String, " };

describe.skipIf(!scratchClickHouseUrl)("a shorter period applied to stored data", () => {
  let clickhouse: ScratchClickHouse;
  let eventing: EventSourcing;
  let eventStore: ReturnType<typeof EventStoreMemory.createForTesting>;
  let app: DataRetentionModule;

  beforeAll(async () => {
    clickhouse = await createScratchClickHouse({
      url: scratchClickHouseUrl ?? "",
      prefix: "test_retention_apply",
    });
    const { scoped } = clickhouse;
    await scoped.command({
      query:
        "CREATE TABLE event_log (TenantId String, AggregateType LowCardinality(String), " +
        "AggregateId String DEFAULT '', EventType LowCardinality(String), " +
        "_retention_days UInt16) ENGINE = MergeTree ORDER BY (TenantId, AggregateType)",
    });
    for (const table of Object.keys(RETENTION_TABLE_CATEGORY_MAP)) {
      if (table === "event_log") continue;
      await scoped.command({
        query: `CREATE TABLE ${table} (TenantId String, ${EXTRA_COLUMNS[table] ?? ""}_retention_days UInt16) ENGINE = MergeTree ORDER BY TenantId`,
      });
    }
    // Both projects keep a year today; the organization then shortens to 91 days.
    await scoped.insert({
      table: "stored_spans",
      format: "JSONEachRow",
      values: [
        { TenantId: projectId, SpanId: "kept-a-year", _retention_days: 371 },
        { TenantId: siblingProjectId, SpanId: "sibling-kept-a-year", _retention_days: 371 },
      ],
    });

    app = createDataRetentionTestApp({
      repositories: {
        ...MemoryDataRetentionRepositories.create(),
        retroactive: ClickHouseRetroactiveRetentionRepository.create({
          clickhouse: clickhouse.queryClient,
        }),
        directory: MemoryRetentionDirectory.create(),
        projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, [siblingProjectId]),
      },
    });
    for (const category of retentionCategories) {
      await app.setForScope({
        organizationId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
        category,
        retentionDays: NEW_PERIOD,
      });
    }
    eventStore = EventStoreMemory.createForTesting();
    eventing = new EventSourcing({
      eventStore,
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const extension = eventing.register(
      app.retentionExtensionPipeline({ applyRetryDelayMs: () => 10 }),
    );
    app.connectRetentionExtensionCommands(extension.commands);
  }, 120_000);

  afterAll(async () => {
    await eventing?.close();
    await clickhouse?.drop();
  });

  /** @scenario "Applying a shorter period now rewrites every project under the scope" */
  it("rewrites every project's stored rows to the organization's period, one applied fact each", async () => {
    await app.applyScopeRetentionToStoredData({
      organizationId,
      scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
      userId: "user-1",
    });

    const appliedFor = async (aggregateId: string) =>
      (
        await eventStore.getEvents({
          aggregateId,
          context: { tenantId: createTenantId(aggregateId) },
          aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
        })
      ).filter((event) => event.type === RETENTION_APPLIED_EVENT_TYPE);
    await vi.waitFor(
      async () => {
        const applied = [...(await appliedFor(projectId)), ...(await appliedFor(siblingProjectId))];
        if (applied.length !== 2 * retentionCategories.length) {
          throw new Error(`${applied.length} rewrites applied so far`);
        }
      },
      { timeout: 60_000, interval: 250 },
    );

    const [traces] = (await appliedFor(siblingProjectId)).filter(
      (event) => (event.data as { category: string }).category === "traces",
    );
    expect(traces?.data).toMatchObject({ mode: "apply", retentionDays: NEW_PERIOD });
    const result = await clickhouse.scoped.query({
      query: "SELECT SpanId, toUInt32(_retention_days) AS days FROM stored_spans ORDER BY SpanId",
      format: "JSONEachRow",
    });
    expect(await result.json()).toEqual([
      { SpanId: "kept-a-year", days: NEW_PERIOD },
      { SpanId: "sibling-kept-a-year", days: NEW_PERIOD },
    ]);
  }, 90_000);
});
