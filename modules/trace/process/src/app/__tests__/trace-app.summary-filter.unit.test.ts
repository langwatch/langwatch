/**
 * `TraceApi.listTraceSummaries` takes a LangWatchQL filter as written (ADR-202 Decided 25) and
 * compiles it into the read; a filter that narrows nothing is refused, never read whole.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

type LegacyRead = TraceAppDependencies["traces"]["read"];

const QUERY = { projectId: "project-1", startDate: 1_000, endDate: 2_000 };
const ORIGIN_FILTER = "trace.attribute.langwatch.origin.kind:ingestion_source";

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
      expect(options?.filterWhere?.sql).not.toContain("ingestion_source");
      expect(Object.values(options?.filterWhere?.params ?? {})).toContain("ingestion_source");
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
