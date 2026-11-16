import { readFileSync } from "node:fs";

/**
 * The analytics reads built on the typed builder answer literal rows on 26.8 (ADR-202): the filter
 * pickers, the filter conditions and their negation, and the four timeseries reads, each seeded for
 * two tenants that share ids, read under one tenant's proof and under an aggregate's.
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type {
  AnalyticsTable,
  AnalyticsTimeseriesResult,
  FilterField,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import type { FilterOption } from "../../filter-options.repository.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
} from "../clickhouse.filter-conditions.mapper.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";
import { servesStandardTraceSummaries } from "../clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";
import * as conditions from "./built-reads.filter-conditions.fixture.ts";
import * as pickers from "./built-reads.filter-pickers.fixture.ts";
import * as timeseries from "./built-reads.timeseries.fixture.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

/** The literal answers, keyed by proof and case; each suite's run id is written `RUN`. */
const expected = JSON.parse(
  readFileSync(new URL("./built-reads.expected.fixture.json", import.meta.url), "utf8"),
) as {
  pickers: Record<string, FilterOption[]>;
  conditions: Record<string, string[]>;
  timeseries: Record<string, AnalyticsTimeseriesResult>;
};

/** A read's answer with its suite's run id written as the literals write it. */
const literal = <T>(value: T, run: string): T =>
  JSON.parse(JSON.stringify(value).replaceAll(run, "RUN")) as T;

const SETTINGS = { async_insert: 0, wait_for_async_insert: 0 } as const;

let client: ClickHouseClient;
let options: FilterOptionsClickHouseRepository;
let analytics: ClickHouseAnalyticsRepository;

async function insert(table: string, values: unknown[]) {
  await client.insert({ table, values, format: "JSONEachRow", clickhouse_settings: SETTINGS });
}

/** Trace summaries, spans and evaluation runs for both tenants of one row-builder. */
async function seedTraces({
  tenants,
  count,
  rowsOf,
}: {
  tenants: string[];
  count: number;
  rowsOf: (tenantId: string, index: number) => { summary: unknown; span: unknown; run: unknown };
}) {
  const rows = tenants.flatMap((tenantId) =>
    Array.from({ length: count }, (_, index) => rowsOf(tenantId, index)),
  );
  await insert(
    "trace_summaries",
    rows.map((row) => row.summary),
  );
  await insert(
    "stored_spans",
    rows.map((row) => row.span),
  );
  await insert(
    "evaluation_runs",
    rows.map((row) => row.run),
  );
}

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  options = FilterOptionsClickHouseRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  analytics = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  await seedTraces({
    tenants: [pickers.TENANT_A, pickers.TENANT_B],
    count: pickers.TRACE_COUNT,
    rowsOf: pickers.seedRows,
  });
  await seedTraces({
    tenants: [conditions.TENANT_A, conditions.TENANT_B],
    count: conditions.TRACE_COUNT,
    rowsOf: conditions.seedRows,
  });
  for (const tenantId of [timeseries.TENANT_A, timeseries.TENANT_B]) {
    await insert(
      "trace_analytics",
      timeseries.TRACE_SEEDS.map((seed) => timeseries.traceRow(tenantId, seed)),
    );
    await insert(
      "trace_analytics_rollup",
      timeseries.ROLLUP_SEEDS.map((seed) => timeseries.rollupRow(tenantId, seed)),
    );
    await insert(
      "evaluation_analytics",
      timeseries.EVAL_SEEDS.map((seed) => timeseries.evalRow(tenantId, seed)),
    );
    await insert(
      "evaluation_analytics_rollup",
      timeseries.EVAL_ROLLUP_SEEDS.map((seed) => timeseries.evalRollupRow(tenantId, seed)),
    );
    const summaries = timeseries.TRACE_SEEDS.map((seed) => timeseries.summaryRows(tenantId, seed));
    await insert(
      "trace_summaries",
      summaries.map((row) => row.summary),
    );
    await insert(
      "stored_spans",
      summaries.flatMap((row) => (row.span ? [row.span] : [])),
    );
    await insert(
      "evaluation_runs",
      summaries.flatMap((row) => (row.run ? [row.run] : [])),
    );
  }
}, 300_000);

afterAll(async () => {
  for (const tenantId of [pickers.TENANT_A, pickers.TENANT_B, pickers.AGGREGATE]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: pickers.SEEDED_TABLES });
  }
  for (const tenantId of [conditions.TENANT_A, conditions.TENANT_B]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: conditions.SEEDED_TABLES });
  }
  for (const tenantId of [timeseries.TENANT_A, timeseries.TENANT_B, timeseries.AGGREGATE]) {
    await deleteMigratedTenantRows({
      client,
      tenantId,
      tables: [...timeseries.TABLES, ...timeseries.SUMMARY_TABLES],
    });
  }
});

/** The built picker's options, through the repository as the service calls it. */
async function builtOptions({
  field,
  authorization,
  readsMembers,
  ask,
}: {
  field: FilterField;
  authorization: Authorization;
  readsMembers: boolean;
  ask: pickers.Ask;
}): Promise<FilterOption[]> {
  const found = await options.findOptions({
    field,
    authorization,
    readsMembers,
    startDate: pickers.START,
    endDate: pickers.END,
    ...(ask.query === undefined ? {} : { query: ask.query }),
    ...(ask.key === undefined ? {} : { key: ask.key }),
    ...(ask.subkey === undefined ? {} : { subkey: ask.subkey }),
    ...(ask.filters ? { filters: ask.filters } : {}),
  });
  return literal(
    found.toSorted((a, b) => `${a.field}|${a.label}`.localeCompare(`${b.field}|${b.label}`)),
    pickers.RUN,
  );
}

type PairRow = { tenant: unknown; trace: unknown };

/** The built condition's (tenant, trace) pairs, sent as the reader with the tenant setting. */
async function builtPairs({
  authorization,
  filters,
  negated = false,
}: {
  authorization: Authorization;
  filters: AnalyticsFilterInput;
  negated?: boolean;
}): Promise<string[]> {
  const scope = tenantScope.fromProof({ authorization, reads: "analytics" });
  const statement = clickhouseRead({ scope })
    .from(traceSummaries)
    .withinWindows()
    .select({ tenant: traceSummaries.TenantId, trace: traceSummaries.TraceId })
    .where(
      analyticsFilterCondition({
        filters,
        ts: traceSummaries,
        spanWindow: { startMs: conditions.START.getTime(), endMs: conditions.END.getTime() },
        negated,
      }),
    )
    .build();
  const { rows } = await clickHouseQueryClientOver(client).read({ statement });
  const pairs = (rows as PairRow[])
    .map((row) => `${String(row.tenant)}/${String(row.trace)}`)
    .toSorted();
  return literal(pairs, conditions.RUN);
}

/** A shape's dashboard query. */
const timeseriesInput = (shape: timeseries.Shape, projectId: string) =>
  ({
    projectId,
    startDate: timeseries.START,
    endDate: timeseries.END,
    series: shape.series,
    filters: shape.filters ?? {},
    groupBy: shape.groupBy,
    negateFilters: shape.negateFilters,
    traceIds: shape.traceIds,
    excludeOrigins: shape.excludeOrigins,
    timeScale: shape.timeScale,
    timeZone: shape.timeZone ?? "UTC",
  }) as Parameters<ClickHouseAnalyticsRepository["runTimeseries"]>[0]["input"];

/** The built timeseries read, through the repository as the service calls it. */
async function builtTimeseries({
  shape,
  projectId,
  proof,
}: {
  shape: timeseries.Shape;
  projectId: string;
  proof: Authorization;
}) {
  const result = await analytics.runTimeseries({
    table: shape.table as AnalyticsTable,
    authorization: proof,
    input: timeseriesInput(shape, projectId),
    startDate: Temporal.Instant.fromEpochMilliseconds(timeseries.START),
    endDate: Temporal.Instant.fromEpochMilliseconds(timeseries.END),
    previousPeriodStartDate: Temporal.Instant.fromEpochMilliseconds(timeseries.PREVIOUS_START),
    adjustedTimeScale: shape.timeScale,
    maxResultRows: undefined,
  });
  return literal(result, timeseries.RUN);
}

describe("filter pickers built on the typed builder", () => {
  describe.each([
    { proof: "tenant A's own proof", kind: "own", proofOf: pickers.ownProof, readsMembers: false },
    {
      proof: "an aggregate proof over A and B",
      kind: "both",
      proofOf: pickers.bothProof,
      readsMembers: true,
    },
  ])("given $proof", ({ kind, proofOf, readsMembers }) => {
    it.each(pickers.FIELDS)("offers the expected options for %s", async (field) => {
      for (const ask of pickers.asksFor(field)) {
        const key = `${kind}|${field}|${JSON.stringify(ask)}`;
        const want = expected.pickers[key];

        expect(want?.length, key).toBeGreaterThan(0);
        expect(
          await builtOptions({ field, authorization: proofOf(), readsMembers, ask }),
          key,
        ).toEqual(want);
      }
    });
  });

  describe("given tenant A's own proof", () => {
    it.each(pickers.FIELDS)("never offers tenant B's values for %s", async (field) => {
      for (const ask of pickers.asksFor(field)) {
        const actual = await builtOptions({
          field,
          authorization: pickers.ownProof(),
          readsMembers: false,
          ask,
        });

        expect(JSON.stringify(actual)).not.toMatch(/"b-|b_only|b_detail|b\.custom/);
      }
    });

    it.each(pickers.FIELDS)("searches by prefix for %s", async (field) => {
      for (const ask of pickers.asksFor(field).map((each) => ({ ...each, query: "A-" }))) {
        const key = `own|${field}|${JSON.stringify(ask)}`;

        expect(expected.pickers[key], key).toBeDefined();
        expect(
          await builtOptions({
            field,
            authorization: pickers.ownProof(),
            readsMembers: false,
            ask,
          }),
          key,
        ).toEqual(expected.pickers[key]);
      }
    });

    describe.each<{ narrowing: string; filters: AnalyticsFilterInput }>([
      { narrowing: "a row filter", filters: { "traces.error": ["true"] } },
      { narrowing: "a side-table filter", filters: { "evaluations.evaluator_id": ["ev-1"] } },
      { narrowing: "a span filter", filters: { "spans.type": ["a-type-0"] } },
    ])("when narrowed by $narrowing", ({ filters }) => {
      it.each(pickers.FIELDS)("offers the expected narrowed options for %s", async (field) => {
        for (const ask of pickers.asksFor(field).map((each) => ({ ...each, filters }))) {
          const key = `own|${field}|${JSON.stringify(ask)}`;

          expect(expected.pickers[key], key).toBeDefined();
          expect(
            await builtOptions({
              field,
              authorization: pickers.ownProof(),
              readsMembers: false,
              ask,
            }),
            key,
          ).toEqual(expected.pickers[key]);
        }
      });
    });
  });
});

describe("analytics filters built on the typed builder", () => {
  const tenantA = `${literal(conditions.TENANT_A, conditions.RUN)}/`;
  const tenantB = `${literal(conditions.TENANT_B, conditions.RUN)}/`;

  describe("given two tenants sharing trace ids with opposite values", () => {
    it.each(conditions.CASES)(
      "%s picks the expected rows under one tenant's proof",
      async (name, filters) => {
        const want = expected.conditions[`own|${name}`] ?? [];

        expect(want.length).toBeGreaterThan(0);
        expect(want.every((pair) => pair.startsWith(tenantA))).toBe(true);
        expect(await builtPairs({ authorization: conditions.ownProof(), filters })).toEqual(want);
      },
    );

    it.each(conditions.CASES)(
      "%s picks the expected rows under a proof reading both",
      async (name, filters) => {
        const want = expected.conditions[`both|${name}`] ?? [];

        expect(want.some((pair) => pair.startsWith(tenantB))).toBe(true);
        expect(await builtPairs({ authorization: conditions.bothProof(), filters })).toEqual(want);
      },
    );
  });

  describe("given the negate toggle", () => {
    it.each(conditions.CASES)(
      "%s negated picks the expected rows under one tenant's proof",
      async (name, filters) => {
        const want = expected.conditions[`own-negated|${name}`];

        expect(want).toBeDefined();
        expect(want?.every((pair) => pair.startsWith(tenantA))).toBe(true);
        expect(
          await builtPairs({ authorization: conditions.ownProof(), filters, negated: true }),
        ).toEqual(want);
      },
    );

    it.each(conditions.CASES)(
      "%s negated picks the expected rows under a proof reading both",
      async (name, filters) => {
        const want = expected.conditions[`both-negated|${name}`];

        expect(want).toBeDefined();
        expect(
          await builtPairs({ authorization: conditions.bothProof(), filters, negated: true }),
        ).toEqual(want);
      },
    );
  });
});

/** A float sum depends on the order ClickHouse adds rows in, main's answer included. */
function toTwelveDigits(value: unknown): unknown {
  if (typeof value === "number" && !Number.isInteger(value)) return Number(value.toPrecision(12));
  if (Array.isArray(value)) return value.map(toTwelveDigits);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toTwelveDigits(entry)]),
    );
  }
  return value;
}

describe("timeseries reads built on the typed builder", () => {
  describe.each(timeseries.PROOFS)("given $name", ({ projectId, proof }) => {
    it.each(timeseries.SHAPES)("$name answers the expected buckets", async (shape) => {
      const want = expected.timeseries[`${literal(projectId, timeseries.RUN)}|${shape.name}`];

      expect(want).toBeDefined();
      expect(
        (want?.currentPeriod.length ?? 0) + (want?.previousPeriod.length ?? 0),
      ).toBeGreaterThan(0);
      expect(toTwelveDigits(await builtTimeseries({ shape, projectId, proof: proof() }))).toEqual(
        toTwelveDigits(want),
      );
    });
  });

  describe("given the standard trace_summaries shapes", () => {
    it.each(timeseries.SUMMARY_SHAPES)("$name is a built read", (shape) => {
      expect(
        servesStandardTraceSummaries({
          ...timeseriesInput(shape, timeseries.TENANT_A),
          startDate: new Date(timeseries.START),
          endDate: new Date(timeseries.END),
          previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
        }),
      ).toBe(true);
    });
  });

  describe("given the aggregate reads B inside its window", () => {
    it("counts B's cost where tenant A's own proof does not", async () => {
      const [own, aggregate] = timeseries.PROOFS;
      const shape = timeseries.SHAPES[3]!;
      const cost = (result: AnalyticsTimeseriesResult) =>
        Number(result.currentPeriod[0]?.["0/performance.total_cost/sum"] ?? 0);

      expect(
        cost(await builtTimeseries({ shape, projectId: own!.projectId, proof: own!.proof() })),
      ).toBe(2 + 8);
      expect(
        cost(
          await builtTimeseries({
            shape,
            projectId: aggregate!.projectId,
            proof: aggregate!.proof(),
          }),
        ),
      ).toBe(2 + 8 + 200);
    });
  });
});
