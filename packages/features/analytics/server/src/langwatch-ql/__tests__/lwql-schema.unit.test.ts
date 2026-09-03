/**
 * What the schema-discovery endpoint publishes.
 *
 * Two claims carry the file. First, a withheld column says *which* permission
 * withholds it rather than collapsing to a boolean — the decision this slice
 * settled, and the difference between an agent that knows what to ask for and
 * one that only knows it was refused. Second, the published `available` flag
 * and the validator's answer are the same answer: a schema that advertised a
 * column the validator then refused would send every caller down a dead end,
 * and that is the one inconsistency this endpoint must not have.
 *
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import type { Protections } from "@langwatch/trace-server";
import { LWQL_VIEW_CATALOG } from "../catalog/lwql-views";
import { lwqlAllowedTables, lwqlGatedColumns } from "../catalog/types";
import { describeLangWatchQLSchema } from "../schema";
import { validateLangWatchQL } from "../validation/validate";
import { GATED_DATASET, GATED_DATASET_QUALIFIED_NAME } from "./gatedDatasetFixture";

const DATABASE = "analytics";

const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

const WITHOUT_CONTENT: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: true,
};

const WITHOUT_ANYTHING: Protections = {};

function schemaFor(protections: Protections) {
  return describeLangWatchQLSchema({ database: DATABASE, protections });
}

function columnsOf(protections: Protections) {
  return schemaFor(protections).datasets.flatMap((dataset) =>
    dataset.columns.map((column) => ({ dataset: dataset.name, ...column })),
  );
}

function policyFor(protections: Protections) {
  return {
    allowedTables: lwqlAllowedTables({
      database: DATABASE,
      views: LWQL_VIEW_CATALOG,
    }),
    gatedColumns: lwqlGatedColumns({
      protections,
      views: LWQL_VIEW_CATALOG,
    }),
    defaultDatabase: DATABASE,
  };
}

describe("given the LangWatchQL schema catalog", () => {
  describe("when it is published for a caller", () => {
    it("names every dataset, qualified with the LangWatchQL database", () => {
      expect(schemaFor(FULLY_PERMITTED).datasets.map((d) => d.name)).toEqual(
        LWQL_VIEW_CATALOG.map((view) => `${DATABASE}.${view.name}`),
      );
    });

    it("carries the grain, join keys, partition-pruning column and freshness of each dataset", () => {
      for (const dataset of schemaFor(FULLY_PERMITTED).datasets) {
        expect(dataset.grain, dataset.name).not.toBe("");
        expect(dataset.joinKeys.length, dataset.name).toBeGreaterThan(0);
        expect(dataset.timeColumn, dataset.name).not.toBe("");
        expect(dataset.freshness, dataset.name).not.toBe("");
        expect(dataset.description, dataset.name).not.toBe("");
      }
    });

    it("gives every column a type and a description", () => {
      for (const column of columnsOf(FULLY_PERMITTED)) {
        expect(column.type, `${column.dataset}.${column.name}`).not.toBe("");
        expect(column.description, `${column.dataset}.${column.name}`).not.toBe("");
      }
    });

    /**
     * `null` rather than an absent key, because a consumer has to be able to
     * tell "this column has no unit" from "this response predates units".
     */
    it("answers the unit question for every column, including with no", () => {
      const columns = columnsOf(FULLY_PERMITTED);
      for (const column of columns) {
        expect(
          Object.hasOwn(column, "unit"),
          `${column.dataset}.${column.name} does not answer the unit question`,
        ).toBe(true);
      }
      expect(
        columns.filter((column) => column.unit === null).length,
        "every column carries a unit — the null case is untested",
      ).toBeGreaterThan(0);
    });

    it("publishes the unit of a measured column", () => {
      const byName = new Map(
        columnsOf(FULLY_PERMITTED).map((column) => [`${column.dataset}.${column.name}`, column]),
      );
      expect(byName.get("analytics.traces.TotalDurationMs")!.unit).toBe("ms");
      expect(byName.get("analytics.traces.TotalCost")!.unit).toBe("USD");
      expect(byName.get("analytics.traces.TotalPromptTokenCount")!.unit).toBe("tokens");
      expect(byName.get("analytics.spans.Cost")!.unit).toBe("USD");
      // An identifier measures nothing, and says so.
      expect(byName.get("analytics.traces.TraceId")!.unit).toBeNull();
    });
  });

  describe("when a column is withheld from the caller", () => {
    /** @scenario "The schema endpoint names which permission unlocks each gated column" */
    it("names the permission kinds that unlock it rather than a bare refusal", () => {
      const withheld = columnsOf(WITHOUT_CONTENT).filter((column) => !column.available);
      expect(
        withheld.length,
        "no column is withheld from a caller with no content permission — the claim below is vacuous",
      ).toBeGreaterThan(0);
      for (const column of withheld) {
        expect(
          column.gates.length,
          `${column.dataset}.${column.name} is withheld but names no permission`,
        ).toBeGreaterThan(0);
      }

      const byName = new Map(
        columnsOf(WITHOUT_CONTENT).map((column) => [`${column.dataset}.${column.name}`, column]),
      );
      // The three gate kinds, each read off a column the catalog declares it
      // for, so a collapsed boolean could not pass this.
      expect(byName.get("analytics.traces.CapturedInput")!.gates).toEqual(["input"]);
      expect(byName.get("analytics.traces.CapturedOutput")!.gates).toEqual(["output"]);
      expect(byName.get("analytics.traces.TotalCost")!.gates).toEqual(["costs"]);
      // A column that needs two permissions says both.
      expect(byName.get("analytics.simulations.MessageContents")!.gates).toEqual([
        "input",
        "output",
      ]);
    });

    /** @scenario "The schema endpoint names which permission unlocks each gated column" */
    it("still lists it, because the gate is what makes the refusal actionable", () => {
      expect(columnsOf(WITHOUT_CONTENT).map((column) => column.name)).toEqual(
        columnsOf(FULLY_PERMITTED).map((column) => column.name),
      );
    });

    it("marks a costs column available for a caller who holds only that permission", () => {
      const costs = columnsOf(WITHOUT_CONTENT).filter((column) => column.gates.includes("costs"));
      expect(costs.length).toBeGreaterThan(0);
      for (const column of costs) {
        expect(column.available, `${column.dataset}.${column.name}`).toBe(true);
      }
    });

    it("withholds every gated column when permissions are unresolved", () => {
      const gated = columnsOf(WITHOUT_ANYTHING).filter((column) => column.gates.length > 0);
      expect(gated.length).toBeGreaterThan(0);
      for (const column of gated) {
        expect(column.available, `${column.dataset}.${column.name}`).toBe(false);
      }
    });

    it("withholds nothing from a fully-permitted caller", () => {
      expect(
        columnsOf(FULLY_PERMITTED)
          .filter((column) => !column.available)
          .map((column) => `${column.dataset}.${column.name}`),
      ).toEqual([]);
    });
  });

  describe("when the published availability is checked against the validator", () => {
    /**
     * The consistency claim, run over every column of every dataset for three
     * permission shapes: the endpoint and the gate must never disagree about a
     * single column, in either direction.
     */
    it("accepts exactly the columns it advertises, and refuses exactly the rest", () => {
      for (const protections of [FULLY_PERMITTED, WITHOUT_CONTENT, WITHOUT_ANYTHING]) {
        const policy = policyFor(protections);
        for (const column of columnsOf(protections)) {
          const result = validateLangWatchQL({
            sql: `SELECT ${column.name} FROM ${column.dataset}`,
            ...policy,
          });
          expect(
            result.ok,
            `${column.dataset}.${column.name}: published available=${column.available}, validator said ok=${result.ok}`,
          ).toBe(column.available);
        }
      }
    });
  });

  describe("when a dataset's example query is read", () => {
    /**
     * An example a caller cannot run teaches them the wrong thing about the
     * API, so it is checked against the gate for the most restricted caller
     * there is — not against the one it was generated for.
     */
    it("is valid LangWatchQL for a caller with no permissions at all", () => {
      const policy = policyFor(WITHOUT_ANYTHING);
      for (const dataset of schemaFor(WITHOUT_ANYTHING).datasets) {
        const result = validateLangWatchQL({
          sql: dataset.exampleSql,
          ...policy,
        });
        expect(
          result.ok ? [] : result.violations,
          `${dataset.name}'s example query is refused by the gate`,
        ).toEqual([]);
      }
    });

    it("filters on the column that prunes the dataset's partitions", () => {
      for (const dataset of schemaFor(FULLY_PERMITTED).datasets) {
        expect(dataset.exampleSql, dataset.name).toContain(`WHERE ${dataset.timeColumn} >=`);
      }
    });

    /**
     * The server pins every query to one tenant, so `TenantId` is a single
     * repeated value — an example selecting it teaches a member to select a
     * constant. The column stays published and selectable; only the example
     * skips it.
     */
    it("never puts the tenant scope column in its projection", () => {
      for (const dataset of schemaFor(FULLY_PERMITTED).datasets) {
        const projection = /select\s+([\s\S]*?)\s+from\b/i.exec(dataset.exampleSql)?.[1];
        expect(projection, `${dataset.name}: no SELECT ... FROM found`).toBeDefined();
        expect(projection, dataset.name).not.toContain("TenantId");
      }
    });
  });

  /**
   * A dataset a caller may read nothing in. Exercised on the shared fixture
   * (`./gatedDatasetFixture`), because no shipped dataset is gated as a whole —
   * the catalog suite pins that — and a case written against the shipped
   * catalog would be asserting that nothing happens. The code under test is the
   * endpoint's, and it is the same code.
   */
  describe("when a dataset is outside the caller's permissions", () => {
    const views = [...LWQL_VIEW_CATALOG, GATED_DATASET];
    const schemaWith = (protections: Protections) =>
      describeLangWatchQLSchema({ database: DATABASE, protections, views });

    it("leaves it out of the published schema entirely", () => {
      expect(schemaWith(WITHOUT_CONTENT).datasets.map((dataset) => dataset.name)).not.toContain(
        GATED_DATASET_QUALIFIED_NAME,
      );
    });

    it("publishes it to a caller who holds the permission, so absence is about the permission", () => {
      expect(schemaWith(FULLY_PERMITTED).datasets.map((dataset) => dataset.name)).toContain(
        GATED_DATASET_QUALIFIED_NAME,
      );
    });

    it("keeps every other dataset, rather than hiding the schema", () => {
      expect(schemaWith(WITHOUT_CONTENT).datasets.map((dataset) => dataset.name)).toEqual(
        LWQL_VIEW_CATALOG.map((view) => `${DATABASE}.${view.name}`),
      );
    });

    it("names the dataset's permission on each of its columns", () => {
      const dataset = schemaWith(FULLY_PERMITTED).datasets.find(
        (candidate) => candidate.name === GATED_DATASET_QUALIFIED_NAME,
      )!;
      expect(dataset.columns.map((column) => column.gates)).toEqual([
        ["input"],
        ["input"],
        ["input", "output"],
      ]);
    });

    /**
     * The example is generated from columns' own gates, not the combined
     * dataset-plus-column ones — combined, a whole-gated dataset has no
     * ungated column and the example degenerates to `SELECT ` with nothing
     * to select, published as "a runnable query over this dataset".
     */
    it("publishes a runnable example for the gated dataset", () => {
      const dataset = schemaWith(FULLY_PERMITTED).datasets.find(
        (candidate) => candidate.name === GATED_DATASET_QUALIFIED_NAME,
      )!;
      const result = validateLangWatchQL({
        sql: dataset.exampleSql,
        allowedTables: lwqlAllowedTables({ database: DATABASE, views }),
        gatedColumns: lwqlGatedColumns({
          protections: FULLY_PERMITTED,
          views,
        }),
        defaultDatabase: DATABASE,
      });
      expect(
        result.ok ? [] : result.violations,
        `${dataset.name}'s example query is refused by the gate`,
      ).toEqual([]);
    });

    /**
     * The half that keeps the endpoint and the gate agreeing. A dataset the
     * endpoint hides must not be quietly readable, and every column of it being
     * withheld is what makes that true without a second mechanism.
     */
    it("refuses every column of the hidden dataset at the gate", () => {
      const policy = {
        allowedTables: lwqlAllowedTables({ database: DATABASE, views }),
        gatedColumns: lwqlGatedColumns({
          protections: WITHOUT_CONTENT,
          views,
        }),
        defaultDatabase: DATABASE,
      };
      for (const column of GATED_DATASET.columns) {
        const result = validateLangWatchQL({
          sql: `SELECT ${column.name} FROM ${GATED_DATASET_QUALIFIED_NAME}`,
          ...policy,
        });
        expect(result.ok, `${column.name} was readable in a hidden dataset`).toBe(false);
      }
    });
  });
});
