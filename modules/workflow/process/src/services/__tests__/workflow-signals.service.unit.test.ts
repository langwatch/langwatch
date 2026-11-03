/** @see modules/workflow/specs/workflow-service.feature */
import { HandledError } from "@langwatch/handled-error";
import type * as TestHarness from "@langwatch/test-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lines: [] as { level: number; msg?: string; [field: string]: unknown }[],
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const { logger, lines } = harness.createTestLogger();
  captured.lines = lines;
  return { ...(await importOriginal<object>()), createLogger: () => logger };
});

import { WorkflowSignalsService } from "../workflow-signals.service.ts";

class CustomerRefusal extends HandledError {
  constructor() {
    super("model_not_configured", "model_not_configured", { httpStatus: 400, fault: "customer" });
  }
}

class PlatformFailure extends HandledError {
  constructor() {
    super("database_busy", "database_busy", { httpStatus: 503, fault: "platform" });
  }
}

const WARN_LEVEL = 40;
const ERROR_LEVEL = 50;
const linesAt = (level: number) => captured.lines.filter((line) => line.level === level);

beforeEach(() => {
  captured.lines.length = 0;
});

describe("WorkflowSignalsService.failed", () => {
  describe("when a side effect is refused for a reason the customer fixes", () => {
    /** @scenario "A side effect refused for a reason the customer fixes is a warning, not an error" */
    it("logs a warning with the handled code and nothing at error", () => {
      WorkflowSignalsService.create().failed(new CustomerRefusal(), { projectId: "project_1" });

      expect(linesAt(ERROR_LEVEL)).toHaveLength(0);
      expect(linesAt(WARN_LEVEL)).toEqual([
        expect.objectContaining({
          handledErrorCode: "model_not_configured",
          projectId: "project_1",
          msg: expect.any(String),
        }),
      ]);
    });
  });

  describe("when a side effect fails for a reason that is ours or a provider's", () => {
    /** @scenario "A side effect refused for a reason the customer fixes is a warning, not an error" */
    it.each([new PlatformFailure(), new Error("boom")])("logs %s at error", (error) => {
      WorkflowSignalsService.create().failed(error, { projectId: "project_1" });

      expect(linesAt(ERROR_LEVEL)).toHaveLength(1);
      expect(linesAt(WARN_LEVEL)).toHaveLength(0);
    });
  });
});
