/**
 * Coverage completeness, not behaviour: every metric prefix `metric-translator`
 * branches on must appear in `column-pruning.test.ts`. Both files are read off
 * disk, so adding a prefix without a pruning test fails here rather than
 * shipping an unpruned query.
 *
 * @see specs/analytics/clickhouse-memory-safety.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("memory-safety", () => {
  describe("metric prefix column-pruning test coverage", () => {
    describe("when comparing metric-translator prefixes to column-pruning tests", () => {
      /** @scenario Every metric prefix in metric-translator has a column-pruning test */
      it("has at least one column-pruning test for every registered metric prefix", () => {
        // Extract metric prefixes from metric-translator.ts by reading the source
        const translatorPath = path.resolve(__dirname, "..", "metric-translator.ts");
        const translatorSource = fs.readFileSync(translatorPath, "utf-8");

        // Find all metric.startsWith("prefix.") patterns
        const prefixPattern = /metric\.startsWith\("([^"]+)\."\)/g;
        const registeredPrefixes = new Set<string>();
        let prefixMatch: RegExpExecArray | null;
        while ((prefixMatch = prefixPattern.exec(translatorSource)) !== null) {
          registeredPrefixes.add(prefixMatch[1]!);
        }

        expect(registeredPrefixes.size).toBeGreaterThan(0);

        // Read the column-pruning test file to find which prefixes are covered
        const pruningTestPath = path.resolve(__dirname, "column-pruning.test.ts");
        const pruningTestSource = fs.readFileSync(pruningTestPath, "utf-8");

        // Find all metric references and groupBy references in the test
        // A prefix is "covered" if it appears as a metric OR groupBy value
        const coveredPrefixes = new Set<string>();

        // Check metrics: "prefix.something" as FlattenAnalyticsMetricsEnum
        const metricRefPattern = /"([a-z_]+)\.[a-z_]+"\s*as\s*AnalyticsSeries\["metric"\]/g;
        let metricRef: RegExpExecArray | null;
        while ((metricRef = metricRefPattern.exec(pruningTestSource)) !== null) {
          coveredPrefixes.add(metricRef[1]!);
        }

        // Check groupBy: groupBy: "prefix.something"
        const groupByPattern = /groupBy:\s*"([a-z_]+)\.[a-z_]+"/g;
        let groupByRef: RegExpExecArray | null;
        while ((groupByRef = groupByPattern.exec(pruningTestSource)) !== null) {
          coveredPrefixes.add(groupByRef[1]!);
        }

        // Assert every registered prefix has at least one test
        const missingPrefixes: string[] = [];
        for (const prefix of registeredPrefixes) {
          if (!coveredPrefixes.has(prefix)) {
            missingPrefixes.push(prefix);
          }
        }

        expect(
          missingPrefixes,
          `The following metric prefixes from metric-translator.ts have no ` +
            `column-pruning test coverage. Add tests to column-pruning.test.ts ` +
            `for: ${missingPrefixes.join(", ")}`,
        ).toEqual([]);
      });
    });
  });
});
