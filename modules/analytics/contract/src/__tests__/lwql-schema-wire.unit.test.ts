import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { langWatchQLSchema, lwqlSchemaSchema, queryReferenceLangWatchQLSchema } from "../index.ts";

const VIEW = {
  name: "analytics.traces",
  description: "One row per trace.",
  grain: "one row per trace",
  joinKeys: ["TraceId"],
  timeColumn: null,
  freshness: "seconds",
  columns: [],
  exampleSql: "SELECT TraceId FROM analytics.traces LIMIT 100",
};

const SCHEMA = {
  database: "analytics",
  functions: ["count", "sum"],
  views: [VIEW],
  appFunctions: [],
};

describe("the LangWatchQL schema wire", () => {
  describe("given the shape the SDK CLI, the MCP server and the OpenAPI document read", () => {
    it("publishes database, functions, views and appFunctions, in that order", () => {
      expect(Object.keys(langWatchQLSchema.shape)).toEqual([
        "database",
        "functions",
        "views",
        "appFunctions",
      ]);
      expect(Object.keys(langWatchQLSchema.parse(SCHEMA))).toEqual([
        "database",
        "functions",
        "views",
        "appFunctions",
      ]);
    });

    it("serves the same shape from the schema door and the reference door", () => {
      expect(lwqlSchemaSchema).toBe(langWatchQLSchema);
      expect(queryReferenceLangWatchQLSchema.shape.schema).toBe(langWatchQLSchema);
    });

    it("accepts a view with no time column", () => {
      expect(langWatchQLSchema.parse(SCHEMA).views[0]!.timeColumn).toBeNull();
    });
  });

  describe("given the retired datasets spelling", () => {
    it("refuses it rather than serving a second shape", () => {
      const { views, ...rest } = SCHEMA;

      expect(() => langWatchQLSchema.parse({ ...rest, datasets: views })).toThrow(ZodError);
    });
  });
});
