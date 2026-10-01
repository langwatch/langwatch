import type * as observabilityModule from "@langwatch/observability";
/**
 * @vitest-environment node
 * A tracked-event body the caller got wrong is answered as a 400 and logged as a warning:
 * the client's mistake is not a server error.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TrackedEventInvalidError } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceModule, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

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
  return TraceModule.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

describe("TraceModule.trackEventFromRequest", () => {
  describe("when the body is not a valid tracked event", () => {
    it("refuses it and logs at warn, never error", async () => {
      loggerSpies.warn.mockClear();
      loggerSpies.error.mockClear();

      await expect(
        app().trackEventFromRequest({ projectId: "project_1", raw: JSON.stringify({}) }),
      ).rejects.toBeInstanceOf(TrackedEventInvalidError);

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1" }),
        "invalid event received",
      );
      expect(loggerSpies.error).not.toHaveBeenCalled();
    });
  });
});
