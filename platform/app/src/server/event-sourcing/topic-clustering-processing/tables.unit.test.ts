import { describe, expect, it } from "vitest";
import { initRunStatusState } from "./projections/runStatus";
import {
  foldStateRow,
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "./tables";

/**
 * None of these three tables is deployed — that is asserted against the
 * migration SQL in `../__tests__/tableMigrationParity.unit.test.ts`, which is
 * also where engine, key, anchor and column-type parity will be checked once
 * one is. What is worth pinning here is that the three share one shape,
 * because they come from one factory.
 */
describe("topic-clustering-processing ClickHouse table declarations", () => {
  const tables = [
    topicClusteringRunStatusTable,
    topicClusteringRunHistoryTable,
    topicModelTable,
  ] as const;

  it("gives all three the same shape, differing only in name", () => {
    const shapes = tables.map((table) =>
      JSON.stringify({ ...table.describe(), name: "" }),
    );
    expect(new Set(shapes).size).toBe(1);
    expect(new Set(tables.map((table) => table.name)).size).toBe(tables.length);
  });

  for (const table of tables) {
    it(`${table.name} declares no DeliverySeq column`, () => {
      expect(table.columnNames).not.toContain("DeliverySeq");
    });
  }
});

describe("foldStateRow", () => {
  it("round-trips a fold's whole state through the single State column", () => {
    const mapping = foldStateRow<ReturnType<typeof initRunStatusState>>();
    const state = initRunStatusState();
    const row = mapping.toRow(state, {
      tenantId: "project-1",
      key: "project-1",
      version: "v1",
      writtenAt: new Date("2026-07-30T00:00:00.000Z"),
      retentionDays: 90,
    });

    expect(row.TenantId).toBe("project-1");
    expect(row.ProjectId).toBe("project-1");
    expect(row.StateVersion).toBe("v1");
    expect(mapping.fromRow(row)).toEqual(state);
  });
});
