/**
 * The trace source sizes the thread read by the threads it asks for, so a
 * page of conversations never loses a trace to the read's single ceiling.
 *
 * @see ../traceSource.ts
 * @see ../../../../../../specs/lwql/app-functions.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { TraceService } from "~/server/traces/trace.service";
import {
  createLangWatchQLAppFunctionTraceSource,
  LWQL_TRACES_PER_THREAD_CEILING,
} from "../traceSource";

const PROTECTIONS = {} as never;

function service() {
  return {
    getTracesWithSpans: vi.fn(async () => []),
    getTracesWithSpansByThreadIds: vi.fn(async () => []),
  } as unknown as Pick<
    TraceService,
    "getTracesWithSpans" | "getTracesWithSpansByThreadIds"
  > & {
    getTracesWithSpansByThreadIds: ReturnType<typeof vi.fn>;
  };
}

describe("given a page of two hundred conversations", () => {
  describe("when their traces are read", () => {
    /** @scenario "A page of conversations never loses a trace to the read's ceiling" */
    it("asks for a ceiling sized by the threads, not the read's default", async () => {
      const traces = service();
      const source = createLangWatchQLAppFunctionTraceSource(traces);
      const threadKeys = Array.from({ length: 200 }, (_, i) => `thread-${i}`);

      await source.tracesByThreadKeys({
        projectId: "project-1",
        threadKeys,
        protections: PROTECTIONS,
      });

      expect(traces.getTracesWithSpansByThreadIds).toHaveBeenCalledWith(
        "project-1",
        threadKeys,
        PROTECTIONS,
        { full: true, maxTraces: 200 * LWQL_TRACES_PER_THREAD_CEILING },
      );
    });

    it("reads nothing for no threads", async () => {
      const traces = service();
      const source = createLangWatchQLAppFunctionTraceSource(traces);

      await source.tracesByThreadKeys({
        projectId: "project-1",
        threadKeys: [],
        protections: PROTECTIONS,
      });

      expect(traces.getTracesWithSpansByThreadIds).not.toHaveBeenCalled();
    });
  });
});
