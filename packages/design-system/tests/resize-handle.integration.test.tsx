// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResizeHandle } from "../src/components/layout/resize-handle.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function renderHandle({ value = 212 }: { value?: number } = {}) {
  const onChange = vi.fn<(width: number) => void>();
  const onReset = vi.fn<() => void>();
  renderWithDesignSystem(
    <ResizeHandle
      label="Resize sidebar"
      value={value}
      min={212}
      max={480}
      onChange={onChange}
      onReset={onReset}
    />,
  );
  return { onChange, onReset, handle: screen.getByRole("separator", { name: "Resize sidebar" }) };
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
