/**
 * @vitest-environment node
 * @see modules/data-retention/specs/event-log-retention-via-eventing.feature
 * Eventing's event-log rewrite, driven by data-retention, over seeded rows in a scratch database.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";
import {
  classifyEventLogRowRetention,
  RETENTION_CLASS_BY_AGGREGATE_TYPE,
} from "@langwatch/data-retention-contract/event-log-retention-policy";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseRetroactiveRetentionRepository } from "../clickhouse.retroactive-retention.repository.ts";

const clickHouseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
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
  return new ClickHouseQueryClient({ driver });
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
          "EventType LowCardinality(String), _retention_days UInt16 DEFAULT 308) " +
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
