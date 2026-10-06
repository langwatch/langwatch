/**
 * TraceModule's transcript read for one viewer: protections first, then the shared read.
 * @see modules/trace/specs/trace-drawer-coding-agent-reads.feature
 */
import { describe, expect, it, vi } from "vitest";

import { openProtections } from "../../repositories/clickhouse/__tests__/open-protections.ts";
import { createTranscriptApp } from "../../transport/__tests__/support/transcript-read.support.ts";

const PROJECT_ID = "project_test";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const CUTOFF_MS = 1_699_000_000_000;

describe("TraceModule.readCodingAgentTranscript", () => {
  describe("given a viewer whose protections carry a plan visibility window", () => {
    /** @scenario "The transcript is redacted by the viewer's own protections" */
    it("resolves that viewer's protections and reads spans inside the window", async () => {
      const resolve = vi.fn(async () => ({ ...openProtections, visibilityCutoffMs: CUTOFF_MS }));
      const { app, getSpansByTraceId, getLogsByTraceId } = createTranscriptApp({ resolve });
      getSpansByTraceId.mockResolvedValue([]);
      getLogsByTraceId.mockResolvedValue([]);

      const transcript = await app.readCodingAgentTranscript({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        viewerUserId: "viewer-1",
      });

      expect(resolve).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: "viewer-1",
        publiclyShared: false,
      });
      expect(getSpansByTraceId).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PROJECT_ID, visibilityCutoffMs: CUTOFF_MS }),
      );
      expect(transcript).toMatchObject({ entries: [] });
    });
  });

  describe("given the log records of a trace", () => {
    /** @scenario "the transcript is derived from the canonical log read the trace module is composed with" */
    it("reads them from the composed log read, for the project and trace asked", async () => {
      const { app, getSpansByTraceId, getLogsByTraceId } = createTranscriptApp({
        resolve: async () => openProtections,
      });
      getSpansByTraceId.mockResolvedValue([]);
      getLogsByTraceId.mockResolvedValue([]);

      await app.readCodingAgentTranscript({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        viewerUserId: "viewer-1",
      });

      expect(getLogsByTraceId).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PROJECT_ID, traceId: TRACE_ID }),
      );
    });
  });
});
