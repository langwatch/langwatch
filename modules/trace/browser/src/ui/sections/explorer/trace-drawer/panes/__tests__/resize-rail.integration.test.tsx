/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  drawerChrome,
} from "../../../../../../behavior/drawer-chrome.store.ts";
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

import { ResizeRail } from "../resize-rail.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const VIEWPORT_WIDTH = 1440;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
  localStorage.clear();
  drawerChrome.setState(drawerChrome.getInitialState(), true);
});

afterEach(cleanup);

// jsdom does not implement setPointerCapture / releasePointerCapture —
// they're not part of the DOM standard yet. The component already
// no-ops on throw, so stubbing them with vi is unnecessary, but we
// stub here to silence the harmless warning that would otherwise log.
function patchPointerCapture(el: Element | null) {
  if (!el) return;
  el.setPointerCapture = () => undefined;
  el.releasePointerCapture = () => undefined;
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
  describe("given the rail is mounted", () => {
    describe("when looked up via the data-edge-grip selector", () => {
      /** @scenario Hit area covers full drawer height */
      it("renders into the DOM as a pointer-only grip hidden from assistive tech", () => {
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        expect(el.getAttribute("aria-hidden")).toBe("true");
        // The pill is rendered as a child element, also via data attr.
        expect(el.querySelector("[data-edge-pill]")).not.toBeNull();
      });
    });
  });

  describe("given the rail is mounted", () => {
    describe("when checked for keyboard focus", () => {
      /** @scenario Rail is not keyboard-focusable */
      it("does not have tabIndex set so Tab never lands on it", () => {
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        expect(el.getAttribute("tabindex")).toBeNull();
      });
    });
  });

  describe("given the user drags the rail", () => {
    describe("when pointermove fires with a leftward delta", () => {
      /** @scenario Drag the left-edge grip to resize the drawer */
      it("updates the drawer width to current + |dx|", () => {
        // Start from a known width so the math is checkable.
        drawerChrome.getState().setWidthPx(640);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        // Pointer events in jsdom: PointerEvent constructor exists,
        // but use fireEvent.pointerDown to keep the surface API.
        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        fireEvent.pointerMove(el, { clientX: 800, pointerId: 1 });

        // Dragging the rail leftward by 200px widens the drawer to 840px.
        expect(drawerChrome.getState().widthPx).toBe(840);

        fireEvent.pointerUp(el, { clientX: 800, pointerId: 1 });
      });
    });

    describe("when pointermove drags past the min clamp", () => {
      /** @scenario Width is clamped to a minimum */
      it("does not let widthPx drop below DRAWER_MIN_WIDTH_PX", () => {
        drawerChrome.getState().setWidthPx(400);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        // Drag rightward 800px → propose 400 - 800 = -400, clamp to min.
        fireEvent.pointerMove(el, { clientX: 1800, pointerId: 1 });

        expect(drawerChrome.getState().widthPx).toBe(DRAWER_MIN_WIDTH_PX);

        fireEvent.pointerUp(el, { clientX: 1800, pointerId: 1 });
      });
    });

    describe("when pointermove drags past the max clamp", () => {
      /** @scenario Width is clamped to a maximum */
      it("does not let widthPx exceed viewport - edge", () => {
        drawerChrome.getState().setWidthPx(800);

        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        // Drag leftward 2000px → propose 2800px, clamp to viewport-edge.
        fireEvent.pointerMove(el, { clientX: -1000, pointerId: 1 });

        expect(drawerChrome.getState().widthPx).toBe(VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX);

        fireEvent.pointerUp(el, { clientX: -1000, pointerId: 1 });
      });
    });
  });

  describe("given the user double-clicks the rail without dragging", () => {
    describe("when double-click fires", () => {
      /** @scenario Double-click the grip toggles maximize and restore */
      it("snaps the width to viewport - edge", () => {
        drawerChrome.getState().setWidthPx(700);
        render(<ResizeRail />, { wrapper });
        const el = getRail();
        fireEvent.doubleClick(el);
        expect(drawerChrome.getState().widthPx).toBe(VIEWPORT_WIDTH - DRAWER_MAXIMIZE_EDGE_PX);
      });
    });
  });

  describe("given the user single-clicks the rail without dragging", () => {
    describe("when only a pointerdown/up fires (no double click)", () => {
      /** @scenario Single-click the grip does NOT toggle width */
      it("does not change the width", () => {
        drawerChrome.getState().setWidthPx(700);
        render(<ResizeRail />, { wrapper });
        const el = getRail();

        fireEvent.pointerDown(el, { clientX: 1000, button: 0, pointerId: 1 });
        fireEvent.pointerUp(el, { clientX: 1000, pointerId: 1 });

        expect(drawerChrome.getState().widthPx).toBe(700);
      });
    });
  });
});
