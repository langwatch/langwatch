/**
 * Structural regression: `dedupedTraceSummaries` must use `max(UpdatedAt)
 * GROUP BY` for dedup, never bare `LIMIT 1 BY` (reads every heavy column/row).
 * @see dev/docs/best_practices/clickhouse-queries.md
 * @regression issue #3158
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

describe("aggregation-builder dedup OOM safety", () => {
  const sourcePath = path.resolve(__dirname, "..", "clickhouse.aggregation-builder.mapper.ts");
  const source = fs.readFileSync(sourcePath, "utf-8");

  /** Extract a named function body from source. */
  function extractFunctionBody(functionName: string): string {
    const pattern = new RegExp(
      `(?:export\\s+)?function\\s+${functionName}[\\s\\S]*?(?=\\n(?:export\\s+)?(?:async\\s+)?function |\\n/\\*\\*|$)`,
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`Could not extract function "${functionName}" from aggregation-builder.ts`);
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

      it("applies dateFilter in both inner and outer query paths", () => {
        // dateFilter is assigned to dateClause and interpolated twice:
        // once in the outer WHERE and once in the IN-tuple subquery WHERE
        const dateClauseInterpolations = body.match(/\$\{dateClause\}/g) ?? [];
        expect(dateClauseInterpolations.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
