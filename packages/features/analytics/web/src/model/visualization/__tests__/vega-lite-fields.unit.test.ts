/**
 * Field references, resolved against the dataset feeding the branch they sit in
 * rather than against whatever dataset happens to be at the top of the spec.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { LWQL_FIXTURE_COLUMNS, LWQL_FIXTURE_ROW_COUNTS } from "./fixtures/lwql-dataset-registry";
import { repeatOverRegisteredColumns, transformCreatedFields } from "./fixtures/valid";
import { validateVegaLiteSpec } from "../validate-vega-lite-spec";
import { VEGA_LITE_SCHEMA_URL as S } from "../vega-lite-schema";

const validate = (spec: unknown) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: LWQL_FIXTURE_COLUMNS,
    rowCountsByDataset: LWQL_FIXTURE_ROW_COUNTS,
  });

const bar = (extra: Record<string, unknown>) => ({
  $schema: S,
  data: { name: "query_result" },
  mark: "bar",
  ...extra,
});

describe("field reference validation", () => {
  describe("given a spec whose branches read different registered datasets", () => {
    describe("when a field reference does not exist in the dataset feeding its branch", () => {
      /** @scenario "Field references are validated against the dataset that feeds them" */
      it("names the dataset, lists its columns, and still recognizes transform-created fields", () => {
        const refused = validate({
          $schema: S,
          hconcat: [
            {
              data: { name: "query_result" },
              mark: "bar",
              encoding: { x: { field: "latency", type: "quantitative" } },
            },
            {
              data: { name: "model_catalog" },
              mark: "bar",
              encoding: { x: { field: "latency", type: "quantitative" } },
            },
          ],
        });

        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.errors).toHaveLength(1);

        const [error] = refused.errors;
        expect(error?.rule).toBe("field.unknown");
        expect(error?.code).toBe("unknown-field");
        expect(error?.path).toBe("/hconcat/1/encoding/x/field");
        expect(error?.message).toContain("model_catalog");
        expect(error?.message).toContain("vendor");
        expect(error?.meta?.availableColumns).toEqual(["model", "vendor"]);

        // The identical reference in the branch fed by query_result is fine.
        expect(error?.path).not.toContain("/hconcat/0");

        // Fields the allowed transforms create are recognized downstream.
        expect(validate(transformCreatedFields).ok).toBe(true);
      });
    });
  });

  describe("given a reference to a column that does not exist", () => {
    describe("when the reference sits on a channel, a sort, a condition, or a facet", () => {
      it("reports each site with the pointer that reaches it", () => {
        const sites: [unknown, string][] = [
          [bar({ encoding: { x: { field: "ghost", type: "nominal" } } }), "/encoding/x/field"],
          [
            bar({
              encoding: {
                x: {
                  field: "model",
                  type: "nominal",
                  sort: { field: "ghost", op: "sum" },
                },
              },
            }),
            "/encoding/x/sort/field",
          ],
          [
            bar({
              encoding: {
                tooltip: [
                  { field: "model", type: "nominal" },
                  { field: "ghost", type: "nominal" },
                ],
              },
            }),
            "/encoding/tooltip/1/field",
          ],
          [
            bar({
              encoding: {
                color: {
                  condition: {
                    test: "datum.total > 1",
                    field: "ghost",
                    type: "nominal",
                  },
                  value: "grey",
                },
              },
            }),
            "/encoding/color/condition/field",
          ],
          [
            {
              $schema: S,
              data: { name: "query_result" },
              facet: { field: "ghost", type: "nominal" },
              spec: {
                mark: "bar",
                encoding: { x: { field: "model", type: "nominal" } },
              },
            },
            "/facet/field",
          ],
        ];

        for (const [spec, path] of sites) {
          const result = validate(spec);
          expect(result.ok).toBe(false);
          if (result.ok) continue;
          expect(result.errors.map((error) => error.path)).toContain(path);
        }
      });
    });
  });

  describe("given a reference into a structured column or a repeat list", () => {
    describe("when it is validated", () => {
      it("accepts nested access through a known root column and resolves repeat variables", () => {
        expect(
          validate(
            bar({
              encoding: { x: { field: "payload.nested.key", type: "nominal" } },
            }),
          ).ok,
        ).toBe(true);
        expect(
          validate(bar({ encoding: { x: { field: "payload[0]", type: "nominal" } } })).ok,
        ).toBe(true);
        expect(
          validate(
            bar({
              encoding: { x: { field: "ghost.nested", type: "nominal" } },
            }),
          ).ok,
        ).toBe(false);

        expect(validate(repeatOverRegisteredColumns).ok).toBe(true);

        const repeatingAnUnknownColumn = {
          $schema: S,
          repeat: ["total", "ghost"],
          spec: {
            data: { name: "query_result" },
            mark: "bar",
            encoding: {
              y: { field: { repeat: "repeat" }, type: "quantitative" },
            },
          },
        };
        const refused = validate(repeatingAnUnknownColumn);
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.errors[0]?.message).toContain("ghost");
      });

      it("refuses a repeat variable that no enclosing repeat definition binds", () => {
        const refused = validate({
          $schema: S,
          repeat: { column: ["total"] },
          spec: {
            data: { name: "query_result" },
            mark: "bar",
            encoding: { y: { field: { repeat: "row" }, type: "quantitative" } },
          },
        });

        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.errors[0]?.rule).toBe("field.unknown");
        expect(refused.errors[0]?.message).toContain("row");
      });
    });
  });

  describe("given a transform whose output columns come from the data", () => {
    describe("when a later reference cannot be checked", () => {
      it("warns instead of refusing, and says why", () => {
        const result = validate(
          bar({
            transform: [{ pivot: "series", value: "total", groupby: ["bucket"] }],
            encoding: {
              y: { field: "whichever_series_value", type: "quantitative" },
            },
          }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.warnings.map((warning) => warning.code)).toContain(
          "transform-fields-unverifiable",
        );
      });
    });
  });

  describe("given a transform that reads a column before it exists", () => {
    describe("when the transforms run in order", () => {
      it("refuses the read that comes before the write", () => {
        const tooEarly = validate(
          bar({
            transform: [
              { calculate: "datum.total * 2", as: "doubled" },
              {
                aggregate: [{ op: "sum", field: "tripled", as: "s" }],
                groupby: ["model"],
              },
            ],
          }),
        );
        expect(tooEarly.ok).toBe(false);
        if (!tooEarly.ok) {
          expect(tooEarly.errors[0]?.rule).toBe("field.unknown");
          expect(tooEarly.errors[0]?.message).toContain("tripled");
        }

        const inOrder = validate(
          bar({
            transform: [
              { calculate: "datum.total * 2", as: "doubled" },
              {
                aggregate: [{ op: "sum", field: "doubled", as: "s" }],
                groupby: ["model"],
              },
            ],
            encoding: { y: { field: "s", type: "quantitative" } },
          }),
        );
        expect(inOrder.ok).toBe(true);
      });
    });
  });
});
