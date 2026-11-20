/**
 * @vitest-environment node
 * att-change/change on a 60-day board reads 120 days. Sent as the service sends it, under the
 * widget cap at compatibility 25.10, its peak no longer grows with the project's older history.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
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
  type Form,
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

/** Production's widget cap; every query here must answer under it. */
const ATTRIBUTION_MEMORY_CAP_BYTES = DEFAULT_LWQL_RESOURCE_LIMITS.maxMemoryUsageBytes;
/** How far LARGE's peak may sit from BARE's once older history no longer counts. */
const HISTORY_TOLERANCE = 0.1;
/** Runs of each new query per tenant; the comparisons read their median. */
const RUNS = 3;
/** Up to nine runs a case, each allowed the profile's 60 s. */
const CASE_TIMEOUT_MS = 600_000;

/** Production's ceilings, on four threads. */
const LIMITS: LangWatchQLResourceLimits = { ...DEFAULT_LWQL_RESOURCE_LIMITS, maxThreads: 4 };

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
      "answers main's %s within the cap",
      async (label) => {
        const runs = await measured({ form: "main", label, tenant: TENANTS.LARGE });
        expectAnswered({ runs, context: `main's ${label} on LARGE` });
        for (const run of runs) {
          expect(run.peakBytes).toBeLessThanOrEqual(ATTRIBUTION_MEMORY_CAP_BYTES);
        }
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

  describe("when the catalogue's att-change/change runs on each tenant", () => {
    const label = "att-change/change";

    it(
      "answers on every tenant, its peaks printed beside main's",
      async () => {
        for (const tenant of [TENANTS.LARGE, TENANTS.SMALL, TENANTS.BARE]) {
          const runs = await measured({ form: "catalogue", label, tenant });
          expectAnswered({ runs, context: `${label} on ${tenant.name}` });
        }
      },
      CASE_TIMEOUT_MS,
    );

    /** @scenario "att-change/change's memory no longer grows with the project's older history" */
    it(
      "peaks within a tenth of the tenant with no older history, median of three",
      async () => {
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
