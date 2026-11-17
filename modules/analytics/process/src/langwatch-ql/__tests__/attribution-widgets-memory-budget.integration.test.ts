/**
 * @vitest-environment node
 * att-change and att-table's pass rates on a 60-day board read 120 days. Sent as the service sends
 * them, under the widget cap at compatibility 25.10, each must answer whatever the project's older
 * history; main's form was refused (code 241) once that history grew.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 * @see specs/lwql/stock-widgets-read-trace-evaluations.feature
 */
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { floorLangWatchQLDedup } from "../../rules/lwql-dedup-floor.rules.ts";
import {
  ATT_CHANGE_LABELS,
  createMeasurer,
  described,
  expectAnswered,
  expectRefused,
  type Form,
  MEMORY_LIMIT_EXCEEDED,
  median,
  mib,
  QUERY_LABELS,
  type QueryLabel,
  sqlOf,
} from "./attribution-widgets-measurement.ts";
import {
  SEED_BUDGET_SECONDS,
  seedAttributionTenants,
  type TenantName,
  type TenantSeed,
  TENANTS,
  VIEWS,
} from "./attribution-widgets-seed.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

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

describe("given three tenants' attribution traces, read over a 60-day period and the window before it", () => {
  const fileStartedAt = performance.now();
  let harness: LangWatchQLClickHouseHarness;
  let executor: ClickHouseLangWatchQLExecutorRepository;
  let seedSeconds = Number.NaN;
  const measurer = createMeasurer({ harness: () => harness, executor: () => executor });
  const { measurements } = measurer;

  const measured = ({
    form,
    label,
    tenant,
  }: {
    form: Form;
    label: QueryLabel;
    tenant: TenantSeed;
  }) => measurer.measured({ form, label, tenant, runs: form === "main" ? 1 : RUNS });

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "attribution-widgets-memory",
      facts: "migrated",
    });
    const seeded = await seedAttributionTenants({ harness, limits: LIMITS });
    seedSeconds = seeded.seedSeconds;
    console.table({
      seed: { seconds: Number(seedSeconds.toFixed(1)), managedColumn: seeded.managedColumn },
    });

    executor = ClickHouseLangWatchQLExecutorRepository.create({
      connection: {
        ...harness.restrictedConnection(),
        database: harness.names.database,
        tenantSetting: harness.names.tenantSetting,
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
        expect(runs).toHaveLength(1);
        expectRefused({ runs, code: MEMORY_LIMIT_EXCEEDED });
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
