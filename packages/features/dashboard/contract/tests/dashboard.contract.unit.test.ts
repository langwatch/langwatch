import { describe, expect, it } from "vitest";
import {
  dashboardCreateInputSchema,
  graphLayoutSchema,
  savedWorkbenchChartDefinitionSchema,
} from "../src";

describe("dashboard contract", () => {
  it("bounds dashboard names at the contract boundary", () => {
    expect(
      dashboardCreateInputSchema.safeParse({ projectId: "project_1", name: "" }).success,
    ).toBe(false);
    expect(
      dashboardCreateInputSchema.parse({ projectId: "project_1", name: "Reports" }),
    ).toEqual({ projectId: "project_1", name: "Reports" });
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
    expect(
      savedWorkbenchChartDefinitionSchema.safeParse({ sql: "SELECT 1" }).success,
    ).toBe(false);
  });
});
