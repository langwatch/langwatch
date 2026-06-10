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

  describe("single-run getRun latest-version read", () => {
    // getRun fetches ONE run, so it resolves the latest version with a scalar
    // `UpdatedAt = (SELECT max(UpdatedAt) ...)` subquery rather than the
    // `(..., UpdatedAt) IN (max-subquery)` tuple form. The scalar equality is
    // PREWHERE-able, so the heavy columns are materialized for only the
    // surviving version instead of across every version of the run. The
    // IN-tuple form stays correct for the multi-run list reads.
    it("uses a scalar max(UpdatedAt) subquery for the single run fetch", () => {
      expect(source).toMatch(
        /UpdatedAt = \(\s*SELECT max\(UpdatedAt\)\s*FROM experiment_runs/,
      );
    });

    it("does not read a single run via an experiment_runs UpdatedAt IN-tuple", () => {
      // Order-insensitive over the three key columns, and bare (non-aliased)
      // columns only: the legitimate multi-run listRuns dedup uses `t.`-prefixed
      // columns (`(t.TenantId, t.RunId, t.ExperimentId, t.UpdatedAt) IN`), so a
      // getRun regression back to a bare key+UpdatedAt IN-tuple is caught in any
      // key order without flagging listRuns.
      expect(source).not.toMatch(
        /\(\s*(?:(?:TenantId|ExperimentId|RunId)\s*,\s*){3}UpdatedAt\s*\)\s*IN/,
      );
    });
  });
});
