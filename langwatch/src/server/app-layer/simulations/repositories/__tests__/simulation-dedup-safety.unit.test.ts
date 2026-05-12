/**
 * Structural regression tests for LIMIT 1 BY deduplication in simulation queries.
 *
 * simulation_runs uses ReplacingMergeTree(UpdatedAt) with dedup key
 * (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId) and partition
 * toYearWeek(StartedAt). LIMIT 1 BY materializes all selected columns
 * per 8K-row granule before deduplicating — the IN-tuple pattern avoids this.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md
 * @regression issue #3158
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("simulation.clickhouse.repository dedup OOM safety", () => {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "simulation.clickhouse.repository.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf-8");

  it("does not use LIMIT 1 BY anywhere in the file", () => {
    expect(source).not.toContain("LIMIT 1 BY");
  });

  it("uses max(UpdatedAt) GROUP BY for simulation_runs dedup", () => {
    expect(source).toContain("max(UpdatedAt)");
    expect(source).toMatch(
      /GROUP BY\s+TenantId,\s*ScenarioSetId,\s*BatchRunId,\s*ScenarioRunId/,
    );
  });
});
