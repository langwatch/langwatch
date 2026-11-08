/**
 * @vitest-environment node
 * The reporter the collector door calls when it refuses a payload is the real one here, not a
 * stub: a refusal is the sender's mistake, so it logs at warn and never raises an error signature.
 */
import type * as observabilityModule from "@langwatch/observability";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TraceLegacyRead } from "../../services/trace-viewer.service.ts";
import type { TraceAppDependencies } from "../trace.app.ts";

const testLog = createTestLogger();
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => testLog.logger,
}));

// After the mock: trace.app builds its logger when the module loads.
const { TraceModule } = await import("../trace.app.ts");

function app() {
  return TraceModule.fromDependencies(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

beforeEach(() => {
  testLog.lines.length = 0;
});

describe("TraceModule.collectorReportError", () => {
  describe("when the collector refuses a span that failed validation", () => {
    /** @scenario A refused payload never raises an error signature */
    it("logs at warn with the project and trace, never error", () => {
      app().collectorReportError(new Error("ZodError on parsing spans"), {
        projectId: "project_1",
        traceId: "trace_1",
      });

      expect(testLog.lines.findLine("warn", "the collector refused a payload")).toMatchObject({
        projectId: "project_1",
        traceId: "trace_1",
      });
      expect(testLog.lines.filter((line) => line.level >= 50)).toEqual([]);
    });
  });
});
