/**
 * @vitest-environment jsdom
 *
 * The lens lives in the URL fragment, and the *stored* last-used lens is a
 * separate preference that only a resolved lens may overwrite. Both entry
 * points into `useURLSync` — a bare URL and a fragment naming a lens — can
 * land on a lens that hasn't hydrated yet (custom lenses arrive from
 * `useLensSync` well after the first apply), and both have to show the default
 * WITHOUT persisting it, or `setUserLenses` loses the id it was waiting to
 * restore. See specs/traces-v2/view-system.feature.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectLensMock = vi.fn();
let persistedLens: string | null = null;
const allLenses = [
  { id: "all-traces", name: "All", filterText: "" },
  { id: "simplified", name: "Simplified", filterText: "" },
];

vi.mock("../../stores/viewStore", () => ({
  useViewStore: (sel: (s: unknown) => unknown) =>
    sel({
      activeLensId: "all-traces",
      allLenses,
      draftState: new Map(),
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

describe("useURLSync lens selection from a fragment", () => {
  describe("given a fragment naming a lens that is already loaded", () => {
    it("selects it and records it as the last-used lens", () => {
      window.history.replaceState(null, "", "/#simplified");
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("simplified", {
        persist: true,
      });
    });
  });

  describe("given a fragment naming a custom lens that hasn't hydrated yet", () => {
    it("shows All without persisting it, so the stored preference survives", () => {
      // A reload or a shared `#custom-…` link: `useURLSync` runs before
      // `useLensSync` has fetched anything, so the lens genuinely isn't in
      // the list yet. Persisting the All fallback here would overwrite the
      // user's last-used lens AND disarm `setUserLenses`'s restore, which
      // only fires while the active lens is still the default.
      persistedLens = "custom-abc";
      window.history.replaceState(null, "", "/#custom-abc");
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
        persist: false,
      });
    });
  });

  describe("given a fragment naming a lens that does not exist at all", () => {
    it("falls back to All without persisting", () => {
      window.history.replaceState(null, "", "/#deleted-by-a-teammate");
      render(<Harness />);
      expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
        persist: false,
      });
    });
  });
});
