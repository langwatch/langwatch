import {
  clickhouseRead,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { customMetadataKeyCondition } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
} from "../clickhouse.filter-conditions.mapper.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";

const ts = traceSummaries;

function built({
  filters,
  spanWindow,
}: {
  filters: AnalyticsFilterInput;
  spanWindow?: { startMs: number; endMs: number };
}): ReaderReadStatement {
  const scope = tenantScope.fromProof({
    authorization: analyticsProof({ projectId: "project-1" }),
    reads: "analytics",
  });
  return clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .select({ trace: ts.TraceId })
    .where(analyticsFilterCondition({ filters, ts, spanWindow }))
    .build() as ReaderReadStatement;
}

/** The values a statement binds beside the proof's own tenant list. */
const boundValues = (statement: ReaderReadStatement) =>
  Object.values(statement.params).filter(
    (value) => !(Array.isArray(value) && value.length === 1 && value[0] === "project-1"),
  );

describe("analyticsFilterCondition", () => {
  describe("given no filter", () => {
    it("keeps every row with a constant true, binding nothing of its own", () => {
      const statement = built({ filters: {} });

      expect(statement.sql).toContain("1 = 1");
      expect(boundValues(statement)).toEqual([]);
    });
  });

  describe("given a span filter under the project's own proof", () => {
    it("matches tenant and trace in a span subquery held to the proof's tenants", () => {
      const statement = built({
        filters: { "spans.type": ["llm"] },
        spanWindow: { startMs: 1_000_000_000_000, endMs: 1_000_000_360_000 },
      });

      expect(statement.identity).toBe("reader");
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statement.sql).toMatch(
        /tuple\(TenantId, TraceId\) IN \(SELECT TenantId, TraceId FROM stored_spans WHERE \(TenantId IN/,
      );
      expect(boundValues(statement)).toEqual(
        expect.arrayContaining([
          ["llm"],
          1_000_000_000_000 - 2 * 86_400_000,
          1_000_000_360_000 + 2 * 86_400_000,
        ]),
      );
    });
  });

  describe("given an evaluation filter under the project's own proof", () => {
    it("holds the evaluation subquery to the proof's tenants", () => {
      const statement = built({ filters: { "evaluations.state": ["processed"] } });

      expect(statement.identity).toBe("reader");
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statement.sql).toMatch(/IN \(SELECT [^)]*FROM evaluation_runs WHERE \(TenantId IN/);
    });
  });

  describe("given a flag filter naming both values", () => {
    it("drops the filter, as main's 1=1 did", () => {
      expect(built({ filters: { "traces.error": ["true", "false"] } }).sql).toContain("1 = 1");
    });
  });

  describe("given a custom metadata key", () => {
    it("reads the three stored keys trace search reads", () => {
      const { params } = built({ filters: { "metadata.key": ["team·name"] } });
      const trace = customMetadataKeyCondition({ values: ["team·name"], paramId: "k", alias: "t" });

      expect(Object.values(params)).toEqual(expect.arrayContaining(Object.values(trace.params)));
    });
  });
});
