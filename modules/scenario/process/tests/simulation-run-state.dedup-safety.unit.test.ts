/**
 * Regression test: must use scalar max(UpdatedAt) subquery, not tuple form (OOM-prone).
 * Tuple form not PREWHERE-able with many snapshot versions. See integration test.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("simulationRunState.clickhouse.repository findProjection OOM safety", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "src",
      "repositories",
      "clickhouse",
      "clickhouse.simulation-run-state.repository.ts",
    ),
    "utf-8",
  );

  it("resolves the latest version with a scalar max(UpdatedAt) subquery", () => {
    expect(source).toMatch(/t\.UpdatedAt\s*=\s*\(\s*SELECT max\(s\.UpdatedAt\)/);
  });

  it("does not read the latest version via an UpdatedAt IN-tuple subquery", () => {
    expect(source).not.toMatch(/\(t\.TenantId,\s*t\.ScenarioRunId,\s*t\.UpdatedAt\)\s*IN/);
  });
});
