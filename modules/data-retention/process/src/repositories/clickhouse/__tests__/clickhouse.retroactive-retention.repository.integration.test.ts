/**
 * @vitest-environment node
 * @see modules/data-retention/specs/event-log-retention-via-eventing.feature
 * Eventing's event-log rewrite, driven by data-retention, over seeded rows in a scratch database.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";
import {
  classifyEventLogRowRetention,
  RETENTION_CLASS_BY_AGGREGATE_TYPE,
} from "@langwatch/data-retention-contract/event-log-retention-policy";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DECLARED_ID_INDEXES } from "../../../__tests__/support/declared-id-indexes.fixture.ts";
import { ClickHouseRetroactiveRetentionRepository } from "../clickhouse.retroactive-retention.repository.ts";

const clickHouseUrl = serverUrl(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL,
);
const database = `test_data_retention_${generate("test").toString().toLowerCase()}`;
const tenantId = `project-${generate("test").toString()}`;
const otherTenantId = `project-${generate("test").toString()}`;
const SEEDED_DAYS = 308;
const NEW_DAYS: Record<RetentionCategory, number> = { traces: 7, scenarios: 14, experiments: 21 };
const EVENT_TYPES = [
  "lw.trace.span_received",
  "lw.identity.user_created",
  "lw.authz.grant_added",
  "lw.governance.vk_lifecycle",
  "lw.governance.other",
];
const AGGREGATE_TYPES = [...Object.keys(RETENTION_CLASS_BY_AGGREGATE_TYPE), "unlisted_aggregate"];

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
  // The indexes the installed modules declare at composition, which retention reads at run time.
  routed.declareIdIndexes({ indexes: DECLARED_ID_INDEXES });
  return routed;
}

async function retentionByRow(): Promise<
  { TenantId: string; AggregateType: string; EventType: string; days: number }[]
> {
  const result = await scoped.query({
    query:
      "SELECT TenantId, AggregateType, EventType, toUInt32(_retention_days) AS days FROM event_log",
    format: "JSONEachRow",
  });
  return result.json();
}

describe.skipIf(!clickHouseUrl)(
  "ClickHouseRetroactiveRetentionRepository on live ClickHouse",
  () => {
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
          "_retention_days UInt16 DEFAULT 308) " +
          "ENGINE = MergeTree ORDER BY (TenantId, AggregateType)",
      });
      for (const table of Object.keys(RETENTION_TABLE_CATEGORY_MAP)) {
        if (table === "event_log") continue;
        await scoped.command({
          query: `CREATE TABLE ${table} (TenantId String, _retention_days UInt16) ENGINE = MergeTree ORDER BY TenantId`,
        });
      }
      const rows = [tenantId, otherTenantId].flatMap((TenantId) =>
        AGGREGATE_TYPES.flatMap((AggregateType) =>
          EVENT_TYPES.map((EventType) => ({
            TenantId,
            AggregateType,
            EventType,
            _retention_days: SEEDED_DAYS,
          })),
        ),
      );
      await scoped.insert({ table: "event_log", values: rows, format: "JSONEachRow" });

      const repository = ClickHouseRetroactiveRetentionRepository.create({
        clickhouse: queryClient(scoped),
      });
      for (const category of retentionCategories) {
        await repository.triggerUpdate({
          projectId: tenantId,
          category,
          newRetentionDays: NEW_DAYS[category],
        });
      }
    });

    afterAll(async () => {
      await admin?.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await Promise.all([admin?.close(), scoped?.close()]);
    });

    /** @scenario "A trace-category event past the new retention is marked to expire" */
    it("gives a project's trace events the new traces retention", async () => {
      const traceEvent = (await retentionByRow()).find(
        (row) =>
          row.TenantId === tenantId &&
          row.AggregateType === "trace" &&
          row.EventType === "lw.trace.span_received",
      );
      expect(traceEvent?.days).toBe(NEW_DAYS.traces);
    });

    /** @scenario "Durable security events never take a category's retention" */
    it("leaves identity, authorisation and virtual-key lifecycle events on their seeded retention", async () => {
      const durable = (await retentionByRow()).filter(
        (row) => row.TenantId === tenantId && classifyEventLogRowRetention(row) === "indefinite",
      );
      expect(durable.length).toBeGreaterThan(0);
      expect(durable.map((row) => row.EventType)).toEqual(
        expect.arrayContaining([
          "lw.identity.user_created",
          "lw.authz.grant_added",
          "lw.governance.vk_lifecycle",
        ]),
      );
      expect(durable.every((row) => row.days === SEEDED_DAYS)).toBe(true);
    });

    /** @scenario "Another category's events keep their retention" */
    it("gives scenario and experiment events their own category's retention, not the traces one", async () => {
      const rows = (await retentionByRow()).filter((row) => row.TenantId === tenantId);
      const simulation = rows.find(
        (row) =>
          row.AggregateType === "simulation_run" && row.EventType === "lw.trace.span_received",
      );
      const experiment = rows.find(
        (row) =>
          row.AggregateType === "experiment_run" && row.EventType === "lw.trace.span_received",
      );
      expect(simulation?.days).toBe(NEW_DAYS.scenarios);
      expect(experiment?.days).toBe(NEW_DAYS.experiments);
      const other = (await retentionByRow()).filter((row) => row.TenantId === otherTenantId);
      expect(other.every((row) => row.days === SEEDED_DAYS)).toBe(true);
    });

    /** @scenario "The rewrite selects the same rows as the per-row classifier" */
    it("selects, for every category, exactly the rows the classifier puts in it", async () => {
      const rows = (await retentionByRow()).filter((row) => row.TenantId === tenantId);
      expect(rows).toHaveLength(AGGREGATE_TYPES.length * EVENT_TYPES.length);
      for (const row of rows) {
        const retentionClass = classifyEventLogRowRetention(row);
        const expected = retentionClass === "indefinite" ? SEEDED_DAYS : NEW_DAYS[retentionClass];
        expect({ ...row, days: row.days }).toEqual({ ...row, days: expected });
      }
    });
  },
);

/** @see specs/clickhouse/id-index-reads.feature */
describe.skipIf(!clickHouseUrl)("Id index retention on live ClickHouse", () => {
  const indexDatabase = `${database}_id_index`;
  let indexAdmin: ClickHouseClient;
  let indexScoped: ClickHouseClient;
  let repository: ClickHouseRetroactiveRetentionRepository;

  async function indexRetention(table: string, tenant: string): Promise<number[]> {
    const result = await indexScoped.query({
      query: `SELECT toUInt32(max(_retention_days)) AS days FROM ${table} WHERE TenantId = {tenant:String} GROUP BY TenantId`,
      query_params: { tenant },
      format: "JSONEachRow",
    });
    return (await result.json<{ days: number }>()).map(({ days }) => days);
  }

  async function seedIndex(table: string, rows: Record<string, unknown>[]): Promise<void> {
    await indexScoped.insert({ table, values: rows, format: "JSONEachRow" });
  }

  beforeAll(async () => {
    indexAdmin = createClient({ url: clickHouseUrl });
    await indexAdmin.command({ query: `CREATE DATABASE ${indexDatabase}` });
    indexScoped = createClient({
      url: clickHouseUrl,
      database: indexDatabase,
      clickhouse_settings: { mutations_sync: "2" },
    });
    await indexScoped.command({
      query:
        "CREATE TABLE event_log (TenantId String, AggregateType LowCardinality(String), " +
        "AggregateId String DEFAULT '', EventType LowCardinality(String), _retention_days UInt16) " +
        "ENGINE = MergeTree ORDER BY (TenantId, AggregateType)",
    });
    for (const table of Object.keys(RETENTION_TABLE_CATEGORY_MAP)) {
      if (table === "event_log") continue;
      await indexScoped.command({
        query: `CREATE TABLE ${table} (TenantId String, _retention_days UInt16) ENGINE = MergeTree ORDER BY TenantId`,
      });
    }
    await indexScoped.command({
      query:
        "CREATE TABLE stored_spans_id_index (TenantId String, TraceId String, " +
        "_retention_days SimpleAggregateFunction(max, UInt16)) " +
        "ENGINE = AggregatingMergeTree ORDER BY (TenantId, TraceId)",
    });
    await indexScoped.command({
      query:
        "CREATE TABLE event_log_id_index (TenantId String, AggregateType LowCardinality(String), " +
        "AggregateId String, _retention_days SimpleAggregateFunction(max, UInt16)) " +
        "ENGINE = AggregatingMergeTree ORDER BY (TenantId, AggregateType, AggregateId)",
    });
    repository = ClickHouseRetroactiveRetentionRepository.create({
      clickhouse: queryClient(indexScoped),
    });
  });

  afterAll(async () => {
    await indexAdmin?.command({ query: `DROP DATABASE IF EXISTS ${indexDatabase}` });
    await Promise.all([indexAdmin?.close(), indexScoped?.close()]);
  });

  /** @scenario "a lengthened retention reaches the index" */
  it("raises a project's trace index rows to its lengthened trace retention", async () => {
    const project = `project-${generate("test").toString()}`;
    const bystander = `project-${generate("test").toString()}`;
    await seedIndex("stored_spans_id_index", [
      { TenantId: project, TraceId: "trace-1", _retention_days: 30 },
      { TenantId: bystander, TraceId: "trace-2", _retention_days: 30 },
    ]);

    const result = await repository.triggerUpdate({
      projectId: project,
      category: "traces",
      newRetentionDays: 365,
    });

    expect(result.tables).toEqual(
      expect.arrayContaining(["stored_spans_id_index", "event_log_id_index"]),
    );
    expect(await indexRetention("stored_spans_id_index", project)).toEqual([365]);
    expect(await indexRetention("stored_spans_id_index", bystander)).toEqual([30]);
  });

  /** @scenario "a shortened retention never shortens the index" */
  it("keeps an aggregate kept forever, and a longer-lived trace, when retention shortens", async () => {
    const project = `project-${generate("test").toString()}`;
    await seedIndex("event_log_id_index", [
      {
        TenantId: project,
        AggregateType: "trace",
        AggregateId: "trace-1",
        _retention_days: 65_535,
      },
    ]);
    await seedIndex("stored_spans_id_index", [
      { TenantId: project, TraceId: "trace-1", _retention_days: 365 },
    ]);

    await repository.triggerUpdate({
      projectId: project,
      category: "traces",
      newRetentionDays: 30,
    });

    expect(await indexRetention("event_log_id_index", project)).toEqual([65_535]);
    expect(await indexRetention("stored_spans_id_index", project)).toEqual([365]);
  });

  /** @scenario "a retention change during the backfill does not leave stale index rows" */
  it("raises index rows a fill wrote with the old retention to the project's current one", async () => {
    const project = `project-${generate("test").toString()}`;
    await seedIndex("stored_spans_id_index", [
      { TenantId: project, TraceId: "trace-1", _retention_days: 30 },
    ]);
    await seedIndex("event_log_id_index", [
      { TenantId: project, AggregateType: "trace", AggregateId: "trace-1", _retention_days: 30 },
    ]);
    const indexes = await repository.findHeldIdIndexes({
      indexes: ["stored_spans_id_index", "event_log_id_index", "suite_runs_id_index"],
    });
    expect(indexes).toEqual(["stored_spans_id_index", "event_log_id_index"]);
    expect(await repository.findIdIndexTenantIds({ indexes })).toContain(project);

    await repository.raiseIdIndexRetention({
      indexes,
      retentionByTenant: new Map([[project, { traces: 365, scenarios: 49, experiments: 49 }]]),
    });

    expect(await indexRetention("stored_spans_id_index", project)).toEqual([365]);
    expect(await indexRetention("event_log_id_index", project)).toEqual([365]);
  });
});

/** The server alone: each suite makes its own scratch database; CI's URL names test_langwatch. */
function serverUrl(configured: string | undefined): string | undefined {
  if (configured === undefined) return undefined;
  const url = new URL(configured);
  url.pathname = "/";
  return url.toString();
}
