import { describe, expect, it } from "vitest";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-web/validation";
import { SavedWorkbenchChartAlreadyExistsError } from "@langwatch/dashboard-contract";
import {
  AppSavedWorkbenchChartPolicy,
  mapDashboardSavedWorkbenchChartError,
} from "../dashboard-saved-workbench-chart-policy.adapter";
import { LangWatchQLService } from "~/server/analytics/lwql/lwql.service";

const permittedDefinition = {
  version: 1,
  sql: "SELECT count() AS value FROM analytics.traces",
  parameters: {},
};

function policy(): AppSavedWorkbenchChartPolicy {
  return AppSavedWorkbenchChartPolicy.create({
    langWatchQL: new LangWatchQLService({ executor: null, database: "analytics" }),
  });
}

describe("AppSavedWorkbenchChartPolicy", () => {
  it("admits a definition the current caller may execute", () => {
    expect(() =>
      policy().validate({
        projectId: "project_1",
        protections: { canSeeCosts: true },
        definition: permittedDefinition,
      }),
    ).not.toThrow();
  });

  /** @scenario "SQL the LangWatchQL validator refuses never reaches the database" */
  /** @scenario "What the author may read decides what their saved SQL may name" */
  it("refuses SQL that names a column the current caller cannot read", () => {
    expect(() =>
      policy().validate({
        projectId: "project_1",
        protections: { canSeeCapturedInput: false },
        definition: {
          ...permittedDefinition,
          sql: "SELECT CapturedInput FROM analytics.traces",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "lwql_not_permitted" }));
  });

  /** @scenario "A specification the chart policy refuses never reaches the database" */
  it("refuses a network-loading Vega specification before persistence", () => {
    expect(() =>
      policy().validate({
        projectId: "project_1",
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
