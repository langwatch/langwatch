/**
 * Every named ceiling, from both sides: a specification sitting exactly on the
 * ceiling renders, and one a single step past it is refused naming the ceiling
 * it crossed.
 *
 * Only the pair proves anything. A test that checked the refusal alone would
 * pass against a validator that refused everything.
 *
 * The specifications are generated from `LWQL_VEGA_LIMITS` so the pair
 * stays a pair when a ceiling moves; the absolute numbers are pinned separately
 * in the first test, so a ceiling cannot be moved without saying so.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { LWQL_FIXTURE_COLUMNS, LWQL_FIXTURE_ROW_COUNTS } from "./fixtures/lwql-dataset-registry";
import { validateVegaLiteSpec } from "../validate-vega-lite-spec";
import {
  LWQL_VEGA_LIMITS as L,
  type LangWatchQLVegaLimitName,
  LWQL_VEGA_RULES,
} from "../vega-lite-policy";
import { VEGA_LITE_SCHEMA_URL as S } from "../vega-lite-schema";
import type { DatasetRowCounts } from "../visualization-types";

const validate = (spec: unknown, rows: DatasetRowCounts = LWQL_FIXTURE_ROW_COUNTS) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: LWQL_FIXTURE_COLUMNS,
    rowCountsByDataset: rows,
  });

const framed = (extra: Record<string, unknown>) => ({
  $schema: S,
  data: { name: "query_result" },
  ...extra,
});

const point = () => ({ mark: { type: "point" } });

/**
 * Depth measured independently of the validator's own measurement, so the two
 * have to agree for the generated pair to be the pair this test claims.
 */
const jsonDepth = (value: unknown): number => {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  if (value !== null && typeof value === "object") {
    return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  }
  return 0;
};

/** A `vconcat` chain whose JSON depth is exactly `target`. */
const nestedTo = (target: number) => {
  const even = target % 2 === 0;
  const leaf = even
    ? { mark: { type: "point" } }
    : {
        mark: { type: "point" },
        encoding: { x: { field: "total", type: "quantitative" } },
      };
  const wraps = (target - (even ? 2 : 3)) / 2;

  let inner: unknown = leaf;
  for (let i = 0; i < wraps - 1; i += 1) inner = { vconcat: [inner] };
  return framed({ vconcat: [inner] });
};

/** An expression of exactly `bytes` UTF-8 bytes, built from allowlisted tokens. */
const expressionOf = (bytes: number) => {
  let expression = "datum.total";
  while (expression.length + 4 <= bytes) expression += " + 1";
  while (expression.length < bytes) expression += "0";
  return expression;
};

/** A specification serializing to exactly `bytes` UTF-8 bytes. */
const specOf = (bytes: number) => {
  const shell = framed({ mark: "bar", description: "" });
  return {
    ...shell,
    description: "x".repeat(bytes - JSON.stringify(shell).length),
  };
};

const refusedBy = (spec: unknown, rows?: DatasetRowCounts) => {
  const result = validate(spec, rows);
  return result.ok ? [] : result.errors;
};

/** What one ceiling's pair of specifications turned out to do. */
interface CeilingObservation {
  readonly limit: LangWatchQLVegaLimitName;
  readonly admittedAtCeiling: boolean;
  readonly refusedPastCeiling: boolean;
  readonly namedTheLimit: boolean;
  readonly reportedTheAllowedValue: boolean;
}

/**
 * Observes the pair without asserting on it. The assertions belong in the test
 * body, where a failure can name every ceiling that misbehaved at once instead
 * of stopping at the first.
 */
const observeCeiling = ({
  limit,
  atCeiling,
  pastCeiling,
  rowsAt,
  rowsPast,
}: {
  limit: LangWatchQLVegaLimitName;
  atCeiling: unknown;
  pastCeiling: unknown;
  rowsAt?: DatasetRowCounts;
  rowsPast?: DatasetRowCounts;
}): CeilingObservation => {
  const onCeiling = refusedBy(atCeiling, rowsAt);
  const pastIt = refusedBy(pastCeiling, rowsPast);
  const named = pastIt.find((error) => error.rule === `limit.${limit}`);

  return {
    limit,
    admittedAtCeiling: onCeiling.length === 0,
    refusedPastCeiling: pastIt.length > 0,
    namedTheLimit: named?.code === "complexity-refusal" && named.message.includes(limit),
    reportedTheAllowedValue: named?.meta?.limit === limit && named?.meta?.allowed === L[limit],
  };
};

/** The ceilings that failed a claim, for a failure message worth reading. */
const limitsFailing = (
  observations: readonly CeilingObservation[],
  holds: (observation: CeilingObservation) => boolean,
): string[] => observations.filter((o) => !holds(o)).map((o) => o.limit);

describe("the LangWatchQL complexity ceilings", () => {
  describe("given the centralized complexity limits", () => {
    describe("when a spec sits at a ceiling and another sits just past it", () => {
      it("covers exactly the ceiling rules the policy declares", () => {
        expect(
          LWQL_VEGA_RULES.map((rule) => rule.id).filter((id) => id.startsWith("limit.")),
        ).toEqual([
          "limit.maxSpecBytes",
          "limit.maxNestingDepth",
          "limit.maxUnitViews",
          "limit.maxLayersPerView",
          "limit.maxTransforms",
          "limit.maxExpressionBytes",
          "limit.maxTotalExpressionBytes",
          "limit.maxInteractiveParams",
          "limit.maxRowsPerDataset",
          "limit.maxRowsAllDatasets",
        ]);
      });

      it("pins every ceiling to the number the policy was reviewed at", () => {
        expect(L).toEqual({
          maxSpecBytes: 262144,
          maxNestingDepth: 32,
          maxUnitViews: 12,
          maxLayersPerView: 8,
          maxTransforms: 32,
          maxExpressionBytes: 4096,
          maxTotalExpressionBytes: 16384,
          maxInteractiveParams: 16,
          maxRowsPerDataset: 10000,
          maxRowsAllDatasets: 20000,
        });
      });

      /** @scenario "Policy validates names, fields, transforms, and complexity" */
      it("admits the one on the ceiling and refuses the one past it, naming the limit", () => {
        // The generated pairs really are one step apart on the axis each
        // ceiling measures, checked with measurements of this file's own.
        expect(JSON.stringify(specOf(L.maxSpecBytes)).length).toBe(L.maxSpecBytes);
        expect(jsonDepth(nestedTo(L.maxNestingDepth))).toBe(L.maxNestingDepth);
        expect(jsonDepth(nestedTo(L.maxNestingDepth + 1))).toBe(L.maxNestingDepth + 1);
        expect(expressionOf(L.maxExpressionBytes)).toHaveLength(L.maxExpressionBytes);

        const concatOf = (n: number) => framed({ hconcat: Array.from({ length: n }, point) });
        const layersOf = (n: number) => framed({ layer: Array.from({ length: n }, point) });
        const transformsOf = (n: number) =>
          framed({
            mark: "bar",
            transform: Array.from({ length: n }, (_, i) => ({
              calculate: "datum.total + 1",
              as: `step${i}`,
            })),
          });
        const oneExpressionOf = (bytes: number) =>
          framed({
            mark: "bar",
            transform: [{ calculate: expressionOf(bytes), as: "e" }],
          });
        const paramsOf = (n: number) =>
          framed({
            mark: "bar",
            params: Array.from({ length: n }, (_, i) => ({
              name: `p${i}`,
              value: i,
            })),
          });
        const wholeCeiling = Array.from(
          { length: L.maxTotalExpressionBytes / L.maxExpressionBytes },
          (_, i) => ({
            calculate: expressionOf(L.maxExpressionBytes),
            as: `t${i}`,
          }),
        );
        const anyValidChart = framed({
          mark: "bar",
          encoding: { x: { field: "model", type: "nominal" } },
        });
        const spread = {
          query_result: L.maxRowsPerDataset,
          model_catalog: L.maxRowsAllDatasets - L.maxRowsPerDataset,
        };

        const observations = [
          observeCeiling({
            limit: "maxSpecBytes",
            atCeiling: specOf(L.maxSpecBytes),
            pastCeiling: specOf(L.maxSpecBytes + 1),
          }),
          observeCeiling({
            limit: "maxNestingDepth",
            atCeiling: nestedTo(L.maxNestingDepth),
            pastCeiling: nestedTo(L.maxNestingDepth + 1),
          }),
          observeCeiling({
            limit: "maxUnitViews",
            atCeiling: concatOf(L.maxUnitViews),
            pastCeiling: concatOf(L.maxUnitViews + 1),
          }),
          observeCeiling({
            limit: "maxLayersPerView",
            atCeiling: layersOf(L.maxLayersPerView),
            pastCeiling: layersOf(L.maxLayersPerView + 1),
          }),
          observeCeiling({
            limit: "maxTransforms",
            atCeiling: transformsOf(L.maxTransforms),
            pastCeiling: transformsOf(L.maxTransforms + 1),
          }),
          observeCeiling({
            limit: "maxExpressionBytes",
            atCeiling: oneExpressionOf(L.maxExpressionBytes),
            pastCeiling: oneExpressionOf(L.maxExpressionBytes + 1),
          }),
          observeCeiling({
            limit: "maxTotalExpressionBytes",
            atCeiling: framed({ mark: "bar", transform: wholeCeiling }),
            pastCeiling: framed({
              mark: "bar",
              transform: [...wholeCeiling, { calculate: "1", as: "one-more-byte" }],
            }),
          }),
          observeCeiling({
            limit: "maxInteractiveParams",
            atCeiling: paramsOf(L.maxInteractiveParams),
            pastCeiling: paramsOf(L.maxInteractiveParams + 1),
          }),
          observeCeiling({
            limit: "maxRowsPerDataset",
            atCeiling: anyValidChart,
            pastCeiling: anyValidChart,
            rowsAt: { query_result: L.maxRowsPerDataset },
            rowsPast: { query_result: L.maxRowsPerDataset + 1 },
          }),
          observeCeiling({
            limit: "maxRowsAllDatasets",
            atCeiling: anyValidChart,
            pastCeiling: anyValidChart,
            rowsAt: spread,
            rowsPast: { ...spread, spare_dataset: 1 },
          }),
        ];

        // Every ceiling the policy names is exercised, not just the easy ones.
        expect(observations.map((o) => o.limit)).toEqual(Object.keys(L));

        expect(limitsFailing(observations, (o) => o.admittedAtCeiling)).toEqual([]);
        expect(limitsFailing(observations, (o) => o.refusedPastCeiling)).toEqual([]);
        expect(limitsFailing(observations, (o) => o.namedTheLimit)).toEqual([]);
        expect(limitsFailing(observations, (o) => o.reportedTheAllowedValue)).toEqual([]);
      });
    });
  });
});
