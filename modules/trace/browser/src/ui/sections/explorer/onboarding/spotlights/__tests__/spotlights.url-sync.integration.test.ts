/**
 * Unit tests for spotlight URL fragment sync: readSpotlightFragment /
 * writeSpotlightFragment / useSpotlightURLSync
 * @vitest-environment jsdom
 */
import { parseFragment } from "@langwatch/trace-contract";
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

vi.mock("../../../../../../behavior/explorer/onboarding/store/onboarding-store.ts", () => ({
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
} from "../spotlight-overlay.tsx";

const realReplaceState = window.history.replaceState.bind(window.history);

// Stub history.replaceState so fragment writes don't throw in jsdom
const historyReplaceState = vi
  .spyOn(window.history, "replaceState")
  .mockImplementation(() => undefined);

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  historyReplaceState.mockClear();
  historyReplaceState.mockImplementation(() => undefined);
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
      window.location.hash = "#sp=search-bar";
      writeSpotlightFragment(null);
      expect(historyReplaceState).toHaveBeenCalledWith(
        null,
        "",
        expect.not.stringContaining("sp="),
      );
    });
  });
});

// ─── Explorer state in the same fragment ─────────────────────────────────────

describe("when the fragment already carries explorer state", () => {
  const explorerHash = "#all-traces?q=trace.attribute.laze.agent.id%3Aagt_123&preset=7d";

  beforeEach(() => {
    historyReplaceState.mockImplementation((...args) => realReplaceState(...args));
    realReplaceState(null, "", `/traces?langy=open${explorerHash}`);
  });

  describe("when a tour step is written", () => {
    /** @scenario "The tour step sits beside the explorer state" */
    it("keeps the explorer state and adds the step", () => {
      writeSpotlightFragment("search-bar");

      expect(window.location.search).toBe("?langy=open");
      expect(window.location.hash).toBe(`${explorerHash}&sp=search-bar`);
      expect(readSpotlightFragment()).toBe("search-bar");
    });

    it("replaces the previous step instead of stacking steps", () => {
      writeSpotlightFragment("search-bar");
      writeSpotlightFragment("filter-sidebar");

      expect(window.location.hash).toBe(`${explorerHash}&sp=filter-sidebar`);
    });
  });

  describe("when the tour ends", () => {
    /** @scenario "A deep-linked filter survives the first-visit tour" */
    it("removes only the step and keeps the explorer state", () => {
      writeSpotlightFragment("search-bar");
      writeSpotlightFragment(null);

      expect(window.location.hash).toBe(explorerHash);
      expect(readSpotlightFragment()).toBeNull();
      // A reload restores the bar state through the same parser useURLSync applies.
      expect(parseFragment(window.location.hash)).toEqual({
        lensId: "all-traces",
        overrides: { query: "trace.attribute.laze.agent.id:agt_123", preset: "7d" },
      });
    });
  });

  describe("when no tour step was written", () => {
    it("leaves the explorer state alone on end", () => {
      writeSpotlightFragment(null);

      expect(window.location.hash).toBe(explorerHash);
    });
  });

  describe("when the fragment names a lens with no parameters", () => {
    it("adds the step as the lens's first parameter", () => {
      realReplaceState(null, "", "/traces#custom-abc");

      writeSpotlightFragment("search-bar");

      expect(window.location.hash).toBe("#custom-abc?sp=search-bar");
      writeSpotlightFragment(null);
      expect(window.location.hash).toBe("#custom-abc");
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
