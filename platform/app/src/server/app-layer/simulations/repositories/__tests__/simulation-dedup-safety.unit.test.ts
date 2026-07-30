/**
 * Structural regression tests for read-time deduplication of `simulation_runs`.
 *
 * The table is `ReplacingMergeTree(UpdatedAt)` with engine key
 * `ORDER BY (TenantId, ScenarioRunId)` and partition `toYearWeek(StartedAt)`
 * (00002_create_schema.sql). Two shapes have to stay out of this file:
 *
 *   - `LIMIT 1 BY`, which materializes every selected column for a whole 8K-row
 *     granule before deduplicating.
 *   - a `GROUP BY` WIDER than the engine key, which splits one run's versions
 *     into several groups so the same run survives dedup once per group.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md
 * @regression issue #3158
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("simulation.clickhouse.repository dedup safety", () => {
  const sources = [
    "simulation.clickhouse.repository.ts",
    "simulationRuns.sql.ts",
  ].map((file) => ({
    file,
    text: fs.readFileSync(path.resolve(__dirname, "..", file), "utf-8"),
  }));

  describe("given the simulation read queries", () => {
    describe("when the source is scanned", () => {
      it("does not use LIMIT 1 BY anywhere", () => {
        for (const { file, text } of sources) {
          expect(text, file).not.toContain("LIMIT 1 BY");
        }
      });

      it("never groups a dedup scope wider than the engine key", () => {
        // The historical bug: grouping on
        // (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId). ScenarioSetId
        // and BatchRunId are fold-written and start as '', so a version written
        // before the run-started event lands in its own group and survives.
        for (const { file, text } of sources) {
          const groupings = text.match(/GROUP BY\s+TenantId[^\n)]*/g) ?? [];
          expect(
            groupings.length,
            `${file} has no tenant-scoped GROUP BY`,
          ).toBeGreaterThan(0);
          for (const grouping of groupings) {
            expect(grouping.replace(/\s+/g, " ").trim(), file).toBe(
              "GROUP BY TenantId, ScenarioRunId",
            );
          }
        }
      });

      it("resolves fold-written columns with argMax, never max", () => {
        // max(ScenarioSetId) would pick the lexicographically largest value
        // across versions rather than the latest one.
        for (const { file, text } of sources) {
          expect(text, file).not.toMatch(
            /\bmax\(\s*(ScenarioSetId|BatchRunId|Status|ScenarioId|ArchivedAt)\s*\)/,
          );
        }
      });
    });
  });
});
