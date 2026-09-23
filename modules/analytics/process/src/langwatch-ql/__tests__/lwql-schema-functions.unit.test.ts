/**
 * The function allowlist is published on the schema, permission-independent.
 * @see specs/lwql/api.feature
 */

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LWQL_ALLOWED_FUNCTION_NAMES } from "../../rules/langwatch-ql-functions.rules.ts";
import { LWQL_POSTGRES_CATALOG } from "../../rules/lwql-postgres-view-catalog.rules.ts";
import { LangWatchQLSchemaService } from "../../services/langwatch-ql-schema.service.ts";

const FULLY_PERMITTED: LangWatchQLProtections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

describe("LangWatchQLSchemaService.describe", () => {
  describe("given the catalog and a caller's protections", () => {
    /** @scenario "The schema endpoint publishes the allowed function names" */
    it("publishes functions as a sorted array equal to the validator's allowlist", () => {
      const schema = LangWatchQLSchemaService.create().describe({
        database: "analytics",
        protections: FULLY_PERMITTED,
      });

      expect(schema.functions).toEqual(LWQL_ALLOWED_FUNCTION_NAMES);
      expect(Object.keys(schema)).toEqual(["database", "functions", "views", "appFunctions"]);
    });

    it("publishes the same list whatever the caller can see", () => {
      const schema = LangWatchQLSchemaService.create().describe({
        database: "analytics",
        protections: {},
      });

      expect(schema.functions).toEqual(LWQL_ALLOWED_FUNCTION_NAMES);
    });
  });
});

describe("given the PostgreSQL-resident half of the catalog", () => {
  describe("when the schema is described", () => {
    /** @scenario "The self-describing catalog output names every derived view" */
    it("names every derived view with its columns", () => {
      const schema = LangWatchQLSchemaService.create().describe({
        database: "analytics",
        protections: FULLY_PERMITTED,
      });
      const byName = new Map(schema.views.map((view) => [view.name, view]));
      const columnNamesOf = (view: string) =>
        byName.get(`analytics.${view}`)?.columns.map((column) => column.name) ?? [];

      expect(LWQL_POSTGRES_CATALOG.length).toBeGreaterThan(0);
      for (const view of LWQL_POSTGRES_CATALOG) {
        expect(byName.has(`analytics.${view.name}`), view.name).toBe(true);
      }
      expect(columnNamesOf("topics")).toEqual(
        expect.arrayContaining(["TopicId", "TopicName", "TenantId"]),
      );
      expect(columnNamesOf("virtual_keys")).toEqual(expect.arrayContaining(["TenantId"]));
    });
  });
});
