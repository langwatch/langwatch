import { describe, expect, it } from "vitest";
import {
  dashboardCreateInputSchema,
  graphLayoutSchema,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartPlacementSchema,
} from "../index";

describe("dashboard contract", () => {
  it("bounds dashboard names at the contract boundary", () => {
    expect(dashboardCreateInputSchema.safeParse({ projectId: "project_1", name: "" }).success).toBe(
      false,
    );
    expect(dashboardCreateInputSchema.parse({ projectId: "project_1", name: "Reports" })).toEqual({
      projectId: "project_1",
      name: "Reports",
    });
  });

  it("keeps graph layout values integer and within the persisted grid", () => {
    expect(
      graphLayoutSchema.safeParse({
        gridColumn: 2,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
      }).success,
    ).toBe(false);
  });

  it("requires the versioned saved-workbench definition shape", () => {
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
      }).success,
    ).toBe(true);
    expect(savedWorkbenchChartDefinitionSchema.safeParse({ sql: "SELECT 1" }).success).toBe(false);
  });

  /** @scenario "A saved definition carries the query, its parameter values and its specification" */
  it("carries the query, its parameter values and its specification through unchanged", () => {
    const vegaLiteSpec = {
      $schema: "https://vega.github.io/schema/vega-lite/v6.json",
      data: { name: "query_result" },
      mark: "bar",
    };

    expect(
      savedWorkbenchChartDefinitionSchema.parse({
        version: 1,
        sql: "SELECT count() AS value FROM analytics.traces",
        parameters: { since: "2026-02-01", limit: 10, exact: true },
        vegaLiteSpec,
      }),
    ).toEqual({
      version: 1,
      sql: "SELECT count() AS value FROM analytics.traces",
      parameters: { since: "2026-02-01", limit: 10, exact: true },
      vegaLiteSpec,
    });
  });

  /** @scenario "A chart saved without a hand-authored specification is the same record" */
  it("normalizes legacy definition and placement extensions by stripping them", () => {
    expect(
      savedWorkbenchChartDefinitionSchema.parse({
        version: 1,
        sql: "SELECT 1",
        legacyDefinitionField: "ignored",
      }),
    ).toEqual({ version: 1, sql: "SELECT 1", parameters: {} });
    expect(
      savedWorkbenchChartPlacementSchema.parse({
        dashboardId: "dashboard_1",
        legacyPlacementField: "ignored",
      }),
    ).toEqual({ dashboardId: "dashboard_1" });
  });

  /** @scenario "A parameter value that is not a scalar is refused" */
  it("preserves only scalar saved query parameters and defaults an omitted map", () => {
    const parsed = savedWorkbenchChartDefinitionSchema.parse({
      version: 1,
      sql: "SELECT 1",
      parameters: { text: "a", number: 1, flag: false, nothing: null },
    });
    expect(parsed.parameters).toEqual({ text: "a", number: 1, flag: false, nothing: null });
    expect(
      savedWorkbenchChartDefinitionSchema.parse({ version: 1, sql: "SELECT 1" }).parameters,
    ).toEqual({});
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: { unsupported: ["array"] },
      }).success,
    ).toBe(false);
  });

  /** @scenario "A definition written in an unknown version is refused rather than guessed at" */
  /** @scenario "A definition larger than the stored ceilings is refused" */
  it("refuses definitions outside the persisted SQL and parameter ceilings", () => {
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "x".repeat(50_001),
      }).success,
    ).toBe(false);
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 2,
        sql: "SELECT 1",
      }).success,
    ).toBe(false);
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`parameter_${index}`, index]),
        ),
      }).success,
    ).toBe(false);
  });

  /** @scenario "A definition larger than the stored ceilings is refused" */
  it("bounds every persisted parameter name and scalar value", () => {
    const atTheCeiling = savedWorkbenchChartDefinitionSchema.parse({
      version: 1,
      sql: "SELECT 1",
      parameters: Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [
          `parameter_${index.toString().padStart(3, "0")}`.padEnd(256, "x"),
          "v".repeat(4_000),
        ]),
      ),
    });
    expect(Object.keys(atTheCeiling.parameters)).toHaveLength(64);
    // Raised on the map rather than on the key schema: zod reports a key
    // refusal as `invalid_key`, and `flatten()` — what the boundary sends a
    // caller — turns that into "Invalid key in record", which names neither
    // the parameter nor the ceiling.
    const overLongName = savedWorkbenchChartDefinitionSchema.safeParse({
      version: 1,
      sql: "SELECT 1",
      parameters: { ["x".repeat(257)]: "value" },
    });
    expect(overLongName.success).toBe(false);
    expect(overLongName.error?.issues).toContainEqual(
      expect.objectContaining({
        code: "too_big",
        maximum: 256,
        path: ["parameters", "x".repeat(257)],
      }),
    );
    const overLongValue = savedWorkbenchChartDefinitionSchema.safeParse({
      version: 1,
      sql: "SELECT 1",
      parameters: { value: "x".repeat(4_001) },
    });
    expect(overLongValue.success).toBe(false);
    expect(overLongValue.error?.issues).toContainEqual(
      expect.objectContaining({
        code: "too_big",
        maximum: 4_000,
        path: ["parameters", "value"],
      }),
    );
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: { value: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
  });

  /** @scenario "Placing a chart requires a dashboard id and accepts an optional grid position" */
  it("requires a dashboard on a placement and leaves the grid position optional", () => {
    expect(savedWorkbenchChartPlacementSchema.safeParse({ gridRow: 2 }).success).toBe(false);
    expect(savedWorkbenchChartPlacementSchema.safeParse({ dashboardId: "" }).success).toBe(false);
    expect(savedWorkbenchChartPlacementSchema.parse({ dashboardId: "dashboard_1" })).toEqual({
      dashboardId: "dashboard_1",
    });
  });

  it("keeps saved-chart placement inside the two-column persisted grid", () => {
    expect(
      savedWorkbenchChartPlacementSchema.safeParse({
        dashboardId: "dashboard_1",
        gridColumn: 1,
        colSpan: 2,
      }).success,
    ).toBe(false);
    expect(
      savedWorkbenchChartPlacementSchema.parse({
        dashboardId: "dashboard_1",
        gridColumn: 0,
        gridRow: 2,
        colSpan: 2,
        rowSpan: 1,
      }),
    ).toMatchObject({ dashboardId: "dashboard_1", gridRow: 2 });
  });
});
