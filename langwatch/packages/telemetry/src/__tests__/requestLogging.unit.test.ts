import { describe, it, expect, vi } from "vitest";
import {
  getStatusCodeFromError,
  getLogLevelFromStatusCode,
  logHttpRequest,
  hasAuthorizationToken,
} from "../request/requestLogging";

describe("requestLogging", () => {
  describe("getStatusCodeFromError", () => {
    it("returns 200 when no error", () => {
      expect(getStatusCodeFromError(null)).toBe(200);
      expect(getStatusCodeFromError(undefined)).toBe(200);
    });

    it("returns 500 for generic errors", () => {
      expect(getStatusCodeFromError(new Error("fail"))).toBe(500);
    });

    it("returns httpStatus from DomainError-like errors", () => {
      const err = Object.assign(new Error("not found"), { httpStatus: 404 });
      expect(getStatusCodeFromError(err)).toBe(404);
    });

    it("returns status from HttpError-like errors", () => {
      const err = Object.assign(new Error("bad request"), { status: 400 });
      expect(getStatusCodeFromError(err)).toBe(400);
    });

    it("prefers httpStatus over status", () => {
      const err = Object.assign(new Error("conflict"), { httpStatus: 409, status: 500 });
      expect(getStatusCodeFromError(err)).toBe(409);
    });
  });

  describe("getLogLevelFromStatusCode", () => {
    it("returns error for 5xx", () => {
      expect(getLogLevelFromStatusCode(500)).toBe("error");
      expect(getLogLevelFromStatusCode(503)).toBe("error");
    });

    it("returns info for 404", () => {
      expect(getLogLevelFromStatusCode(404)).toBe("info");
    });

    it("returns warn for other 4xx", () => {
      expect(getLogLevelFromStatusCode(400)).toBe("warn");
      expect(getLogLevelFromStatusCode(403)).toBe("warn");
    });

    it("returns info for success", () => {
      expect(getLogLevelFromStatusCode(200)).toBe("info");
      expect(getLogLevelFromStatusCode(301)).toBe("info");
    });
  });

  describe("logHttpRequest", () => {
    it("logs at appropriate level based on status code", () => {
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

  describe("hasAuthorizationToken", () => {
    it("detects x-auth-token", () => {
      expect(hasAuthorizationToken({ "x-auth-token": "tok" })).toBe(true);
    });

    it("detects bearer authorization", () => {
      expect(hasAuthorizationToken({ authorization: "Bearer abc123" })).toBe(true);
    });

    it("returns false when no token", () => {
      expect(hasAuthorizationToken({})).toBe(false);
    });
  });
});
