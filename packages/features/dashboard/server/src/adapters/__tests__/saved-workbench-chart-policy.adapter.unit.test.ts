/**
 * The save gate for a workbench chart: what a definition has to survive before
 * anything is allowed to store it.
 *
 * This is the object `presets.ts` wires as the Dashboard feature's
 * `SavedWorkbenchChartPolicy`, and the one `root.ts` calls through `admit`
 * with the caller's own protections before the packaged service is reached.
 * Both governors run here — the LangWatchQL validator over the SQL, and the
 * Vega-Lite policy over the specification — so this is where their refusals
 * are pinned.
 *
 * That a refused definition never reaches storage is the service's half of the
 * contract, and lives with the service:
 * `packages/features/dashboard/server/src/services/__tests__/saved-workbench-chart.service.unit.test.ts`.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-contract/visualization/validation";
import { SavedWorkbenchChartAlreadyExistsError } from "@langwatch/dashboard-contract";
import {
  AnalyticsSavedWorkbenchChartPolicy,
  mapDashboardSavedWorkbenchChartError,
} from "../saved-workbench-chart-policy.adapter";
import { LangWatchQLService } from "@langwatch/analytics-server";

const PROJECT_ID = "project_1";

const permittedDefinition = {
  version: 1 as const,
  sql: "SELECT count() AS value FROM analytics.traces",
  parameters: {},
};

/** Reads a column gated on captured input. */
const CONTENT_SQL = "SELECT CapturedInput AS value FROM analytics.traces";

/** Everything visible: the author the gate is measured against. */
const FULLY_PERMITTED = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** No captured content — the shape a `restrict` privacy policy produces. */
const WITHOUT_CONTENT = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  canSeeCosts: true,
};

/**
 * The real LangWatchQL service with no executor. Validation needs no database,
 * and a stubbed validator would prove only that the stub refuses.
 */
function policy(): AnalyticsSavedWorkbenchChartPolicy {
  return AnalyticsSavedWorkbenchChartPolicy.create({
    langWatchQL: new LangWatchQLService({ executor: null, database: "analytics" }),
  });
}

function refusalOf(run: () => unknown): { code: unknown; meta: unknown } {
  try {
    run();
  } catch (error) {
    return {
      code: (error as { code?: unknown }).code,
      meta: (error as { meta?: unknown }).meta,
    };
  }
  throw new Error("expected the definition to be refused, but it was admitted");
}

describe("AnalyticsSavedWorkbenchChartPolicy", () => {
  it("admits a definition the current caller may execute", () => {
    expect(() =>
      policy().validate({
        projectId: PROJECT_ID,
        protections: { canSeeCosts: true },
        definition: permittedDefinition,
      }),
    ).not.toThrow();
  });

  describe("given SQL the LangWatchQL validator refuses", () => {
    /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
    /** @scenario "What the author may read decides what their saved SQL may name" */
    it("refuses SQL that names a column the current caller cannot read", () => {
      expect(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: { canSeeCapturedInput: false },
          definition: { ...permittedDefinition, sql: CONTENT_SQL },
        }),
      ).toThrowError(expect.objectContaining({ code: "lwql_not_permitted" }));
    });

    /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
    it("refuses a write dressed as a chart with the validator's own code", () => {
      expect(
        refusalOf(() =>
          policy().validate({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            definition: { ...permittedDefinition, sql: "DROP TABLE analytics.traces" },
          }),
        ).code,
      ).toBe("lwql_not_permitted");
    });

    /** @scenario "What the author may read decides what their saved SQL may name" */
    it("admits the identical statement for an author whose protections do not withhold it", () => {
      expect(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          definition: { ...permittedDefinition, sql: CONTENT_SQL },
        }),
      ).not.toThrow();
      expect(
        refusalOf(() =>
          policy().validate({
            projectId: PROJECT_ID,
            protections: WITHOUT_CONTENT,
            definition: { ...permittedDefinition, sql: CONTENT_SQL },
          }),
        ).code,
      ).toBe("lwql_not_permitted");
    });
  });

  describe("given SQL declaring a parameter the definition supplies no value for", () => {
    /** @scenario "A query whose declared parameters have no saved values is refused at save" */
    it("refuses it and names the missing parameter", () => {
      const refusal = refusalOf(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          definition: {
            ...permittedDefinition,
            sql:
              "SELECT count() AS value FROM analytics.traces " +
              "WHERE OccurredAt >= {since:DateTime}",
            parameters: {},
          },
        }),
      );

      expect(refusal.code).toBe("lwql_parameter_missing");
      expect((refusal.meta as { parameters?: unknown }).parameters).toEqual(["since"]);
    });

    /** @scenario "A query whose declared parameters have no saved values is refused at save" */
    it("admits it once the value is saved alongside the query", () => {
      expect(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          definition: {
            ...permittedDefinition,
            sql:
              "SELECT count() AS value FROM analytics.traces " +
              "WHERE OccurredAt >= {since:DateTime}",
            parameters: { since: "2026-02-01 00:00:00" },
          },
        }),
      ).not.toThrow();
    });
  });

  describe("given a specification the chart policy refuses", () => {
    /** @scenario "A specification the chart policy refuses never reaches the database" */
    it("refuses a network-loading Vega specification before persistence", () => {
      expect(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: { canSeeCosts: true },
          definition: {
            ...permittedDefinition,
            vegaLiteSpec: {
              $schema: VEGA_LITE_SCHEMA_URL,
              data: { url: "https://example.invalid/data.json" },
              mark: "bar",
            },
          },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "saved_workbench_chart_specification_refused" }),
      );
    });

    /** @scenario "A specification the chart policy refuses never reaches the database" */
    it("refuses a dataset the workbench does not register, and names what was wrong", () => {
      const refusal = refusalOf(() =>
        policy().validate({
          projectId: PROJECT_ID,
          protections: FULLY_PERMITTED,
          definition: {
            ...permittedDefinition,
            vegaLiteSpec: {
              $schema: VEGA_LITE_SCHEMA_URL,
              data: { name: "somebody_elses_data" },
              mark: "bar",
            },
          },
        }),
      );

      expect(refusal.code).toBe("saved_workbench_chart_specification_refused");
      // The editor needs to know *where*, not just that something was wrong.
      expect((refusal.meta as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
    });
  });

  describe("given a definition that has not been read yet", () => {
    /** @scenario "A saved definition carries the query, its parameter values and its specification" */
    it("returns the parsed definition rather than the caller's object", () => {
      const spec = {
        $schema: VEGA_LITE_SCHEMA_URL,
        data: { name: "query_result" },
        mark: "bar",
        encoding: { y: { field: "value", type: "quantitative" } },
      };

      const parsed = policy().admit({
        projectId: PROJECT_ID,
        protections: FULLY_PERMITTED,
        definition: {
          version: 1,
          sql: permittedDefinition.sql,
          parameters: { since: "2026-02-01", limit: 10, exact: true },
          vegaLiteSpec: spec,
          legacyField: "stripped",
        },
      });

      expect(parsed).toEqual({
        version: 1,
        sql: permittedDefinition.sql,
        parameters: { since: "2026-02-01", limit: 10, exact: true },
        vegaLiteSpec: spec,
      });
    });

    it("refuses a shape that is not a saved chart as invalid input", () => {
      expect(
        refusalOf(() =>
          policy().admit({
            projectId: PROJECT_ID,
            protections: FULLY_PERMITTED,
            definition: { sql: permittedDefinition.sql },
          }),
        ).code,
      ).toBe("validation_error");
    });

    it("puts the shape check before the governors, so a malformed body is not judged as SQL", () => {
      expect(
        refusalOf(() =>
          policy().admit({
            projectId: PROJECT_ID,
            protections: WITHOUT_CONTENT,
            definition: { version: 1, sql: CONTENT_SQL, parameters: { bad: ["array"] } },
          }),
        ).code,
      ).toBe("validation_error");
    });
  });

  it("maps a package duplicate onto the established 409 transport envelope", () => {
    expect(() =>
      mapDashboardSavedWorkbenchChartError(new SavedWorkbenchChartAlreadyExistsError()),
    ).toThrowError(
      expect.objectContaining({
        code: "saved_workbench_chart_already_exists",
        httpStatus: 409,
      }),
    );
  });
});
