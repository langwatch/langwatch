import { describe, expect, it, vi } from "vitest";
import { REQUEST_CAUSE_FIELD } from "../constants";
import type { Logger } from "../logger";
import { logCaughtError } from "../request/requestLogging";

/**
 * Regression cover for the 2026-08-24 "Error creating prompt" page.
 *
 * `POST /api/prompts` answered an invalid body with a correct 400, then logged
 * the customer-fault `SystemPromptRequiredError` through a hand-rolled
 * `logger.error`. That put the cause under `error`, which ingest derives
 * `error_signature` from, so a caller retrying a bad request once a minute
 * minted a brand-new error signature and paged the team — while the request
 * logger had already recorded the same failure at warn.
 */

const fakeLogger = () =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger & {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

const handled = ({
  code,
  httpStatus,
  fault,
  name,
}: {
  code: string;
  httpStatus: number;
  fault?: string;
  name?: string;
}) =>
  Object.assign(new Error("System prompt is required."), {
    code,
    httpStatus,
    ...(fault ? { fault } : {}),
    name: name ?? "SystemPromptRequiredError",
  });

describe("logCaughtError", () => {
  describe("given a handled error attributed to the customer", () => {
    const subject = () => {
      const logger = fakeLogger();
      logCaughtError({
        logger,
        error: handled({
          code: "system_prompt_required",
          httpStatus: 400,
          fault: "customer",
        }),
        message: "Error creating prompt",
        data: { projectId: "project_abc" },
      });
      return logger;
    };

    describe("when the error is logged", () => {
      /** @scenario "A failure the caller caused does not page the team" */
      it("records it at warn, not error", () => {
        const logger = subject();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });

      /** @scenario "A failure the caller caused does not page the team" */
      it("keeps the cause off the error field so no signature is minted", () => {
        const payload = subject().warn.mock.calls[0]![0] as Record<
          string,
          unknown
        >;
        expect(payload.error).toBeUndefined();
        expect(payload[REQUEST_CAUSE_FIELD]).toBeDefined();
      });

      /** @scenario "A failure the caller caused stays diagnosable" */
      it("restates the type and attribution so the record stays groupable", () => {
        const payload = subject().warn.mock.calls[0]![0] as Record<
          string,
          unknown
        >;
        expect(payload.errorType).toBe("SystemPromptRequiredError");
        expect(payload.handledErrorCode).toBe("system_prompt_required");
        expect(payload.handledErrorFault).toBe("customer");
      });

      /** @scenario "A failure the caller caused stays diagnosable" */
      it("carries the caller's context through", () => {
        const payload = subject().warn.mock.calls[0]![0] as Record<
          string,
          unknown
        >;
        expect(payload.projectId).toBe("project_abc");
      });
    });
  });

  describe("given a handled error attributed to the platform", () => {
    describe("when the error is logged", () => {
      /** @scenario "A failure the platform caused is still an incident" */
      it("records it at error, under the error field", () => {
        const logger = fakeLogger();
        const error = handled({
          code: "database_unavailable",
          httpStatus: 503,
          fault: "platform",
          name: "DatabaseUnavailableError",
        });

        logCaughtError({ logger, error, message: "Error creating prompt" });

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
        const payload = logger.error.mock.calls[0]![0] as Record<
          string,
          unknown
        >;
        expect(payload.error).toBe(error);
      });
    });
  });

  describe("given an unhandled error", () => {
    describe("when the error is logged", () => {
      /** @scenario "A failure nobody anticipated is still an incident" */
      it("records it at error, under the error field", () => {
        const logger = fakeLogger();
        const error = new Error("socket hang up");

        logCaughtError({
          logger,
          error,
          message: "Error creating prompt",
          data: { projectId: "project_abc" },
        });

        expect(logger.warn).not.toHaveBeenCalled();
        const payload = logger.error.mock.calls[0]![0] as Record<
          string,
          unknown
        >;
        expect(payload.error).toBe(error);
        expect(payload.projectId).toBe("project_abc");
      });
    });
  });

  describe("given a handled error carrying no fault attribution", () => {
    describe("when the error is logged", () => {
      /** @scenario "A failure nobody anticipated is still an incident" */
      it("records it at error rather than assuming it is the caller's doing", () => {
        const logger = fakeLogger();

        logCaughtError({
          logger,
          error: handled({ code: "unknown_failure", httpStatus: 500 }),
          message: "Error creating prompt",
        });

        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
      });
    });
  });
});
