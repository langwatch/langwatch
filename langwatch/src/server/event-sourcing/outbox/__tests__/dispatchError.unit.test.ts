import { describe, expect, it } from "vitest";
import { DispatchError, isDispatchError } from "../dispatchError";

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
