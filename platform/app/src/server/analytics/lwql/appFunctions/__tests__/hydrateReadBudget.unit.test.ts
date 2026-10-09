/**
 * The read stage's byte budget and chunking: a page whose traces weigh more
 * than one hydration may read is refused before the rest is fetched, and a
 * cancellation is answered between chunks rather than after the last one.
 *
 * @see ../hydration/read.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import { LWQL_APP_FUNCTION_READ_CHUNK } from "../hydration/read";
import type { LangWatchQLAppFunctionTraceSource } from "../traceSource";
import { hydrate, LIMITS, sourceOf, trace } from "./hydrateFixtures";

const TRACE_JSON = [
  { column: "j", function: "trace_json", options: [] },
] as const;
const COLUMNS = [{ name: "j", type: "Nullable(String)" }];

function rowsNaming(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    j: `t${index}`,
  }));
}

function heavyTraces(count: number) {
  return Array.from({ length: count }, (_unused, index) =>
    trace({ traceId: `t${index}`, input: "x".repeat(10_000) }),
  );
}

describe("given a page whose traces together weigh more than the read budget", () => {
  describe("when their traces are read for hydration", () => {
    /** @scenario "A read past the byte budget is refused, not completed" */
    it("stops at the budget and refuses with the read-budget error", async () => {
      const source = sourceOf({ traces: heavyTraces(100) });

      const failure = await hydrate({
        calls: [...TRACE_JSON],
        columns: COLUMNS,
        rows: rowsNaming(100),
        traceSource: source,
        limits: { ...LIMITS, maxReadBytes: 600_000 },
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "lwql_app_function_read_budget",
        meta: { budgetBytes: 600_000 },
      });
      expect(
        (failure as { meta: { readBytes: number } }).meta.readBytes,
      ).toBeGreaterThan(600_000);
      // Two chunks of 25 fit under the budget, the third passes it, and the
      // fourth is never asked for.
      expect(source.askedTraceIds).toHaveLength(3);
    });

    it("reads a page under the budget in chunks and returns every trace", async () => {
      const source = sourceOf({ traces: heavyTraces(60) });

      const result = await hydrate({
        calls: [...TRACE_JSON],
        columns: COLUMNS,
        rows: rowsNaming(60),
        traceSource: source,
      });

      expect(source.askedTraceIds.map((chunk) => chunk.length)).toEqual([
        LWQL_APP_FUNCTION_READ_CHUNK.traceIds,
        LWQL_APP_FUNCTION_READ_CHUNK.traceIds,
        10,
      ]);
      expect(result.unresolvedKeys).toEqual([]);
      expect(result.rows).toHaveLength(60);
    });
  });
});

describe("given a page of traces read in chunks", () => {
  describe("when the caller cancels after the first chunk", () => {
    /** @scenario "A cancelled read stops between chunks" */
    it("reads no further chunk and surfaces the cancellation", async () => {
      const controller = new AbortController();
      const inner = sourceOf({ traces: heavyTraces(60) });
      const asked: string[][] = [];
      const source: LangWatchQLAppFunctionTraceSource = {
        async tracesByIds(input) {
          asked.push([...input.traceIds]);
          controller.abort();
          return await inner.tracesByIds(input);
        },
        tracesByThreadKeys: (input) => inner.tracesByThreadKeys(input),
      };

      const failure = await hydrate({
        calls: [...TRACE_JSON],
        columns: COLUMNS,
        rows: rowsNaming(60),
        traceSource: source,
        signal: controller.signal,
      }).catch((error: unknown) => error);

      expect(asked).toHaveLength(1);
      expect(failure).toMatchObject({ name: "AbortError" });
    });
  });
});
