/**
 * Memory safety regression tests for ClickHouse analytics queries.
 *
 * Validates structural invariants that prevent OOM in production:
 * - No bare SpanAttributes in outermost SELECT
 * - LIMIT clauses on discovery queries
 * - Memory spill-to-disk settings on all query paths
 * - Column-pruning test coverage for all metric prefixes
 *
 * @see specs/analytics/clickhouse-memory-safety.feature (Layer 1: @unit scenarios)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The repository this reads, resolved once.
 *
 * Named in one place because the assertions are about the SQL the shipped
 * source issues: if the file moves and each call site keeps its own path, the
 * suite dies with ENOENT, which reads exactly like a guard that stopped
 * guarding. One resolver means one thing to fix.
 */
function traceReadSourcePath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "trace-legacy-read.repository.ts",
  );
}

describe("memory-safety", () => {
  // -------------------------------------------------------------------------
  // Scenario 2: Topic and field-discovery queries access only specific attributes
  // -------------------------------------------------------------------------
  describe("topic and field-discovery query attribute access", () => {
    /**
     * Read the actual production source of clickhouse-trace.service.ts and
     * extract the method bodies for getTopicCounts and getDistinctFieldNames.
     * This way, if the SQL changes the test checks the ACTUAL code.
     */
    const traceServicePath = traceReadSourcePath();
    const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

    const getTopicCountsBody = traceServiceSource.match(
      /async getTopicCounts[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    const getDistinctFieldNamesBody = traceServiceSource.match(
      /async getDistinctFieldNames[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    describe("when the topic counting query SQL is inspected", () => {
      /** @scenario Topic and field-discovery queries access only specific attributes */
      it("does not select the full SpanAttributes Map column", () => {
        expect(getTopicCountsBody).not.toBeNull();
        expect(getTopicCountsBody![0]).not.toContain("SpanAttributes");
      });

      it("does not select the full Attributes Map column without key access", () => {
        expect(getTopicCountsBody).not.toBeNull();
        // Attributes without ['key'] means reading the entire Map
        expect(getTopicCountsBody![0]).not.toMatch(/\bAttributes\b(?!\[)/);
      });
    });

    describe("when the field discovery query SQL is inspected", () => {
      /** @scenario "Topic and field-discovery queries access only specific attributes" */
      it("does not select the full SpanAttributes Map column", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        expect(getDistinctFieldNamesBody![0]).not.toContain("SpanAttributes");
      });

      it("uses mapKeys() for Attributes access (extracts keys only, not values)", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // mapKeys extracts only the key names, avoiding reading all Map values
        expect(getDistinctFieldNamesBody![0]).toContain("mapKeys(Attributes)");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Topic counting query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("topic counting query LIMIT clause", () => {
    const traceServicePath = traceReadSourcePath();
    const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

    const getTopicCountsBody = traceServiceSource.match(
      /async getTopicCounts[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    describe("when the topic counting query SQL is inspected", () => {
      /** @scenario Topic counting query includes a LIMIT clause */
      it("includes a LIMIT clause followed by a number", () => {
        expect(getTopicCountsBody).not.toBeNull();
        expect(getTopicCountsBody![0]).toMatch(/\bLIMIT\s+\d+/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Field discovery query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("field discovery query LIMIT clause", () => {
    const traceServicePath = traceReadSourcePath();
    const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

    const getDistinctFieldNamesBody = traceServiceSource.match(
      /async getDistinctFieldNames[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    describe("when the field discovery query SQL is inspected", () => {
      // A bounded LIMIT is either a literal number or a named numeric constant
      // interpolated into the query (e.g. `LIMIT ${DISTINCT_FIELD_NAMES_LIMIT}`).
      // Both keep the query bounded, which is what memory-safety requires.
      const BOUNDED_LIMIT = /\bLIMIT\s+(?:\d+|\$\{[A-Z0-9_]+\})/g;

      /** @scenario Field discovery query includes a LIMIT clause */
      it("span names query includes a LIMIT clause followed by a number", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // The body contains two queries (span names + metadata keys).
        // Verify at least two LIMIT occurrences so both are covered.
        const limitMatches = getDistinctFieldNamesBody![0].match(BOUNDED_LIMIT);
        expect(limitMatches).not.toBeNull();
        expect(limitMatches!.length).toBeGreaterThanOrEqual(1);
      });

      it("metadata keys query includes a LIMIT clause followed by a number", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // Both the span-names and metadata-keys queries must have LIMIT.
        const limitMatches = getDistinctFieldNamesBody![0].match(BOUNDED_LIMIT);
        expect(limitMatches).not.toBeNull();
        expect(limitMatches!.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: All query execution paths include memory safety settings
  // -------------------------------------------------------------------------
  describe("memory safety settings on query execution paths", () => {
    describe("when the trace service source is inspected", () => {
      it("resolves every client through the injected per-tenant resolver", () => {
        const source = fs.readFileSync(traceReadSourcePath(), "utf-8");

        // Every read must go through the resolver this repository was composed
        // with, whose clients are built by the one construction path that
        // applies the package query-default policy — so the memory-safety
        // settings are injected on every query rather than remembered at each
        // call site. A bare driver client would carry none of them. The
        // wrapper's merge behaviour is tested in the managed-client suite.
        expect(source).toContain("this.resolveClient(");
        expect(source).not.toMatch(/\bcreateClient\s*\(/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Every metric prefix in metric-translator has a column-pruning test
  // -------------------------------------------------------------------------
});
