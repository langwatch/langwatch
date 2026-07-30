import { describe, expect, it } from "vitest";
import { initRunStatusState } from "./projections/runStatus";
import {
  foldStateRow,
  topicClusteringRunHistoryTable,
  topicClusteringRunStatusTable,
  topicModelTable,
} from "./tables";

describe("topic-clustering-processing ClickHouse table declarations", () => {
  for (const [name, table] of [
    ["topicClusteringRunStatusTable", topicClusteringRunStatusTable],
    ["topicClusteringRunHistoryTable", topicClusteringRunHistoryTable],
    ["topicModelTable", topicModelTable],
  ] as const) {
    it(`${name} declares a replacing table keyed on (TenantId, ProjectId)`, () => {
      const description = table.describe();
      expect(description.merge).toEqual({
        kind: "replacing",
        version: "UpdatedAt",
      });
      expect(description.sortKey).toEqual(["TenantId", "ProjectId"]);
      expect(description.tenant).toEqual(["TenantId"]);
    });

    it(`${name} partitions and expires on the frozen, platform-controlled AcceptedAt column`, () => {
      const description = table.describe();
      expect(description.partition.column).toBe("AcceptedAt");
      expect(description.ttl?.anchor).toBe("AcceptedAt");
    });

    it(`${name} declares no DeliverySeq column`, () => {
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
