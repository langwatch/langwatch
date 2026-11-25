import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, vi } from "vitest";

import type { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { lwqlLogComment } from "../../rules/langwatch-ql-tenant-capability.rules.ts";
import { LangWatchQLFlooredReadService } from "../../services/langwatch-ql-floored-read.service.ts";
import { PARAMETERS, type TenantSeed, VIEWS } from "./attribution-widgets-seed.ts";
import { type LangWatchQLClickHouseHarness, selectRows } from "./lwql-clickhouse-harness.ts";

const flooredRead = LangWatchQLFlooredReadService.create();

/** ClickHouse's MEMORY_LIMIT_EXCEEDED: the run hit the cap, so it is not a measurement. */
export const MEMORY_LIMIT_EXCEEDED = 241;

/**
 * Made once per file run: system.query_log persists in a reused container and runCount restarts,
 * so a comment without it could match an earlier invocation's entry.
 */
const INVOCATION = randomUUID().replaceAll("-", "");

type StockQuery = { label: string; sql: string };

function fixture(name: string): readonly StockQuery[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

const QUERY_LABELS = ["att-change/change", "att-change/units", "att-table/passRates"] as const;
export type QueryLabel = (typeof QUERY_LABELS)[number];

/** Main's SQL for the three, frozen as the catalogue held it before the fix. */
const MAIN = new Map(
  fixture("stock-widget-queries.attribution-baseline.json").map((q) => [q.label, q.sql]),
);
/** The catalogue's SQL, kept equal to the widgets by the browser package's snapshot test. */
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));
export type Form = "main" | "catalogue";

/** One run's cost, and the rows it read, from the query log the server wrote for it. */
export type Run = {
  type: string;
  peakBytes: number;
  exceptionCode: number;
  durationMs: number;
  rowsRead: number;
  refusal?: string;
};

export const median = (runs: readonly Run[]): number =>
  runs.map((run) => run.peakBytes).toSorted((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 0;
export const mib = (bytes: number) => Number((bytes / 2 ** 20).toFixed(1));
export const described = (runs: readonly Run[]) =>
  runs
    .map(
      (run) =>
        `${run.type} code ${run.exceptionCode} at ${mib(run.peakBytes)} MiB, ` +
        `${run.rowsRead} rows read`,
    )
    .join("; ");

export function sqlOf({ form, label }: { form: Form; label: QueryLabel }): string {
  const sql = (form === "main" ? MAIN : STOCK).get(label);
  if (!sql) throw new Error(`no ${form} SQL for ${label}`);
  return sql;
}

/**
 * Fails if a run hit the cap, was refused, has a server exception code, or read no rows. No-data
 * runs pass cap and drift checks with a meaningless peak, and capped peak is the cap, not a
 * measure. att-change/change may rightly find none: no version first appears in the seed's period.
 */
export function expectAnswered({ runs, context }: { runs: readonly Run[]; context: string }): void {
  expect(runs.length, context).toBeGreaterThan(0);
  for (const run of runs) {
    expect(
      run.exceptionCode === MEMORY_LIMIT_EXCEEDED,
      `${context} hit the memory cap, so its peak is the cap and not a measure: ${described(runs)}`,
    ).toBe(false);
    expect(run.refusal, `${context}: ${described(runs)}`).toBeUndefined();
    expect(run.exceptionCode, `${context}: ${described(runs)}`).toBe(0);
    expect(run.rowsRead, `${context}: ${described(runs)}`).toBeGreaterThan(0);
  }
}

/** Runs queries as the service sends them and reads each one's cost from the query log. */
export function createMeasurer({
  harness,
  executor,
}: {
  harness: () => LangWatchQLClickHouseHarness;
  executor: () => ClickHouseLangWatchQLExecutorRepository;
}) {
  let runCount = 0;
  const measurements = new Map<string, Promise<Run[]>>();

  /** The newest finished or refused query_log entry the run's comment names. */
  async function queryLogEntry({ comment }: { comment: string }): Promise<Run> {
    return vi.waitFor(
      async () => {
        await harness().applyAsAdmin(["SYSTEM FLUSH LOGS"]);
        const [entry] = await selectRows<{
          type: string;
          memory_usage: string;
          exception_code: string;
          query_duration_ms: string;
          read_rows: string;
        }>(
          harness().admin,
          `SELECT type, memory_usage, exception_code, query_duration_ms, read_rows ` +
            `FROM system.query_log ` +
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
          rowsRead: Number(entry.read_rows),
        };
      },
      { timeout: 15_000, interval: 250 },
    );
  }

  /**
   * One run through the floored read and the shipped executor, as the service sends it. Each run
   * names its own project, carrying this invocation's token, so its entry is found exactly.
   */
  async function runOnce({ tenant, sql }: { tenant: TenantSeed; sql: string }): Promise<Run> {
    runCount += 1;
    const projectIds = [`${tenant.tenantId}-${INVOCATION}-run-${runCount}`];
    let refusal: string | undefined;
    try {
      await flooredRead.execute({
        executor: executor(),
        request: { sql, parameters: PARAMETERS, tenantCapability: tenant.keyHash, projectIds },
        database: harness().names.database,
        views: VIEWS,
      });
    } catch (error) {
      // The query log carries the server's code; the executor's handled code is printed beside it.
      refusal = String((error as { code?: unknown } | null)?.code ?? error);
    }
    const run = await queryLogEntry({ comment: lwqlLogComment({ projectIds }) });
    return refusal === undefined ? run : { ...run, refusal };
  }

  /** Each form, query and tenant runs `runs` times a file run, shared by every comparison. */
  function measured({
    form,
    label,
    tenant,
    runs: count,
  }: {
    form: Form;
    label: QueryLabel;
    tenant: TenantSeed;
    runs: number;
  }): Promise<Run[]> {
    const key = JSON.stringify({ form, label, tenant: tenant.name });
    const known = measurements.get(key);
    if (known) return known;
    const pending = (async () => {
      const runs: Run[] = [];
      for (let n = 0; n < count; n++) {
        runs.push(await runOnce({ tenant, sql: sqlOf({ form, label }) }));
      }
      return runs;
    })();
    measurements.set(key, pending);
    return pending;
  }

  return { measured, measurements };
}
