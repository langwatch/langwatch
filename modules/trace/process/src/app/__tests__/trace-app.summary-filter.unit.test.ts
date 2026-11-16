/**
 * `TraceApi.listTraceSummaries` takes a LangWatchQL filter as written (ADR-202 Decided 25) and
 * compiles it into the read; a filter that narrows nothing is refused, never read whole.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { TraceFilterCompile } from "../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { traceSummaries } from "../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

type LegacyRead = TraceAppDependencies["traces"]["read"];

const QUERY = { projectId: "project-1", startDate: 1_000, endDate: 2_000 };
const ORIGIN_FILTER = "trace.attribute.langwatch.origin.kind:ingestion_source";

/** The compiled filter rendered into the summary read it narrows, as the store builds it. */
function renderedFilter(compile: TraceFilterCompile | undefined) {
  const scope = tenantScope.single({ tenantId: QUERY.projectId });
  const compiled = compile?.({ scope });
  if (compiled?.kind !== "compiled") throw new Error("fixture: the filter compiled to nothing");
  return clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ total: fn.count() })
    .where((ops) => compiled.where(ops))
    .build();
}

function harness() {
  const listTraceSummaries = vi.fn<LegacyRead["listTraceSummaries"]>(async () => ({
    summaries: [],
  }));
  const app = createTraceAppHarness({
    traces: { read: createApiFixture<LegacyRead>({ listTraceSummaries }, "read") },
  });
  return { app, listTraceSummaries };
}

describe("given a summary read with a LangWatchQL filter as written", () => {
  describe("when the filter names a trace attribute", () => {
    it("reads with the filter compiled to bound conditions", async () => {
      const { app, listTraceSummaries } = harness();

      await app.listTraceSummaries({
        query: QUERY,
        options: { dateField: "updated", scrollId: null, filter: ORIGIN_FILTER },
      });

      const [, options] = listTraceSummaries.mock.calls[0] ?? [];
      expect(options).toMatchObject({ dateField: "updated", scrollId: null });
      const statement = renderedFilter(options?.compileFilter);
      expect(statement.sql).not.toContain("ingestion_source");
      expect(Object.values(statement.params)).toContain("ingestion_source");
      expect(Object.values(statement.params)).toContain("langwatch.origin.kind");
    });
  });

  describe("when the filter is free text", () => {
    /** @scenario "A summary read refuses free text it cannot narrow by" */
    it("hands a filter whose compilation refuses the read by name", async () => {
      const { app, listTraceSummaries } = harness();

      await app.listTraceSummaries({ query: QUERY, options: { filter: "hello" } });

      const [, options] = listTraceSummaries.mock.calls[0] ?? [];
      expect(() => renderedFilter(options?.compileFilter)).toThrow(
        expect.objectContaining({ code: "filter_value_refused" }),
      );
    });
  });

  describe("when the filter narrows nothing", () => {
    /** @scenario "A summary read refuses a filter as written that narrows nothing" */
    it("refuses the read rather than reading every trace", async () => {
      const { app, listTraceSummaries } = harness();

      await expect(
        app.listTraceSummaries({ query: QUERY, options: { filter: "   " } }),
      ).rejects.toMatchObject({ code: "filter_parse_error" });
      expect(listTraceSummaries).not.toHaveBeenCalled();
    });
  });
});
