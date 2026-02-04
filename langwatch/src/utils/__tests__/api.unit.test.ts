import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  extractLimitExceededInfo,
  isHandledByGlobalLicenseHandler,
  markAsHandledByLicenseHandler,
} from "../trpcError";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";

describe("Global mutation error handler", () => {
  beforeEach(() => {
    // Reset the store before each test
    useUpgradeModalStore.getState().close();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("extractLimitExceededInfo", () => {
    it("returns null for non-TRPCClientError", () => {
      const error = new Error("Some error");
      expect(extractLimitExceededInfo(error)).toBeNull();
    });

    it("returns null for non-FORBIDDEN errors", () => {
      const error = new TRPCClientError("Not found", {
        result: {
          error: {
            data: { code: "NOT_FOUND", httpStatus: 404 },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toBeNull();
    });

    it("returns null for FORBIDDEN errors without limit data", () => {
      const error = new TRPCClientError("Forbidden", {
        result: {
          error: {
            data: { code: "FORBIDDEN", httpStatus: 403 },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toBeNull();
    });

    it("extracts limit info from FORBIDDEN error with cause", () => {
      const error = new TRPCClientError("Limit exceeded", {
        result: {
          error: {
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              cause: {
                limitType: "prompts",
                current: 10,
                max: 10,
              },
            },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toEqual({
        limitType: "prompts",
        current: 10,
        max: 10,
      });
    });

    it("extracts limit info for scenarios", () => {
      const error = new TRPCClientError("Limit exceeded", {
        result: {
          error: {
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              cause: {
                limitType: "scenarios",
                current: 5,
                max: 5,
              },
            },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toEqual({
        limitType: "scenarios",
        current: 5,
        max: 5,
      });
    });

    it("extracts limit info for evaluators", () => {
      const error = new TRPCClientError("Limit exceeded", {
        result: {
          error: {
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              cause: {
                limitType: "evaluators",
                current: 3,
                max: 3,
              },
            },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toEqual({
        limitType: "evaluators",
        current: 3,
        max: 3,
      });
    });

    it("handles missing current/max with defaults", () => {
      const error = new TRPCClientError("Limit exceeded", {
        result: {
          error: {
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              cause: {
                limitType: "workflows",
              },
            },
          },
        },
      });
      expect(extractLimitExceededInfo(error)).toEqual({
        limitType: "workflows",
        current: 0,
        max: 0,
      });
    });
  });

  describe("useUpgradeModalStore", () => {
    it("opens modal with limit info", () => {
      const store = useUpgradeModalStore.getState();
      expect(store.isOpen).toBe(false);

      store.open("prompts", 10, 10);

      const updatedState = useUpgradeModalStore.getState();
      expect(updatedState.isOpen).toBe(true);
      expect(updatedState.limitType).toBe("prompts");
      expect(updatedState.current).toBe(10);
      expect(updatedState.max).toBe(10);
    });

    it("closes modal and resets state", () => {
      const store = useUpgradeModalStore.getState();
      store.open("scenarios", 5, 5);
      store.close();

      const updatedState = useUpgradeModalStore.getState();
      expect(updatedState.isOpen).toBe(false);
      expect(updatedState.limitType).toBeNull();
      expect(updatedState.current).toBeNull();
      expect(updatedState.max).toBeNull();
    });
  });

  describe("Global mutation cache integration", () => {
    it("opens upgrade modal when limit error is detected", () => {
      const limitInfo = {
        limitType: "prompts" as const,
        current: 10,
        max: 10,
      };

      // Simulate what the global onError handler does
      useUpgradeModalStore
        .getState()
        .open(limitInfo.limitType, limitInfo.current, limitInfo.max);

      const state = useUpgradeModalStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.limitType).toBe("prompts");
    });

    it("does not open modal for non-limit errors", () => {
      const error = new Error("Network error");
      const limitInfo = extractLimitExceededInfo(error);

      // The global handler would only open modal if limitInfo exists
      if (limitInfo) {
        useUpgradeModalStore
          .getState()
          .open(limitInfo.limitType, limitInfo.current, limitInfo.max);
      }

      const state = useUpgradeModalStore.getState();
      expect(state.isOpen).toBe(false);
    });
  });

  describe("isHandledByGlobalLicenseHandler", () => {
    it("returns false for regular errors", () => {
      const error = new Error("Network error");
      expect(isHandledByGlobalLicenseHandler(error)).toBe(false);
    });

    it("returns false for errors without the flag", () => {
      const error = new TRPCClientError("Limit exceeded", {
        result: {
          error: {
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              cause: { limitType: "prompts", current: 10, max: 10 },
            },
          },
        },
      });
      expect(isHandledByGlobalLicenseHandler(error)).toBe(false);
    });

    it("returns true for errors marked by global handler", () => {
      const error = new Error("Limit exceeded");
      markAsHandledByLicenseHandler(error);
      expect(isHandledByGlobalLicenseHandler(error)).toBe(true);
    });

    it("handles null/undefined gracefully", () => {
      expect(isHandledByGlobalLicenseHandler(null)).toBe(false);
      expect(isHandledByGlobalLicenseHandler(undefined)).toBe(false);
    });
  });
});
