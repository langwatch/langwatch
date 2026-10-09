/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseColumns } from "../present-columns.ts";

const BEFORE = [
  { table: "trace_summaries", name: "TenantId" },
  { table: "trace_summaries", name: "TraceId" },
];
const AFTER = [...BEFORE, { table: "trace_summaries", name: "CostUsd" }];
const COLUMNS = { TraceId: "''", CostUsd: "CAST(0 AS Float64)" };

describe("ClickHouseColumns", () => {
  describe("given a pending ClickHouse step that adds a column the target lacks", () => {
    /** @scenario "A ClickHouse read leaves out a column a pending step has not added" */
    it("selects the column's typed default under its name, then the column once the list refreshes", async () => {
      let clock = 0;
      const read = vi.fn(async () => (read.mock.calls.length > 1 ? AFTER : BEFORE));
      const columns = ClickHouseColumns.over({ read, refreshMs: 1_000, now: () => clock });

      const pending = await columns.select({ table: "trace_summaries", columns: COLUMNS });
      clock = 500;
      const cached = await columns.select({ table: "trace_summaries", columns: COLUMNS });
      clock = 1_500;
      const added = await columns.select({ table: "trace_summaries", columns: COLUMNS });

      expect(pending).toBe("TraceId, CAST(0 AS Float64) AS CostUsd");
      expect(cached).toBe(pending);
      expect(added).toBe("TraceId, CostUsd");
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  describe("given the column list cannot be read", () => {
    it("names every column and reads the list again on the next select", async () => {
      const read = vi
        .fn<() => Promise<typeof BEFORE>>()
        .mockRejectedValueOnce(new Error("ClickHouse unreachable"))
        .mockResolvedValue(BEFORE);
      const columns = ClickHouseColumns.over({ read, now: () => 0 });

      const blind = await columns.select({ table: "trace_summaries", columns: COLUMNS });
      const known = await columns.select({ table: "trace_summaries", columns: COLUMNS });

      expect(blind).toBe("TraceId, CostUsd");
      expect(known).toBe("TraceId, CAST(0 AS Float64) AS CostUsd");
    });
  });
});
