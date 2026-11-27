/** @see modules/staff-access/specs/staff-access-functions-telemetry.feature */
import { describe, expect, it } from "vitest";

import { MemoryClickHouseServerRepository } from "../../repositories/memory/memory.clickhouse-server.repository.ts";
import { ClickHouseServerReadService } from "../clickhouse-server-read.service.ts";

const group = {
  queryShapeId: "42",
  source: "lwql",
  code: 241,
  codeName: "MEMORY_LIMIT_EXCEEDED",
  count: 3,
  p95Ms: 10,
  maxMemoryBytes: 100,
  rowsRead: 7,
  projectIds: ["project_b", "", "project_a", "project_b"],
  lastAt: 1_000,
};

describe("ClickHouseServerReadService", () => {
  describe("when the query log names a source this release does not know", () => {
    /** @scenario "A source this release does not know reads as other" */
    it("answers it as other, and a window ending before it starts reads nothing", async () => {
      const repository = MemoryClickHouseServerRepository.create();
      repository.errors = [group, { ...group, queryShapeId: "43", source: "billing_export" }];
      const reads = ClickHouseServerReadService.create({ repository });

      const found = await reads.findQueryErrors({ sinceMs: 0, untilMs: 2_000 });

      expect(found.map((row) => [row.queryShapeId, row.source])).toEqual([
        ["42", "lwql"],
        ["43", "other"],
      ]);
      expect(found[0]?.projectIds).toEqual(["project_a", "project_b"]);
      await expect(reads.findQueryErrors({ sinceMs: 2_000, untilMs: 2_000 })).resolves.toEqual([]);
      const asOther = await reads.findQueryErrors({ sinceMs: 0, untilMs: 2_000, source: "other" });
      expect(asOther.map((row) => row.queryShapeId)).toEqual(["43"]);
    });
  });
});
