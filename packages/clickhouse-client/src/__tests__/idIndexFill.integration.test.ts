/** @vitest-environment node */

/**
 * An id index on a fixture source, as the goose template writes it: the view fills it inside
 * the insert, `max` keeps "forever" sticky, and the background fill covers rows older than the
 * view and converges on a second run. Spec: specs/clickhouse/id-index-reads.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import {
  ClickHouseClientFactory,
  type ClickHouseClientCreationInput,
  ClickHouseConnection,
} from "../connection.ts";
import { fillIdIndexes, type IdIndexFillReport, idIndexFillTargets } from "../idIndexFill.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TENANT = `tenant_${RUN}`;
const OTHER_TENANT = `tenant_other_${RUN}`;

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }
}

/** The goose template's source, index and view, for one fixture table name. */
async function createFixture({
  probe,
  source,
  withIndex,
}: {
  probe: ClickHouseClient;
  source: string;
  withIndex: boolean;
}): Promise<void> {
  await probe.command({
    query: `CREATE TABLE IF NOT EXISTS ${source} (
      TenantId String, TraceId String, StartTime DateTime64(3), _retention_days UInt16
    ) ENGINE = MergeTree() PARTITION BY toYearWeek(StartTime) ORDER BY (TenantId, TraceId, StartTime)`,
  });
  if (withIndex) await createIndex({ probe, source });
}

async function createIndex({ probe, source }: { probe: ClickHouseClient; source: string }) {
  await probe.command({
    query: `CREATE TABLE IF NOT EXISTS ${source}_id_index (
      TenantId String,
      TraceId String,
      FromAt SimpleAggregateFunction(min, DateTime64(3)),
      ToAt SimpleAggregateFunction(max, DateTime64(3)),
      _retention_days SimpleAggregateFunction(max, UInt16)
    ) ENGINE = AggregatingMergeTree() ORDER BY (TenantId, TraceId)
    TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE`,
  });
  await probe.command({
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${source}_id_index_mv TO ${source}_id_index AS
      SELECT TenantId, TraceId, min(StartTime) AS FromAt, max(StartTime) AS ToAt,
        max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
      FROM ${source} GROUP BY TenantId, TraceId`,
  });
}

type Span = { TenantId: string; TraceId: string; StartTime: string; _retention_days: number };

async function insertSpans({
  probe,
  source,
  spans,
}: {
  probe: ClickHouseClient;
  source: string;
  spans: Span[];
}) {
  await probe.insert({ table: source, values: spans, format: "JSONEachRow" });
}

type IndexRow = {
  TenantId: string;
  TraceId: string;
  fromMs: number;
  toMs: number;
  retention: number;
};

/** The index merged per id, as a reader sees it. */
async function indexOf({
  probe,
  source,
}: {
  probe: ClickHouseClient;
  source: string;
}): Promise<IndexRow[]> {
  const result = await probe.query({
    query: `SELECT TenantId, TraceId, toUnixTimestamp64Milli(min(FromAt)) AS fromMs,
        toUnixTimestamp64Milli(max(ToAt)) AS toMs, max(_retention_days) AS retention
      FROM ${source}_id_index GROUP BY TenantId, TraceId ORDER BY TenantId, TraceId`,
    format: "JSONEachRow",
  });
  // A server may quote 64-bit integers in JSON or not; read every number as a number.
  const rows = await result.json<Record<string, unknown>>();
  return rows.map((row) => ({
    TenantId: String(row.TenantId),
    TraceId: String(row.TraceId),
    fromMs: Number(row.fromMs),
    toMs: Number(row.toMs),
    retention: Number(row.retention),
  }));
}

const ms = (iso: string) => Date.parse(iso);

/**
 * A whole hour some days before today. Recent on purpose: an index row past its retention is
 * dropped by the index's own TTL, so fixtures older than their retention would vanish.
 */
function at({ daysAgo, hour }: { daysAgo: number; hour: number }): string {
  const today = new Date(nowInstant().epochMilliseconds);
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hour),
  ).toISOString();
}

let probe: ClickHouseClient;
let connection: ClickHouseConnection<ClickHouseClient>;
let statements: ClickHouseQueryClient;

describe("an id index on a time-partitioned source", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "id-index",
      names: ["shared"],
      environment: process.env,
    });
    if (endpoint === undefined) throw new Error("No ClickHouse endpoint was provisioned");
    probe = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    connection = ClickHouseConnection.create({
      configuration: ClickHouseConfigService.create().resolve({
        shared: { url: endpoint.url, cluster: "test" },
        privateRoutes: [],
      }),
      router: createTenantRouter({
        table: { routes: new Map(), skipped: [], ambiguous: [] },
        directory: { organizationForTenant: async () => "org_shared" },
      }),
      clientFactory: new VendorFactory(),
    });
    statements = new ClickHouseQueryClient({
      driver: routingDriver(connection),
      tenantGuard: new TenantGuard(),
    });
  }, 300_000);

  afterAll(async () => {
    await connection?.closeOnce();
    await probe?.close();
  }, 60_000);

  describe("when a record is inserted into the source table", () => {
    /** @scenario "inserting a record fills its index row in the same insert" */
    it("has its index row without any application code writing it", async () => {
      const source = `fixture_insert_${RUN}`;
      await createFixture({ probe, source, withIndex: true });

      await insertSpans({
        probe,
        source,
        spans: [
          {
            TenantId: TENANT,
            TraceId: "t1",
            StartTime: at({ daysAgo: 3, hour: 10 }),
            _retention_days: 30,
          },
        ],
      });

      expect(await indexOf({ probe, source })).toEqual([
        {
          TenantId: TENANT,
          TraceId: "t1",
          fromMs: ms(at({ daysAgo: 3, hour: 10 })),
          toMs: ms(at({ daysAgo: 3, hour: 10 })),
          retention: 30,
        },
      ]);
    });
  });

  describe("given an id whose earlier rows are kept forever", () => {
    /** @scenario "an id kept forever is not expired by a finite-retention row" */
    it("stays kept forever when a later row arrives with a 30-day retention", async () => {
      const source = `fixture_forever_${RUN}`;
      await createFixture({ probe, source, withIndex: true });

      await insertSpans({
        probe,
        source,
        spans: [
          {
            TenantId: TENANT,
            TraceId: "t1",
            StartTime: at({ daysAgo: 3, hour: 10 }),
            _retention_days: 0,
          },
        ],
      });
      await insertSpans({
        probe,
        source,
        spans: [
          {
            TenantId: TENANT,
            TraceId: "t1",
            StartTime: at({ daysAgo: 1, hour: 10 }),
            _retention_days: 30,
          },
        ],
      });

      const [row] = await indexOf({ probe, source });
      expect(row?.retention).toBe(65535);
      expect(row?.toMs).toBe(ms(at({ daysAgo: 1, hour: 10 })));
    });
  });

  describe("given records stored before the index existed", () => {
    /** @scenario "the backfill fills existing records and can run twice" */
    it("fills every id across an interrupted, resumed and repeated run, changing no range", async () => {
      const source = `fixture_backfill_${RUN}`;
      await createFixture({ probe, source, withIndex: false });
      const spans: Span[] = [
        {
          TenantId: TENANT,
          TraceId: "t1",
          StartTime: at({ daysAgo: 20, hour: 10 }),
          _retention_days: 30,
        },
        {
          TenantId: TENANT,
          TraceId: "t1",
          StartTime: at({ daysAgo: 2, hour: 10 }),
          _retention_days: 30,
        },
        {
          TenantId: TENANT,
          TraceId: "t2",
          StartTime: at({ daysAgo: 9, hour: 10 }),
          _retention_days: 0,
        },
        {
          TenantId: OTHER_TENANT,
          TraceId: "t3",
          StartTime: at({ daysAgo: 2, hour: 11 }),
          _retention_days: 90,
        },
        {
          TenantId: OTHER_TENANT,
          TraceId: "t4",
          StartTime: at({ daysAgo: 2, hour: 12 }),
          _retention_days: 90,
        },
      ];
      await insertSpans({ probe, source, spans });
      await createIndex({ probe, source });
      expect(await indexOf({ probe, source })).toEqual([]);

      const flagged: string[] = [];
      const options = {
        statements,
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [
          {
            source,
            index: `${source}_id_index`,
            key: ["TraceId"],
            time: "StartTime",
            retentionAnchor: "StartTime",
            retention: "copied" as const,
          },
        ],
        // Small enough that the busiest week splits by tenant.
        batchRows: 1,
        beforeFlag: async () => {},
        setFlag: async ({ target }: { target: string }) => {
          flagged.push(target);
        },
        sleep: async () => {},
      };
      let saved: IdIndexFillReport | null = null;
      const interrupted = new AbortController();
      await fillIdIndexes({
        ...options,
        checkpoint: {
          resumeFrom: null,
          save: async ({ report }) => {
            saved = structuredClone(report);
            if (report.batches === 1) interrupted.abort();
          },
        },
        signal: interrupted.signal,
      });
      expect(flagged).toEqual([]);

      await fillIdIndexes({
        ...options,
        checkpoint: { resumeFrom: saved, save: async () => {} },
        signal: new AbortController().signal,
      });
      const filled = await indexOf({ probe, source });
      await fillIdIndexes({
        ...options,
        checkpoint: { resumeFrom: null, save: async () => {} },
        signal: new AbortController().signal,
      });

      expect(filled).toEqual(
        [
          {
            TenantId: TENANT,
            TraceId: "t1",
            fromMs: ms(at({ daysAgo: 20, hour: 10 })),
            toMs: ms(at({ daysAgo: 2, hour: 10 })),
            retention: 30,
          },
          {
            TenantId: TENANT,
            TraceId: "t2",
            fromMs: ms(at({ daysAgo: 9, hour: 10 })),
            toMs: ms(at({ daysAgo: 9, hour: 10 })),
            retention: 65535,
          },
          {
            TenantId: OTHER_TENANT,
            TraceId: "t3",
            fromMs: ms(at({ daysAgo: 2, hour: 11 })),
            toMs: ms(at({ daysAgo: 2, hour: 11 })),
            retention: 90,
          },
          {
            TenantId: OTHER_TENANT,
            TraceId: "t4",
            fromMs: ms(at({ daysAgo: 2, hour: 12 })),
            toMs: ms(at({ daysAgo: 2, hour: 12 })),
            retention: 90,
          },
        ].toSorted((left, right) =>
          `${left.TenantId}${left.TraceId}`.localeCompare(`${right.TenantId}${right.TraceId}`),
        ),
      );
      expect(await indexOf({ probe, source })).toEqual(filled);
      expect(flagged).toEqual(["shared", "shared"]);
    });
  });
});
