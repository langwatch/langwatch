/**
 * Structural regression test for the simulation-run-state projection read.
 *
 * getProjection() reads the latest version of a single run from
 * simulation_runs (ReplacingMergeTree(UpdatedAt)). It must resolve the latest
 * version with a scalar `UpdatedAt = (SELECT max(...))` subquery, NOT the
 * `(TenantId, ScenarioRunId, UpdatedAt) IN (max-subquery)` tuple form: the
 * tuple form is not applied as a PREWHERE on the version, so ClickHouse read
 * the heavy Messages.* arrays across every version before discarding the stale
 * ones, exhausting the server memory limit (Code 241) for runs with many
 * snapshot versions.
 *
 * The behavioural proof lives in the integration test
 * (simulationRunState.clickhouse.repository.integration.test.ts); this guards
 * the query shape so the fix can't silently regress.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("simulationRunState.clickhouse.repository getProjection OOM safety", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "simulationRunState.clickhouse.repository.ts"),
    "utf-8",
  );

  it("resolves the latest version with a scalar max(UpdatedAt) subquery", () => {
    expect(source).toMatch(/t\.UpdatedAt\s*=\s*\(\s*SELECT max\(s\.UpdatedAt\)/);
  });

  it("does not read the latest version via an UpdatedAt IN-tuple subquery", () => {
    expect(source).not.toMatch(
      /\(t\.TenantId,\s*t\.ScenarioRunId,\s*t\.UpdatedAt\)\s*IN/,
    );
  });
});
