// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock posthog-js before importing the module under test
vi.mock("posthog-js", () => ({
  default: {
    __loaded: true,
    capture: vi.fn(),
  },
}));

import posthog from "posthog-js";
import { captureException, toError } from "../posthogErrorCapture";

describe("captureException()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when called with an Error instance", () => {
    it("captures the error message", () => {
      const error = new Error("connection failed");

      captureException(error);

      expect(posthog.capture).toHaveBeenCalledWith(
        "$exception",
        expect.objectContaining({
          $exception_message: "connection failed",
        }),
      );
    });

    it("captures the error constructor name as exception type", () => {
      const error = new Error("connection failed");

      captureException(error);

      expect(posthog.capture).toHaveBeenCalledWith(
        "$exception",
        expect.objectContaining({
          $exception_type: "Error",
        }),
      );
    });

    it("includes the stack trace", () => {
      const error = new Error("connection failed");

      captureException(error);

      expect(posthog.capture).toHaveBeenCalledWith(
        "$exception",
        expect.objectContaining({
          $exception_stack_trace_raw: expect.stringContaining(
            "connection failed",
          ),
        }),
      );
    });
  });

  describe("when called with a string", () => {
    it("captures the string as the exception message", () => {
      captureException("timeout occurred");

      expect(posthog.capture).toHaveBeenCalledWith(
        "$exception",
        expect.objectContaining({
          $exception_message: "timeout occurred",
        }),
      );
    });

    it("sets the exception type to Error", () => {
      captureException("timeout occurred");

      expect(posthog.capture).toHaveBeenCalledWith(
        "$exception",
        expect.objectContaining({
          $exception_type: "Error",
        }),
      );
    });
  });
});

describe("toError()", () => {
  describe("when given an Error instance", () => {
    it("returns the same Error reference", () => {
      const original = new Error("already an error");

      const result = toError(original);

      expect(result).toBe(original);
    });
  });

  describe("when given a string", () => {
    it("returns a new Error with that string as message", () => {
      const result = toError("something went wrong");

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("something went wrong");
    });
  });

  describe("when given a plain object", () => {
    it("returns a new Error with String(object) as message", () => {
      const result = toError({ foo: "bar" });

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("[object Object]");
    });
  });

  describe("when given null", () => {
    it("returns a new Error with 'null' as message", () => {
      const result = toError(null);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("null");
    });
  });

  describe("when given undefined", () => {
    it("returns a new Error with 'undefined' as message", () => {
      const result = toError(undefined);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("undefined");
    });
  });
});
