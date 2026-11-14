/** @vitest-environment node */
/**
 * ADR-177 block C: in a converted trace repository only the client writes the tenant predicate,
 * from the proof's `tenantScope` marker. This scan refuses the shapes the reader refuses at run
 * time, so a hand-written predicate fails here even on a path no test drives.
 * @see specs/governance/aggregate-project.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { HAND_WRITTEN_TENANT_PREDICATE } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

const CONVERTED_REPOSITORIES = [
  "trace-list.repository.ts",
  "trace-summary.repository.ts",
  "span-storage.repository.ts",
  "trace-metrics-analytics.repository.ts",
  "session-groups.repository.ts",
];

/** Every template literal's text, each line tagged with where it sits in the file. */
function handWrittenTenantPredicatesIn({ file, source }: { file: string; source: string }) {
  return [...source.matchAll(/`([^`]*)`/g)].flatMap((literal) => {
    const firstLine = source.slice(0, literal.index).split("\n").length;
    return (literal[1] ?? "")
      .split("\n")
      .flatMap((line, offset) =>
        HAND_WRITTEN_TENANT_PREDICATE.test(line)
          ? [`${file}:${firstLine + offset} ${line.trim()}`]
          : [],
      );
  });
}

describe("the converted trace repositories", () => {
  describe("when their query text is scanned", () => {
    /** @scenario "Trace repositories write no tenant of their own" */
    it("finds the tenantScope marker in each and no hand-written tenant predicate", () => {
      const offending = CONVERTED_REPOSITORIES.flatMap((file) => {
        const source = readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
        // A file without the marker is the wrong file, and "nothing offends" would be vacuous.
        expect(source, `${file} carries no tenantScope marker`).toContain("tenantScope(");
        return handWrittenTenantPredicatesIn({ file, source });
      });

      expect(offending).toEqual([]);
    });
  });

  describe("when a repository filters on the tenant column", () => {
    /** @scenario "Trace repositories write no tenant of their own" */
    it("names the predicate, and lets a projection and a dedup tuple through", () => {
      const source = [
        "const sql = `",
        "  SELECT TenantId AS TenantId, TraceId",
        "  FROM trace_summaries",
        "  WHERE TenantId = {tenantId:String}",
        "    AND (TenantId, TraceId) > ({cursorTenant:String}, {cursorTrace:String})",
        "`;",
      ].join("\n");

      expect(handWrittenTenantPredicatesIn({ file: "fixture.ts", source })).toEqual([
        "fixture.ts:4 WHERE TenantId = {tenantId:String}",
      ]);
    });
  });
});
