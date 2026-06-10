/**
 * @vitest-environment jsdom
 *
 * Unit tests for SpotlightOverlay rendering and navigation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, act, fireEvent, waitFor } from "@testing-library/react";
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

vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      spotlightsActive: mockSpotlightsActive,
      currentSpotlightId: mockCurrentSpotlightId,
      setSpotlightsActive: mockSetSpotlightsActive,
      setCurrentSpotlightId: mockSetCurrentSpotlightId,
    }),
}));

// Stub history.replaceState so fragment writes don't throw in jsdom
const historyReplaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);

// Make requestAnimationFrame execute synchronously in jsdom so the
// anchor measurement effect fires within `act()` / `waitFor()`.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", () => undefined);

// ─── Module under test ────────────────────────────────────────────────────────
import React from "react";
import { SpotlightOverlay } from "../SpotlightOverlay";
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
        expect(screen.queryByTestId("spotlight-popover")).not.toBeInTheDocument();
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
        expect(screen.queryByTestId("spotlight-popover")).not.toBeInTheDocument();
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
      });
    });
  });
});
