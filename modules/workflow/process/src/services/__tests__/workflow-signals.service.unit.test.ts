/** @see modules/workflow/specs/workflow-service.feature */
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLogger: () => logger,
}));

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

beforeEach(() => vi.clearAllMocks());

describe("WorkflowSignalsService.failed", () => {
  describe("when a side effect is refused for a reason the customer fixes", () => {
    /** @scenario "A side effect refused for a reason the customer fixes is a warning, not an error" */
    it("logs a warning with the handled code and nothing at error", () => {
      WorkflowSignalsService.create().failed(new CustomerRefusal(), { projectId: "project_1" });

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          handledErrorCode: "model_not_configured",
          projectId: "project_1",
        }),
        expect.any(String),
      );
    });
  });

  describe("when a side effect fails for a reason that is ours or a provider's", () => {
    /** @scenario "A side effect refused for a reason the customer fixes is a warning, not an error" */
    it.each([new PlatformFailure(), new Error("boom")])("logs %s at error", (error) => {
      WorkflowSignalsService.create().failed(error, { projectId: "project_1" });

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
