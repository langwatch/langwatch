/**
 * @vitest-environment node
 * att-change/change on a 60-day board reads 120 days. Sent as the service sends it, under the cap C
 * at 25.10, its peak no longer grows with older history; the sweep shows main's refused (code 241).
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
  createMeasurer,
  described,
  expectAnswered,
  type Form,
  median,
  MEMORY_LIMIT_EXCEEDED,
  mib,
  type QueryLabel,
  type Run,
  sqlOf,
} from "./attribution-widgets-measurement.ts";
import {
  PERMANENT_TENANTS,
  provisionAttributionViews,
  SEED_BUDGET_SECONDS,
  seedAttributionTenants,
  SWEEP_ONLY_TENANTS,
  SWEEP_TENANTS,
  type TenantName,
  TENANTS,
  type TenantSeed,
  VIEWS,
} from "./attribution-widgets-seed.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

/**
 * C, below the shipped 1 GB: CI cannot seed production-size history in time. Swept at C, the
 * new form peaks at most 136.6 MiB at every history size to 4M; main answers at 375k (at most
 * 118.6 MiB) and is refused at the cap (code 241) at 1.5M and 4M. Retune here.
 */
const ATTRIBUTION_MEMORY_CAP_BYTES = 192 * 2 ** 20;
/** How far a peak may sit from the no-history tenant's once older history no longer counts. */
const HISTORY_TOLERANCE = 0.1;
/** Runs of each new query per tenant; the comparisons read their median. */
const RUNS = 3;
/** Up to nine runs a case, each allowed the profile's 60 s. */
const CASE_TIMEOUT_MS = 600_000;

/**
 * The one-off sweep to 4M traces of history; too slow to seed on every pull request. It runs only
 * with LWQL_ATTRIBUTION_MEMORY_SWEEP=1, set by hand locally or by a one-off env line in
 * langwatch-app-ci.yml, as for the 468cd7dc578 proof run.
 */
const SWEEP = process.env.LWQL_ATTRIBUTION_MEMORY_SWEEP === "1";
/** Main's form runs once a tenant, or as often as the new one when the sweep compares them. */
const MAIN_RUNS = SWEEP ? RUNS : 1;
const SWEEP_SEED_BUDGET_SECONDS = 900;
/** Up to twelve runs a sweep case. */
const SWEEP_CASE_TIMEOUT_MS = 900_000;

const SHIPPED = DEFAULT_LWQL_RESOURCE_LIMITS;
/** A shipped byte budget, kept in its shipped proportion to the memory cap. */
const scaledToCap = (bytes: number, cap = ATTRIBUTION_MEMORY_CAP_BYTES) =>
  Math.floor((bytes * cap) / SHIPPED.maxMemoryUsageBytes);

/** Production's ceilings at `cap` on four threads, its spill and join budgets scaled with it. */
const limitsAt = (cap: number): LangWatchQLResourceLimits => ({
  ...SHIPPED,
  maxMemoryUsageBytes: cap,
  maxThreads: 4,
  maxBytesBeforeExternalGroupBy: scaledToCap(SHIPPED.maxBytesBeforeExternalGroupBy, cap),
  maxBytesBeforeExternalSort: scaledToCap(SHIPPED.maxBytesBeforeExternalSort, cap),
  maxBytesInJoin: scaledToCap(SHIPPED.maxBytesInJoin, cap),
});

/** Production's ceilings at C, the cap every describe but units runs under. */
const LIMITS = limitsAt(ATTRIBUTION_MEMORY_CAP_BYTES);
/**
 * A raised test cap for units alone. Its evaluations read sets the floor, so units stays over the
 * 192 MiB cap in both forms on this seed; at this cap its runs finish and their peaks are real.
 * Production's cap is unchanged.
 */
const UNITS_MEASURE_CAP_BYTES = 1024 * 2 ** 20;
const UNITS_LIMITS = limitsAt(UNITS_MEASURE_CAP_BYTES);

type SweepCase = { label: QueryLabel; form: Form; tenant: TenantSeed };
type SweepRow = SweepCase & { runs: readonly Run[] };

const distinct = (values: readonly (string | number)[]) => [...new Set(values)].join(", ");

/** The sweep's peaks as a markdown table, one row a query, form and history size. */
function sweepTable(rows: readonly SweepRow[]): string {
  const sorted = rows.toSorted(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      a.tenant.historyTraces - b.tenant.historyTraces ||
      a.form.localeCompare(b.form),
  );
  const lines = [
    "| Query | Form | Older history (traces) | Peak MiB per run | Exit code | Type | Refusal |",
    "|---|---|---:|---|---|---|---|",
  ];
  for (const { label, form, tenant, runs } of sorted) {
    const cells = [
      label,
      form === "main" ? "main" : "new",
      tenant.historyTraces.toLocaleString("en-GB"),
      runs.map((run) => mib(run.peakBytes)).join(" / "),
      distinct(runs.map((run) => run.exceptionCode)),
      distinct(runs.map((run) => run.type)),
      distinct(runs.map((run) => run.refusal ?? "-")),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

describe("given three tenants' attribution traces, read over a 60-day period and the window before it", () => {
  const fileStartedAt = performance.now();
  let harness: LangWatchQLClickHouseHarness;
  let executor: ClickHouseLangWatchQLExecutorRepository;
  let seedSeconds = Number.NaN;
  const measurer = createMeasurer({ harness: () => harness, executor: () => executor });
  const { measurements } = measurer;
  /** A separate cache, so units' raised-cap runs never mix with the 192 MiB ones. */
  const unitsMeasurer = createMeasurer({ harness: () => harness, executor: () => executor });

  const measured = ({
    form,
    label,
    tenant,
  }: {
    form: Form;
    label: QueryLabel;
    tenant: TenantSeed;
  }) => measurer.measured({ form, label, tenant, runs: form === "main" ? MAIN_RUNS : RUNS });

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "attribution-widgets-memory",
      facts: "migrated",
    });
    await provisionAttributionViews({ harness, limits: LIMITS });
    seedSeconds = await seedAttributionTenants({
      harness,
      tenants: PERMANENT_TENANTS,
    });
    console.table({ seed: { seconds: Number(seedSeconds.toFixed(1)) } });

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
    for (const [capBytes, cached] of [
      [ATTRIBUTION_MEMORY_CAP_BYTES, measurements],
      [UNITS_MEASURE_CAP_BYTES, unitsMeasurer.measurements],
    ] as const) {
      for (const [key, pending] of cached) {
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
          rows.push({
            capMiB: mib(capBytes),
            form,
            label,
            tenant,
            run: n + 1,
            floored,
            peakMiB,
            ...run,
          });
        }
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

  it(`seeds the three tenants within ${SEED_BUDGET_SECONDS} seconds`, () => {
    expect(seedSeconds).toBeLessThanOrEqual(SEED_BUDGET_SECONDS);
  });

  describe("when main's att-change/change runs with and without 300 days of older history", () => {
    it.each([TENANTS.LARGE, TENANTS.BARE])(
      "answers on $name within the cap",
      async (tenant) => {
        const label = "att-change/change";
        const runs = await measured({ form: "main", label, tenant });
        expectAnswered({ runs, context: `main's ${label} on ${tenant.name}` });
      },
      CASE_TIMEOUT_MS,
    );
  });

  describe("when the catalogue's att-change/change runs on each tenant", () => {
    const label = "att-change/change";

    it(
      "answers on every tenant within the cap, its peaks printed beside main's",
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

  /**
   * units runs under UNITS_LIMITS, a raised test cap, so its runs finish; production's cap is
   * unchanged. Tests run in order, so beforeAll's cap holds for all; afterAll restores LIMITS.
   * On LARGE the catalogue reads fewer rows than main, peaking at most a tenth above it.
   */
  describe("when the catalogue's att-change/units is measured under the raised test cap", () => {
    const label = "att-change/units";
    const unitsMeasured = ({ form, tenant }: { form: Form; tenant: TenantSeed }) =>
      unitsMeasurer.measured({ form, label, tenant, runs: RUNS });

    /** The restricted identity's own cap, read as it: the raised one, or the test fails. */
    const expectRaisedCap = async () => {
      const result = await executor.execute({
        sql: "SELECT toString(getSetting('max_memory_usage')) AS cap",
        tenantCapability: TENANTS.LARGE.keyHash,
        projectIds: [TENANTS.LARGE.tenantId],
      });
      expect(result.rows).toEqual([{ cap: String(UNITS_MEASURE_CAP_BYTES) }]);
    };

    beforeAll(async () => {
      await harness.applyAccessModel({
        views: VIEWS,
        sourceDatabase: harness.factDatabase,
        limits: UNITS_LIMITS,
      });
    }, 120_000);

    afterAll(async () => {
      await harness.applyAccessModel({
        views: VIEWS,
        sourceDatabase: harness.factDatabase,
        limits: LIMITS,
      });
    }, 120_000);

    /** @scenario "att-change/units's memory no longer grows with the project's older history" */
    it(
      "peaks no more than a tenth above the tenant with no older history, median of three",
      async () => {
        await expectRaisedCap();
        const large = await unitsMeasured({ form: "catalogue", tenant: TENANTS.LARGE });
        const bare = await unitsMeasured({ form: "catalogue", tenant: TENANTS.BARE });
        expectAnswered({ runs: large, context: `${label} on LARGE` });
        expectAnswered({ runs: bare, context: `${label} on BARE` });
        const growth = (median(large) - median(bare)) / median(bare);
        expect(growth, `${described(large)} against ${described(bare)}`).toBeLessThanOrEqual(
          HISTORY_TOLERANCE,
        );
      },
      CASE_TIMEOUT_MS,
    );

    it(
      "reads fewer rows than main's att-change/units and peaks no more than a tenth above it, on the tenant with older history",
      async () => {
        await expectRaisedCap();
        const catalogue = await unitsMeasured({ form: "catalogue", tenant: TENANTS.LARGE });
        const main = await unitsMeasured({ form: "main", tenant: TENANTS.LARGE });
        expectAnswered({ runs: catalogue, context: `${label} on LARGE` });
        expectAnswered({ runs: main, context: `main's ${label} on LARGE` });
        console.log(`catalogue: ${described(catalogue)}`);
        console.log(`main: ${described(main)}`);
        const context = `${described(catalogue)} against main ${described(main)}`;
        const catalogueMaxRows = Math.max(...catalogue.map((run) => run.rowsRead));
        const mainMinRows = Math.min(...main.map((run) => run.rowsRead));
        expect(catalogueMaxRows, context).toBeLessThan(mainMinRows);
        const growth = (median(catalogue) - median(main)) / median(main);
        expect(growth, context).toBeLessThanOrEqual(HISTORY_TOLERANCE);
      },
      CASE_TIMEOUT_MS,
    );
  });

  describe.skipIf(!SWEEP)("when older history grows to 4M traces, the window fixed", () => {
    const label = "att-change/change";
    const swept: (SweepCase & { pending: Promise<Run[]> })[] = [];
    let sweepSeedSeconds = Number.NaN;

    /** att-change/change as the file measures it, the others once; each kept for the table. */
    const sweepMeasured = (row: SweepCase) => {
      const pending = row.label === label ? measured(row) : measurer.measured({ ...row, runs: 1 });
      if (!swept.some((known) => known.pending === pending)) swept.push({ ...row, pending });
      return pending;
    };

    beforeAll(
      async () => {
        sweepSeedSeconds = await seedAttributionTenants({
          harness,
          tenants: SWEEP_ONLY_TENANTS,
        });
      },
      2 * SWEEP_SEED_BUDGET_SECONDS * 1000,
    );

    afterAll(async () => {
      const rows: SweepRow[] = [];
      for (const { pending, ...row } of swept) {
        rows.push({ ...row, runs: await pending.catch(() => []) });
      }
      const seconds = Number(sweepSeedSeconds.toFixed(1));
      console.log(
        `\nAttribution memory sweep: cap ${mib(ATTRIBUTION_MEMORY_CAP_BYTES)} MiB, ` +
          `window 250,000 traces, sweep seed ${seconds} s\n\n${sweepTable(rows)}\n`,
      );
    }, 120_000);

    it(`seeds the two larger histories within ${SWEEP_SEED_BUDGET_SECONDS} seconds`, () => {
      expect(sweepSeedSeconds).toBeLessThanOrEqual(SWEEP_SEED_BUDGET_SECONDS);
    });

    it(
      "refuses main's form with code 241 at the largest history",
      async () => {
        for (const tenant of SWEEP_TENANTS) {
          await sweepMeasured({ form: "main", label, tenant });
        }
        const runs = await sweepMeasured({ form: "main", label, tenant: TENANTS.HISTORY_4000K });
        for (const run of runs) {
          expect(run.exceptionCode, described(runs)).toBe(MEMORY_LIMIT_EXCEEDED);
        }
      },
      SWEEP_CASE_TIMEOUT_MS,
    );

    it(
      "answers the new form at every history size",
      async () => {
        for (const tenant of SWEEP_TENANTS) {
          const runs = await sweepMeasured({ form: "catalogue", label, tenant });
          expectAnswered({ runs, context: `${label} on ${tenant.name}` });
        }
      },
      SWEEP_CASE_TIMEOUT_MS,
    );

    it(
      "keeps the new form within a tenth of no older history at every size, median of three",
      async () => {
        const bare = await sweepMeasured({ form: "catalogue", label, tenant: TENANTS.BARE });
        expectAnswered({ runs: bare, context: `${label} on BARE` });
        for (const tenant of SWEEP_TENANTS) {
          const runs = await sweepMeasured({ form: "catalogue", label, tenant });
          expectAnswered({ runs, context: `${label} on ${tenant.name}` });
          const drift = Math.abs(median(runs) - median(bare)) / median(bare);
          const context = `${tenant.name}: ${described(runs)} against ${described(bare)}`;
          expect(drift, context).toBeLessThanOrEqual(HISTORY_TOLERANCE);
        }
      },
      SWEEP_CASE_TIMEOUT_MS,
    );

    it(
      "records att-table/passRates main against new, and main's att-change/units, on LARGE",
      async () => {
        const cases = [
          { label: "att-table/passRates", form: "main" },
          { label: "att-table/passRates", form: "catalogue" },
          { label: "att-change/units", form: "main" },
        ] as const;
        for (const row of cases) {
          const runs = await sweepMeasured({ ...row, tenant: TENANTS.LARGE });
          expect(runs, `${row.form}'s ${row.label}`).toHaveLength(1);
        }
      },
      SWEEP_CASE_TIMEOUT_MS,
    );
  });
});
