/**
 * @vitest-environment node
 * Spec: modules/analytics/specs/trace-analytics-ownership.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TRACE_PROCESS_SOURCE = fileURLToPath(new URL("../..", import.meta.url));

/** The has-signal predicate's distinctive clause, as analytics' rules spell it. */
const HAS_SIGNAL_CLAUSE = "langwatch.reserved.log_record_count'] NOT IN";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("trace's process source", () => {
  describe("when it is searched for the trace_analytics has-signal predicate", () => {
    /** @scenario "Trace holds no copy of the has-signal predicate" */
    it("holds no copy of it, because analytics owns the table and its readers", () => {
      const holders = sourceFiles(TRACE_PROCESS_SOURCE).filter((path) =>
        readFileSync(path, "utf8").includes(HAS_SIGNAL_CLAUSE),
      );

      expect(holders).toEqual([]);
    });
  });
});
