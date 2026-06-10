/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../../../../stores/drawerStore";
import { ResizeRail } from "../ResizeRail";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const VIEWPORT_WIDTH = 1440;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
  useDrawerStore.getState().setWidthPx(null);
  localStorage.clear();
});

afterEach(cleanup);

// jsdom does not implement setPointerCapture / releasePointerCapture —
// they're not part of the DOM standard yet. The component already
// no-ops on throw, so stubbing them with vi is unnecessary, but we
// stub here to silence the harmless warning that would otherwise log.
type Capturable = { setPointerCapture?: unknown; releasePointerCapture?: unknown };
function patchPointerCapture(el: Element | null) {
  if (!el) return;
  const target = el as unknown as Capturable;
  target.setPointerCapture = () => undefined;
  target.releasePointerCapture = () => undefined;
}

function getRail(): HTMLElement {
  // The rail is aria-hidden by design but exposes a stable
  // data-edge-grip attribute that the empty-state onboarding tour
  // already keys off — use the same selector for tests.
  const el = document.querySelector('[data-edge-grip="true"]');
  if (!el) throw new Error("ResizeRail not in DOM");
  patchPointerCapture(el);
  return el as HTMLElement;
}

describe("ResizeRail", () => {
  /** @scenario Hit area covers full drawer height */
  describe("given the rail is mounted", () => {
    describe("when looked up via the data-edge-grip selector", () => {
      it("renders into the DOM as a separator with col-resize cursor", () => {
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        expect(el.getAttribute("role")).toBe("separator");
        // The pill is rendered as a child element, also via data attr.
        expect(el.querySelector("[data-edge-pill]")).not.toBeNull();
      });
    });
  });

  /** @scenario Rail is not keyboard-focusable */
  describe("given the rail is mounted", () => {
    describe("when checked for keyboard focus", () => {
      it("does not have tabIndex set so Tab never lands on it", () => {
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        expect(el.getAttribute("tabindex")).toBeNull();
      });
    });
  });

  /** @scenario Drag the left-edge grip to resize the drawer */
  describe("given the user drags the rail", () => {
    describe("when pointermove fires with a leftward delta", () => {
      it("updates drawerStore.widthPx to current + |dx|", () => {
        // Start from a known width so the math is checkable.
        useDrawerStore.getState().setWidthPx(640);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        // Pointer events in jsdom: PointerEvent constructor exists,
        // but use fireEvent.pointerDown to keep the surface API.
        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        fireEvent.pointerMove(el, { clientX: 800, pointerId: 1 });

        // Dragging the rail leftward by 200px widens the drawer to 840px.
        expect(useDrawerStore.getState().widthPx).toBe(840);

        fireEvent.pointerUp(el, { clientX: 800, pointerId: 1 });
      });
    });

    /** @scenario Width is clamped to a minimum */
    describe("when pointermove drags past the min clamp", () => {
      it("does not let widthPx drop below DRAWER_MIN_WIDTH_PX", () => {
        useDrawerStore.getState().setWidthPx(400);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        // Drag rightward 800px → propose 400 - 800 = -400, clamp to min.
        fireEvent.pointerMove(el, { clientX: 1800, pointerId: 1 });

        expect(useDrawerStore.getState().widthPx).toBe(DRAWER_MIN_WIDTH_PX);

        fireEvent.pointerUp(el, { clientX: 1800, pointerId: 1 });
      });
    });

    /** @scenario Width is clamped to a maximum */
    describe("when pointermove drags past the max clamp", () => {
      it("does not let widthPx exceed viewport - edge", () => {
        useDrawerStore.getState().setWidthPx(800);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        // Drag leftward 2000px → propose 2800px, clamp to viewport-edge.
        fireEvent.pointerMove(el, { clientX: -1000, pointerId: 1 });

        expect(useDrawerStore.getState().widthPx).toBe(
          VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX,
        );

        fireEvent.pointerUp(el, { clientX: -1000, pointerId: 1 });
      });
    });
  });

  /** @scenario Double-click the grip toggles maximize and restore */
  describe("given the user double-clicks the rail without dragging", () => {
    describe("when double-click fires", () => {
      it("snaps the width to viewport - edge", () => {
        useDrawerStore.getState().setWidthPx(700);
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        fireEvent.doubleClick(el);
        expect(useDrawerStore.getState().widthPx).toBe(
          VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX,
        );
      });
    });
  });

  /** @scenario Single-click the grip does NOT toggle width */
  describe("given the user single-clicks the rail without dragging", () => {
    describe("when only a pointerdown/up fires (no double click)", () => {
      it("does not change the width", () => {
        useDrawerStore.getState().setWidthPx(700);
        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        fireEvent.pointerUp(el, { clientX: 1000, pointerId: 1 });

        expect(useDrawerStore.getState().widthPx).toBe(700);
      });
    });
  });
});
