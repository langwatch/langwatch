import { describe, expect, it } from "vitest";
import {
  DispatchError,
  extractHttpStatus,
  isDispatchError,
  isRetryableHttpStatus,
  toDispatchError,
} from "../dispatchError";

describe("DispatchError", () => {
  describe("when constructed", () => {
    it("captures message, retryable flag, and cause", () => {
      const cause = new Error("inner");
      const err = new DispatchError({
        message: "outer",
        retryable: false,
        cause,
      });
      expect(err.message).toBe("outer");
      expect(err.retryable).toBe(false);
      expect(err.cause).toBe(cause);
      expect(err.name).toBe("DispatchError");
    });

    it("identifies as a real Error", () => {
      const err = new DispatchError({ message: "x", retryable: true });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DispatchError);
    });
  });
});

describe("isDispatchError", () => {
  describe("when given a DispatchError instance", () => {
    it("returns true", () => {
      expect(
        isDispatchError(new DispatchError({ message: "x", retryable: true })),
      ).toBe(true);
    });
  });

  describe("when given anything else", () => {
    it("returns false", () => {
      expect(isDispatchError(new Error("plain"))).toBe(false);
      expect(isDispatchError("string-error")).toBe(false);
      expect(isDispatchError(null)).toBe(false);
      expect(isDispatchError(undefined)).toBe(false);
      expect(isDispatchError({ retryable: true })).toBe(false);
    });
  });
});

describe("isRetryableHttpStatus", () => {
  describe("when the status is a rate limit or server error", () => {
    it("returns true for 429 and 5xx", () => {
      expect(isRetryableHttpStatus(429)).toBe(true);
      expect(isRetryableHttpStatus(500)).toBe(true);
      expect(isRetryableHttpStatus(503)).toBe(true);
    });
  });

  describe("when the status is a client error other than 429", () => {
    it("returns false", () => {
      expect(isRetryableHttpStatus(400)).toBe(false);
      expect(isRetryableHttpStatus(404)).toBe(false);
      expect(isRetryableHttpStatus(410)).toBe(false);
    });
  });
});

describe("extractHttpStatus", () => {
  describe("when the error carries a status in a known shape", () => {
    it("reads the AWS SDK v3 metadata status", () => {
      expect(extractHttpStatus({ $metadata: { httpStatusCode: 500 } })).toBe(
        500,
      );
    });

    it("reads an axios/@slack/webhook nested response status", () => {
      expect(extractHttpStatus({ original: { response: { status: 404 } } })).toBe(
        404,
      );
    });

    it("reads a numeric SendGrid code", () => {
      expect(extractHttpStatus({ code: 429 })).toBe(429);
    });
  });

  describe("when the error carries no recognizable status", () => {
    it("ignores string transport codes and returns undefined", () => {
      expect(extractHttpStatus({ code: "ECONNREFUSED" })).toBeUndefined();
      expect(extractHttpStatus(new Error("boom"))).toBeUndefined();
      expect(extractHttpStatus("nope")).toBeUndefined();
      expect(extractHttpStatus(null)).toBeUndefined();
    });
  });
});

describe("toDispatchError", () => {
  describe("when given an existing DispatchError", () => {
    it("returns it unchanged", () => {
      const original = new DispatchError({ message: "x", retryable: false });
      expect(toDispatchError(original, { message: "wrapped" })).toBe(original);
    });
  });

  describe("when the failure has a retryable status", () => {
    it("produces a retryable DispatchError", () => {
      const err = toDispatchError(
        { $metadata: { httpStatusCode: 503 } },
        { message: "send failed" },
      );
      expect(err).toBeInstanceOf(DispatchError);
      expect(err.retryable).toBe(true);
      expect(err.message).toBe("send failed");
    });
  });

  describe("when the failure has a terminal status", () => {
    it("produces a non-retryable DispatchError", () => {
      const err = toDispatchError(
        { response: { status: 404 } },
        { message: "send failed" },
      );
      expect(err.retryable).toBe(false);
    });
  });

  describe("when the failure has no recognizable status", () => {
    it("defaults to retryable and preserves the cause", () => {
      const cause = new Error("connection refused");
      const err = toDispatchError(cause, { message: "send failed" });
      expect(err.retryable).toBe(true);
      expect(err.cause).toBe(cause);
    });
  });
});
