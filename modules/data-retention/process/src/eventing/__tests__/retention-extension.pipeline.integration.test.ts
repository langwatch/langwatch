/**
 * @vitest-environment node
 * Retention at upgrade reaching rows already stored, over a live ClickHouse: billing's activation
 * fact, the extension fact, one raise per project and category, each stored span read back. Runs
 * on a scratch database of the server LANGWATCH_TEST_CLICKHOUSE_URL names.
 * @see specs/billing/seat-subscription-retention-policy.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import {
  GROWTH_INCLUDED_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import {
  BILLING_LIFECYCLE_EVENT_VERSION,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  subscriptionStartedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DECLARED_ID_INDEXES } from "../../__tests__/support/declared-id-indexes.fixture.ts";
import {
  createDataRetentionTestApp,
  createDataRetentionTestProjectScopes,
  MemoryRetentionDirectory,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { ClickHouseRetroactiveRetentionRepository } from "../../repositories/clickhouse/clickhouse.retroactive-retention.repository.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
} from "../retention-extension.events.ts";

const clickHouseUrl = serverUrl(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL,
);
const database = `test_retention_extension_${generate("test").toString().toLowerCase()}`;
const organizationId = retentionTestGraph.organizationId ?? "";
const projectId = retentionTestGraph.projectId;
const siblingProjectId = `project-${generate("test").toString()}`;
const bystanderProjectId = `project-${generate("test").toString()}`;

let admin: ClickHouseClient;
let scoped: ClickHouseClient;

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
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
    },
  };
  const routed = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  routed.declareIdIndexes({ indexes: DECLARED_ID_INDEXES });
  return routed;
}

function billingStandIn() {
  return definePipeline({
    name: "billing_stand_in",
    aggregate: defineAggregate({ type: "billing_lifecycle" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(SUBSCRIPTION_STARTED_EVENT_TYPE),
        data: subscriptionStartedEventDataSchema,
      }),
    ])
    .build();
}

async function spanRetention(): Promise<Record<string, number>> {
  const result = await scoped.query({
    query: "SELECT SpanId, toUInt32(_retention_days) AS days FROM stored_spans",
    format: "JSONEachRow",
  });
  const rows = await result.json<{ SpanId: string; days: number }>();
  return Object.fromEntries(rows.map((row) => [row.SpanId, row.days]));
}

describe.skipIf(!clickHouseUrl)("retention at upgrade over live ClickHouse", () => {
  let eventing: EventSourcing;
  let eventStore: ReturnType<typeof EventStoreMemory.createForTesting>;

  beforeAll(async () => {
    admin = createClient({ url: clickHouseUrl });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    scoped = createClient({
      url: clickHouseUrl,
      database,
      clickhouse_settings: { mutations_sync: "2" },
    });
    await scoped.command({
      query:
        "CREATE TABLE event_log (TenantId String, AggregateType LowCardinality(String), " +
        "AggregateId String DEFAULT '', EventType LowCardinality(String), " +
        "_retention_days UInt16) ENGINE = MergeTree ORDER BY (TenantId, AggregateType)",
    });
    for (const table of Object.keys(RETENTION_TABLE_CATEGORY_MAP)) {
      if (table === "event_log") continue;
      const spanColumn = table === "stored_spans" ? "SpanId String, " : "";
      await scoped.command({
        query: `CREATE TABLE ${table} (TenantId String, ${spanColumn}_retention_days UInt16) ENGINE = MergeTree ORDER BY TenantId`,
      });
    }
    await scoped.insert({
      table: "stored_spans",
      format: "JSONEachRow",
      values: [
        { TenantId: projectId, SpanId: "free-tier", _retention_days: 14 },
        { TenantId: projectId, SpanId: "kept-a-year", _retention_days: 371 },
        { TenantId: projectId, SpanId: "kept-forever", _retention_days: 0 },
        { TenantId: siblingProjectId, SpanId: "sibling-free-tier", _retention_days: 14 },
        { TenantId: bystanderProjectId, SpanId: "bystander", _retention_days: 14 },
      ],
    });
    await scoped.insert({
      table: "event_log",
      format: "JSONEachRow",
      values: [
        {
          TenantId: projectId,
          AggregateType: "trace",
          AggregateId: "trace-1",
          EventType: "lw.trace.span_received",
          _retention_days: 14,
        },
      ],
    });

    // A Free organization holds no retention rule of its own; its rows were stamped for 14 days.
    const policies = MemoryDataRetentionRepository.create();
    const app = createDataRetentionTestApp({
      repositories: {
        ...MemoryDataRetentionRepositories.create(),
        policies,
        retroactive: ClickHouseRetroactiveRetentionRepository.create({
          clickhouse: queryClient(scoped),
        }),
        directory: MemoryRetentionDirectory.create(),
        projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, [siblingProjectId]),
      },
    });
    eventStore = EventStoreMemory.createForTesting();
    eventing = new EventSourcing({
      eventStore,
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const billing = eventing.register(billingStandIn());
    eventing.register(app.seatPolicyPipeline());
    const extension = eventing.register(
      app.retentionExtensionPipeline({ applyRetryDelayMs: () => 10 }),
    );
    app.connectRetentionExtensionCommands(extension.commands);

    const occurredAt = Date.now();
    await billing.service.storeEvents(
      [
        {
          id: `event-${generate("test").toString()}`,
          aggregateId: organizationId,
          aggregateType: "billing_lifecycle",
          tenantId: createTenantId(organizationId),
          type: SUBSCRIPTION_STARTED_EVENT_TYPE,
          version: BILLING_LIFECYCLE_EVENT_VERSION,
          createdAt: occurredAt,
          occurredAt,
          idempotencyKey: `${organizationId}:sub-1:started`,
          data: {
            tenantId: organizationId,
            occurredAt,
            organizationId,
            subscriptionId: "sub-1",
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            memberUserIds: ["user-1"],
            retentionDays: GROWTH_INCLUDED_RETENTION_DAYS,
          },
        },
      ],
      { tenantId: createTenantId(organizationId) },
    );
    await vi.waitFor(
      async () => {
        const applied = await Promise.all(
          [projectId, siblingProjectId].map(async (aggregateId) =>
            (
              await eventStore.getEvents({
                aggregateId,
                context: { tenantId: createTenantId(aggregateId) },
                aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
              })
            ).filter((event) => event.type === RETENTION_APPLIED_EVENT_TYPE),
          ),
        );
        const expected = 2 * retentionCategories.length;
        if (applied.flat().length !== expected) {
          throw new Error(`${applied.flat().length} of ${expected} raises applied so far`);
        }
      },
      { timeout: 60_000, interval: 250 },
    );
  }, 120_000);

  afterAll(async () => {
    await eventing?.close();
    await admin?.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    await Promise.all([admin?.close(), scoped?.close()]);
  });

  /** @scenario "Upgrading re-stamps stored rows to the longer retention" */
  it("re-stamps spans stamped for 14 days to the Growth retention in every project", async () => {
    const days = await spanRetention();
    expect(days["free-tier"]).toBe(GROWTH_INCLUDED_RETENTION_DAYS);
    expect(days["sibling-free-tier"]).toBe(GROWTH_INCLUDED_RETENTION_DAYS);
    expect(days.bystander).toBe(14);

    const result = await scoped.query({
      query: "SELECT toUInt32(_retention_days) AS days FROM event_log WHERE TenantId = {t:String}",
      query_params: { t: projectId },
      format: "JSONEachRow",
    });
    expect(await result.json()).toEqual([{ days: GROWTH_INCLUDED_RETENTION_DAYS }]);
  });

  /** @scenario "Upgrading never shortens stored rows kept longer" */
  it("keeps spans stamped for a year and spans kept forever as they were", async () => {
    const days = await spanRetention();
    expect(days["kept-a-year"]).toBe(371);
    expect(days["kept-forever"]).toBe(0);
  });
});

/** The server alone: each suite makes its own scratch database; CI's URL names test_langwatch. */
function serverUrl(configured: string | undefined): string | undefined {
  if (configured === undefined) return undefined;
  const url = new URL(configured);
  url.pathname = "/";
  return url.toString();
}
