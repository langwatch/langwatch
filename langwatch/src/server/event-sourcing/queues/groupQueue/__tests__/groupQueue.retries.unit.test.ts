import { describe, expect, it } from "vitest";
import { DispatchError } from "@langwatch/dispatch-error";
import {
  ConfigurationError,
  categorizeError,
  ErrorCategory,
  QueueError,
  SecurityError,
  ValidationError,
} from "../../../services/errorHandling";
import { isRetryableJobError, retryBackoffMsFor } from "../groupQueue";

describe("groupQueue retry categorization", () => {
  describe("when error is a ValidationError", () => {
    it("categorizes as CRITICAL (non-retryable)", () => {
      const error = new ValidationError("invalid schema", "traceId");

      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("when error is a SecurityError", () => {
    it("categorizes as CRITICAL (non-retryable)", () => {
      const error = new SecurityError("checkTenant", "tenant mismatch", "t1");

      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("when error is a ConfigurationError", () => {
    it("categorizes as CRITICAL (non-retryable)", () => {
      const error = new ConfigurationError("pipeline", "missing handler");

      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("when error is a QueueError", () => {
    it("categorizes as RECOVERABLE (retryable)", () => {
      const error = new QueueError("test-queue", "send", "connection lost");

      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.RECOVERABLE);
    });
  });

  describe("when error is an unknown Error", () => {
    it("defaults to RECOVERABLE (retryable)", () => {
      const error = new Error("something unexpected");

      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.RECOVERABLE);
    });
  });

  describe("when error is a non-Error value", () => {
    it("defaults to RECOVERABLE (retryable)", () => {
      const category = categorizeError("string error");

      expect(category).toBe(ErrorCategory.RECOVERABLE);
    });
  });

  describe("retry decision logic", () => {
    it("skips retries for ValidationError on first attempt", () => {
      const error = new ValidationError("bad data", "field");

      expect(isRetryableJobError(error)).toBe(false);
    });

    it("allows retries for QueueError", () => {
      const error = new QueueError("q", "op", "transient");

      expect(isRetryableJobError(error)).toBe(true);
    });

    it("allows retries for generic errors", () => {
      const error = new Error("unknown");

      expect(isRetryableJobError(error)).toBe(true);
    });

    describe("when error is an outbox DispatchError", () => {
      it("skips retries when the dispatcher marked it non-retryable", () => {
        const error = new DispatchError({
          message: "bad webhook config",
          retryable: false,
        });

        expect(isRetryableJobError(error)).toBe(false);
      });

      it("allows retries when the dispatcher marked it retryable", () => {
        const error = new DispatchError({
          message: "provider 503",
          retryable: true,
        });

        expect(isRetryableJobError(error)).toBe(true);
      });
    });
  });
});

describe("groupQueue retry backoff", () => {
  describe("when a retryable dispatch error carries Retry-After", () => {
    it("uses the receiver delay when it exceeds exponential backoff", () => {
      const error = new DispatchError({
        message: "rate limited",
        retryable: true,
        retryAfterMs: 90_000,
      });

      expect(retryBackoffMsFor({ attempt: 1, error })).toBe(90_000);
    });

    it("keeps exponential backoff when Retry-After is shorter", () => {
      const baseline = retryBackoffMsFor({ attempt: 3, error: new Error() });
      const error = new DispatchError({
        message: "retry soon",
        retryable: true,
        retryAfterMs: 1,
      });

      expect(retryBackoffMsFor({ attempt: 3, error })).toBe(baseline);
    });
  });
});
