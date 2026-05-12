/**
 * Structural regression tests for LIMIT 1 BY deduplication in experiment run queries.
 *
 * experiment_runs uses ReplacingMergeTree(UpdatedAt) with dedup key
 * (TenantId, RunId, ExperimentId).
 *
 * experiment_run_items uses ReplacingMergeTree(OccurredAt) with business dedup key
 * (TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')).
 *
 * The per-row dedup anti-pattern materializes all selected columns per 8K-row
 * granule before deduplicating — the IN-tuple pattern avoids this.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md
 * @regression issue #3158
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("clickhouse-experiment-run.service dedup OOM safety", () => {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "clickhouse-experiment-run.service.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf-8");

  it("does not use LIMIT 1 BY anywhere in the file", () => {
    expect(source).not.toContain("LIMIT 1 BY");
  });

  describe("experiment_runs dedup", () => {
    it("uses max(UpdatedAt) GROUP BY for experiment_runs dedup", () => {
      expect(source).toContain("max(UpdatedAt)");
      expect(source).toMatch(/GROUP BY\s+TenantId,\s*RunId,\s*ExperimentId/);
    });
  });

  describe("experiment_run_items dedup", () => {
    it("uses max(OccurredAt) GROUP BY for experiment_run_items dedup", () => {
      expect(source).toContain("max(OccurredAt)");
      expect(source).toMatch(
        /GROUP BY\s+TenantId,\s*ExperimentId,\s*RunId,\s*RowIndex,\s*TargetId,\s*ResultType,\s*coalesce\(EvaluatorId,\s*''\)/,
      );
    });
  });
});
