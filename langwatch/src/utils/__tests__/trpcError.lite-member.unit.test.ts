/**
 * Unit tests for the isHandledByGlobalHandler error deduplication pattern.
 *
 * Tests the mark-and-check mechanism that prevents duplicate toast+modal
 * errors when global handlers (license limit or lite member restriction)
 * have already handled a mutation error.
 *
 * Related component integration tests:
 * - components/settings/__tests__/LLMModelCostDrawer.lite-member.integration.test.tsx
 */
import { describe, expect, it } from "vitest";
import {
  isHandledByGlobalHandler,
  isHandledByLiteMemberHandler,
  isHandledByGlobalLicenseHandler,
  markAsHandledByLiteMemberHandler,
  markAsHandledByLicenseHandler,
} from "../trpcError";

describe("isHandledByGlobalHandler()", () => {
  describe("when error is marked by lite member handler", () => {
    it("returns true", () => {
      const error = new Error("Lite member restricted");
      markAsHandledByLiteMemberHandler(error);

      expect(isHandledByGlobalHandler(error)).toBe(true);
    });
  });

  describe("when error is marked by license handler", () => {
    it("returns true", () => {
      const error = new Error("License limit exceeded");
      markAsHandledByLicenseHandler(error);

      expect(isHandledByGlobalHandler(error)).toBe(true);
    });
  });

  describe("when error is not marked by any handler", () => {
    it("returns false", () => {
      const error = new Error("Network error");

      expect(isHandledByGlobalHandler(error)).toBe(false);
    });
  });

  describe("when error is null or undefined", () => {
    it("returns false for null", () => {
      expect(isHandledByGlobalHandler(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isHandledByGlobalHandler(undefined)).toBe(false);
    });
  });

  describe("when error is a non-Error value", () => {
    it("returns false for string", () => {
      expect(isHandledByGlobalHandler("some error string")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isHandledByGlobalHandler(42)).toBe(false);
    });
  });
});

describe("markAsHandledByLiteMemberHandler()", () => {
  it("marks the error so isHandledByLiteMemberHandler returns true", () => {
    const error = new Error("Restricted");

    expect(isHandledByLiteMemberHandler(error)).toBe(false);
    markAsHandledByLiteMemberHandler(error);
    expect(isHandledByLiteMemberHandler(error)).toBe(true);
  });

  it("does not affect other error instances", () => {
    const error1 = new Error("Restricted");
    const error2 = new Error("Also restricted");

    markAsHandledByLiteMemberHandler(error1);

    expect(isHandledByLiteMemberHandler(error1)).toBe(true);
    expect(isHandledByLiteMemberHandler(error2)).toBe(false);
  });
});

describe("markAsHandledByLicenseHandler()", () => {
  it("marks the error so isHandledByGlobalLicenseHandler returns true", () => {
    const error = new Error("Limit exceeded");

    expect(isHandledByGlobalLicenseHandler(error)).toBe(false);
    markAsHandledByLicenseHandler(error);
    expect(isHandledByGlobalLicenseHandler(error)).toBe(true);
  });

  it("does not affect other error instances", () => {
    const error1 = new Error("Limit exceeded");
    const error2 = new Error("Also exceeded");

    markAsHandledByLicenseHandler(error1);

    expect(isHandledByGlobalLicenseHandler(error1)).toBe(true);
    expect(isHandledByGlobalLicenseHandler(error2)).toBe(false);
  });
});

describe("error deduplication pattern", () => {
  describe("when both handlers mark the same error", () => {
    it("returns true for isHandledByGlobalHandler", () => {
      const error = new Error("Double handled");
      markAsHandledByLiteMemberHandler(error);
      markAsHandledByLicenseHandler(error);

      expect(isHandledByGlobalHandler(error)).toBe(true);
      expect(isHandledByLiteMemberHandler(error)).toBe(true);
      expect(isHandledByGlobalLicenseHandler(error)).toBe(true);
    });
  });

  describe("when simulating onError callback pattern", () => {
    it("prevents toast when error is pre-handled", () => {
      const error = new Error("Restricted");
      markAsHandledByLiteMemberHandler(error);

      // Simulate the pattern used in LLMModelCostDrawer.tsx onError:
      // if (isHandledByGlobalHandler(error)) return;
      // toaster.create(...)
      let toastCalled = false;
      if (!isHandledByGlobalHandler(error)) {
        toastCalled = true;
      }

      expect(toastCalled).toBe(false);
    });

    it("allows toast when error is not pre-handled", () => {
      const error = new Error("Network error");

      let toastCalled = false;
      if (!isHandledByGlobalHandler(error)) {
        toastCalled = true;
      }

      expect(toastCalled).toBe(true);
    });
  });
});
