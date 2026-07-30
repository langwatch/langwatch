import { describe, expect, it } from "vitest";
import { experimentRunsTable } from "./table";

describe("experimentRunsTable", () => {
  it("declares UpdatedAt as the replacing version column, matching the deployed engine", () => {
    expect(experimentRunsTable.merge).toEqual({
      kind: "replacing",
      version: "UpdatedAt",
    });
  });

  it("partitions on StartedAt, matching the deployed DDL", () => {
    expect(experimentRunsTable.partition).toEqual({
      by: "toYearWeek(StartedAt)",
      column: "StartedAt",
    });
  });

  it("sorts on the deployed key (TenantId, RunId, ExperimentId)", () => {
    expect(experimentRunsTable.sortKey).toEqual([
      "TenantId",
      "RunId",
      "ExperimentId",
    ]);
  });

  it("does not declare any of the eleven counter columns ADR-103 decision 1 retires", () => {
    const retired = [
      "Progress",
      "CompletedCount",
      "FailedCount",
      "TotalCost",
      "TotalDurationMs",
      "AvgScoreBps",
      "PassRateBps",
      "TotalScoreSum",
      "ScoreCount",
      "PassedCount",
      "GradedCount",
    ];
    for (const column of retired) {
      expect(experimentRunsTable.columnNames).not.toContain(column);
    }
  });
});
