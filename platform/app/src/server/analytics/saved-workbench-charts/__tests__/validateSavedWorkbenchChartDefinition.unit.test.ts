/**
 * The save gate for a workbench chart: what a definition has to survive before
 * anything is allowed to store it.
 *
 * This is the function `presets.ts` wires as the dashboard feature's
 * `SavedWorkbenchChartPolicy`, and the one the tRPC transport calls with the
 * caller's own protections before the service is reached. Both governors run
 * here — the LangWatchQL validator over the SQL, and the chart policy over the
 * Vega-Lite specification — so this is where their refusals are pinned.
 *
 * That a refused definition never reaches storage is the service's half of the
 * contract, and lives with the service:
 * `packages/features/dashboard/server/src/services/__tests__/saved-workbench-chart.service.unit.test.ts`.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-web/validation";
import type { Protections } from "@langwatch/trace-server";
import { LangWatchQLService } from "../../lwql/lwql.service";
import { validateSavedWorkbenchChartDefinition } from "../savedWorkbenchChart.service";
import { WORKBENCH_CHART_DEFINITION_VERSION } from "../workbenchChartDefinition";

const PROJECT_ID = "project-under-test";

/** Everything visible: the author the gate is measured against. */
const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** No captured content — the shape a `restrict` privacy policy produces. */
const WITHOUT_CONTENT: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: true,
};

const PERMITTED_SQL =
  "SELECT count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

/** Reads a column gated on captured input. */
const CONTENT_SQL =
  "SELECT CapturedInput AS value FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-01 00:00:00', 3)";

const VALID_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};

/** Reads a dataset the workbench does not register. */
const UNREGISTERED_DATASET_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "somebody_elses_data" },
  mark: "bar",
};

/** Loads its data over the network — refused before it can reach Vega. */
const NETWORK_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: WORKBENCH_CHART_DEFINITION_VERSION,
    sql: PERMITTED_SQL,
    parameters: {},
    vegaLiteSpec: VALID_SPEC,
    ...overrides,
  };
}

/**
 * The real LangWatchQL service with no executor. Validation needs no database,
 * and a stubbed validator would prove only that the stub refuses.
 */
function validate(input: { protections?: Protections; definition: Record<string, unknown> }) {
  return validateSavedWorkbenchChartDefinition({
    projectId: PROJECT_ID,
    protections: input.protections ?? FULLY_PERMITTED,
    definition: input.definition,
    lwql: new LangWatchQLService({ executor: null, database: "analytics" }),
  });
}

async function refusalOf(run: () => unknown): Promise<{ code: unknown; meta: unknown }> {
  try {
    await run();
  } catch (error) {
    return {
      code: (error as { code?: unknown }).code,
      meta: (error as { meta?: unknown }).meta,
    };
  }
  throw new Error("expected the definition to be refused, but it was admitted");
}

describe("validateSavedWorkbenchChartDefinition", () => {
  describe("given a specification the chart policy refuses", () => {
    describe("when it names a dataset the workbench does not register", () => {
      /** @scenario "A specification the chart policy refuses never reaches the database" */
      it("refuses it and names what was wrong", async () => {
        const refusal = await refusalOf(() =>
          validate({ definition: definition({ vegaLiteSpec: UNREGISTERED_DATASET_SPEC }) }),
        );

        expect(refusal.code).toBe("saved_workbench_chart_specification_refused");
        // The editor needs to know *where*, not just that something was wrong.
        expect((refusal.meta as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
      });
    });

    describe("when it would load its data over the network", () => {
      /** @scenario "A specification the chart policy refuses never reaches the database" */
      it("refuses it before it can reach Vega", async () => {
        const refusal = await refusalOf(() =>
          validate({ definition: definition({ vegaLiteSpec: NETWORK_SPEC }) }),
        );

        expect(refusal.code).toBe("saved_workbench_chart_specification_refused");
      });
    });
  });

  describe("given SQL the LangWatchQL validator refuses", () => {
    describe("when the statement is a write dressed as a chart", () => {
      /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
      it("refuses it with the validator's own code", async () => {
        const refusal = await refusalOf(() =>
          validate({ definition: definition({ sql: "DROP TABLE analytics.traces" }) }),
        );

        expect(refusal.code).toBe("lwql_not_permitted");
      });
    });
  });

  describe("given SQL declaring a parameter the definition supplies no value for", () => {
    describe("when the definition carries no value for it", () => {
      /** @scenario "A query whose declared parameters have no saved values is refused at save" */
      it("refuses it and names the missing parameter", async () => {
        const refusal = await refusalOf(() =>
          validate({
            definition: definition({
              sql:
                "SELECT count() AS value FROM analytics.traces " +
                "WHERE OccurredAt >= {since:DateTime}",
              parameters: {},
            }),
          }),
        );

        expect(refusal.code).toBe("lwql_parameter_missing");
        expect((refusal.meta as { parameters?: unknown }).parameters).toEqual(["since"]);
      });
    });

    describe("when the value is saved alongside the query", () => {
      it("admits it", () => {
        expect(() =>
          validate({
            definition: definition({
              sql:
                "SELECT count() AS value FROM analytics.traces " +
                "WHERE OccurredAt >= {since:DateTime}",
              parameters: { since: "2026-02-01 00:00:00" },
            }),
          }),
        ).not.toThrow();
      });
    });
  });

  describe("given a member whose protections withhold a content-gated column", () => {
    describe("when their SQL names it", () => {
      /** @scenario "What the author may read decides what their saved SQL may name" */
      it("refuses with the same refusal the query endpoint gives them", async () => {
        const refusal = await refusalOf(() =>
          validate({ protections: WITHOUT_CONTENT, definition: definition({ sql: CONTENT_SQL }) }),
        );

        expect(refusal.code).toBe("lwql_not_permitted");
      });
    });

    describe("when an author whose protections do not withhold it names the same column", () => {
      it("admits the identical statement, so the refusal is about the permissions", () => {
        expect(() =>
          validate({ protections: FULLY_PERMITTED, definition: definition({ sql: CONTENT_SQL }) }),
        ).not.toThrow();
      });
    });
  });

  describe("given a definition that is not the shape a saved chart has", () => {
    describe("when a required field is missing", () => {
      it("refuses it as invalid input", async () => {
        const refusal = await refusalOf(() => validate({ definition: { sql: PERMITTED_SQL } }));

        expect(refusal.code).toBe("validation_error");
      });
    });
  });

  describe("given a definition both governors accept", () => {
    describe("when it carries a query, its parameters and a specification", () => {
      it("returns the parsed definition rather than the input object", () => {
        const parsed = validate({ definition: definition() });

        expect(parsed.sql).toBe(PERMITTED_SQL);
        expect(parsed.vegaLiteSpec).toEqual(VALID_SPEC);
      });
    });

    describe("when it carries no specification", () => {
      it("admits the query on its own", () => {
        const parsed = validate({
          definition: { version: WORKBENCH_CHART_DEFINITION_VERSION, sql: PERMITTED_SQL },
        });

        expect(parsed.vegaLiteSpec).toBeUndefined();
      });
    });
  });
});
