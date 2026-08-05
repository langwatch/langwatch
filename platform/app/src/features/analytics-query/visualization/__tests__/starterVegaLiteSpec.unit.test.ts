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
} from "../starterVegaLiteSpec";
import { validateVegaLiteSpec } from "../validateVegaLiteSpec";
import type {
  DatasetRowCounts,
  GovernedDatasetColumn,
} from "../visualization.types";

const DATASET = "query_result";
const ROWS: DatasetRowCounts = { [DATASET]: 12 };

const COLUMN_SHAPES: readonly {
  name: string;
  columns: readonly GovernedDatasetColumn[];
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

const validate = (spec: unknown, columns: readonly GovernedDatasetColumn[]) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: { [DATASET]: columns },
    rowCountsByDataset: ROWS,
  });

describe("the starting chart specification", () => {
  describe("given the columns a governed result returned", () => {
    describe("when a starter is built for each shape of result", () => {
      it("produces one the governed validator accepts, every time", () => {
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
        const columns = COLUMN_SHAPES[1]!.columns;
        const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
        const encoding = spec.encoding as Record<string, any>;

        expect(spec.mark).toEqual({ type: "line", point: true });
        expect(encoding.x).toEqual({ field: "bucket", type: "temporal" });
        expect(encoding.y).toEqual({ field: "latency", type: "quantitative" });
      });

      it("counts rows when the result has nothing to measure", () => {
        const columns = COLUMN_SHAPES[2]!.columns;
        const spec = starterVegaLiteSpec({ columns, datasetName: DATASET });
        const encoding = spec.encoding as Record<string, any>;

        expect(spec.mark).toBe("bar");
        expect(encoding.x).toEqual({ field: "model", type: "nominal" });
        expect(encoding.y).toEqual({
          aggregate: "count",
          type: "quantitative",
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
        const columns = COLUMN_SHAPES[0]!.columns;
        const text = starterVegaLiteSpecText({ columns, datasetName: DATASET });

        expect(text).toContain("\n");
        expect(JSON.parse(text)).toEqual(
          starterVegaLiteSpec({ columns, datasetName: DATASET }),
        );
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
