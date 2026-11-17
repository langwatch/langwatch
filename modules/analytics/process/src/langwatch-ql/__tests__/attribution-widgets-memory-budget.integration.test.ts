/**
 * @vitest-environment node
 * att-change and att-table's pass rates on a 60-day board read 120 days. Sent as the service sends
 * them, under the widget cap at compatibility 25.10, each must answer whatever the project's older
 * history; main's form was refused (code 241) once that history grew.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 * @see specs/lwql/stock-widgets-read-trace-evaluations.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@clickhouse/client";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { lwqlLogComment } from "../../rules/langwatch-ql-tenant-capability.rules.ts";
import { floorLangWatchQLDedup } from "../../rules/lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCapabilityService } from "../../services/langwatch-ql-capability.service.ts";
import { LangWatchQLFlooredReadService } from "../../services/langwatch-ql-floored-read.service.ts";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  type LangWatchQLClickHouseHarness,
  selectRows,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();
const flooredRead = LangWatchQLFlooredReadService.create();
const capabilities = LangWatchQLCapabilityService.create();

/**
 * C. PLACEHOLDER, production's cap: replace it with the value the first CI run's printed peaks
 * support (main's att-change refused on LARGE, the new SQL on LARGE at or under 0.7 C), and record
 * here main's refused LARGE peak and the new SQL's LARGE peaks from that run.
 */
const ATTRIBUTION_MEMORY_CAP_BYTES = 1_000_000_000;

/** The share of C the new SQL may use on LARGE: room for prod's data shapes this seed lacks. */
const NEW_SQL_HEADROOM = 0.7;
const NEW_SQL_CEILING_BYTES = NEW_SQL_HEADROOM * ATTRIBUTION_MEMORY_CAP_BYTES;
/** LARGE holds twice SMALL's traces in the window, so a peak that tracks the window grows ~2x. */
const LARGE_TO_SMALL_GROWTH = 2.2;
/** How far LARGE's peak may sit from BARE's once older history no longer counts. */
const HISTORY_TOLERANCE = 0.1;
/** Runs of each new query per tenant; the comparisons read their median. */
const RUNS = 3;
const SEED_BUDGET_SECONDS = 300;
const MEMORY_LIMIT_EXCEEDED = 241;
/** Up to six runs a case, each allowed the profile's 60 s. */
const CASE_TIMEOUT_MS = 420_000;

/** Production's ceilings at C, its spill and join budgets kept in the shipped proportion to it. */
const SHIPPED = DEFAULT_LWQL_RESOURCE_LIMITS;
const scaledToCap = (bytes: number) =>
  Math.floor((bytes * ATTRIBUTION_MEMORY_CAP_BYTES) / SHIPPED.maxMemoryUsageBytes);
const LIMITS: LangWatchQLResourceLimits = {
  ...SHIPPED,
  maxMemoryUsageBytes: ATTRIBUTION_MEMORY_CAP_BYTES,
  maxThreads: 4,
  maxBytesBeforeExternalGroupBy: scaledToCap(SHIPPED.maxBytesBeforeExternalGroupBy),
  maxBytesBeforeExternalSort: scaledToCap(SHIPPED.maxBytesBeforeExternalSort),
  maxBytesInJoin: scaledToCap(SHIPPED.maxBytesInJoin),
};

/** The views the three queries read. Only these are provisioned: none of them maps Postgres. */
const READ_VIEWS = new Set(["traces", "trace_metrics", "trace_evaluation_metrics"]);
const VIEWS = LWQL_VIEW_CATALOG.filter((view) => READ_VIEWS.has(view.name));

type StockQuery = { label: string; sql: string };

function fixture(name: string): readonly StockQuery[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

const QUERY_LABELS = ["att-change/change", "att-change/units", "att-table/passRates"] as const;
const ATT_CHANGE_LABELS = ["att-change/change", "att-change/units"] as const;
type QueryLabel = (typeof QUERY_LABELS)[number];

/** Main's SQL for the three, frozen as the catalogue held it before the fix. */
const MAIN = new Map(
  fixture("stock-widget-queries.attribution-baseline.json").map((q) => [q.label, q.sql]),
);
/** The catalogue's SQL, kept equal to the widgets by the browser package's snapshot test. */
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));
type Form = "main" | "catalogue";

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 60;
const HISTORY_DAYS = 300;
const PERIOD_END = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const PERIOD_START = PERIOD_END - PERIOD_DAYS * DAY_MS;
/** The window before the period, which every one of the three also reads. */
const READ_START = PERIOD_START - PERIOD_DAYS * DAY_MS;
const READ_MS = PERIOD_END - READ_START;
const HISTORY_MS = HISTORY_DAYS * DAY_MS;

/** As a board sends them: instants, which the executor binds as Unix seconds. */
const PARAMETERS = {
  dashboard_context_period_start: new Date(PERIOD_START).toISOString(),
  dashboard_context_period_end: new Date(PERIOD_END).toISOString(),
  dashboard_context_granularity_seconds: 86_400,
  dashboard_context_sources: ["application"],
};

const UNITS = 2_000;
const MANAGED_VERSIONS = 20;
const METADATA_VERSIONS = 10;
const EVALUATORS = 5;
/** With CustomerId and Labels, the 8 keys att-change and att-table pick their unit from. */
const UNIT_METADATA_KEYS = ["document_type", "language", "team", "flow", "segment", "topic"];

type TenantName = "SMALL" | "LARGE" | "BARE";
type TenantSeed = {
  name: TenantName;
  tenantId: string;
  keyHash: string;
  /** Traces inside the 120 days read. */
  windowTraces: number;
  /** Traces in the 300 days before them. */
  historyTraces: number;
};

function tenantSeed({
  name,
  windowTraces,
  historyTraces,
}: Omit<TenantSeed, "tenantId" | "keyHash">): TenantSeed {
  const tenantId = `attribution-${name.toLowerCase()}`;
  const keyHash = capabilities.tenantCapability({ secret: `raw-lwql-key-${tenantId}-DO-NOT-LOG` });
  return { name, tenantId, keyHash, windowTraces, historyTraces };
}

const TENANTS: Record<TenantName, TenantSeed> = {
  SMALL: tenantSeed({ name: "SMALL", windowTraces: 125_000, historyTraces: 190_000 }),
  LARGE: tenantSeed({ name: "LARGE", windowTraces: 250_000, historyTraces: 375_000 }),
  BARE: tenantSeed({ name: "BARE", windowTraces: 250_000, historyTraces: 0 }),
};

/**
 * The seed writes whole blocks: merges stay stopped on these tables, so each block is a part per
 * week it spans, and small blocks would pile parts up until inserts are throttled.
 */
const SEED_SETTINGS = {
  max_insert_threads: "1",
  min_insert_block_size_rows: "262144",
  min_insert_block_size_bytes: "0",
} as const;

/**
 * Trace t of a tenant: the first `windowTraces` spread evenly over the 120 days read, the rest
 * over the 300 days before them. 30% carry a managed version, 10% a metadata version.
 */
function seedTraces({ tenant }: { tenant: TenantSeed }): string {
  const { windowTraces: inWindow, historyTraces } = tenant;
  return `(
    SELECT number AS t,
      lower(hex(MD5(concat({tenantId:String}, '-', toString(t))))) AS tid,
      if(t < ${inWindow},
        toDateTime64({end:DateTime64(3)}, 3) - toIntervalMillisecond(intDiv(t * ${READ_MS}, ${inWindow}) + 1),
        toDateTime64({readStart:DateTime64(3)}, 3)
          - toIntervalMillisecond(intDiv(greatest(toInt64(t) - ${inWindow}, 0) * ${HISTORY_MS}, ${Math.max(historyTraces, 1)}) + 1)) AS occ,
      t % ${UNITS} AS unit,
      if(t % 10 < 3, concat('pv-', toString(intDiv(t, 10) % ${MANAGED_VERSIONS})), '') AS managed,
      if(t % 10 = 3, concat('m-', toString(intDiv(t, 10) % ${METADATA_VERSIONS})), '') AS metadata_version
    FROM numbers(${inWindow + historyTraces})
  )`;
}

/** Rows older than the 308-day TTL would go at the next merge; 0 keeps the 300 days of history. */
const KEEP = 0;
const unitValue = (key: string) => `concat('${key}-', toString(unit))`;

/**
 * The tenant's `trace_analytics` rows. The managed version goes to `LastUsedPromptVersionId` once
 * a migration gives the table that column; main's table has none.
 */
function traceAnalyticsInsert({
  facts,
  tenant,
  managedColumn,
}: {
  facts: string;
  tenant: TenantSeed;
  managedColumn: boolean;
}): string {
  const metadata = UNIT_METADATA_KEYS.map((key) => `'metadata.${key}', ${unitValue(key)}`);
  return `
    INSERT INTO ${facts}.trace_analytics (TenantId, TraceId, Version, OccurredAt, CreatedAt, UpdatedAt, TraceName, CustomerId, Origin, Models, Labels, TotalDurationMs, HasError, Attributes, MetadataPromptVersion, _retention_days${managedColumn ? ", LastUsedPromptVersionId" : ""})
    SELECT {tenantId:String}, tid, '1', occ, occ, occ, concat('agent-', toString(t % 40)),
      ${unitValue("customer")}, 'application', ['gpt-5-mini'], [${unitValue("label")}], (t * 13) % 60000, false,
      map('langwatch.origin', 'application', ${metadata.join(", ")}),
      metadata_version, ${KEEP}${managedColumn ? ", managed" : ""}
    FROM ${seedTraces({ tenant })}
  `;
}

function traceSummariesInsert({ facts, tenant }: { facts: string; tenant: TenantSeed }): string {
  return `
    INSERT INTO ${facts}.trace_summaries (ProjectionId, TenantId, TraceId, Version, OccurredAt, CreatedAt, UpdatedAt, TraceName, Attributes, LastUsedPromptVersionId, _retention_days)
    SELECT tid, {tenantId:String}, tid, '1', occ, occ, occ, concat('agent-', toString(t % 40)),
      map('langwatch.origin', 'application', 'langwatch.customer_id', ${unitValue("customer")}),
      nullIf(managed, ''), ${KEEP}
    FROM ${seedTraces({ tenant })}
  `;
}

/**
 * Two evaluations a trace. Every tenth trace's first one changed: its first row, the retraction of
 * that row and its next revision land as three inserts, so the pair stays unmerged (ADR-007).
 */
const EVALUATION_WRITES = [
  { sign: 1, revision: 1, only: "1" },
  { sign: -1, revision: 1, only: "t % 10 = 0 AND n = 0" },
  { sign: 1, revision: 2, only: "t % 10 = 0 AND n = 0" },
] as const;

function traceEvaluationInsert({
  facts,
  tenant,
  write,
}: {
  facts: string;
  tenant: TenantSeed;
  write: (typeof EVALUATION_WRITES)[number];
}): string {
  const passedFirst = `(t + n) % 3 != 0`;
  const metadata = UNIT_METADATA_KEYS.map((key) => unitValue(key));
  return `
    INSERT INTO ${facts}.trace_evaluation_analytics (TenantId, TraceId, EvaluationId, OccurredAt, UpdatedAt, TraceOccurredAt, EvaluatorName, Status, IsGuardrail, Passed, Origin, TraceOrigin, CustomerId, Labels, MetadataDocumentType, MetadataLanguage, MetadataTeam, MetadataFlow, MetadataSegment, MetadataTopic, MetadataPromptVersion, Sign, Revision, _retention_days)
    SELECT {tenantId:String}, tid, concat(tid, '-', toString(n)),
      occ + toIntervalMinute(1 + n), occ + toIntervalMinute(1 + n) + toIntervalHour(${write.revision - 1}), occ,
      concat('evaluator-', toString((t + n) % ${EVALUATORS})), 'processed', false,
      ${write.revision === 1 ? passedFirst : `NOT (${passedFirst})`},
      'application', 'application', ${unitValue("customer")}, [${unitValue("label")}],
      ${metadata.join(", ")}, metadata_version, ${write.sign}, ${write.revision}, ${KEEP}
    FROM ${seedTraces({ tenant })}
    ARRAY JOIN [0, 1] AS n
    WHERE ${write.only}
  `;
}

/** One run's cost, read from the query log the server wrote for it. */
type Run = {
  type: string;
  peakBytes: number;
  exceptionCode: number;
  durationMs: number;
  refusal?: string;
};

const median = (runs: readonly Run[]): number =>
  runs.map((run) => run.peakBytes).toSorted((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 0;
const mib = (bytes: number) => Number((bytes / 2 ** 20).toFixed(1));
const described = (runs: readonly Run[]) =>
  runs
    .map((run) => `${run.type} code ${run.exceptionCode} at ${mib(run.peakBytes)} MiB`)
    .join("; ");

describe("given three tenants' attribution traces, read over a 60-day period and the window before it", () => {
  const fileStartedAt = performance.now();
  let harness: LangWatchQLClickHouseHarness;
  let executor: ClickHouseLangWatchQLExecutorRepository;
  let seedSeconds = Number.NaN;
  let runCount = 0;
  const measurements = new Map<string, Promise<Run[]>>();

  function sqlOf({ form, label }: { form: Form; label: QueryLabel }): string {
    const sql = (form === "main" ? MAIN : STOCK).get(label);
    if (!sql) throw new Error(`no ${form} SQL for ${label}`);
    return sql;
  }

  /** The newest finished or refused query_log entry the run's comment names. */
  async function queryLogEntry({ comment }: { comment: string }): Promise<Run> {
    return vi.waitFor(
      async () => {
        await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);
        const [entry] = await selectRows<{
          type: string;
          memory_usage: string;
          exception_code: string;
          query_duration_ms: string;
        }>(
          harness.admin,
          `SELECT type, memory_usage, exception_code, query_duration_ms FROM system.query_log ` +
            `WHERE log_comment = '${comment}' AND type != 'QueryStart' ` +
            `ORDER BY event_time_microseconds DESC LIMIT 1`,
        );
        if (!entry) {
          throw new Error(`no query_log entry for ${comment}: its peak would be invented`);
        }
        return {
          type: entry.type,
          peakBytes: Number(entry.memory_usage),
          exceptionCode: Number(entry.exception_code),
          durationMs: Number(entry.query_duration_ms),
        };
      },
      { timeout: 15_000, interval: 250 },
    );
  }

  /**
   * One run through the floored read and the shipped executor, as the service sends it. Each run
   * names its own project in the log comment, so its query_log entry is found exactly.
   */
  async function runOnce({ tenant, sql }: { tenant: TenantSeed; sql: string }): Promise<Run> {
    runCount += 1;
    const projectIds = [`${tenant.tenantId}-run-${runCount}`];
    let refusal: string | undefined;
    try {
      await flooredRead.execute({
        executor,
        request: { sql, parameters: PARAMETERS, tenantCapability: tenant.keyHash, projectIds },
        database: harness.names.database,
        views: VIEWS,
      });
    } catch (error) {
      // The query log carries the server's code; the executor's handled code is printed beside it.
      refusal = String((error as { code?: unknown } | null)?.code ?? error);
    }
    const run = await queryLogEntry({ comment: lwqlLogComment({ projectIds }) });
    return refusal === undefined ? run : { ...run, refusal };
  }

  /** Main's form runs once per tenant; the catalogue's three times, shared by every comparison. */
  function measured({
    form,
    label,
    tenant,
  }: {
    form: Form;
    label: QueryLabel;
    tenant: TenantSeed;
  }): Promise<Run[]> {
    const key = JSON.stringify({ form, label, tenant: tenant.name });
    const known = measurements.get(key);
    if (known) return known;
    const pending = (async () => {
      const runs: Run[] = [];
      for (let n = 0; n < (form === "main" ? 1 : RUNS); n++) {
        runs.push(await runOnce({ tenant, sql: sqlOf({ form, label }) }));
      }
      return runs;
    })();
    measurements.set(key, pending);
    return pending;
  }

  function expectAnswered({ runs, context }: { runs: readonly Run[]; context: string }): void {
    for (const run of runs) expect(run.exceptionCode, `${context}: ${described(runs)}`).toBe(0);
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "attribution-widgets-memory",
      facts: "migrated",
    });
    const { names, factDatabase: facts } = harness;
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names,
        sourceDatabase: facts,
        views: VIEWS,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views: VIEWS, sourceDatabase: facts, limits: LIMITS });
    // The harness stops merges on the trace tables; the pairs must stay unmerged here too.
    await harness.applyAsAdmin([
      `SYSTEM STOP MERGES ${facts}.trace_evaluation_analytics`,
      `TRUNCATE TABLE ${facts}.trace_evaluation_analytics`,
    ]);
    await harness.admin.insert({
      table: `${facts}.${names.keyMapTable}`,
      format: "JSONEachRow",
      values: Object.values(TENANTS).map(({ keyHash, tenantId }) => ({
        KeyHash: keyHash,
        TenantId: tenantId,
      })),
    });
    const [column] = await selectRows<{ n: string }>(
      harness.admin,
      `SELECT count() AS n FROM system.columns ` +
        `WHERE database = '${facts}' AND table = 'trace_analytics' ` +
        `AND name = 'LastUsedPromptVersionId'`,
    );
    const managedColumn = Number(column?.n) > 0;

    // One INSERT ... SELECT can outlast the driver's default 30 s on a slow runner.
    const seeder = createClient({
      url: harness.container.getHttpUrl(),
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      request_timeout: SEED_BUDGET_SECONDS * 1000,
    });
    const seedStartedAt = performance.now();
    for (const tenant of Object.values(TENANTS)) {
      const statements = [
        traceAnalyticsInsert({ facts, tenant, managedColumn }),
        traceSummariesInsert({ facts, tenant }),
        ...EVALUATION_WRITES.map((write) => traceEvaluationInsert({ facts, tenant, write })),
      ];
      for (const query of statements) {
        await seeder.command({
          query,
          query_params: {
            tenantId: tenant.tenantId,
            end: new Date(PERIOD_END).toISOString().slice(0, 23).replace("T", " "),
            readStart: new Date(READ_START).toISOString().slice(0, 23).replace("T", " "),
          },
          clickhouse_settings: SEED_SETTINGS,
        });
      }
    }
    seedSeconds = (performance.now() - seedStartedAt) / 1000;
    await seeder.close();

    const seeded = await selectRows<{ TenantId: string; n: string }>(
      harness.admin,
      `SELECT TenantId, count() AS n FROM ${facts}.trace_analytics ` +
        `WHERE TenantId LIKE 'attribution-%' GROUP BY TenantId`,
    );
    for (const tenant of Object.values(TENANTS)) {
      const n = Number(seeded.find((row) => row.TenantId === tenant.tenantId)?.n);
      if (n !== tenant.windowTraces + tenant.historyTraces) {
        throw new Error(`seed wrote ${n} trace_analytics rows for ${tenant.name}`);
      }
    }
    console.table({ seed: { seconds: Number(seedSeconds.toFixed(1)), managedColumn } });

    executor = ClickHouseLangWatchQLExecutorRepository.create({
      connection: {
        ...harness.restrictedConnection(),
        database: names.database,
        tenantSetting: names.tenantSetting,
      },
    });
  }, 600_000);

  afterAll(async () => {
    const rows: Record<string, unknown>[] = [];
    for (const [key, pending] of measurements) {
      const { form, label, tenant } = JSON.parse(key) as {
        form: Form;
        label: QueryLabel;
        tenant: TenantName;
      };
      const runs = await pending.catch(() => []);
      const sql = sqlOf({ form, label });
      const database = harness.names.database;
      const floored = floorLangWatchQLDedup({ sql, database, views: VIEWS }) !== sql;
      for (const [n, run] of runs.entries()) {
        const peakMiB = mib(run.peakBytes);
        rows.push({ form, label, tenant, run: n + 1, floored, peakMiB, ...run });
      }
    }
    console.table(rows);
    console.table({
      cap: {
        capBytes: ATTRIBUTION_MEMORY_CAP_BYTES,
        newSqlCeilingBytes: NEW_SQL_CEILING_BYTES,
        seedSeconds: Number(seedSeconds.toFixed(1)),
        fileSeconds: Number(((performance.now() - fileStartedAt) / 1000).toFixed(1)),
      },
    });
    await executor?.close();
    await harness?.stop();
  }, 120_000);

  it("runs the restricted identity at compatibility 25.10, four threads and the cap", async () => {
    const result = await executor.execute({
      sql:
        "SELECT toString(getSetting('compatibility')) AS compatibility, " +
        "toString(getSetting('max_threads')) AS threads, " +
        "toString(getSetting('max_memory_usage')) AS cap",
      tenantCapability: TENANTS.LARGE.keyHash,
      projectIds: [TENANTS.LARGE.tenantId],
    });
    expect(result.rows).toEqual([
      { compatibility: "25.10", threads: "4", cap: String(ATTRIBUTION_MEMORY_CAP_BYTES) },
    ]);
  });

  it("seeds the three tenants within 300 seconds", () => {
    expect(seedSeconds).toBeLessThanOrEqual(SEED_BUDGET_SECONDS);
  });

  describe("when main's SQL runs on the large tenant with 300 days of older history", () => {
    it.each(QUERY_LABELS)(
      "refuses main's %s with code 241 at the cap",
      async (label) => {
        const runs = await measured({ form: "main", label, tenant: TENANTS.LARGE });
        const codes = runs.map((run) => run.exceptionCode);
        expect(codes, described(runs)).toEqual([MEMORY_LIMIT_EXCEEDED]);
      },
      CASE_TIMEOUT_MS,
    );
  });

  describe("when main's att-change runs on the large tenant with no older history", () => {
    it.each(ATT_CHANGE_LABELS)(
      "answers main's %s within the cap",
      async (label) => {
        const runs = await measured({ form: "main", label, tenant: TENANTS.BARE });
        expectAnswered({ runs, context: `main's ${label} on BARE` });
        for (const run of runs) {
          expect(run.peakBytes).toBeLessThanOrEqual(ATTRIBUTION_MEMORY_CAP_BYTES);
        }
      },
      CASE_TIMEOUT_MS,
    );
  });

  describe("when the catalogue's SQL runs on the large tenant with 300 days of older history", () => {
    /** @scenario "att-change and passRates answer within the memory cap on 120 days, whatever the history" */
    /** @scenario "passRates answers within the memory cap on 120 days" */
    it.each(QUERY_LABELS)(
      "answers %s at or under 0.7 of the cap",
      async (label) => {
        const runs = await measured({ form: "catalogue", label, tenant: TENANTS.LARGE });
        expectAnswered({ runs, context: `${label} on LARGE` });
        const peak = Math.max(...runs.map((run) => run.peakBytes));
        expect(peak, described(runs)).toBeLessThanOrEqual(NEW_SQL_CEILING_BYTES);
      },
      CASE_TIMEOUT_MS,
    );

    /** @scenario "att-change and passRates answer within the memory cap on 120 days, whatever the history" */
    it.each(QUERY_LABELS)(
      "peaks at most 2.2 times as high for %s as on the small tenant",
      async (label) => {
        const large = await measured({ form: "catalogue", label, tenant: TENANTS.LARGE });
        const small = await measured({ form: "catalogue", label, tenant: TENANTS.SMALL });
        expectAnswered({ runs: large, context: `${label} on LARGE` });
        expectAnswered({ runs: small, context: `${label} on SMALL` });
        expect(median(large)).toBeLessThanOrEqual(LARGE_TO_SMALL_GROWTH * median(small));
      },
      CASE_TIMEOUT_MS,
    );

    /** @scenario "att-change and passRates answer within the memory cap on 120 days, whatever the history" */
    it.each(QUERY_LABELS)(
      "peaks within a tenth of the tenant with no older history for %s, median of three",
      async (label) => {
        const large = await measured({ form: "catalogue", label, tenant: TENANTS.LARGE });
        const bare = await measured({ form: "catalogue", label, tenant: TENANTS.BARE });
        expectAnswered({ runs: large, context: `${label} on LARGE` });
        expectAnswered({ runs: bare, context: `${label} on BARE` });
        const drift = Math.abs(median(large) - median(bare)) / median(bare);
        expect(drift, `${described(large)} against ${described(bare)}`).toBeLessThanOrEqual(
          HISTORY_TOLERANCE,
        );
      },
      CASE_TIMEOUT_MS,
    );
  });
});
