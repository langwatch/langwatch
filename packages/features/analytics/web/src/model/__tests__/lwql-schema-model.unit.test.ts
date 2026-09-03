/**
 * The schema response is the whole of what the workbench knows.
 *
 * The load-bearing assertion is the negative one: fed an empty response the
 * mapping offers nothing at all. A hard-coded dataset, column or physical table
 * anywhere in the frontend would survive that and show up here.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import {
  filterLangWatchQLSchemaModel,
  lwqlCompletionItems,
  lwqlHoverFor,
  lwqlSchemaModel,
} from "../lwql-schema-model";

import {
  SCHEMA_AVAILABLE_COLUMN_NAMES,
  SCHEMA_COLUMN_NAMES,
  SCHEMA_DATASET_NAMES,
  SCHEMA_RESPONSE,
} from "../../__tests__/lwql-fixtures";

describe("mapping the LangWatchQL schema response", () => {
  describe("given a response with datasets, columns, types, units and documentation", () => {
    describe("when it is mapped for the browser and the editor", () => {
      /** @scenario "Schema documentation and completion use the live response" */
      it("carries every dataset and column from the response and invents none", () => {
        const model = lwqlSchemaModel(SCHEMA_RESPONSE);

        expect(model.database).toBe(SCHEMA_RESPONSE.database);
        expect(model.datasets.map((dataset) => dataset.name)).toEqual(SCHEMA_DATASET_NAMES);
        expect(
          model.datasets.flatMap((dataset) => dataset.columns.map((column) => column.name)),
        ).toEqual(SCHEMA_COLUMN_NAMES);

        const first = model.datasets[0]!;
        const source = SCHEMA_RESPONSE.datasets[0]!;
        expect(first.description).toBe(source.description);
        expect(first.grain).toBe(source.grain);
        expect(first.freshness).toBe(source.freshness);
        expect(first.timeColumn).toBe(source.timeColumn);
        expect(first.joinKeys).toEqual(source.joinKeys);
        expect(first.exampleSql).toBe(source.exampleSql);
        expect(first.columns[1]).toEqual({
          name: "latency_ms",
          type: "Float64",
          description: "End to end latency of the trace.",
          unit: "ms",
          gates: [],
          available: true,
          qualifiedName: "analytics.traces_daily.latency_ms",
        });
      });

      /** @scenario "Schema documentation and completion use the live response" */
      it("offers nothing at all for a response that carries nothing", () => {
        const model = lwqlSchemaModel({
          database: "analytics",
          datasets: [],
        });

        expect(model.datasets).toEqual([]);
        expect(lwqlCompletionItems(model)).toEqual([]);
        expect(lwqlHoverFor({ model, identifier: "analytics.traces_daily" })).toBeUndefined();
      });

      /** @scenario "Schema documentation and completion use the live response" */
      it("suggests only names the response carried, and no withheld column", () => {
        const model = lwqlSchemaModel(SCHEMA_RESPONSE);
        const items = lwqlCompletionItems(model);

        const fromResponse = new Set([...SCHEMA_DATASET_NAMES, ...SCHEMA_AVAILABLE_COLUMN_NAMES]);
        expect(items.map((item) => item.label).sort()).toEqual([...fromResponse].sort());
        expect(items.map((item) => item.label)).not.toContain("total_cost");
        expect(items.find((item) => item.label === "latency_ms")?.detail).toBe("Float64");
      });
    });
  });

  describe("given a member hovering an identifier", () => {
    describe("when the schema names it", () => {
      it("answers from the response and stays silent about withheld columns", () => {
        const model = lwqlSchemaModel(SCHEMA_RESPONSE);

        expect(lwqlHoverFor({ model, identifier: "latency_ms" })).toEqual({
          title: "analytics.traces_daily.latency_ms",
          detail: "Float64",
          documentation: "End to end latency of the trace. Measured in ms.",
        });
        expect(lwqlHoverFor({ model, identifier: "total_cost" })).toBeUndefined();
        expect(lwqlHoverFor({ model, identifier: "traces_daily" })?.title).toBe(
          "analytics.traces_daily",
        );
      });
    });
  });

  describe("given a search term", () => {
    describe("when the schema is narrowed", () => {
      it("keeps a matching dataset whole and trims a dataset matched through a column", () => {
        const model = lwqlSchemaModel(SCHEMA_RESPONSE);

        const byDataset = filterLangWatchQLSchemaModel({
          model,
          search: "evaluations",
        });
        expect(byDataset.datasets.map((dataset) => dataset.name)).toEqual([
          "analytics.evaluations_daily",
        ]);
        expect(byDataset.datasets[0]!.columns).toHaveLength(2);

        const byColumn = filterLangWatchQLSchemaModel({
          model,
          search: "latency",
        });
        expect(byColumn.datasets.map((dataset) => dataset.name)).toEqual([
          "analytics.traces_daily",
        ]);
        expect(byColumn.datasets[0]!.columns.map((column) => column.name)).toEqual(["latency_ms"]);

        expect(filterLangWatchQLSchemaModel({ model, search: "   " }).datasets).toHaveLength(2);
      });
    });
  });
});
