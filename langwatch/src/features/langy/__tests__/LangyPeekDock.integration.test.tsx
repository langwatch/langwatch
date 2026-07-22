/**
 * @vitest-environment jsdom
 *
 * Integration test for the minimised peek — the panel's closed state.
 *
 * Spec: specs/langy/langy-peek-dock.feature
 *
 * Boundary mocks: useDrawer (whether a right-anchored drawer holds the edge).
 * The zustand store is REAL — the peek's whole contract is that it drives and
 * follows `isOpen`, so the open transition is asserted through the store,
 * exactly as LangySidecar wires it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawerState = { current: null as string | null };
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ currentDrawer: drawerState.current }),
}));

// A controllable crash INSIDE the peek, on the real render path: the
// proximity hook throwing during render is exactly the shape of failure the
// error boundary exists for. Real behaviour everywhere else.
const proximityState = { shouldThrow: false };
vi.mock("../hooks/useLangyPeekProximity", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../hooks/useLangyPeekProximity")
    >();
  return {
    useLangyPeekProximity: (
      args: Parameters<typeof actual.useLangyPeekProximity>[0],
    ) => {
      if (proximityState.shouldThrow) throw new Error("peek exploded");
      return actual.useLangyPeekProximity(args);
    },
  };
});

import { LangyPeekDock } from "../components/LangyPeekDock";
import { useLangyStore } from "../stores/langyStore";

/** The peek exactly as LangySidecar mounts it: prop-fed from the real store. */
function Harness() {
  const isOpen = useLangyStore((s) => s.isOpen);
  const openPanel = useLangyStore((s) => s.openPanel);
  return (
    <ChakraProvider value={defaultSystem}>
      <LangyPeekDock isOpen={isOpen} onOpen={openPanel} />
    </ChakraProvider>
  );
}

const peek = () =>
  screen.queryByRole("button", { name: "Open Langy assistant" });

/** A pointer move the proximity listener can read (jsdom has no PointerEvent). */
const movePointer = (clientX: number, clientY: number) => {
  const event = new Event("pointermove");
  Object.assign(event, { clientX, clientY });
  act(() => {
    window.dispatchEvent(event);
  });
};

beforeEach(() => {
  drawerState.current = null;
  proximityState.shouldThrow = false;
  useLangyStore.setState({ isOpen: false, panelMode: "floating" });
});

afterEach(() => cleanup());

describe("LangyPeekDock", () => {
  describe("given the panel is minimised in floating mode", () => {
    it("rests as the bottom-edge peek, overlaying rather than reserving room", () => {
      render(<Harness />);
      const button = peek();
      expect(button).not.toBeNull();
      expect(button?.getAttribute("data-peek-mode")).toBe("floating");
      expect(button?.getAttribute("data-peek-phase")).toBe("rest");
      // Overlay, never a push: the store's dock reservation stays off.
      expect(useLangyStore.getState().dockShifted).toBe(false);
    });

    /** @scenario Clicking the peek opens the panel */
    it("opens the panel on click and stands down", async () => {
      render(<Harness />);
      await userEvent.click(peek()!);
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(peek()).toBeNull();
    });

    /** @scenario The peek is a keyboard citizen */
    it("rises on keyboard focus and opens on Enter", async () => {
      render(<Harness />);
      await userEvent.tab();
      expect(peek()?.getAttribute("data-peek-phase")).toBe("near");
      await userEvent.keyboard("{Enter}");
      expect(useLangyStore.getState().isOpen).toBe(true);
    });

    /** @scenario The peek pops closer as the pointer approaches */
    it("pops to the near phase when the pointer enters the edge region", async () => {
      render(<Harness />);
      // jsdom viewport is 1024x768: just above the resting sliver.
      movePointer(800, 740);
      await waitFor(() =>
        expect(peek()?.getAttribute("data-peek-phase")).toBe("near"),
      );
      // ...and settles back once the pointer leaves (past the exit radius).
      movePointer(100, 100);
      await waitFor(() =>
        expect(peek()?.getAttribute("data-peek-phase")).toBe("rest"),
      );
    });

    it("also rises on direct hover, pointer-proximity aside", async () => {
      render(<Harness />);
      await userEvent.hover(peek()!);
      expect(peek()?.getAttribute("data-peek-phase")).toBe("near");
      await userEvent.unhover(peek()!);
      expect(peek()?.getAttribute("data-peek-phase")).toBe("rest");
    });

    /** @scenario A drawer moves the floating peek out of its way */
    it("dodges to the bottom-left while a drawer holds the corner", () => {
      drawerState.current = "traceV2Details";
      render(<Harness />);
      expect(peek()?.getAttribute("data-peek-dodge")).toBe("left");
    });
  });

  describe("given the panel is minimised in sidebar mode", () => {
    beforeEach(() => {
      useLangyStore.setState({ panelMode: "sidebar" });
    });

    it("rests as the right-edge sliver", () => {
      render(<Harness />);
      expect(peek()?.getAttribute("data-peek-mode")).toBe("sidebar");
      expect(peek()?.getAttribute("data-peek-phase")).toBe("rest");
    });

    /** @scenario The sidebar peek holds the right edge above an open drawer */
    it("holds the right edge rather than dodging when a drawer opens", () => {
      drawerState.current = "traceV2Details";
      render(<Harness />);
      expect(peek()?.getAttribute("data-peek-mode")).toBe("sidebar");
      expect(peek()?.getAttribute("data-peek-dodge")).toBeNull();
    });

    it("opens the dock on click", async () => {
      render(<Harness />);
      await userEvent.click(peek()!);
      expect(useLangyStore.getState().isOpen).toBe(true);
    });
  });

  describe("given the panel is open", () => {
    it("renders no peek at all — the panel owns the open surface", () => {
      useLangyStore.setState({ isOpen: true });
      render(<Harness />);
      expect(peek()).toBeNull();
    });

    it("appears when the panel minimises", async () => {
      useLangyStore.setState({ isOpen: true });
      render(<Harness />);
      act(() => {
        useLangyStore.getState().closePanel();
      });
      expect(peek()).not.toBeNull();
    });
  });

  describe("given the peek crashes while rendering", () => {
    it("contains the crash in its own boundary instead of blanking the page", () => {
      proximityState.shouldThrow = true;
      // React reports the caught error to console.error — expected here.
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        // The render itself must not throw past the boundary...
        render(<Harness />);
        // ...the peek is gone, the inline error card stands in its place...
        expect(peek()).toBeNull();
        expect(screen.getByRole("alert")).toBeTruthy();
        // ...and the panel state is untouched: Cmd/Ctrl+I (wired above this
        // subtree) can still open the panel.
        expect(useLangyStore.getState().isOpen).toBe(false);
        act(() => {
          useLangyStore.getState().togglePanel();
        });
        expect(useLangyStore.getState().isOpen).toBe(true);
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe("given the user prefers reduced motion", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockImplementation((query: string) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** @scenario Reduced motion trades the pop for a plain hover state */
    it("ignores pointer proximity but still rises on its own hover", async () => {
      render(<Harness />);
      movePointer(800, 740);
      // No proximity tracking runs at all: the phase never leaves rest.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(peek()?.getAttribute("data-peek-phase")).toBe("rest");
      await userEvent.hover(peek()!);
      expect(peek()?.getAttribute("data-peek-phase")).toBe("near");
    });

    it("fades instead of sliding", () => {
      render(<Harness />);
      const style = peek()!.style;
      expect(style.transition).toContain("opacity");
      expect(style.transition).not.toContain("transform");
    });
  });
});
