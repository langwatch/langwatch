import { createRowCodec } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { mapTargetResult } from "./itemsMapping";
import {
  type ExperimentRunItemsRow,
  experimentRunItemsTable,
  experimentRunsTable,
} from "./table";

describe("experimentRunsTable", () => {
  it("declares the deployed engine key, version and partition", () => {
    expect(experimentRunsTable.merge).toEqual({
      kind: "replacing",
      version: "UpdatedAt",
    });
    expect(experimentRunsTable.sortKey).toEqual([
      "TenantId",
      "RunId",
      "ExperimentId",
    ]);
    expect(experimentRunsTable.partition).toEqual({
      by: "toYearWeek(StartedAt)",
      column: "StartedAt",
    });
  });

  it("declares no delivery-sequence column", () => {
    expect(experimentRunsTable.columnNames).not.toContain("DeliverySeq");
  });

  it("does not declare any of the eleven counter columns ADR-103 retires", () => {
    for (const column of [
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
    ]) {
      expect(experimentRunsTable.columnNames).not.toContain(column);
    }
  });
});

describe("experimentRunItemsTable", () => {
  it("ends its sort key on the item's deterministic identity", () => {
    expect(experimentRunItemsTable.sortKey).toEqual([
      "TenantId",
      "RunId",
      "ProjectionId",
    ]);
  });

  it("round-trips a mapped item row through the shared wire codec", () => {
    const codec = createRowCodec();
    const columns = experimentRunItemsTable.columnNames.map(
      (name) => experimentRunItemsTable.columns[name],
    );
    const row: ExperimentRunItemsRow = {
      ...mapTargetResult({
        runId: "run-1",
        experimentId: "exp-1",
        index: 2,
        targetId: "t1",
        entry: { question: "why" },
        cost: 0.5,
        duration: 120,
        occurredAt: Date.parse("2026-01-01T00:00:01.500Z"),
      }),
      ProjectionId: "proj-1",
      TenantId: "tenant-1",
      CreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      _retention_days: 49,
    };

    const [encoded] = codec.encodeRows({
      columns,
      columnNames: experimentRunItemsTable.columnNames,
      rows: [row],
    });
    const [decoded] = codec.decodeRows<ExperimentRunItemsRow>({
      columns,
      columnNames: experimentRunItemsTable.columnNames,
      header: undefined,
      rows: [encoded!],
    });

    expect(decoded).toEqual(row);
  });
});
