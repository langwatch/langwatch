import {
  ch,
  createRowCodec,
  defineTable,
  replacing,
  TableDefinitionError,
} from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import {
  experimentRunItemsColumnNames,
  experimentRunItemsColumns,
  experimentRunItemsWireColumns,
} from "./itemsTable";

describe("experiment_run_items' wire columns", () => {
  it("declares every physical column exactly once, in a stable order", () => {
    expect(experimentRunItemsColumnNames).toContain("ProjectionId");
    expect(experimentRunItemsColumnNames).toContain("OccurredAt");
    expect(new Set(experimentRunItemsColumnNames).size).toBe(
      experimentRunItemsColumnNames.length,
    );
  });

  it("round-trips a row through the shared codec", () => {
    const codec = createRowCodec();
    const row = {
      ProjectionId: "proj-1",
      TenantId: "tenant-1",
      RunId: "run-1",
      ExperimentId: "exp-1",
      RowIndex: 2,
      TargetId: "t1",
      ResultType: "target",
      DatasetEntry: "{}",
      Predicted: null,
      TargetCost: 0.5,
      TargetDurationMs: 120,
      TargetError: null,
      TargetDomainError: null,
      TraceId: null,
      EvaluatorId: null,
      EvaluatorName: null,
      EvaluationStatus: "",
      Score: null,
      Label: null,
      Passed: null,
      EvaluationDetails: null,
      EvaluationCost: null,
      EvaluationInputs: null,
      EvaluationDurationMs: null,
      CreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      OccurredAt: new Date("2026-01-01T00:00:01.500Z"),
      _retention_days: 49,
    };

    const [encoded] = codec.encodeRows({
      columns: experimentRunItemsWireColumns,
      columnNames: experimentRunItemsColumnNames,
      rows: [row],
    });
    const [decoded] = codec.decodeRows<typeof row>({
      columns: experimentRunItemsWireColumns,
      columnNames: experimentRunItemsColumnNames,
      header: undefined,
      rows: [encoded!],
    });

    expect(decoded).toEqual(row);
  });

  describe("why this table bypasses defineTable — proven, not just asserted", () => {
    it("defineTable refuses OccurredAt as the replacing version column (wrong timeRole)", () => {
      expect(() =>
        defineTable({
          name: "experiment_run_items_hypothetical",
          merge: replacing({ version: "OccurredAt" }),
          sortKey: ["TenantId", "RunId", "ProjectionId"],
          partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
          tenant: ["TenantId"],
          columns: {
            TenantId: ch.string(),
            RunId: ch.string(),
            ProjectionId: ch.string(),
            OccurredAt: ch.occurredAt(),
          },
        }),
      ).toThrow(TableDefinitionError);
    });

    it("defineTable also refuses OccurredAt as the partition column (not frozen/platform-controlled)", () => {
      expect(() =>
        defineTable({
          name: "experiment_run_items_hypothetical_2",
          merge: replacing({ version: "WrittenAt" }),
          sortKey: ["TenantId", "RunId", "ProjectionId"],
          partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
          tenant: ["TenantId"],
          columns: {
            TenantId: ch.string(),
            RunId: ch.string(),
            ProjectionId: ch.string(),
            OccurredAt: ch.occurredAt(),
            WrittenAt: ch.writtenAt(),
          },
        }),
      ).toThrow(TableDefinitionError);
    });
  });
});
