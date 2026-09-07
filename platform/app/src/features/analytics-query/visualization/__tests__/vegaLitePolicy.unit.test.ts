/**
 * The LangWatchQL policy: where data may come from, which resource-loading paths
 * exist, who controls the chart runtime, and what a transform or an expression
 * is allowed to do.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  LWQL_FIXTURE_COLUMNS,
  LWQL_FIXTURE_ROW_COUNTS,
} from "../../__tests__/fixtures/lwqlDatasetRegistry";
import { lookupBetweenRegisteredDatasets } from "../../__tests__/fixtures/valid";
import { validateVegaLiteSpec } from "../validateVegaLiteSpec";
import { ALLOWED_VEGA_EXPRESSION_IDENTIFIERS } from "../vegaLiteExpressions";
import {
  ALLOWED_VEGA_LITE_TRANSFORMS,
  applyLangWatchQLVegaPolicy,
  LWQL_VEGA_LIMITS,
} from "../vegaLitePolicy";
import { VEGA_LITE_SCHEMA_URL as S } from "../vegaLiteSchema";
import type { VegaValidationError } from "../visualization.types";

const validate = (spec: unknown) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: LWQL_FIXTURE_COLUMNS,
    rowCountsByDataset: LWQL_FIXTURE_ROW_COUNTS,
  });

const refusalRules = (spec: unknown): string[] => {
  const result = validate(spec);
  return result.ok ? [] : result.errors.map((error) => error.rule);
};

const refusals = (spec: unknown): readonly VegaValidationError[] => {
  const result = validate(spec);
  return result.ok ? [] : result.errors;
};

const bar = (extra: Record<string, unknown>) => ({
  $schema: S,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { x: { field: "model", type: "nominal" } },
  ...extra,
});

describe("the LangWatchQL Vega-Lite policy", () => {
  describe("given a spec that names a data source", () => {
    describe("when the name is not registered", () => {
      /** @scenario "Every data source must resolve to a registered named dataset" */
      it("names the unknown dataset and the registered ones", () => {
        const errors = refusals({
          $schema: S,
          data: { name: "customer_pii" },
          mark: "bar",
        });

        expect(errors.map((error) => error.rule)).toEqual([
          "data.unknown-name",
        ]);
        expect(errors[0]?.code).toBe("unknown-dataset");
        expect(errors[0]?.message).toContain("customer_pii");
        expect(errors[0]?.message).toContain("query_result");
        expect(errors[0]?.message).toContain("model_catalog");
        expect(errors[0]?.meta?.registeredDatasets).toEqual([
          "query_result",
          "model_catalog",
        ]);
      });

      it("refuses a view that no data source reaches at all", () => {
        expect(
          refusalRules({ $schema: S, vconcat: [{ mark: "bar" }] }),
        ).toEqual(["data.unresolved"]);
      });

      it("admits a nested view that inherits a registered dataset", () => {
        expect(
          validate({
            $schema: S,
            data: { name: "query_result" },
            vconcat: [{ layer: [{ mark: "bar" }] }],
          }).ok,
        ).toBe(true);
      });
    });
  });

  describe("given a spec that carries its own data", () => {
    describe("when it is validated", () => {
      /** @scenario "Caller-supplied datasets and inline values are rejected" */
      it("refuses a top-level datasets property and inline values before Vega sees them", () => {
        expect(
          refusalRules(bar({ datasets: { smuggled: [{ model: "a" }] } })),
        ).toContain("data.caller-datasets");

        expect(
          refusalRules({
            $schema: S,
            data: { values: [{ model: "a", total: 1 }] },
            mark: "bar",
          }),
        ).toContain("data.inline-values");
      });
    });
  });

  describe("given a spec carrying a resource-loading path", () => {
    describe("when the path is buried in the composition tree", () => {
      /** @scenario "Every resource-loading path is rejected recursively" */
      it("refuses URL data, URL lookups, image marks, and URL encodings at any depth", () => {
        const nested = (leaf: Record<string, unknown>) => ({
          $schema: S,
          data: { name: "query_result" },
          vconcat: [{ vconcat: [{ layer: [{ layer: [leaf] }] }] }],
        });

        expect(
          refusalRules(
            nested({
              data: { url: "https://exfiltrate.example/rows.json" },
              mark: "bar",
            }),
          ),
        ).toContain("data.url");

        expect(
          refusalRules(
            nested({
              mark: "bar",
              transform: [
                {
                  lookup: "model",
                  from: {
                    data: { url: "https://exfiltrate.example/j.json" },
                    key: "model",
                    fields: ["vendor"],
                  },
                },
              ],
            }),
          ),
        ).toContain("lookup.url-data");

        expect(refusalRules(nested({ mark: "image" }))).toContain("mark.image");
        expect(
          refusalRules(nested({ mark: { type: "image", width: 8 } })),
        ).toContain("mark.image");

        expect(
          refusalRules(
            nested({
              mark: "point",
              encoding: { url: { field: "payload", type: "nominal" } },
            }),
          ),
        ).toContain("encoding.url");
      });

      it("refuses a URL on a mark config, which no position-by-position rule would reach", () => {
        const errors = refusals(
          bar({
            config: { mark: { url: "https://exfiltrate.example/pixel.png" } },
          }),
        );

        expect(errors.map((error) => error.rule)).toEqual([
          "resource.url-property",
        ]);
        expect(errors[0]?.path).toBe("/config/mark/url");
      });

      it("refuses a resource property given as a string, even where the schema never looks", () => {
        // The schema catches a string `config` at the top level first, so the
        // rule is exercised where the schema is deliberately permissive: the
        // free-form `usermeta` dictionary.
        const { errors } = applyLangWatchQLVegaPolicy({
          spec: {
            config: "https://exfiltrate.example/config.json",
            mark: "bar",
          },
          registeredDatasets: ["query_result"],
        });

        expect(errors.map((error) => error.rule)).toContain(
          "resource.url-property",
        );
        expect(
          refusalRules(
            bar({ usermeta: { patch: "https://exfiltrate.example/p.json" } }),
          ),
        ).toContain("resource.url-property");
      });
    });
  });

  describe("given a spec that reaches for the chart runtime's own options", () => {
    describe("when it is validated", () => {
      /** @scenario "Spec-controlled runtime options are rejected" */
      it("refuses usermeta embed options while leaving other usermeta alone", () => {
        const errors = refusals(
          bar({
            usermeta: {
              embedOptions: {
                actions: true,
                loader: { baseURL: "https://x/" },
              },
            },
          }),
        );

        expect(errors.map((error) => error.rule)).toEqual([
          "runtime.embed-options",
        ]);
        expect(errors[0]?.path).toBe("/usermeta/embedOptions");
        expect(
          validate(bar({ usermeta: { note: "a comment of my own" } })).ok,
        ).toBe(true);
      });
    });
  });

  describe("given a lookup transform", () => {
    describe("when it names another dataset", () => {
      /** @scenario "Lookup is admitted only between registered datasets within limits" */
      it("admits a registered source within limits and refuses every other source", () => {
        expect(validate(lookupBetweenRegisteredDatasets).ok).toBe(true);

        const from = (data: unknown) =>
          bar({
            transform: [
              {
                lookup: "model",
                from: { data, key: "model", fields: ["vendor"] },
              },
            ],
          });

        expect(refusalRules(from({ name: "not_registered" }))).toContain(
          "data.unknown-name",
        );
        expect(
          refusalRules(from({ url: "https://exfiltrate.example/j.json" })),
        ).toContain("lookup.url-data");
        expect(
          refusalRules(from({ values: [{ model: "a", vendor: "b" }] })),
        ).toContain("lookup.inline-data");

        const pastTheTransformCeiling = bar({
          transform: [
            ...Array.from(
              { length: LWQL_VEGA_LIMITS.maxTransforms },
              (_, i) => ({
                calculate: "datum.total + 1",
                as: `c${i}`,
              }),
            ),
            {
              lookup: "model",
              from: {
                data: { name: "model_catalog" },
                key: "model",
                fields: ["vendor"],
              },
            },
          ],
        });
        expect(refusalRules(pastTheTransformCeiling)).toContain(
          "limit.maxTransforms",
        );
      });
    });
  });

  describe("given a transform or expression outside the allowlist", () => {
    describe("when it is validated", () => {
      /** @scenario "Unknown transforms and expression features fail closed" */
      it("refuses unreviewed transforms and unreviewed expression identifiers", () => {
        for (const unreviewed of [
          { sample: 500 },
          { density: "total" },
          { regression: "total", on: "latency" },
          { loess: "total", on: "latency" },
          { quantile: "total" },
          { impute: "total", key: "bucket" },
          { extent: "total", param: "p" },
        ]) {
          const errors = refusals(bar({ transform: [unreviewed] }));
          expect(errors.map((error) => error.rule)).toContain(
            "transform.unknown",
          );
          expect(errors[0]?.message).toContain(ALLOWED_VEGA_LITE_TRANSFORMS[0]);
        }

        for (const forbidden of [
          "data('model_catalog')[0].vendor",
          "warn(datum.total)",
          "scale('x', datum.total)",
          "now()",
          "random()",
          "event.target",
          "windowSize()[0]",
          "datum.total = 1",
        ]) {
          const errors = refusals(
            bar({ transform: [{ calculate: forbidden, as: "smuggled" }] }),
          );
          expect(errors.map((error) => error.rule)).toContain(
            "expression.forbidden",
          );
        }
      });

      /** @scenario "Unknown transforms and expression features fail closed" */
      it("screens every expression-bearing key, wherever the evaluator reads one", () => {
        // Each of these is handed to the same evaluator as a `calculate`, so
        // each has to be screened by it. A key left off the screened set is not
        // a weaker refusal — it is an unscreened expression.
        const sites: [string, Record<string, unknown>][] = [
          [
            "/encoding/x/axis/labelExpr",
            {
              encoding: {
                x: {
                  field: "model",
                  type: "nominal",
                  axis: { labelExpr: "warn(datum.label)" },
                },
              },
            },
          ],
          [
            "/encoding/color/legend/labelExpr",
            {
              encoding: {
                color: {
                  field: "model",
                  type: "nominal",
                  legend: { labelExpr: "windowSize()[0]" },
                },
              },
            },
          ],
          [
            "/transform/0/calculate",
            { transform: [{ calculate: "now()", as: "c" }] },
          ],
        ];

        for (const [path, extra] of sites) {
          const errors = refusals(bar(extra));
          expect(
            errors.some(
              (error) =>
                error.rule === "expression.forbidden" && error.path === path,
            ),
            `${path} was not screened`,
          ).toBe(true);
        }
      });

      it("admits every allowlisted transform", () => {
        for (const admitted of [
          { filter: "datum.total > 1" },
          { calculate: "datum.total * 2", as: "doubled" },
          {
            aggregate: [{ op: "sum", field: "total", as: "summed" }],
            groupby: ["model"],
          },
          { bin: true, field: "total", as: "binned" },
          { timeUnit: "yearmonth", field: "bucket", as: "month" },
          { stack: "total", groupby: ["model"], as: ["from", "to"] },
          { fold: ["total", "latency"], as: ["key", "value"] },
          { flatten: ["payload"], as: ["flat"] },
          { joinaggregate: [{ op: "mean", field: "total", as: "avg" }] },
          { window: [{ op: "row_number", as: "rank" }] },
          { pivot: "series", value: "total", groupby: ["bucket"] },
        ]) {
          expect(validate(bar({ transform: [admitted] })).ok).toBe(true);
        }
      });

      it("admits expressions built only from allowlisted identifiers", () => {
        for (const allowed of [
          "datum.total > 10",
          "isValid(datum.total) ? datum.total : 0",
          "if(datum.total > 0, 'up', 'down')",
          "format(datum.total, ',.0f')",
          "timeFormat(datum.bucket, '%Y-%m')",
          "round(sqrt(abs(datum.latency)))",
          "lower(datum.model) == 'gpt'",
        ]) {
          expect(
            validate(bar({ transform: [{ calculate: allowed, as: "c" }] })).ok,
          ).toBe(true);
        }

        expect(ALLOWED_VEGA_EXPRESSION_IDENTIFIERS).toContain("datum");
        expect(ALLOWED_VEGA_EXPRESSION_IDENTIFIERS).not.toContain("data");
        expect(ALLOWED_VEGA_EXPRESSION_IDENTIFIERS).not.toContain("event");
      });
    });
  });

  describe("given the same forbidden expression in every slot that carries one", () => {
    describe("when it is validated", () => {
      /**
       * Screening is per-key, so a slot missing from the key list is not
       * screened *less* — it is not screened at all, and the expression reaches
       * the same evaluator having been read by nothing. `condition.test` was
       * exactly that slot: refused as a `filter`, accepted verbatim here.
       */
      it("refuses it in a conditional encoding, as it does in a filter", () => {
        const forbidden = "window.parent.document.cookie";

        expect(
          refusalRules(bar({ transform: [{ filter: forbidden }] })),
        ).toContain("expression.forbidden");

        expect(
          refusalRules(
            bar({
              encoding: {
                x: { field: "model", type: "nominal" },
                color: {
                  condition: { test: forbidden, value: "red" },
                  value: "blue",
                },
              },
            }),
          ),
        ).toContain("expression.forbidden");
      });
    });
  });
});
