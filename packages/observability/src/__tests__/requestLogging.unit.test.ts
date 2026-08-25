import { describe, expect, it, vi } from "vitest";
import { REQUEST_CAUSE_FIELD } from "../constants";
import {
  getLogLevelFromStatusCode,
  getStatusCodeFromError,
  hasAuthorizationToken,
  logHttpRequest,
} from "../request/requestLogging";

describe("requestLogging", () => {
  describe("getStatusCodeFromError", () => {
    describe("when no error is provided", () => {
      it("returns 200", () => {
        expect(getStatusCodeFromError(null)).toBe(200);
        expect(getStatusCodeFromError(undefined)).toBe(200);
      });
    });

    describe("when a generic Error is provided", () => {
      it("returns 500", () => {
        expect(getStatusCodeFromError(new Error("fail"))).toBe(500);
      });
    });

    describe("when error has httpStatus (HandledError)", () => {
      it("returns the httpStatus value", () => {
        const err = Object.assign(new Error("not found"), { httpStatus: 404 });
        expect(getStatusCodeFromError(err)).toBe(404);
      });
    });

    describe("when error has status (HttpError)", () => {
      it("returns the status value", () => {
        const err = Object.assign(new Error("bad request"), { status: 400 });
        expect(getStatusCodeFromError(err)).toBe(400);
      });
    });

    describe("when error has both httpStatus and status", () => {
      it("prefers httpStatus", () => {
        const err = Object.assign(new Error("conflict"), {
          httpStatus: 409,
          status: 500,
        });
        expect(getStatusCodeFromError(err)).toBe(409);
      });
    });

    describe("when error is a plain object with status", () => {
      it("returns the status value", () => {
        expect(getStatusCodeFromError({ status: 401 })).toBe(401);
      });
    });

    describe("when error is a plain object with httpStatus", () => {
      it("returns the httpStatus value", () => {
        expect(getStatusCodeFromError({ httpStatus: 403 })).toBe(403);
      });
    });
  });

  describe("getLogLevelFromStatusCode", () => {
    describe("when status is 5xx", () => {
      it("returns error", () => {
        expect(getLogLevelFromStatusCode(500)).toBe("error");
        expect(getLogLevelFromStatusCode(503)).toBe("error");
      });
    });

    describe("when status is 404", () => {
      it("returns info", () => {
        expect(getLogLevelFromStatusCode(404)).toBe("info");
      });
    });

    describe("when status is other 4xx", () => {
      it("returns warn", () => {
        expect(getLogLevelFromStatusCode(400)).toBe("warn");
        expect(getLogLevelFromStatusCode(403)).toBe("warn");
      });
    });

    describe("when status is 2xx or 3xx", () => {
      it("returns info", () => {
        expect(getLogLevelFromStatusCode(200)).toBe("info");
        expect(getLogLevelFromStatusCode(301)).toBe("info");
      });
    });
  });

  describe("logHttpRequest", () => {
    describe("when request succeeds", () => {
      it("logs at info level", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "GET",
          url: "/test",
          statusCode: 200,
          duration: 42,
          userAgent: "test-agent",
        });
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ method: "GET", statusCode: 200 }),
          "request handled",
        );
      });
    });

    describe("when extra fields overlap with canonical fields", () => {
      it("preserves canonical field values", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "GET",
          url: "/real-url",
          statusCode: 200,
          duration: 42,
          userAgent: "test-agent",
          extra: { statusCode: 999, url: "/fake-url", customField: "kept" },
        });

        const logData = logger.info.mock.calls[0][0];
        expect(logData.statusCode).toBe(200);
        expect(logData.url).toBe("/real-url");
        expect(logData.customField).toBe("kept");
      });
    });

    describe("when the request carries traffic attribution", () => {
      /** @scenario The request log line carries the attribution fields */
      it("flattens the endpoint class and client fields onto the log line", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "POST",
          url: "/api/collector",
          statusCode: 200,
          duration: 42,
          userAgent: "langwatch-sdk-node/3.1.0",
          attribution: {
            endpointClass: "collector",
            clientSource: "sdk",
            clientSdkName: "langwatch-observability-sdk",
            clientSdkLanguage: "typescript",
            clientSdkVersion: "3.1.0",
          },
        });

        expect(logger.info.mock.calls[0][0]).toMatchObject({
          endpointClass: "collector",
          clientSource: "sdk",
          clientSdkName: "langwatch-observability-sdk",
          clientSdkLanguage: "typescript",
          clientSdkVersion: "3.1.0",
        });
      });
    });

    describe("when request fails with 5xx", () => {
      it("logs at error level", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "POST",
          url: "/fail",
          statusCode: 500,
          duration: 100,
          userAgent: null,
          error: new Error("boom"),
        });
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 500 }),
          "error handling request",
        );
      });
    });

    describe("when the response is a server error but no cause reached the logger", () => {
      const uncaused = () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        logHttpRequest(logger, {
          method: "POST",
          url: "/api/otel/v1/traces",
          statusCode: 500,
          duration: 100,
          userAgent: null,
          // A route that RETURNS a 500 rather than throwing leaves the
          // middleware nothing to attach.
        });
        return logger;
      };

      /** @scenario A server error with no cause attached says so */
      it("does not claim the request was handled", () => {
        expect(uncaused().error.mock.calls[0][1]).not.toBe("request handled");
      });

      /** @scenario A server error with no cause attached says so */
      it("states that no cause was attached", () => {
        const [data, message] = uncaused().error.mock.calls[0];
        expect(message).toMatch(/without a cause/i);
        expect(data.errorType).toBe("UncausedServerError");
      });

      /** @scenario A server error with no cause attached says so */
      it("is still logged at error level with its status", () => {
        const logger = uncaused();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error.mock.calls[0][0]).toMatchObject({
          statusCode: 500,
        });
      });

    });

    describe("when the response succeeds", () => {
      /** @scenario A successful request is still reported as handled */
      it("still reports the request as handled", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        logHttpRequest(logger, {
          method: "GET",
          url: "/ok",
          statusCode: 200,
          duration: 1,
          userAgent: null,
        });
        expect(logger.info.mock.calls[0][1]).toBe("request handled");
        expect(logger.info.mock.calls[0][0]).not.toHaveProperty("errorType");
      });
    });

    describe("when the error is a handled error", () => {
      const handled = (fault: string, httpStatus: number) =>
        Object.assign(new Error("handled"), {
          code: "some_code",
          httpStatus,
          fault,
        });

      /** @scenario A handled customer failure is logged below error */
      it("logs customer-fault at warn even for 5xx, with code and fault in the data", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "POST",
          url: "/query",
          statusCode: 504,
          duration: 100,
          userAgent: null,
          error: handled("customer", 504),
        });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 504,
            handledErrorCode: "some_code",
            handledErrorFault: "customer",
          }),
          "error handling request",
        );
        expect(logger.error).not.toHaveBeenCalled();
      });

      /** @scenario A platform fault is logged at error */
      it("logs platform-fault at error", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

        logHttpRequest(logger, {
          method: "GET",
          url: "/traces",
          statusCode: 503,
          duration: 100,
          userAgent: null,
          error: handled("platform", 503),
        });

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ handledErrorFault: "platform" }),
          "error handling request",
        );
      });
    });

    /**
     * A record we chose to log at warn should not carry a key that claims it
     * failed. The level we meant is on `severity_text`; the payload must not
     * argue with it.
     */
    describe("when the record is logged below error level", () => {
      const handledCustomer = Object.assign(new Error("over quota"), {
        name: "PlanLimitExceededError",
        code: "ERR_PLAN_LIMIT",
        httpStatus: 402,
        fault: "customer",
      });

      function warnData() {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        logHttpRequest(logger, {
          method: "POST",
          url: "/api/otel/v1/traces",
          statusCode: 402,
          duration: 5,
          userAgent: null,
          error: handledCustomer,
        });
        return logger.warn.mock.calls[0][0];
      }

      /** @scenario A record below error level does not carry a field named error */
      it("does not attach the cause under a field named error", () => {
        expect(warnData()).not.toHaveProperty("error");
      });

      it("still carries the cause for diagnosis", () => {
        expect(warnData()[REQUEST_CAUSE_FIELD]).toBe(handledCustomer);
      });

      /** @scenario The error type stays groupable after the cause is re-keyed */
      it("keeps the error type groupable after the move", () => {
        expect(warnData().errorType).toBe("PlanLimitExceededError");
      });

      it("keeps the handled attribution", () => {
        expect(warnData()).toMatchObject({
          handledErrorCode: "ERR_PLAN_LIMIT",
          handledErrorFault: "customer",
        });
      });

      it("applies to info-level records too", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        logHttpRequest(logger, {
          method: "GET",
          url: "/missing",
          statusCode: 404,
          duration: 1,
          userAgent: null,
          error: Object.assign(new Error("nope"), { status: 404 }),
        });

        expect(logger.info.mock.calls[0][0]).not.toHaveProperty("error");
      });
    });

    describe("when the record is logged at error level", () => {
      /** @scenario A record at error level keeps its cause on the error field */
      it("keeps the cause under error so 5xx dashboards are unchanged", () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        const boom = new Error("boom");

        logHttpRequest(logger, {
          method: "POST",
          url: "/fail",
          statusCode: 500,
          duration: 100,
          userAgent: null,
          error: boom,
        });

        const logData = logger.error.mock.calls[0][0];
        expect(logData.error).toBe(boom);
        expect(logData).not.toHaveProperty(REQUEST_CAUSE_FIELD);
      });
    });
  });

  describe("hasAuthorizationToken", () => {
    describe("when x-auth-token is present", () => {
      it("returns true", () => {
        expect(hasAuthorizationToken({ "x-auth-token": "tok" })).toBe(true);
      });
    });

    describe("when bearer authorization is present", () => {
      it("returns true", () => {
        expect(hasAuthorizationToken({ authorization: "Bearer abc123" })).toBe(
          true,
        );
      });
    });

    describe("when no token headers are present", () => {
      it("returns false", () => {
        expect(hasAuthorizationToken({})).toBe(false);
      });
    });

    describe("when x-auth-token is empty string", () => {
      it("returns false", () => {
        expect(hasAuthorizationToken({ "x-auth-token": "" })).toBe(false);
      });
    });

    describe("when authorization is empty string", () => {
      it("returns false", () => {
        expect(hasAuthorizationToken({ authorization: "" })).toBe(false);
      });
    });

    describe("when authorization is 'Bearer ' with no token value", () => {
      it("returns true (header is present)", () => {
        expect(hasAuthorizationToken({ authorization: "Bearer " })).toBe(true);
      });
    });

    describe("when authorization uses Basic scheme", () => {
      it("returns true", () => {
        expect(hasAuthorizationToken({ authorization: "Basic xyz" })).toBe(
          true,
        );
      });
    });

    describe("when authorization header uses lowercase key", () => {
      it("returns true", () => {
        // The function signature accepts `authorization` (lowercase) by definition
        expect(
          hasAuthorizationToken({ authorization: "Bearer token123" }),
        ).toBe(true);
      });
    });

    describe("when headers object is empty", () => {
      it("returns false", () => {
        expect(hasAuthorizationToken({})).toBe(false);
      });
    });
  });
});
