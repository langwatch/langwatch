/**
 * The specification a member is given to start from.
 *
 * The one thing it must never be is invalid: a starting point that the chart
 * immediately refuses teaches the member that the editor is broken. So every
 * shape it can produce is run through the real validator here, against the same
 * dataset registry the workbench supplies.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  starterEncodingType,
  starterVegaLiteSpec,
  starterVegaLiteSpecText,
} from "../starter-vega-lite-spec";
import { validateVegaLiteSpec } from "../validate-vega-lite-spec";
import type { DatasetRowCounts, LangWatchQLDatasetColumn } from "../visualization-types";

const DATASET = "query_result";
const ROWS: DatasetRowCounts = { [DATASET]: 12 };

function objectOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

const COLUMN_SHAPES: readonly {
  name: string;
  columns: readonly LangWatchQLDatasetColumn[];
}[] = [
  {
    name: "a category and a number",
    columns: [
      { name: "model", type: "String" },
      { name: "total", type: "UInt64" },
    ],
  },
  {
    name: "a time bucket, a series and a number",
    columns: [
      { name: "bucket", type: "DateTime" },
      { name: "series", type: "LowCardinality(String)" },
      { name: "latency", type: "Float64" },
    ],
  },
  {
    name: "only categories",
    columns: [
      { name: "model", type: "String" },
      { name: "vendor", type: "String" },
    ],
  },
  {
    name: "only numbers",
    columns: [{ name: "total", type: "Nullable(Int32)" }],
  },
  { name: "no columns at all", columns: [] },
];

const shapeNamed = (name: string): readonly LangWatchQLDatasetColumn[] => {
  const shape = COLUMN_SHAPES.find((entry) => entry.name === name);
  if (!shape) throw new Error(`no column shape named ${name}`);
  return shape.columns;
};

const validate = (spec: unknown, columns: readonly LangWatchQLDatasetColumn[]) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: { [DATASET]: columns },
    rowCountsByDataset: ROWS,
  });

describe("the starting chart specification", () => {
  describe("given the columns a LangWatchQL result returned", () => {
    describe("when a starter is built for each shape of result", () => {
      it("produces one the LangWatchQL validator accepts, every time", () => {
        for (const { name, columns } of COLUMN_SHAPES) {
          const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
          const result = validate(spec, columns);

          expect(
            result.ok,
            `${name}: ${result.ok ? "" : result.errors.map((e) => e.message).join(" | ")}`,
          ).toBe(true);
        }
      });

      it("reads the result rather than carrying it", () => {
        const [shape] = COLUMN_SHAPES;
        const spec = starterVegaLiteSpec({
          columns: shape!.columns,
          datasetName: DATASET,
        });

        expect(spec.data).toEqual({ name: DATASET });
        expect(spec.datasets).toBeUndefined();
        expect(JSON.stringify(spec)).not.toContain("values");
      });

      it("puts time on the horizontal axis and draws a line for it", () => {
        const columns = shapeNamed("a time bucket, a series and a number");
        const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
        const encoding = objectOf(spec.encoding);

        expect(spec.mark).toEqual({ type: "line", point: true });
        expect(encoding.x).toEqual({ field: "bucket", type: "temporal" });
        expect(encoding.y).toEqual({ field: "latency", type: "quantitative" });
      });

      it("counts rows when the result has nothing to measure", () => {
        const columns = shapeNamed("only categories");
        const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
        const encoding = objectOf(spec.encoding);

        expect(spec.mark).toBe("bar");
        expect(encoding.x).toEqual({ field: "model", type: "nominal" });
        expect(encoding.y).toEqual({
          aggregate: "count",
          type: "quantitative",
        });
      });

      /**
       * The server pins every result to one tenant, so `TenantId` is constant
       * and a chart over it is a single bar of everything. The starter reaches
       * past it when the result offers any other category — and still uses it
       * when it is the only category there is, because an axis beats none.
       */
      it("prefers a category the result can distinguish over the tenant scope column", () => {
        const spec = starterVegaLiteSpec({
          columns: [
            { name: "TenantId", type: "String" },
            { name: "model", type: "String" },
          ],
          datasetName: DATASET,
        });
        const encoding = objectOf(spec.encoding);
        expect(encoding.x).toEqual({ field: "model", type: "nominal" });

        const onlyTenant = starterVegaLiteSpec({
          columns: [{ name: "TenantId", type: "String" }],
          datasetName: DATASET,
        });
        const tenantEncoding = objectOf(onlyTenant.encoding);
        expect(tenantEncoding.x).toEqual({
          field: "TenantId",
          type: "nominal",
        });
      });

      it("names only columns the result actually has", () => {
        for (const { columns } of COLUMN_SHAPES) {
          const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
          const named = JSON.stringify(spec).match(/"field":"([^"]+)"/g) ?? [];
          const available = columns.map((column) => column.name);

          for (const match of named) {
            const field = match.slice('"field":"'.length, -1);
            expect(available).toContain(field);
          }
        }
      });
    });

    describe("when it is rendered as the editor's initial text", () => {
      it("is formatted JSON that parses back to the same specification", () => {
        const columns = shapeNamed("a category and a number");
        const text = starterVegaLiteSpecText({ columns, datasetName: DATASET });

        expect(text).toContain("\n");
        expect(JSON.parse(text)).toEqual(starterVegaLiteSpec({ columns, datasetName: DATASET }));
      });
    });
  });

  describe("given a ClickHouse column type", () => {
    it("reads it as time, as a number, or as a category", () => {
      expect(starterEncodingType("DateTime64(3)")).toBe("temporal");
      expect(starterEncodingType("Nullable(Date)")).toBe("temporal");
      expect(starterEncodingType("UInt64")).toBe("quantitative");
      expect(starterEncodingType("Decimal(18, 4)")).toBe("quantitative");
      expect(starterEncodingType("LowCardinality(String)")).toBe("nominal");
      expect(starterEncodingType("Map(String, String)")).toBe("nominal");
    });
  });
});
