/**
 * @vitest-environment jsdom
 *
 * Unit tests for the show-once drawer spotlight queue.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let mockPageTourActive = false;
let mockSeenDrawerSpotlights: Record<string, boolean> = {};

const mockMarkDrawerSpotlightSeen = vi.fn((id: string) => {
  mockSeenDrawerSpotlights = { ...mockSeenDrawerSpotlights, [id]: true };
});

vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      spotlightsActive: mockPageTourActive,
      seenDrawerSpotlights: mockSeenDrawerSpotlights,
      markDrawerSpotlightSeen: mockMarkDrawerSpotlightSeen,
    }),
}));

// Make requestAnimationFrame execute synchronously in jsdom so queue
// computation and anchor measurement fire within render/waitFor.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(performance.now());
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", () => undefined);

import React from "react";
import { DrawerSpotlights } from "../DrawerSpotlights";

function addAnchor(anchor: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-spotlight", anchor);
  document.body.appendChild(el);
  return el;
}

function renderDrawerSpotlights(traceId = "trace-1") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DrawerSpotlights traceId={traceId} />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.querySelectorAll("[data-spotlight]").forEach((el) => el.remove());
});

beforeEach(() => {
  mockPageTourActive = false;
  mockSeenDrawerSpotlights = {};
});

describe("<DrawerSpotlights />", () => {
  describe("given anchors for io and events exist and nothing is seen", () => {
    beforeEach(() => {
      addAnchor("drawer-io");
      addAnchor("drawer-events");
    });

    describe("when the drawer mounts", () => {
      it("shows the Input & output spotlight first", async () => {
        renderDrawerSpotlights();
        await waitFor(() =>
          expect(screen.getByText("Input & output")).toBeInTheDocument(),
        );
      });

      it("marks the displayed spotlight seen immediately", async () => {
        renderDrawerSpotlights();
        await waitFor(() =>
          expect(screen.getByText("Input & output")).toBeInTheDocument(),
        );
        expect(mockMarkDrawerSpotlightSeen).toHaveBeenCalledWith("drawer-io");
        expect(mockMarkDrawerSpotlightSeen).not.toHaveBeenCalledWith(
          "drawer-events",
        );
      });
    });

    describe("when user clicks Next", () => {
      it("shows Events and io has been marked seen", async () => {
        renderDrawerSpotlights();
        const nextBtn = await waitFor(() =>
          screen.getByRole("button", { name: /next spotlight/i }),
        );
        expect(mockMarkDrawerSpotlightSeen).toHaveBeenCalledWith("drawer-io");
        fireEvent.click(nextBtn);
        await waitFor(() =>
          expect(screen.getByText("Events")).toBeInTheDocument(),
        );
        expect(mockMarkDrawerSpotlightSeen).toHaveBeenCalledWith(
          "drawer-events",
        );
      });
    });

    describe("when user dismisses via the ✕ button", () => {
      it("closes the queue without displaying the remaining spotlight", async () => {
        renderDrawerSpotlights();
        const dismissBtn = await waitFor(() =>
          screen.getByRole("button", { name: /dismiss tour/i }),
        );
        fireEvent.click(dismissBtn);
        await waitFor(() =>
          expect(
            screen.queryByTestId("spotlight-popover"),
          ).not.toBeInTheDocument(),
        );
        expect(mockMarkDrawerSpotlightSeen).not.toHaveBeenCalledWith(
          "drawer-events",
        );
      });
    });

    describe("when Escape is pressed", () => {
      it("closes the queue", async () => {
        renderDrawerSpotlights();
        await waitFor(() =>
          expect(screen.getByTestId("spotlight-popover")).toBeInTheDocument(),
        );
        fireEvent.keyDown(window, { key: "Escape" });
        await waitFor(() =>
          expect(
            screen.queryByTestId("spotlight-popover"),
          ).not.toBeInTheDocument(),
        );
      });
    });
  });

  describe("given the io spotlight has already been seen", () => {
    beforeEach(() => {
      mockSeenDrawerSpotlights = { "drawer-io": true };
      addAnchor("drawer-io");
      addAnchor("drawer-events");
    });

    describe("when the drawer mounts", () => {
      it("shows only the Events spotlight", async () => {
        renderDrawerSpotlights();
        await waitFor(() =>
          expect(screen.getByText("Events")).toBeInTheDocument(),
        );
        expect(screen.queryByText("Input & output")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the page tour is active", () => {
    beforeEach(() => {
      mockPageTourActive = true;
      addAnchor("drawer-io");
      addAnchor("drawer-events");
    });

    describe("when the drawer mounts", () => {
      it("renders nothing", async () => {
        renderDrawerSpotlights();
        await new Promise((r) => setTimeout(r, 25));
        expect(
          screen.queryByTestId("spotlight-popover"),
        ).not.toBeInTheDocument();
        expect(mockMarkDrawerSpotlightSeen).not.toHaveBeenCalled();
      });
    });
  });

  describe("given no anchors are in the DOM", () => {
    describe("when the drawer mounts", () => {
      it("renders nothing and marks nothing seen", async () => {
        renderDrawerSpotlights();
        await new Promise((r) => setTimeout(r, 25));
        expect(
          screen.queryByTestId("spotlight-popover"),
        ).not.toBeInTheDocument();
        expect(mockMarkDrawerSpotlightSeen).not.toHaveBeenCalled();
      });
    });
  });
});
