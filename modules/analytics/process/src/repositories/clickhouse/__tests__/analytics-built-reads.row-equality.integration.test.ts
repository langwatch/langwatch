import { readFileSync } from "node:fs";

/**
 * Analytics reads answer literal rows on 26.8 (ADR-202): pickers, filter conditions and timeseries
 * for two tenants sharing ids, under one tenant's proof and an aggregate's; and each aggregate read
 * inside its members' grant windows, never a project outside the proof (ADR-177).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  buildSeriesName,
  type AnalyticsTable,
  type AnalyticsTimeseriesResult,
  type FilterField,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { FilterOption, FindFilterOptionsInput } from "../../filter-options.repository.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
} from "../clickhouse.filter-conditions.mapper.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";
import { servesJoinedTraceSummaries } from "../clickhouse.joined-timeseries-query.mapper.ts";
import { servesMixedEval } from "../clickhouse.mixed-eval-timeseries-query.mapper.ts";
import { servesPipelines } from "../clickhouse.pipeline-timeseries-query.mapper.ts";
import { servesSpanGrouped } from "../clickhouse.span-grouped-timeseries-query.mapper.ts";
import { servesStandardTraceSummaries } from "../clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";
import * as costReads from "./built-reads.aggregate-cost-reads.fixture.ts";
import * as evaluationWindow from "./built-reads.aggregate-evaluation-window.fixture.ts";
import * as pickerWindows from "./built-reads.aggregate-filter-options.fixture.ts";
import * as memberIds from "./built-reads.aggregate-member-scoped-ids.fixture.ts";
import * as rollup from "./built-reads.aggregate-rollup.fixture.ts";
import * as slim from "./built-reads.aggregate-slim.fixture.ts";
import * as summaryWindows from "./built-reads.aggregate-trace-summaries.fixture.ts";
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
  /** The mixed read under the aggregate: each member's trace once; see its describe. */
  mixedPerMember: Record<string, AnalyticsTimeseriesResult>;
  /** Pipeline reads under the aggregate where a per-trace step counts each member's trace. */
  pipelinePerMember: Record<string, AnalyticsTimeseriesResult>;
  /**
   * Answers under the aggregate whose trace counts differ from main's: a trace count counts each
   * member's trace (ruling 1a), so two members' traces sharing an id are two; main counted one.
   */
  traceCountPerMember: Record<string, AnalyticsTimeseriesResult>;
  /** Shapes main dropped or inflated, answered by the ruling named (Alex, 2026-11-16). */
  byRuling: Record<string, { ruling: string; answer: AnalyticsTimeseriesResult }>;
};

/** The expected answer: each member's trace counted apart where that differs from main's. */
const answerFor = (key: string): AnalyticsTimeseriesResult | undefined =>
  expected.traceCountPerMember[key] ?? expected.timeseries[key];

/** A read's answer with its suite's run id written as the literals write it. */
const literal = <T>(value: T, run: string): T =>
  JSON.parse(JSON.stringify(value).replaceAll(run, "RUN")) as T;

const SETTINGS = { async_insert: 0, wait_for_async_insert: 0 } as const;

/** The aggregate-window cases: each seeds its own tenants and cleans them up. */
const WINDOW_FIXTURES = [
  slim,
  rollup,
  summaryWindows,
  evaluationWindow,
  memberIds,
  costReads,
  pickerWindows,
];

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
    await insert("stored_spans", [
      ...summaries.flatMap((row) => (row.span ? [row.span] : [])),
      ...timeseries.TRACE_SEEDS.flatMap((seed) => timeseries.extraSpan(tenantId, seed) ?? []),
    ]);
    await insert(
      "evaluation_runs",
      summaries.flatMap((row) => (row.run ? [row.run] : [])),
    );
  }
  for (const fixture of WINDOW_FIXTURES) {
    for (const { table, values } of fixture.seeds()) await insert(table, values);
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
  for (const fixture of WINDOW_FIXTURES) {
    for (const tenantId of fixture.TENANTS) {
      await deleteMigratedTenantRows({ client, tenantId, tables: fixture.SEEDED_TABLES });
    }
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
    groupByKey: shape.groupByKey,
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
      const want = answerFor(`${literal(projectId, timeseries.RUN)}|${shape.name}`);

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

  describe("given trace metrics mixed with evaluation metrics", () => {
    const [own, aggregate] = timeseries.PROOFS;

    it.each(timeseries.MIXED_SHAPES)(
      "$name answers main's buckets under one tenant's proof",
      async (shape) => {
        const want =
          expected.timeseries[`${literal(own!.projectId, timeseries.RUN)}|${shape.name}`];

        expect(want).toBeDefined();
        expect(
          toTwelveDigits(
            await builtTimeseries({ shape, projectId: own!.projectId, proof: own!.proof() }),
          ),
        ).toEqual(toTwelveDigits(want));
      },
    );

    /*
     * Main grouped the per-trace rows by trace id alone, so two members' traces sharing an id
     * merged into one, `any()` picking either member's values. The built read keeps one row per
     * member's trace; these are its answers, the summary's checked by hand below.
     */
    it.each(timeseries.MIXED_SHAPES)(
      "$name counts each member's trace once under an aggregate",
      async (shape) => {
        const want =
          expected.mixedPerMember[`${literal(aggregate!.projectId, timeseries.RUN)}|${shape.name}`];

        expect(want).toBeDefined();
        expect(
          toTwelveDigits(
            await builtTimeseries({
              shape,
              projectId: aggregate!.projectId,
              proof: aggregate!.proof(),
            }),
          ),
        ).toEqual(toTwelveDigits(want));
      },
    );

    it("adds both members' traces 3, which share an id, in the previous period", async () => {
      const shape = timeseries.MIXED_SHAPES.find(
        (each) => each.name === "mixed summary, both periods",
      )!;
      const result = await builtTimeseries({
        shape,
        projectId: aggregate!.projectId,
        proof: aggregate!.proof(),
      });
      const [previous] = result.previousPeriod;

      // A's trace 3 costs 4 over 400 ms; B's, scaled by 100, 400 over 40,000 ms; one run each,
      // so two traces, one per member.
      expect(previous).toMatchObject({
        "0/performance.total_cost/sum": 404,
        "1/performance.completion_time/avg": 20200,
        "4/metadata.trace_id/cardinality": 2,
        "5/metadata.user_id/cardinality": 2,
        "13/evaluations.evaluation_runs/cardinality/ev": 2,
      });
    });

    it.each(timeseries.MIXED_SHAPES)("$name is a built read", (shape) => {
      expect(
        servesMixedEval({
          ...timeseriesInput(shape, timeseries.TENANT_A),
          startDate: new Date(timeseries.START),
          endDate: new Date(timeseries.END),
          previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
        }),
      ).toBe(true);
    });
  });

  describe("given trace summaries joined to their spans or runs", () => {
    describe.each(timeseries.PROOFS)("given $name", ({ projectId, proof }) => {
      it.each(timeseries.JOINED_SHAPES)("$name answers the expected buckets", async (shape) => {
        const want = answerFor(`${literal(projectId, timeseries.RUN)}|${shape.name}`);
        const got = await builtTimeseries({ shape, projectId, proof: proof() });

        expect(want).toBeDefined();
        expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
      });
    });

    /*
     * Main summed the token attribute's string and failed (code 43), so these are derived by hand:
     * each trace's extra span carries (i + 1) * 7 prompt and (i + 1) * 11 completion tokens, B's
     * scaled by 100 and shared from 04:00 until 11:30, its traces joined to its own spans only.
     */
    it.each([
      [timeseries.PROOFS[0]!, { "05": [28, 44], "09": [7, 11], "10": [14, 22], "13": [35, 55] }],
      [
        timeseries.PROOFS[1]!,
        { "05": [2828, 2222], "09": [707, 555.5], "10": [1414, 1111], "13": [35, 55] },
      ],
    ] as const)("sums each member's span tokens under $0.name", async (proof, hours) => {
      const result = await builtTimeseries({
        shape: timeseries.SPAN_TOKEN_SHAPE,
        projectId: proof.projectId,
        proof: proof.proof(),
      });
      const buckets = [...result.previousPeriod, ...result.currentPeriod];

      for (const [hour, [prompt, completion]] of Object.entries(hours)) {
        expect(buckets.find((row) => row.date === `${timeseries.DAY} ${hour}:00:00`)).toMatchObject(
          {
            "0/spans.metrics.prompt_tokens/sum": prompt,
            "1/spans.metrics.completion_tokens/avg": completion,
          },
        );
      }
    });

    it.each([...timeseries.JOINED_SHAPES, timeseries.SPAN_TOKEN_SHAPE])(
      "$name is a built read",
      (shape) => {
        expect(
          servesJoinedTraceSummaries({
            ...timeseriesInput(shape, timeseries.TENANT_A),
            startDate: new Date(timeseries.START),
            endDate: new Date(timeseries.END),
            previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
          }),
        ).toBe(true);
      },
    );
  });

  describe("given trace metrics grouped by a key a trace holds several of", () => {
    describe.each(timeseries.PROOFS)("given $name", ({ projectId, proof }) => {
      it.each(timeseries.SPAN_GROUPED_SHAPES)(
        "$name answers the expected buckets",
        async (shape) => {
          const want = answerFor(`${literal(projectId, timeseries.RUN)}|${shape.name}`);
          const got = await builtTimeseries({ shape, projectId, proof: proof() });

          expect(want).toBeDefined();
          expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
        },
      );
    });

    it.each(timeseries.SPAN_GROUPED_SHAPES)("$name is a built read", (shape) => {
      expect(
        servesSpanGrouped({
          ...timeseriesInput(shape, timeseries.TENANT_A),
          startDate: new Date(timeseries.START),
          endDate: new Date(timeseries.END),
          previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
        }),
      ).toBe(true);
    });
  });

  /*
   * Main's dated pipeline joined its CTEs and named the keys `simple_metrics.period`, so its parser
   * read no bucket; these literals are main's SQL answers under the plain key names.
   */
  describe("given pipeline series", () => {
    const [own, aggregate] = timeseries.PROOFS;

    it.each(timeseries.PIPELINE_SHAPES)(
      "$name answers main's buckets under one tenant's proof",
      async (shape) => {
        const want =
          expected.timeseries[`${literal(own!.projectId, timeseries.RUN)}|${shape.name}`];
        const got = await builtTimeseries({
          shape,
          projectId: own!.projectId,
          proof: own!.proof(),
        });

        expect(want).toBeDefined();
        expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
      },
    );

    /*
     * Main grouped a per-trace pipeline by trace id alone, merging two members' traces sharing
     * an id; the built read keeps each member's trace (ruling 1a). Elsewhere: main's buckets.
     */
    it.each(timeseries.PIPELINE_SHAPES)(
      "$name counts each member's entities under an aggregate",
      async (shape) => {
        const key = `${literal(aggregate!.projectId, timeseries.RUN)}|${shape.name}`;
        const want = expected.pipelinePerMember[key] ?? answerFor(key);
        const got = await builtTimeseries({
          shape,
          projectId: aggregate!.projectId,
          proof: aggregate!.proof(),
        });

        expect(want).toBeDefined();
        expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
      },
    );

    it("averages both members' traces 3, which share an id, as two traces", async () => {
      const shape = timeseries.PIPELINE_SHAPES.find(
        (each) => each.name === "pipelines alone, both periods",
      )!;
      const result = await builtTimeseries({
        shape,
        projectId: aggregate!.projectId,
        proof: aggregate!.proof(),
      });

      // A's trace 3 costs 4, B's 400: two traces averaging 202, where main merged them into 404.
      expect(result.previousPeriod[0]).toMatchObject({
        "3/performance.total_cost/sum/trace_id/avg": 202,
      });
    });

    it.each(timeseries.PIPELINE_SHAPES)("$name is a built read", (shape) => {
      expect(
        servesPipelines({
          ...timeseriesInput(shape, timeseries.TENANT_A),
          startDate: new Date(timeseries.START),
          endDate: new Date(timeseries.END),
          previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
        }),
      ).toBe(true);
    });
  });

  /*
   * Main dropped a full-scale grouped pipeline (ruling 1a: computed) and a pipeline beside span or
   * run metrics shared their join (ruling 2a: read on its own). Answers checked against each part
   * read alone, which the suites above prove.
   */
  describe("given shapes main dropped or inflated", () => {
    describe.each(timeseries.PROOFS)("given $name", ({ projectId, proof }) => {
      it.each(timeseries.BY_RULING_SHAPES)("$name answers by ruling $ruling", async (shape) => {
        const want = expected.byRuling[`${literal(projectId, timeseries.RUN)}|${shape.name}`];

        expect(want?.ruling).toBe(shape.ruling);
        expect(toTwelveDigits(await builtTimeseries({ shape, projectId, proof: proof() }))).toEqual(
          toTwelveDigits(want?.answer),
        );
      });
    });

    it("reads a pipeline beside span metrics as it reads it alone", async () => {
      const [own] = timeseries.PROOFS;
      const read = (name: string) =>
        builtTimeseries({
          shape: [...timeseries.BY_RULING_SHAPES, ...timeseries.PIPELINE_SHAPES].find(
            (shape) => shape.name === name,
          )!,
          projectId: own!.projectId,
          proof: own!.proof(),
        });
      const values = (result: AnalyticsTimeseriesResult) =>
        [...result.previousPeriod, ...result.currentPeriod].map((bucket) => [
          bucket.date,
          (bucket as Record<string, unknown>)["0/performance.total_cost/sum/user_id/avg"],
        ]);

      const beside = values(await read("pipelines beside span metrics, hourly"));
      const alone = values(await read("pipelines one series, hourly"));

      expect(beside.filter(([, value]) => value !== undefined)).toEqual(alone);
    });
  });

  /*
   * A series filtered on spans or runs: main put `(TenantId, TraceId) IN (...)` in the series'
   * `-If`; the built reads hold the same subquery under the proof's windows. Under the aggregate,
   * the mixed read counts each member's trace (ruling 1a), as the mixed suite above does.
   */
  describe("given a series filtered on a side table", () => {
    const [own, aggregate] = timeseries.PROOFS;

    it.each(timeseries.SIDE_FILTER_SHAPES)(
      "$name answers main's buckets under one tenant's proof",
      async (shape) => {
        const want =
          expected.timeseries[`${literal(own!.projectId, timeseries.RUN)}|${shape.name}`];
        const got = await builtTimeseries({
          shape,
          projectId: own!.projectId,
          proof: own!.proof(),
        });

        expect(want).toBeDefined();
        expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
      },
    );

    it.each(timeseries.SIDE_FILTER_SHAPES)(
      "$name answers the expected buckets under an aggregate",
      async (shape) => {
        const key = `${literal(aggregate!.projectId, timeseries.RUN)}|${shape.name}`;
        const want = expected.mixedPerMember[key] ?? answerFor(key);
        const got = await builtTimeseries({
          shape,
          projectId: aggregate!.projectId,
          proof: aggregate!.proof(),
        });

        expect(want).toBeDefined();
        expect(toTwelveDigits(got)).toEqual(toTwelveDigits(want));
      },
    );

    it.each(timeseries.SIDE_FILTER_SHAPES)("$name is a built read", (shape) => {
      const input = {
        ...timeseriesInput(shape, timeseries.TENANT_A),
        startDate: new Date(timeseries.START),
        endDate: new Date(timeseries.END),
        previousPeriodStartDate: new Date(timeseries.PREVIOUS_START),
      };
      const routes = [
        servesStandardTraceSummaries,
        servesMixedEval,
        servesJoinedTraceSummaries,
        servesSpanGrouped,
        servesPipelines,
      ];

      expect(routes.some((serves) => serves(input))).toBe(true);
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

/** The summed cost series over every bucket of the current period. */
function totalCost(result: AnalyticsTimeseriesResult): number {
  return result.currentPeriod.reduce(
    (sum, bucket) => sum + Number(bucket["0/performance.total_cost/sum"] ?? 0),
    0,
  );
}

describe("slim trace analytics read under an aggregate's proof", () => {
  describe("given a member shared for a closed window", () => {
    /** @scenario "The aggregate's slim analytics counts members inside their windows" */
    it("counts the member's traces inside the window and the aggregate's own, nothing else", async () => {
      const proof = analyticsProof({
        projectId: slim.AGGREGATE,
        shared: [
          {
            projectId: slim.MEMBER,
            from: slim.GRANT_FROM.epochMilliseconds,
            until: slim.GRANT_UNTIL.epochMilliseconds,
          },
        ],
      });

      expect(totalCost(await analytics.runTimeseries(slim.costRead(proof)))).toBe(2 + 4 + 32);
    });
  });

  describe("given a member whose grant is still open", () => {
    it("counts every member trace from the window's start on", async () => {
      const proof = analyticsProof({
        projectId: slim.AGGREGATE,
        shared: [{ projectId: slim.MEMBER, from: slim.GRANT_FROM.epochMilliseconds }],
      });

      expect(totalCost(await analytics.runTimeseries(slim.costRead(proof)))).toBe(2 + 4 + 8 + 32);
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own traces alone, as before", async () => {
      const proof = analyticsProof({ projectId: slim.AGGREGATE });

      expect(totalCost(await analytics.runTimeseries(slim.costRead(proof)))).toBe(32);
    });
  });
});

describe("trace analytics rollup read under an aggregate's proof", () => {
  describe("given a member shared from part way through one minute to part way through another", () => {
    /** @scenario "The aggregate's analytics rollup counts members inside their windows" */
    it("counts the member's whole buckets inside the window and the aggregate's own, nothing else", async () => {
      const proof = analyticsProof({
        projectId: rollup.AGGREGATE,
        shared: [
          {
            projectId: rollup.MEMBER,
            from: rollup.GRANT_FROM.epochMilliseconds,
            until: rollup.GRANT_UNTIL.epochMilliseconds,
          },
        ],
      });

      expect(totalCost(await analytics.runTimeseries(rollup.costRead(proof)))).toBe(4 + 8 + 64);
    });
  });

  describe("given a member whose grant is still open", () => {
    it("counts every member bucket from the window's start on", async () => {
      const proof = analyticsProof({
        projectId: rollup.AGGREGATE,
        shared: [{ projectId: rollup.MEMBER, from: rollup.GRANT_FROM.epochMilliseconds }],
      });

      expect(totalCost(await analytics.runTimeseries(rollup.costRead(proof)))).toBe(
        4 + 8 + 16 + 64,
      );
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own buckets alone, as before", async () => {
      const proof = analyticsProof({ projectId: rollup.AGGREGATE });

      expect(totalCost(await analytics.runTimeseries(rollup.costRead(proof)))).toBe(64);
    });
  });
});

describe("legacy trace summaries read under an aggregate's proof", () => {
  const { COST_SERIES, SCORE_SERIES, IN_WINDOWS, SHARED_ID_TOTAL } = summaryWindows;
  const total = async (read: Parameters<typeof summaryWindows.seriesRead>[0]): Promise<number> =>
    summaryWindows.seriesTotal(
      await analytics.runTimeseries(summaryWindows.seriesRead(read)),
      read.series,
    );

  describe("given two members each shared for their whole history", () => {
    /** @scenario "Analytics aggregate across members" */
    it("counts both members' traces and the aggregate's own, never a foreign one", async () => {
      const authorization = analyticsProof({
        projectId: summaryWindows.AGGREGATE,
        shared: [
          { projectId: summaryWindows.WHOLE_HISTORY_MEMBER, from: 0 },
          { projectId: summaryWindows.LATE_MEMBER, from: 0 },
        ],
      });

      expect(await total({ authorization, table: "trace_summaries", series: COST_SERIES })).toBe(
        1 + 2 + 4 + 8 + 32 + SHARED_ID_TOTAL,
      );
    });
  });

  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's trace summaries count members inside their windows" */
    it("counts the first member's every trace, the second's from its start, never a foreign one", async () => {
      expect(
        await total({
          authorization: summaryWindows.aggregateProof(),
          table: "trace_summaries",
          series: COST_SERIES,
        }),
      ).toBe(IN_WINDOWS + SHARED_ID_TOTAL);
    });

    it("keeps the windows when a filter reads the evaluation side table", async () => {
      expect(
        await total({
          authorization: summaryWindows.aggregateProof(),
          table: "trace_summaries",
          series: COST_SERIES,
          filters: { "evaluations.evaluator_id": [summaryWindows.EVALUATOR] },
        }),
      ).toBe(IN_WINDOWS);
    });

    it("keeps only the member whose own trace matches a side-table filter on a trace id both use", async () => {
      expect(
        await total({
          authorization: summaryWindows.aggregateProof(),
          table: "trace_summaries",
          series: COST_SERIES,
          filters: { "evaluations.evaluator_id": [summaryWindows.SHARED_ID_EVALUATOR] },
        }),
      ).toBe(64);
    });

    /** @scenario "The aggregate's evaluation chart counts members inside their windows" */
    it("scores one check across the members inside their windows, never a foreign run", async () => {
      expect(
        await total({
          authorization: summaryWindows.aggregateProof(),
          table: "evaluation_runs",
          series: SCORE_SERIES,
        }),
      ).toBe(IN_WINDOWS);
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own traces alone, as before", async () => {
      expect(
        await total({
          authorization: analyticsProof({ projectId: summaryWindows.AGGREGATE }),
          table: "trace_summaries",
          series: COST_SERIES,
        }),
      ).toBe(32);
    });

    it("scores its own check alone, as before", async () => {
      expect(
        await total({
          authorization: analyticsProof({ projectId: summaryWindows.AGGREGATE }),
          table: "evaluation_runs",
          series: SCORE_SERIES,
        }),
      ).toBe(32);
    });
  });
});

describe("evaluation runs read under an aggregate's proof", () => {
  /** The evaluation runs a proof reads, through the table the series is routed to for it. */
  async function countRuns({
    authorization,
    projectId,
    readsMembers,
  }: {
    authorization: Authorization;
    projectId: string;
    readsMembers: boolean;
  }): Promise<number> {
    const input = evaluationWindow.inputFor(projectId);
    const result = await analytics.runTimeseries({
      table: analytics.tableFor(input, { readsMembers }),
      authorization,
      input,
      startDate: evaluationWindow.START,
      endDate: evaluationWindow.END,
      previousPeriodStartDate: evaluationWindow.START,
      adjustedTimeScale: "full",
      maxResultRows: undefined,
    });
    const name = buildSeriesName(evaluationWindow.RUNS_SERIES, 0);
    return result.currentPeriod.reduce((sum, bucket) => sum + Number(bucket[name] ?? 0), 0);
  }

  describe("given a member shared from a date, with a trace from before it evaluated after it", () => {
    /** @scenario "The aggregate counts a member's evaluations by when their trace occurred" */
    it("counts only the evaluation whose trace is inside the window", async () => {
      const proof = analyticsProof({
        projectId: evaluationWindow.AGGREGATE,
        shared: [
          {
            projectId: evaluationWindow.MEMBER,
            from: evaluationWindow.GRANT_FROM.epochMilliseconds,
          },
        ],
      });

      expect(
        await countRuns({
          authorization: proof,
          projectId: evaluationWindow.AGGREGATE,
          readsMembers: true,
        }),
      ).toBe(1);
    });
  });

  describe("given the member's own proof", () => {
    it("counts both of its evaluations, as before", async () => {
      const proof = analyticsProof({ projectId: evaluationWindow.MEMBER });

      expect(
        await countRuns({
          authorization: proof,
          projectId: evaluationWindow.MEMBER,
          readsMembers: false,
        }),
      ).toBe(2);
    });
  });
});

describe("thread and user metrics under an aggregate's proof", () => {
  const { THREADS_COUNT, MESSAGES_PER_THREAD, THREAD_DURATION, USER_THREAD_DURATION, USERS_COUNT } =
    memberIds;
  const valuesOf = async (read: Parameters<typeof memberIds.seriesRead>[0]): Promise<number[]> =>
    memberIds.values(await analytics.runTimeseries(memberIds.seriesRead(read)), read.series);

  describe("given two members and an outsider on the same conversation and user id", () => {
    describe("when the thread metrics card reads the group", () => {
      it("counts each member's thread as its own, one message each, never the outsider's", async () => {
        expect(
          await valuesOf({
            authorization: memberIds.groupProof(),
            table: "trace_summaries",
            series: [THREADS_COUNT, MESSAGES_PER_THREAD, THREAD_DURATION],
          }),
        ).toEqual([2, 1, 0]);
      });
    });

    describe("when the users page reads the group", () => {
      it("keeps one user per member, each with its own zero-length thread", async () => {
        expect(
          await valuesOf({
            authorization: memberIds.groupProof(),
            table: "trace_summaries",
            series: [USERS_COUNT, USER_THREAD_DURATION],
          }),
        ).toEqual([2, 0]);
      });
    });

    describe("when the slim table serves the counts", () => {
      it("counts each member's thread and user as its own", async () => {
        expect(
          await valuesOf({
            authorization: memberIds.groupProof(),
            table: "trace_analytics",
            series: [THREADS_COUNT, USERS_COUNT],
          }),
        ).toEqual([2, 2]);
      });
    });
  });

  describe("given a plain project's proof", () => {
    it("reads its one thread of one message, as before", async () => {
      expect(
        await valuesOf({
          projectId: memberIds.MEMBER_A,
          authorization: analyticsProof({ projectId: memberIds.MEMBER_A }),
          table: "trace_summaries",
          series: [THREADS_COUNT, MESSAGES_PER_THREAD, THREAD_DURATION, USERS_COUNT],
        }),
      ).toEqual([1, 1, 0, 1]);
    });

    it("counts its one thread and user on the slim table, as before", async () => {
      expect(
        await valuesOf({
          projectId: memberIds.MEMBER_A,
          authorization: analyticsProof({ projectId: memberIds.MEMBER_A }),
          table: "trace_analytics",
          series: [THREADS_COUNT, USERS_COUNT],
        }),
      ).toEqual([1, 1]);
    });
  });
});

describe("cost-gated reads under an aggregate's proof", () => {
  const { IN_WINDOWS } = costReads;

  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("ranks documents cited by the members inside their windows, never a foreign one", async () => {
      const result = await analytics.findTopDocuments(costReads.read());

      expect(result.topDocuments.map((doc) => doc.documentId).toSorted()).toEqual(IN_WINDOWS);
      expect(result.totalUniqueDocuments).toBe(IN_WINDOWS.length);
    });

    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("lists feedbacks on the members' traces inside their windows, never a foreign one", async () => {
      const result = await analytics.findFeedbackEvents(costReads.read());

      expect(result.events.map((event) => event.event_id).toSorted()).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("pages the same feedbacks", async () => {
      const page = await analytics.findFeedbackEventsPage({
        ...costReads.read(),
        after: undefined,
        limit: 10,
      });

      expect(page.rows.map((row) => row.event.event_id).toSorted()).toEqual(IN_WINDOWS);
      expect(page.hasMore).toBe(false);
    });
  });

  describe("given a proof minted for analytics view, not cost view", () => {
    it("refuses the read before it runs", async () => {
      const proof = analyticsProof({ projectId: costReads.AGGREGATE });

      await expect(
        analytics.findTopDocuments({ ...costReads.read(), authorization: proof }),
      ).rejects.toMatchObject({ code: "access_not_granted" });
    });
  });

  describe("given a plain project's proof", () => {
    it("reads its own documents alone, as before", async () => {
      const result = await analytics.findTopDocuments(
        costReads.read(costReads.WHOLE_HISTORY_MEMBER),
      );

      expect(result.topDocuments.map((doc) => doc.documentId).toSorted()).toEqual([
        "a-early",
        "a-late",
      ]);
    });
  });
});

describe("filter pickers read under an aggregate's proof", () => {
  const { EVALUATOR, IN_WINDOWS } = pickerWindows;

  /** What a picker offers; `readsMembers` is what FilterService sets for an aggregate's proof. */
  async function offered({
    field,
    authorization = pickerWindows.aggregateProof(),
    readsMembers = true,
    filters,
  }: {
    field: FilterField;
    authorization?: Authorization;
    readsMembers?: boolean;
    filters?: FindFilterOptionsInput["filters"];
  }): Promise<string[]> {
    const found = await options.findOptions({
      field,
      authorization,
      readsMembers,
      startDate: pickerWindows.START.epochMilliseconds,
      endDate: pickerWindows.END.epochMilliseconds,
      ...(filters ? { filters } : {}),
    });
    return found.map((option) => option.label).toSorted();
  }

  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers trace values from the members inside their windows, never a foreign one", async () => {
      expect(await offered({ field: "metadata.user_id" })).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers span values from the members inside their windows, never a foreign one", async () => {
      expect(await offered({ field: "spans.type" })).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers evaluators from the members inside their windows, never a foreign one", async () => {
      expect(await offered({ field: "evaluations.evaluator_id" })).toEqual(
        IN_WINDOWS.map((name) => `[langevals/exact_match] ${name}`),
      );
    });

    it("narrows by another filter's side-table subquery without crossing members", async () => {
      const filters = {
        "evaluations.evaluator_id": [`${EVALUATOR}-a-late`, `${EVALUATOR}-foreign`],
      };

      expect(await offered({ field: "metadata.user_id", filters })).toEqual(["a-late"]);
    });

    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers no evaluator whose trace predates the member's grant, though it ran after", async () => {
      expect(await offered({ field: "evaluations.evaluator_id" })).not.toContain(
        "[langevals/exact_match] b-before-grant-evaluated-after",
      );
    });
  });

  describe("given two members carrying the same trace id, and a filter picking one member's", () => {
    const filters = { "metadata.user_id": ["a-shared"] };

    it("offers that member's evaluators alone", async () => {
      expect(await offered({ field: "evaluations.evaluator_id", filters })).toEqual([
        "[langevals/exact_match] a-shared",
      ]);
    });

    it("offers that member's span values alone", async () => {
      expect(await offered({ field: "spans.type", filters })).toEqual(["a-shared"]);
    });
  });

  describe("given a member shared until noon, with a trace before noon evaluated after it", () => {
    it("offers the trace when no other filter narrows the picker", async () => {
      expect(
        await offered({
          field: "metadata.user_id",
          authorization: pickerWindows.closedShareProof(),
        }),
      ).toEqual(["c-closed"]);
    });

    /** @scenario "An aggregate's picker holds a side-table filter inside the member's share window" */
    it("drops the trace when narrowed by its evaluator, whose run fell after the share closed", async () => {
      expect(
        await offered({
          field: "metadata.user_id",
          authorization: pickerWindows.closedShareProof(),
          filters: { "evaluations.evaluator_id": [`${EVALUATOR}-c-closed`] },
        }),
      ).toEqual([]);
    });
  });

  describe("given a plain project's proof", () => {
    it("offers its own values alone, as before", async () => {
      expect(
        await offered({
          field: "metadata.user_id",
          authorization: analyticsProof({ projectId: pickerWindows.WHOLE_HISTORY_MEMBER }),
          readsMembers: false,
        }),
      ).toEqual(["a-early", "a-late", "a-shared"]);
    });
  });
});
