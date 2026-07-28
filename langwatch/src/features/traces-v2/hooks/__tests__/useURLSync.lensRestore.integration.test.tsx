/**
 * @vitest-environment jsdom
 *
 * The lens lives in the URL fragment, but a bare URL (no fragment) must
 * restore the user's last-used lens instead of snapping to All. This covers
 * that empty-fragment path of useURLSync — the fix that makes the
 * localStorage lens preference actually stick across navigation.
 * See specs/traces-v2/view-system.feature.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectLensMock = vi.fn();
let persistedLens: string | null = null;
const allLenses = [
  { id: "all-traces", name: "All" },
  { id: "simplified", name: "Simplified" },
];

vi.mock("../../stores/viewStore", () => ({
  useViewStore: (sel: (s: unknown) => unknown) =>
    sel({
      activeLensId: "all-traces",
      allLenses,
      selectLens: selectLensMock,
    }),
  getPersistedActiveLensId: () => persistedLens,
}));

vi.mock("../../stores/filterStore", () => ({
  useFilterStore: (sel: (s: unknown) => unknown) =>
    sel({
      queryText: "",
      timeRange: {
        from: 0,
        to: 1,
        label: "Last 30 days",
        presetId: "30d",
      },
      applyQueryText: vi.fn(),
      setTimeRange: vi.fn(),
      resetPagination: vi.fn(),
    }),
}));

import { useURLSync } from "../useURLSync";

function Harness() {
  useURLSync();
  return null;
}

beforeEach(() => {
  selectLensMock.mockClear();
  persistedLens = null;
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useURLSync lens restore on a bare URL", () => {
  describe("given no fragment and a persisted built-in lens", () => {
    it("restores the persisted lens (and lets it persist)", () => {
      persistedLens = "simplified";
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("simplified", {
        persist: true,
      });
    });
  });

  describe("given no fragment and no persisted lens", () => {
    it("falls back to All without persisting (so an un-hydrated custom lens survives)", () => {
      persistedLens = null;
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
        persist: false,
      });
    });
  });

  describe("given a persisted lens id that isn't in the loaded lenses yet", () => {
    it("falls back to All without persisting", () => {
      persistedLens = "custom-not-hydrated";
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
        persist: false,
      });
    });
  });
});
