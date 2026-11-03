import type * as observabilityModule from "@langwatch/observability";
/**
 * @vitest-environment node
 * A body the collector refused is the sender's mistake: a warn, not an error that pages.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { TraceLegacyRead } from "../../services/trace-viewer.service.ts";
import { TraceModule, type TraceAppDependencies } from "../trace.app.ts";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

function app() {
  return TraceModule.fromDependencies(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

describe("TraceModule.collectorReportError", () => {
  describe("when the collector refused a body", () => {
    /** @scenario "A body the collector refused is logged as the sender's warning" */
    it("logs at warn, never error, naming the trace it knows", () => {
      loggerSpies.warn.mockClear();
      loggerSpies.error.mockClear();

      app().collectorReportError(new Error("bad span"), {
        projectId: "project_1",
        traceId: "trace_1",
      });

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1", traceId: "trace_1" }),
        "the collector answered a failure",
      );
      expect(loggerSpies.error).not.toHaveBeenCalled();
    });

    /** @scenario "A body the collector refused is logged as the sender's warning" */
    it("leaves the trace out when the refusal does not know it", () => {
      loggerSpies.warn.mockClear();

      app().collectorReportError(new Error("bad body"), { projectId: "project_1" });

      expect(loggerSpies.warn.mock.calls[0]?.[0]).not.toHaveProperty("traceId");
    });
  });
});
