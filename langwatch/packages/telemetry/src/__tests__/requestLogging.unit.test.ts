import { describe, it, expect, vi } from "vitest";
import {
  getStatusCodeFromError,
  getLogLevelFromStatusCode,
  logHttpRequest,
  hasAuthorizationToken,
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

    describe("when error has httpStatus (DomainError)", () => {
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
        const err = Object.assign(new Error("conflict"), { httpStatus: 409, status: 500 });
        expect(getStatusCodeFromError(err)).toBe(409);
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
  });

  describe("hasAuthorizationToken", () => {
    describe("when x-auth-token is present", () => {
      it("returns true", () => {
        expect(hasAuthorizationToken({ "x-auth-token": "tok" })).toBe(true);
      });
    });

    describe("when bearer authorization is present", () => {
      it("returns true", () => {
        expect(hasAuthorizationToken({ authorization: "Bearer abc123" })).toBe(true);
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
        expect(hasAuthorizationToken({ authorization: "Basic xyz" })).toBe(true);
      });
    });

    describe("when authorization header uses lowercase key", () => {
      it("returns true", () => {
        // The function signature accepts `authorization` (lowercase) by definition
        expect(hasAuthorizationToken({ authorization: "Bearer token123" })).toBe(true);
      });
    });

    describe("when headers object is empty", () => {
      it("returns false", () => {
        expect(hasAuthorizationToken({})).toBe(false);
      });
    });
  });
});
