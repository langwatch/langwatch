import type * as observabilityModule from "@langwatch/observability";
/**
 * @vitest-environment node
 * The reporter the collector door calls when it refuses a payload is the real one here, not a
 * stub: a refusal is the sender's mistake, so it logs at warn and never raises an error signature.
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
  describe("when the collector refuses a span that failed validation", () => {
    /** @scenario A refused payload never raises an error signature */
    it("logs at warn with the project and trace, never error", () => {
      loggerSpies.warn.mockClear();
      loggerSpies.error.mockClear();

      app().collectorReportError(new Error("ZodError on parsing spans"), {
        projectId: "project_1",
        traceId: "trace_1",
      });

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1", traceId: "trace_1" }),
        "the collector refused a payload",
      );
      expect(loggerSpies.error).not.toHaveBeenCalled();
    });
  });
});
