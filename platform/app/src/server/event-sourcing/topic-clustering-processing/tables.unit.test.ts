import { describe, expect, it } from "vitest";
import {
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
  }
});
