/**
 * @vitest-environment jsdom
 *
 * The lens lives in the URL fragment, and the *stored* last-used lens is a
 * separate preference that only a resolved lens may overwrite. Both entry
 * points into `useURLSync` — a bare URL and a fragment naming a lens — can
 * land on a lens that hasn't hydrated yet (custom lenses arrive from
 * `useLensSync` well after the first apply), and both have to show the default
 * WITHOUT persisting it, or `setUserLenses` loses the id it was waiting to
 * restore.
 *
 * Showing the default is only half the answer for a fragment, though: the lens
 * it names is the address someone shared, so the apply is replayed once the
 * list can actually hold it. See specs/traces-v2/view-system.feature and
 * specs/traces-v2/data-layer.feature ("Shared URL restores full state").
 */
import { render } from "@testing-library/react";
// `useURLSync` reads React Router's own `useLocation()` now (see the
// push-driven-navigation effect), which throws outside a Router context.
// `BrowserRouter`, not `MemoryRouter`, so it reads the SAME
// `window.location` this file drives directly via `window.history`.
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectLensMock = vi.fn();
let persistedLens: string | null = null;
const BUILT_INS = [
  { id: "all-traces", name: "All", filterText: "" },
  { id: "simplified", name: "Simplified", filterText: "" },
];
const SHARED_LENS = { id: "custom-abc", name: "Shared", filterText: "" };
// Both are read through the store mock on every render, so reassigning them
// between renders is how this file plays out a hydration: `setUserLenses`
// hands the store a NEW list, and restores the last-used lens in the same
// write.
let allLenses = BUILT_INS;
let activeLensId = "all-traces";

vi.mock("@langwatch/trace-web/view.store", () => ({
  useViewStore: (sel: (s: unknown) => unknown) =>
    sel({
      activeLensId,
      allLenses,
      draftState: new Map(),
      selectLens: selectLensMock,
    }),
  getPersistedActiveLensId: () => persistedLens,
}));

vi.mock("@langwatch/trace-web/filter.store", () => ({
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
  return (
    <BrowserRouter>
      <HookMount />
    </BrowserRouter>
  );
}

function HookMount() {
  useURLSync();
  return null;
}

beforeEach(() => {
  selectLensMock.mockClear();
  persistedLens = null;
  allLenses = BUILT_INS;
  activeLensId = "all-traces";
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useURLSync lens restore on a bare URL", () => {
  describe("given no fragment and a persisted built-in lens", () => {
    describe("when the hook mounts", () => {
      it("restores the persisted lens (and lets it persist)", () => {
        persistedLens = "simplified";
        render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("simplified", {
          persist: true,
        });
      });
    });
  });

  describe("given no fragment and no persisted lens", () => {
    describe("when the hook mounts", () => {
      it("falls back to All without persisting (so an un-hydrated custom lens survives)", () => {
        persistedLens = null;
        render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
          persist: false,
        });
      });
    });
  });

  describe("given a persisted lens id that isn't in the loaded lenses yet", () => {
    describe("when the hook mounts", () => {
      it("falls back to All without persisting", () => {
        persistedLens = "custom-not-hydrated";
        render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
          persist: false,
        });
      });
    });
  });
});

describe("useURLSync lens selection from a fragment", () => {
  describe("given a fragment naming a lens that is already loaded", () => {
    describe("when the hook mounts", () => {
      it("selects it and records it as the last-used lens", () => {
        window.history.replaceState(null, "", "/#simplified");
        render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("simplified", {
          persist: true,
        });
      });
    });
  });

  describe("given a fragment naming a custom lens that hasn't hydrated yet", () => {
    describe("when the hook mounts", () => {
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

    describe("when the lens list arrives carrying that lens", () => {
      it("applies the lens the link named", () => {
        // The other half of the reload/shared-link case above. The recipient
        // of a shared link has their own last-used lens, which `setUserLenses`
        // restores in the same write that hydrates the list — so without a
        // replay the link is applied as All, then quietly swapped for the
        // viewer's own view, and the address is rewritten out of the URL bar
        // 150ms later. Nothing about it ever loaded.
        persistedLens = "simplified";
        window.history.replaceState(null, "", "/#custom-abc");
        const { rerender } = render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
          persist: false,
        });

        // One write, both changes: the list hydrates and the viewer's own
        // last-used lens is restored off the back of it.
        allLenses = [...BUILT_INS, SHARED_LENS];
        activeLensId = "simplified";
        rerender(<Harness />);

        expect(selectLensMock).toHaveBeenLastCalledWith("custom-abc", {
          persist: true,
        });
      });
    });

    describe("when the user picks another lens before that one arrives", () => {
      it("leaves their choice alone", () => {
        // The replay is for a link nobody has answered yet. A lens picked
        // while the list was loading is the user deciding, and it outranks the
        // address they arrived on.
        window.history.replaceState(null, "", "/#custom-abc");
        const { rerender } = render(<Harness />);

        activeLensId = "simplified";
        rerender(<Harness />);

        allLenses = [...BUILT_INS, SHARED_LENS];
        rerender(<Harness />);

        // Only the mount's fallback — the fragment never gets a second word.
        expect(selectLensMock).toHaveBeenCalledTimes(1);
        expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
          persist: false,
        });
      });
    });
  });

  describe("given a fragment naming a lens that does not exist at all", () => {
    describe("when the lens list arrives without it", () => {
      it("falls back to All without persisting, and stops waiting for it", () => {
        window.history.replaceState(null, "", "/#deleted-by-a-teammate");
        const { rerender } = render(<Harness />);
        expect(selectLensMock).toHaveBeenCalledWith("all-traces", {
          persist: false,
        });

        allLenses = [...BUILT_INS, SHARED_LENS];
        rerender(<Harness />);

        expect(selectLensMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});
