import { describe, expect, it } from "vitest";
import {
  dashboardCreateInputSchema,
  graphLayoutSchema,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartPlacementSchema,
} from "../src";

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
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: { ["x".repeat(257)]: "value" },
      }).success,
    ).toBe(false);
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: { value: "x".repeat(4_001) },
      }).success,
    ).toBe(false);
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({
        version: 1,
        sql: "SELECT 1",
        parameters: { value: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
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
