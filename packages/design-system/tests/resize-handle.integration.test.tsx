// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResizeHandle } from "../src/components/layout/resize-handle.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function renderHandle({ value = 212, edge }: { value?: number; edge?: "left" | "right" } = {}) {
  const onChange = vi.fn<(width: number) => void>();
  const onReset = vi.fn<() => void>();
  const onDragEnd = vi.fn<(width: number) => void>();
  const onDraggingChange = vi.fn<(dragging: boolean) => void>();
  renderWithDesignSystem(
    <ResizeHandle
      label="Resize sidebar"
      value={value}
      min={212}
      max={480}
      onChange={onChange}
      onReset={onReset}
      edge={edge}
      onDragEnd={onDragEnd}
      onDraggingChange={onDraggingChange}
    />,
  );
  return {
    onChange,
    onReset,
    onDragEnd,
    onDraggingChange,
    handle: screen.getByRole("separator", { name: "Resize sidebar" }),
  };
}

describe("ResizeHandle", () => {
  describe("when the reader drags the edge", () => {
    /** @scenario "Dragging the edge reports a width between the minimum and the maximum" */
    it("reports the dragged width and stops at the maximum", () => {
      const { onChange, handle } = renderHandle();

      fireEvent.pointerDown(handle, { button: 0, clientX: 212, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 312, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: 900, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });

      expect(onChange.mock.calls).toEqual([[312], [480]]);
    });
  });

  describe("when the handle sits on the left edge", () => {
    /** @scenario "Dragging a left-edge handle to the left widens the column" */
    it("widens as the pointer moves left", () => {
      const { onChange, handle } = renderHandle({ value: 300, edge: "left" });

      fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });

      expect(onChange.mock.calls).toEqual([[350], [212]]);
    });

    /** @scenario "The handle works from the keyboard" */
    it("widens with ArrowLeft and narrows with ArrowRight", () => {
      const { onChange, handle } = renderHandle({ value: 300, edge: "left" });

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      fireEvent.keyDown(handle, { key: "ArrowRight" });

      expect(onChange.mock.calls).toEqual([[316], [284]]);
    });
  });

  describe("when a drag ends", () => {
    /** @scenario "The width is reported once when a moved drag is released" */
    it("reports the final width once, and the dragging state around it", () => {
      const { onDragEnd, onDraggingChange, handle } = renderHandle();

      fireEvent.pointerDown(handle, { button: 0, clientX: 212, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 262, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 312, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: 312, pointerId: 1 });

      expect(onDragEnd.mock.calls).toEqual([[312]]);
      expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);
    });

    /** @scenario "Losing pointer capture ends the drag" */
    it("ends the drag when the pointer capture is lost, without a width if it never moved", () => {
      const { onDragEnd, onDraggingChange, handle } = renderHandle();

      fireEvent.pointerDown(handle, { button: 0, clientX: 212, pointerId: 1 });
      fireEvent.lostPointerCapture(handle, { pointerId: 1 });

      expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);
      expect(onDragEnd).not.toHaveBeenCalled();
    });

    /** @scenario "The width is reported once when a moved drag is released" */
    it("reports no width for a click without movement", () => {
      const { onDragEnd, handle } = renderHandle();

      fireEvent.pointerDown(handle, { button: 0, clientX: 212, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: 212, pointerId: 1 });

      expect(onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe("when the reader uses the keyboard", () => {
    /** @scenario "The handle works from the keyboard" */
    it("reads as a vertical separator and steps the width", () => {
      const { onChange, handle } = renderHandle({ value: 300 });

      expect(handle.getAttribute("aria-orientation")).toBe("vertical");
      expect(handle.getAttribute("aria-valuenow")).toBe("300");
      expect(handle.getAttribute("aria-valuemin")).toBe("212");
      expect(handle.getAttribute("aria-valuemax")).toBe("480");
      expect(handle.tabIndex).toBe(0);

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      fireEvent.keyDown(handle, { key: "Home" });
      fireEvent.keyDown(handle, { key: "End" });

      expect(onChange.mock.calls).toEqual([[316], [284], [212], [480]]);
    });
  });

  describe("when the reader double-clicks the edge", () => {
    /** @scenario "Double-clicking the edge puts the column back to its default width" */
    it("asks the column to reset", () => {
      const { onReset, handle } = renderHandle({ value: 400 });

      fireEvent.doubleClick(handle);

      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});
