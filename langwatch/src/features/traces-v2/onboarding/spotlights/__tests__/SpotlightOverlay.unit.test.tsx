/**
 * @vitest-environment jsdom
 *
 * Unit tests for SpotlightOverlay rendering and navigation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable store state ──────────────────────────────────────────────────────

let mockSpotlightsActive = false;
let mockCurrentSpotlightId: string | null = null;

const mockSetSpotlightsActive = vi.fn((v: boolean) => {
  mockSpotlightsActive = v;
});
const mockSetCurrentSpotlightId = vi.fn((id: string | null) => {
  mockCurrentSpotlightId = id;
});
const mockPersistDismissal = vi.fn();

vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      spotlightsActive: mockSpotlightsActive,
      currentSpotlightId: mockCurrentSpotlightId,
      setSpotlightsActive: mockSetSpotlightsActive,
      setCurrentSpotlightId: mockSetCurrentSpotlightId,
    }),
}));

vi.mock("../../hooks/useTraceExplorerTourPreference", () => ({
  useTraceExplorerTourPreference: () => ({
    dismiss: mockPersistDismissal,
    isDismissed: false,
    isResolved: true,
  }),
}));

// Stub history.replaceState so fragment writes don't throw in jsdom
const historyReplaceState = vi
  .spyOn(window.history, "replaceState")
  .mockImplementation(() => undefined);

// Make requestAnimationFrame execute synchronously in jsdom so the
// anchor measurement effect fires within `act()` / `waitFor()`.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", () => undefined);

// ─── Module under test ────────────────────────────────────────────────────────
import React from "react";
import {
  type AnchorRect,
  isAnchorParkedOffscreen,
  isAnchorSettled,
  SpotlightOverlay,
} from "../SpotlightOverlay";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../spotlights";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addAnchor(anchor: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-spotlight", anchor);
  el.style.width = "200px";
  el.style.height = "40px";
  document.body.appendChild(el);
  return el;
}

function renderOverlay() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SpotlightOverlay />
    </ChakraProvider>,
  );
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  historyReplaceState.mockClear();
  // Remove all anchor elements added during the test
  document.querySelectorAll("[data-spotlight]").forEach((el) => el.remove());
});

beforeEach(() => {
  mockSpotlightsActive = false;
  mockCurrentSpotlightId = null;
  // Ensure hash is empty so URL sync on mount does nothing
  window.location.hash = "";
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<SpotlightOverlay />", () => {
  describe("given spotlightsActive is false", () => {
    describe("when rendered", () => {
      it("renders nothing", () => {
        renderOverlay();
        expect(
          screen.queryByTestId("spotlight-popover"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given spotlightsActive is true", () => {
    describe("when the first spotlight's anchor is in the DOM", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = TRACE_EXPLORER_SPOTLIGHTS[0]!.id;
        addAnchor(TRACE_EXPLORER_SPOTLIGHTS[0]!.anchor);
      });

      it("renders the spotlight popover", async () => {
        renderOverlay();
        await waitFor(() =>
          expect(screen.getByTestId("spotlight-popover")).toBeInTheDocument(),
        );
      });

      it("shows the spotlight title", async () => {
        renderOverlay();
        const title = TRACE_EXPLORER_SPOTLIGHTS[0]!.title;
        if (title) {
          await waitFor(() =>
            expect(screen.getByText(title)).toBeInTheDocument(),
          );
        }
      });

      it("shows a Next button (not Done) because there are more spotlights", async () => {
        renderOverlay();
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: /next spotlight/i }),
          ).toBeInTheDocument(),
        );
      });
    });

    describe("when user clicks Next", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = TRACE_EXPLORER_SPOTLIGHTS[0]!.id;
        addAnchor(TRACE_EXPLORER_SPOTLIGHTS[0]!.anchor);
      });

      it("advances the current spotlight id to the second one", async () => {
        renderOverlay();
        const nextBtn = await waitFor(() =>
          screen.getByRole("button", { name: /next spotlight/i }),
        );
        fireEvent.click(nextBtn);
        expect(mockSetCurrentSpotlightId).toHaveBeenCalledWith(
          TRACE_EXPLORER_SPOTLIGHTS[1]!.id,
        );
      });
    });

    describe("when user clicks the dismiss (✕) button", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = TRACE_EXPLORER_SPOTLIGHTS[0]!.id;
        addAnchor(TRACE_EXPLORER_SPOTLIGHTS[0]!.anchor);
      });

      it("calls setSpotlightsActive(false)", async () => {
        renderOverlay();
        const dismissBtn = await waitFor(() =>
          screen.getByRole("button", { name: /dismiss tour/i }),
        );
        fireEvent.click(dismissBtn);
        expect(mockSetSpotlightsActive).toHaveBeenCalledWith(false);
      });

      it("clears the current spotlight id", async () => {
        renderOverlay();
        const dismissBtn = await waitFor(() =>
          screen.getByRole("button", { name: /dismiss tour/i }),
        );
        fireEvent.click(dismissBtn);
        expect(mockSetCurrentSpotlightId).toHaveBeenCalledWith(null);
      });

      it("persists dismissal for the authenticated user", async () => {
        renderOverlay();
        const skipButton = await waitFor(() =>
          screen.getByRole("button", { name: /skip tour/i }),
        );
        fireEvent.click(skipButton);
        expect(mockPersistDismissal).toHaveBeenCalledOnce();
      });
    });

    describe("when on the last spotlight and user clicks Done", () => {
      beforeEach(() => {
        const last = TRACE_EXPLORER_SPOTLIGHTS.at(-1)!;
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = last.id;
        // Only add the last anchor — earlier ones don't need to be present for
        // this assertion
        addAnchor(last.anchor);
      });

      it("dismisses the tour", async () => {
        renderOverlay();
        const doneBtn = await waitFor(() =>
          screen.getByRole("button", { name: /finish tour/i }),
        );
        fireEvent.click(doneBtn);
        expect(mockSetSpotlightsActive).toHaveBeenCalledWith(false);
        expect(mockPersistDismissal).toHaveBeenCalledOnce();
      });
    });

    describe("when the anchor element is not in the DOM", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = TRACE_EXPLORER_SPOTLIGHTS[0]!.id;
        // Deliberately do NOT add the anchor element
      });

      it("skips the spotlight (no popover rendered)", async () => {
        renderOverlay();
        // Should skip to next or dismiss — no popover for the missing anchor
        // Wait briefly to ensure rAF has had a chance to fire and skip.
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
        expect(
          screen.queryByTestId("spotlight-popover"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when a conditional anchor is missing but its fallback exists", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        // evaluator-drill's primary anchor (evaluator-drilldown) only
        // exists with a row expanded; the tour must fall back to the
        // always-present evaluator-section anchor instead of skipping —
        // skipping was how the 4-step tour died after step 2.
        mockCurrentSpotlightId = "evaluator-drill";
        addAnchor("evaluator-section");
      });

      it("renders the spotlight against the fallback anchor", async () => {
        renderOverlay();
        await waitFor(() =>
          expect(screen.getByTestId("spotlight-popover")).toBeInTheDocument(),
        );
        expect(screen.getByText("Evaluator drilldown")).toBeInTheDocument();
      });
    });

    describe("when Escape is pressed", () => {
      beforeEach(() => {
        mockSpotlightsActive = true;
        mockCurrentSpotlightId = TRACE_EXPLORER_SPOTLIGHTS[0]!.id;
        addAnchor(TRACE_EXPLORER_SPOTLIGHTS[0]!.anchor);
      });

      it("dismisses the tour", async () => {
        renderOverlay();
        // Wait for the overlay to become visible first
        await waitFor(() =>
          expect(screen.getByTestId("spotlight-popover")).toBeInTheDocument(),
        );
        fireEvent.keyDown(window, { key: "Escape" });
        expect(mockSetSpotlightsActive).toHaveBeenCalledWith(false);
        expect(mockPersistDismissal).toHaveBeenCalledOnce();
      });
    });
  });
});

// The drawer companion ride slides the drawer in from the right, parking its
// anchors off-screen mid-ride. These predicates gate WHERE the fixed ring may
// land so it (and its full-viewport scrim) never strand off-screen.
// Spec: specs/langy/langy-panel-layout.feature.
describe("anchor settle predicates", () => {
  const VW = 1440;
  const rect = (over: Partial<AnchorRect> = {}): AnchorRect => ({
    top: 100,
    left: 200,
    width: 120,
    height: 40,
    ...over,
  });

  describe("isAnchorParkedOffscreen", () => {
    describe("given the anchor's left edge is at or past the right viewport edge", () => {
      it("reports it parked off-screen", () => {
        expect(isAnchorParkedOffscreen(rect({ left: VW }), VW, 0)).toBe(true);
        expect(isAnchorParkedOffscreen(rect({ left: VW + 500 }), VW, 0)).toBe(
          true,
        );
      });
    });

    describe("given the anchor sits within the viewport", () => {
      it("reports it on-screen (a zero-rect included, for jsdom)", () => {
        expect(isAnchorParkedOffscreen(rect({ left: 200 }), VW, 0)).toBe(false);
        expect(
          isAnchorParkedOffscreen(rect({ left: 0, width: 0 }), VW, 0),
        ).toBe(false);
      });
    });

    describe("given the page is scrolled horizontally", () => {
      it("subtracts scrollX before testing the edge", () => {
        // left carries scrollX; a rect at viewport x=200 reads on-screen.
        expect(isAnchorParkedOffscreen(rect({ left: VW + 200 }), VW, 500)).toBe(
          false,
        );
      });
    });
  });

  describe("isAnchorSettled", () => {
    describe("given the anchor is on-screen and unchanged since the last frame", () => {
      it("reports it settled", () => {
        expect(isAnchorSettled(rect(), rect(), VW, 0)).toBe(true);
      });
    });

    describe("given the anchor is still parked off-screen", () => {
      it("is never settled, even if unchanged (parked, not resting)", () => {
        const parked = rect({ left: VW });
        expect(isAnchorSettled(parked, parked, VW, 0)).toBe(false);
      });
    });

    describe("given the anchor moved since the last frame", () => {
      it("is not settled (still riding in)", () => {
        expect(isAnchorSettled(rect({ left: 200 }), rect({ left: 260 }), VW, 0)).toBe(
          false,
        );
      });
    });

    describe("given there is no prior frame to compare", () => {
      it("is not settled yet", () => {
        expect(isAnchorSettled(rect(), null, VW, 0)).toBe(false);
        expect(isAnchorSettled(null, rect(), VW, 0)).toBe(false);
      });
    });
  });
});
