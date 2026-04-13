/**
 * Structural regression tests for LIMIT 1 BY deduplication in analytics queries.
 *
 * ClickHouse LIMIT 1 BY reads all selected columns (including heavy Maps
 * like Attributes and Arrays like Models) for every row in a granule before
 * deduplicating. Combined with missing date filters in the inner subquery,
 * this causes 800x data over-reads (2.5GB vs 3MB expected).
 *
 * The safe alternative is an IN-tuple subquery:
 *   WHERE (TenantId, TraceId, UpdatedAt) IN (
 *     SELECT TenantId, TraceId, max(UpdatedAt) ... GROUP BY TenantId, TraceId
 *   )
 * which resolves dedup using only lightweight key columns and enables
 * partition pruning when date filters are pushed into the inner subquery.
 *
 * These tests verify that dedupedTraceSummaries no longer uses LIMIT 1 BY
 * and instead uses the max(UpdatedAt) GROUP BY pattern.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md
 * @regression issue #3158
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("aggregation-builder dedup OOM safety", () => {
  const sourcePath = path.resolve(__dirname, "..", "aggregation-builder.ts");
  const source = fs.readFileSync(sourcePath, "utf-8");

  /** Extract a named function body from source. */
  function extractFunctionBody(functionName: string): string {
    const pattern = new RegExp(
      `(?:export\\s+)?function\\s+${functionName}[\\s\\S]*?(?=\\n(?:export\\s+)?(?:async\\s+)?function |\\n/\\*\\*|$)`,
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(
        `Could not extract function "${functionName}" from aggregation-builder.ts`,
      );
    }
    return match[0];
  }

  describe("dedupedTraceSummaries()", () => {
    const body = extractFunctionBody("dedupedTraceSummaries");

    describe("when the dedup SQL template is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });

      it("accepts a dateFilter parameter for partition pruning", () => {
        expect(body).toContain("dateFilter");
      });
    });
  });
});
