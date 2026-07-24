/**
 * @vitest-environment jsdom
 *
 * Unit tests for spotlight URL fragment sync:
 *   readSpotlightFragment / writeSpotlightFragment / useSpotlightURLSync
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Store mocks ──────────────────────────────────────────────────────────────

let mockSpotlightsActive = false;
let mockCurrentSpotlightId: string | null = null;

const mockSetSpotlightsActive = vi.fn((v: boolean) => {
  mockSpotlightsActive = v;
});
const mockSetCurrentSpotlightId = vi.fn((id: string | null) => {
  mockCurrentSpotlightId = id;
});

vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      spotlightsActive: mockSpotlightsActive,
      currentSpotlightId: mockCurrentSpotlightId,
      setSpotlightsActive: mockSetSpotlightsActive,
      setCurrentSpotlightId: mockSetCurrentSpotlightId,
    }),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import {
  readSpotlightFragment,
  useSpotlightURLSync,
  writeSpotlightFragment,
} from "../SpotlightOverlay";

// Stub history.replaceState so fragment writes don't throw in jsdom
const historyReplaceState = vi
  .spyOn(window.history, "replaceState")
  .mockImplementation(() => undefined);

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  historyReplaceState.mockClear();
  mockSpotlightsActive = false;
  mockCurrentSpotlightId = null;
  // Reset hash to empty
  window.location.hash = "";
});

// ─── readSpotlightFragment ────────────────────────────────────────────────────

describe("readSpotlightFragment", () => {
  describe("when hash is empty", () => {
    it("returns null", () => {
      window.location.hash = "";
      expect(readSpotlightFragment()).toBeNull();
    });
  });

  describe("when hash contains an sp= prefix", () => {
    it("returns the spotlight id", () => {
      window.location.hash = "#sp=evaluator-drill";
      expect(readSpotlightFragment()).toBe("evaluator-drill");
    });
  });

  describe("when hash has unrelated content (lens fragment)", () => {
    it("returns null", () => {
      window.location.hash = "#all-traces";
      expect(readSpotlightFragment()).toBeNull();
    });
  });

  describe("when hash is sp= with no value", () => {
    it("returns null", () => {
      window.location.hash = "#sp=";
      expect(readSpotlightFragment()).toBeNull();
    });
  });
});

// ─── writeSpotlightFragment ───────────────────────────────────────────────────

describe("writeSpotlightFragment", () => {
  describe("when called with an id", () => {
    it("calls history.replaceState with the sp= fragment", () => {
      writeSpotlightFragment("search-bar");
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        expect.stringContaining("sp=search-bar"),
      );
    });
  });

  describe("when called with null", () => {
    it("calls history.replaceState to remove the fragment", () => {
      writeSpotlightFragment(null);
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        expect.not.stringContaining("sp="),
      );
    });
  });
});

// ─── useSpotlightURLSync ──────────────────────────────────────────────────────

describe("useSpotlightURLSync", () => {
  describe("when hash contains #sp=evaluator-drill on mount", () => {
    it("activates spotlights and sets the current id", async () => {
      window.location.hash = "#sp=evaluator-drill";

      await act(async () => {
        renderHook(() => useSpotlightURLSync());
      });

      expect(mockSetSpotlightsActive).toHaveBeenCalledWith(true);
      expect(mockSetCurrentSpotlightId).toHaveBeenCalledWith("evaluator-drill");
    });
  });

  describe("when hash is empty on mount", () => {
    it("does not activate spotlights", async () => {
      window.location.hash = "";

      await act(async () => {
        renderHook(() => useSpotlightURLSync());
      });

      expect(mockSetSpotlightsActive).not.toHaveBeenCalled();
    });
  });
});
